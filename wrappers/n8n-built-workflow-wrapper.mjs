#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const WORKFLOW_ID = 'cwab001builtworkflow';

async function readStdinJson() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  return JSON.parse(input || '{}');
}

function run(command, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      ...opts,
      env: opts.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => resolve({ code: null, error, stdout: '', stderr: String(error.message || error) }));
    child.on('close', (code) => resolve({
      code,
      error: null,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

function fixtureBaseFrom(payload) {
  const endpoints = payload.task?.fixture_context?.endpoints || {};
  const anyEndpoint = endpoints.invoices || endpoints.validate || process.env.CWAB_FIXTURE_URL || '';
  if (!anyEndpoint) return '';
  return String(anyEndpoint).replace(/\/validate$/, '').replace(/\/runs\/.*$/, '');
}

function workflowJson({ base, runId, setupSeconds }) {
  const invoicesUrl = `${base}/runs/${encodeURIComponent(runId)}/invoices`;
  const paymentsUrl = `${base}/runs/${encodeURIComponent(runId)}/payments.csv`;
  const reportUrl = `${base}/runs/${encodeURIComponent(runId)}/report`;
  const messageUrl = `${base}/runs/${encodeURIComponent(runId)}/message`;
  const jsCode = `
const setupSeconds = ${JSON.stringify(setupSeconds)};

function parseCsv(text) {
  const [headerLine, ...rows] = text.trim().split(/\\r?\\n/);
  const headers = headerLine.split(',');
  return rows.map((row) => Object.fromEntries(row.split(',').map((value, i) => [headers[i], value])));
}

const invoices = $('Get Invoices').first().json.invoices || [];
const paymentsText = $('Get Payments').first().json.data || '';
const payments = parseCsv(paymentsText);
const invoiceByVendor = new Map(invoices.map((invoice) => [invoice.vendor, invoice]));
const paymentByVendor = new Map(payments.map((payment) => [payment.vendor, payment]));
const lines = [];

for (const invoice of invoices) {
  const payment = paymentByVendor.get(invoice.vendor);
  if (!payment) {
    lines.push(invoice.vendor + ' unpaid (' + invoice.id + ', $' + invoice.amount_usd + ').');
    continue;
  }
  const paid = Number(payment.amount_usd);
  if (paid === Number(invoice.amount_usd)) {
    lines.push(invoice.vendor + ' paid in full ($' + invoice.amount_usd + ').');
  } else if (paid < Number(invoice.amount_usd)) {
    lines.push(invoice.vendor + ' underpaid by ' + (Number(invoice.amount_usd) - paid) + ' ($' + paid + ' paid vs $' + invoice.amount_usd + ' invoice).');
  } else {
    lines.push(invoice.vendor + ' overpaid by ' + (paid - Number(invoice.amount_usd)) + '.');
  }
}

for (const payment of payments) {
  if (!invoiceByVendor.has(payment.vendor)) {
    lines.push(payment.vendor + ' payment without invoice ($' + payment.amount_usd + ').');
  }
}

const body = ['Invoice reconciliation report', '', ...lines].join('\\n');

return [{
  json: {
    final_text: body,
    human_interventions: 0,
    operator_setup_seconds: setupSeconds,
    estimated_cost_usd: 0,
    tool_calls: 4,
    tool_failures: 0
  }
}];
`;
  const finalCode = `
const result = $('Reconcile Fixture').first().json;
return [{ json: result }];
`;

  const httpGetNode = ({ id, name, url, position, responseFormat }) => ({
    parameters: {
      method: 'GET',
      url,
      authentication: 'none',
      options: {
        response: {
          response: responseFormat === 'text'
            ? { responseFormat: 'text', outputPropertyName: 'data' }
            : { responseFormat: 'json' },
        },
      },
    },
    id,
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position,
  });

  const httpPostNode = ({ id, name, url, position, bodyParameters }) => ({
    parameters: {
      method: 'POST',
      url,
      authentication: 'none',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'keypair',
      bodyParameters: { parameters: bodyParameters },
      options: {
        response: {
          response: { responseFormat: 'json' },
        },
      },
    },
    id,
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position,
  });

  return {
    id: WORKFLOW_ID,
    name: 'CWAB 001 Built Workflow',
    active: false,
    nodes: [
      {
        parameters: {},
        id: 'manual',
        name: 'Manual Trigger',
        type: 'n8n-nodes-base.manualTrigger',
        typeVersion: 1,
        position: [0, 0],
      },
      httpGetNode({
        id: 'get-invoices',
        name: 'Get Invoices',
        url: invoicesUrl,
        position: [240, 0],
        responseFormat: 'json',
      }),
      httpGetNode({
        id: 'get-payments',
        name: 'Get Payments',
        url: paymentsUrl,
        position: [480, 0],
        responseFormat: 'text',
      }),
      {
        parameters: { jsCode },
        id: 'reconcile',
        name: 'Reconcile Fixture',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [720, 0],
      },
      httpPostNode({
        id: 'post-report',
        name: 'Post Report',
        url: reportUrl,
        position: [960, 0],
        bodyParameters: [
          { name: 'title', value: 'Invoice reconciliation report' },
          { name: 'body', value: '={{ $node["Reconcile Fixture"].json["final_text"] }}' },
        ],
      }),
      httpPostNode({
        id: 'post-message',
        name: 'Post Message',
        url: messageUrl,
        position: [1200, 0],
        bodyParameters: [
          { name: 'channel', value: 'finance-ops' },
          { name: 'text', value: '={{ $node["Reconcile Fixture"].json["final_text"] }}' },
        ],
      }),
      {
        parameters: { jsCode: finalCode },
        id: 'final-output',
        name: 'Final Output',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [1440, 0],
      },
    ],
    connections: {
      'Manual Trigger': {
        main: [[{ node: 'Get Invoices', type: 'main', index: 0 }]],
      },
      'Get Invoices': {
        main: [[{ node: 'Get Payments', type: 'main', index: 0 }]],
      },
      'Get Payments': {
        main: [[{ node: 'Reconcile Fixture', type: 'main', index: 0 }]],
      },
      'Reconcile Fixture': {
        main: [[{ node: 'Post Report', type: 'main', index: 0 }]],
      },
      'Post Report': {
        main: [[{ node: 'Post Message', type: 'main', index: 0 }]],
      },
      'Post Message': {
        main: [[{ node: 'Final Output', type: 'main', index: 0 }]],
      },
    },
    settings: { executionOrder: 'v1' },
  };
}

function parseFinalJson(output) {
  for (let start = 0; start < output.length; start += 1) {
    const open = output[start];
    if (open !== '{' && open !== '[') continue;
    const close = open === '{' ? '}' : ']';
    const stack = [close];
    let inString = false;
    let escaped = false;
    for (let index = start + 1; index < output.length; index += 1) {
      const char = output[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        stack.push('}');
      } else if (char === '[') {
        stack.push(']');
      } else if (char === stack[stack.length - 1]) {
        stack.pop();
        if (stack.length === 0) {
          const text = output.slice(start, index + 1);
          try {
            return JSON.parse(text);
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

function firstJsonItem(parsed) {
  if (!parsed) return null;
  if (Array.isArray(parsed)) return parsed[0]?.json || parsed[0] || null;
  return parsed.json || parsed;
}

function extractN8nFinal(parsed) {
  const runData = parsed?.data?.resultData?.runData;
  const finalRun = runData?.['Final Output']?.at?.(-1) || runData?.['Final Output']?.[runData['Final Output'].length - 1];
  const finalItems = finalRun?.data?.main?.[0] || [];
  if (finalItems[0]?.json) return finalItems[0].json;
  return firstJsonItem(parsed);
}

async function writeJsonIfPresent(filePath, value) {
  if (!value) return;
  try {
    await writeFile(filePath, JSON.stringify(value, null, 2));
  } catch {
    // Attempt artifacts are helpful, but should not change benchmark behavior.
  }
}

function normalizeFinalOutput(parsed, fallbackText) {
  const first = extractN8nFinal(parsed);
  return {
    final_text: first?.final_text || fallbackText,
    human_interventions: first?.human_interventions ?? 0,
    operator_setup_seconds: first?.operator_setup_seconds ?? 600,
    estimated_cost_usd: first?.estimated_cost_usd ?? 0,
    tool_calls: first?.tool_calls ?? 4,
    tool_failures: first?.tool_failures ?? 0,
  };
}

function parseLegacyFinalJson(output) {
  const lines = output.trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    const text = line.trim();
    if (!text.startsWith('{') && !text.startsWith('[')) continue;
    try {
      return JSON.parse(text);
    } catch {
      // keep scanning
    }
  }
  return null;
}

const payload = await readStdinJson();
const attemptDir = process.env.CWAB_ATTEMPT_DIR || payload.attempt_dir || '.';
const n8nHome = path.join(attemptDir, 'n8n-home');
await mkdir(n8nHome, { recursive: true });

const fixtureBase = fixtureBaseFrom(payload);
const setupSeconds = Number(process.env.N8N_OPERATOR_SETUP_SECONDS || 600);
const workflowPath = path.join(attemptDir, 'n8n-cwab-001-workflow.json');
await writeFile(workflowPath, JSON.stringify(workflowJson({
  base: fixtureBase,
  runId: payload.run_id,
  setupSeconds,
}), null, 2));

const env = {
  ...process.env,
  N8N_USER_FOLDER: n8nHome,
  N8N_ENCRYPTION_KEY: process.env.N8N_ENCRYPTION_KEY || 'cwab-local-deterministic-key',
  N8N_DIAGNOSTICS_ENABLED: 'false',
  N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
  N8N_TEMPLATES_ENABLED: 'false',
  N8N_SECURE_COOKIE: 'false',
  CWAB_FIXTURE_BASE: fixtureBase,
  CWAB_RUN_ID: payload.run_id,
};

const imported = await run('/usr/local/bin/n8n', ['import:workflow', '--input', workflowPath], { env });
await writeFile(path.join(attemptDir, 'n8n-import.stdout.txt'), imported.stdout);
await writeFile(path.join(attemptDir, 'n8n-import.stderr.txt'), imported.stderr);
if (imported.code !== 0) {
  console.error(imported.stderr || imported.stdout);
  process.exit(imported.code || 1);
}

const executed = await run('/usr/local/bin/n8n', ['execute', '--id', WORKFLOW_ID, '--rawOutput'], { env });
await writeFile(path.join(attemptDir, 'n8n-execute.stdout.txt'), executed.stdout);
await writeFile(path.join(attemptDir, 'n8n-execute.stderr.txt'), executed.stderr);
if (executed.code !== 0) {
  console.error(executed.stderr || executed.stdout);
  process.exit(executed.code || 1);
}

const parsed = parseFinalJson(executed.stdout) || parseLegacyFinalJson(executed.stdout);
await writeJsonIfPresent(path.join(attemptDir, 'n8n-execution-output.json'), parsed);
console.log(JSON.stringify(normalizeFinalOutput(parsed, executed.stdout)));
