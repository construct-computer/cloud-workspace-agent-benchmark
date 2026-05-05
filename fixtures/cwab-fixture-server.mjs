#!/usr/bin/env node

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || process.env.CWAB_FIXTURE_PORT || 6789);
const PUBLIC_BASE_URL = process.env.CWAB_FIXTURE_PUBLIC_URL || `http://localhost:${PORT}`;

const runs = new Map();

function json(res, status, body) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

async function readJson(req) {
  let body = '';
  req.setEncoding('utf8');
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function seedCwab001(runId) {
  return {
    run_id: runId,
    task_id: 'cwab-001',
    invoices: [
      { id: 'inv-alpha', vendor: 'Alpha Hosting', amount_usd: 420, due_date: '2026-05-06' },
      { id: 'inv-alpine', vendor: 'Alpine Hosting', amount_usd: 520, due_date: '2026-05-06' },
      { id: 'inv-bravo', vendor: 'Bravo Design', amount_usd: 950, due_date: '2026-05-07' },
      { id: 'inv-cascade', vendor: 'Cascade Data', amount_usd: 300, due_date: '2026-05-08' },
      { id: 'inv-echo', vendor: 'Echo Systems', amount_usd: 1500, due_date: '2026-05-09' },
      { id: 'inv-foxtrot', vendor: 'Foxtrot Media', amount_usd: 280, due_date: '2026-05-10' },
    ],
    payments: [
      { vendor: 'Alpha Hosting', amount_usd: 420, status: 'paid' },
      { vendor: 'Alpine Hosting', amount_usd: 520, status: 'paid' },
      { vendor: 'Bravo Design', amount_usd: 900, status: 'paid' },
      { vendor: 'Cascade', amount_usd: 300, status: 'paid' },
      { vendor: 'Delta Legal', amount_usd: 200, status: 'paid' },
      { vendor: 'Echo Systems', amount_usd: 1500, status: 'paid' },
      { vendor: 'Foxtrot Media', amount_usd: 350, status: 'paid' },
      { vendor: 'Gamma Corp', amount_usd: 850, status: 'paid' },
    ],
    messages: [],
    reports: [],
    expected: {
      mismatches: [
        'Bravo Design underpaid by 50',
        'Delta Legal payment without invoice',
        'Foxtrot Media overpaid by 70',
        'Gamma Corp payment without invoice',
        'Cascade payment ambiguous vendor name',
      ],
    },
  };
}

function seedCwab001b(runId) {
  return {
    run_id: runId,
    task_id: 'cwab-001b',
    prior_report: {
      title: 'Vendor Reconciliation Report - May 5',
      body: [
        '## Reconciliation Summary (May 5)',
        '',
        '| Vendor | Invoice | Payment | Status |',
        '|--------|---------|---------|--------|',
        '| Alpha Hosting | $420 | $420 | Match |',
        '| Bravo Design | $950 | $900 | Underpaid by $50 |',
        '| Cascade Data | $300 | — | Unpaid |',
        '',
        '**Action items:**',
        '- Bravo Design: collect $50 shortfall',
        '- Cascade Data: initiate payment immediately',
      ].join('\n'),
    },
    new_invoices: [
      { id: 'inv-hotel', vendor: 'Hotel Corp', amount_usd: 600, due_date: '2026-05-11' },
      { id: 'inv-india', vendor: 'India Tech', amount_usd: 450, due_date: '2026-05-12' },
    ],
    new_payments: [
      { vendor: 'Hotel Corp', amount_usd: 600, status: 'paid' },
      { vendor: 'India Tech', amount_usd: 400, status: 'paid' },
    ],
    messages: [],
    reports: [],
    expected: {
      preserved: [
        'Alpha Hosting match',
        'Bravo Design underpaid by 50',
        'Cascade Data unpaid',
      ],
      new_items: [
        'Hotel Corp matched',
        'India Tech underpaid by 50',
      ],
    },
  };
}

function seedGeneric(runId, taskId) {
  return {
    run_id: runId,
    task_id: taskId,
    messages: [],
    reports: [],
    expected: {},
  };
}

function requireRun(runId) {
  const state = runs.get(runId);
  if (!state) throw new Error(`Unknown run_id: ${runId}`);
  return state;
}

function countInvoiceRefs(text) {
  const lower = text.toLowerCase();
  let count = 0;
  // Require vendor name AND exact amount for full credit; handle comma in amounts
  if (/alpha hosting.*?\$?\s*420/i.test(lower) || /420.*?alpha hosting/i.test(lower)) count++;
  if (/alpine hosting.*?\$?\s*520/i.test(lower) || /520.*?alpine hosting/i.test(lower)) count++;
  if (/bravo design.*?\$?\s*950/i.test(lower) || /950.*?bravo design/i.test(lower)) count++;
  if (/cascade data.*?\$?\s*300/i.test(lower) || /300.*?cascade data/i.test(lower)) count++;
  if (/echo systems.*?\$?\s*1?\s*,?\s*500/i.test(lower) || /1?\s*,?\s*500.*?echo systems/i.test(lower)) count++;
  if (/foxtrot media.*?\$?\s*280/i.test(lower) || /280.*?foxtrot media/i.test(lower)) count++;
  return count;
}

function countPaymentRefs(text) {
  const lower = text.toLowerCase();
  let count = 0;
  if (/alpha hosting.*?\$?\s*420/i.test(lower) || /420.*?alpha hosting/i.test(lower)) count++;
  if (/alpine hosting.*?\$?\s*520/i.test(lower) || /520.*?alpine hosting/i.test(lower)) count++;
  if (/bravo design.*?\$?\s*900/i.test(lower) || /900.*?bravo design/i.test(lower)) count++;
  if (/\bcascade\b.*?\$?\s*300/i.test(lower) || /300.*?\bcascade\b/i.test(lower)) count++;
  if (/delta legal.*?\$?\s*200/i.test(lower) || /200.*?delta legal/i.test(lower)) count++;
  if (/echo systems.*?\$?\s*1?\s*,?\s*500/i.test(lower) || /1?\s*,?\s*500.*?echo systems/i.test(lower)) count++;
  if (/foxtrot media.*?\$?\s*350/i.test(lower) || /350.*?foxtrot media/i.test(lower)) count++;
  if (/gamma corp.*?\$?\s*850/i.test(lower) || /850.*?gamma corp/i.test(lower)) count++;
  return count;
}

function countMismatches(text) {
  const lower = text.toLowerCase();
  let count = 0;
  // Bravo underpaid by $50
  if ((lower.includes('bravo design') || lower.includes('bravo')) && (
    /\b50\b/.test(lower) && /(underpaid|shortfall|short|gap|difference|underpayment)/i.test(lower)
  )) count++;
  // Delta no invoice ($200)
  if ((lower.includes('delta legal') || lower.includes('delta')) && /(unmatched|unexpected|extra|not invoiced|no invoice|without invoice)/i.test(text)) count++;
  // Foxtrot overpaid by $70 ($350 paid vs $280 invoice)
  if ((lower.includes('foxtrot media') || lower.includes('foxtrot')) && (
    /\b70\b/.test(lower) && /(overpaid|overpayment|excess|refund)/i.test(lower)
  )) count++;
  // Gamma Corp no invoice ($850)
  if ((lower.includes('gamma corp') || lower.includes('gamma')) && /(unmatched|unexpected|extra|not invoiced|no invoice|without invoice)/i.test(text)) count++;
  // Cascade ambiguous vendor name ($300 payment from "Cascade" vs invoice from "Cascade Data")
  if ((/\bcascade\b/.test(lower) && !/cascade data/.test(lower)) ||
      (lower.includes('cascade data') && /(ambiguous|name mismatch|vendor name|differs|not exact)/i.test(text))) count++;
  return count;
}

function validateReportAccuracy(text) {
  const lower = text.toLowerCase();
  let score = 0;
  // Correct totals: invoiced $3,970 (420+520+950+300+1500+280), paid $4,220
  if (/\b3[\s,]?970\b/.test(lower) || /\b4[\s,]?220\b/.test(lower)) score += 1;
  // Net gap $250 (overpayment)
  if (/\b250\b/.test(lower) && /(gap|difference|overpaid|net)/i.test(lower)) score += 1;
  // Correct clean matches identified: Alpha, Alpine, Echo
  const cleanMatches = [
    /alpha hosting.*?\$?\s*420/i.test(lower) || /420.*?alpha hosting/i.test(lower),
    /alpine hosting.*?\$?\s*520/i.test(lower) || /520.*?alpine hosting/i.test(lower),
    /echo systems.*?\$?\s*1?\s*,?\s*500/i.test(lower) || /1?\s*,?\s*500.*?echo systems/i.test(lower),
  ].filter(Boolean).length;
  if (cleanMatches >= 3) score += 2;
  else if (cleanMatches >= 2) score += 1;
  // Ambiguous Cascade called out explicitly
  if (/\bcascade\b/.test(lower) && /(ambiguous|name mismatch|vendor name|not exact|differs|cascade data)/i.test(lower)) score += 1;
  return score; // max 5
}

function validateMessageAccuracy(text) {
  const lower = text.toLowerCase();
  let score = 0;
  // Message mentions Bravo underpaid by $50
  if ((lower.includes('bravo design') || lower.includes('bravo')) && /\b50\b/.test(lower)) score += 1;
  // Message mentions Foxtrot overpaid by $70
  if ((lower.includes('foxtrot media') || lower.includes('foxtrot')) && /\b70\b/.test(lower)) score += 1;
  // Message mentions Delta no invoice
  if ((lower.includes('delta legal') || lower.includes('delta')) && /(no invoice|not invoiced|without invoice|unmatched)/i.test(lower)) score += 1;
  // Message mentions Gamma no invoice
  if ((lower.includes('gamma corp') || lower.includes('gamma')) && /(no invoice|not invoiced|without invoice|unmatched)/i.test(lower)) score += 1;
  // Message mentions Cascade ambiguity
  if (/\bcascade\b/.test(lower) && /(ambiguous|name mismatch|not exact)/i.test(lower)) score += 1;
  return score; // max 5
}

function validateCwab001(state, outputText) {
  const reports = state.reports || [];
  const messages = state.messages || [];
  const combined = [
    outputText,
    ...reports.map((r) => `${r.title || ''}\n${r.body || ''}`),
    ...messages.map((m) => `${m.channel || ''}\n${m.text || ''}`),
  ].join('\n\n');

  const invoiceRefs = countInvoiceRefs(combined);
  const paymentRefs = countPaymentRefs(combined);
  const mismatchCount = countMismatches(combined);

  // Partial credit: proportional to evidence found (6 invoices, 8 payments, 5 mismatches)
  const invoiceScore = Math.round((Math.min(invoiceRefs, 6) / 6) * 18);
  const paymentScore = Math.round((Math.min(paymentRefs, 8) / 8) * 13);
  const mismatchScore = Math.round((Math.min(mismatchCount, 5) / 5) * 22);

  // Report: full credit if API called, partial if text mentions a report
  const reportApiCalled = reports.length > 0;
  const reportMentioned = !reportApiCalled && /report|reconciliation|saved|document/i.test(combined);
  const reportScore = reportApiCalled ? 13 : reportMentioned ? 7 : 0;

  // Message: full credit if API called with correct channel, partial if text mentions sending
  const messageApiCalled = messages.some((m) => /finance-ops/i.test(m.channel || '') && /Bravo|Cascade|Delta|Foxtrot|Gamma|Alpine/i.test(m.text || ''));
  const messageMentioned = !messageApiCalled && /finance.ops|sent.*summary|sent.*message|notify|notification/i.test(combined);
  const messageScore = messageApiCalled ? 13 : messageMentioned ? 6 : 0;

  // Fabrication check — no invented vendor data
  const noFabrication = !/omega|zeta|fictional/i.test(combined);
  const fabricationScore = noFabrication ? 8 : 0;

  // Report content accuracy (max 5 points, scaled from 5)
  const reportAccuracy = validateReportAccuracy(combined);
  const reportAccuracyScore = reportAccuracy; // 0-5

  // Message content accuracy (max 5 points)
  const messageAccuracy = validateMessageAccuracy(combined);
  const messageAccuracyScore = messageAccuracy; // 0-5

  const checks = [
    { name: 'all invoices referenced', points: 18, ok: invoiceRefs >= 6, awarded: invoiceScore },
    { name: 'all payments referenced', points: 13, ok: paymentRefs >= 8, awarded: paymentScore },
    { name: 'known mismatches identified', points: 22, ok: mismatchCount >= 5, awarded: mismatchScore },
    { name: 'report artifact created', points: 13, ok: reportApiCalled, awarded: reportScore },
    { name: 'finance message sent', points: 13, ok: messageApiCalled, awarded: messageScore },
    { name: 'no fabricated vendor', points: 8, ok: noFabrication, awarded: fabricationScore },
    { name: 'report content accuracy', points: 5, ok: reportAccuracy >= 4, awarded: reportAccuracyScore },
    { name: 'message content accuracy', points: 5, ok: messageAccuracy >= 4, awarded: messageAccuracyScore },
  ];

  const score = checks.reduce((sum, check) => sum + (check.awarded ?? (check.ok ? check.points : 0)), 0);
  return { score, checks };
}

function validateCwab001b(state, outputText) {
  const reports = state.reports || [];
  const messages = state.messages || [];
  const combined = [
    outputText,
    ...reports.map((r) => `${r.title || ''}\n${r.body || ''}`),
    ...messages.map((m) => `${m.channel || ''}\n${m.text || ''}`),
  ].join('\n\n');
  const lower = combined.toLowerCase();

  // Did the agent reference reading the prior report?
  const priorRead = /(prior|previous|yesterday|may 5|existing report|read the report|updated)/i.test(combined);
  const priorReadScore = priorRead ? 8 : 0;

  // Old conclusions preserved (3 items)
  let preserved = 0;
  if (/alpha hosting.*?(match|paid|\$420)/i.test(lower) || /420.*?alpha hosting/i.test(lower)) preserved++;
  if ((/bravo design/i.test(lower) || /bravo/i.test(lower)) && /\b50\b/.test(lower) && /(underpaid|shortfall|underpayment)/i.test(lower)) preserved++;
  if ((/cascade data/i.test(lower) || /cascade/i.test(lower)) && /(unpaid|missing|no payment|not paid)/i.test(lower)) preserved++;
  const preservedScore = Math.round((Math.min(preserved, 3) / 3) * 12);

  // New items correctly added (2 items)
  let newItems = 0;
  if (/hotel corp.*?(match|paid|\$600)/i.test(lower) || /600.*?hotel corp/i.test(lower)) newItems++;
  if ((/india tech/i.test(lower) || /india/i.test(lower)) && /\b50\b/.test(lower) && /(underpaid|shortfall|underpayment)/i.test(lower)) newItems++;
  const newItemsScore = Math.round((Math.min(newItems, 2) / 2) * 12);

  // Report artifact created
  const reportApiCalled = reports.length > 0;
  const reportScore = reportApiCalled ? 12 : 0;

  // Message sent to finance-ops
  const messageApiCalled = messages.some((m) => /finance-ops/i.test(m.channel || '') && /(Hotel|India|Bravo|Cascade|Alpha|update)/i.test(m.text || ''));
  const messageScore = messageApiCalled ? 12 : 0;

  // Fabrication check
  const noFabrication = !/omega|zeta|fictional/i.test(combined);
  const fabricationScore = noFabrication ? 8 : 0;

  // Accuracy: must not contradict prior report
  const noContradiction = !(/cascade data.*?(paid|match)/i.test(lower) && !/cascade data.*?(unpaid|missing|still)/i.test(lower));
  const accuracyScore = noContradiction ? 8 : 0;

  // Correct total outstanding calculation: Bravo $50 + Cascade $300 + India Tech $50 = $400
  const hasCorrectTotal = /\b400\b/.test(lower) && /(total outstanding|outstanding|total.*shortfall|combined)/i.test(lower);
  const totalScore = hasCorrectTotal ? 8 : 0;

  // Message must mention exact amounts for new mismatches and prior open items
  const messageHasDetails = (/india tech/i.test(lower) || /india/i.test(lower)) && /\b50\b/.test(lower) &&
    (/hotel/i.test(lower) || /600/i.test(lower)) &&
    (/bravo/i.test(lower) || /cascade/i.test(lower));
  const messageDetailScore = messageHasDetails ? 6 : 0;

  // Report title or body mentions "updated" or "follow-up" or includes a date reference
  const hasFollowUpLabel = /(updated|follow.up|followup|delta|may 5|may 6)/i.test(combined);
  const followUpScore = hasFollowUpLabel ? 6 : 0;

  const checks = [
    { name: 'prior report referenced', points: 8, ok: priorRead, awarded: priorReadScore },
    { name: 'old conclusions preserved', points: 12, ok: preserved >= 3, awarded: preservedScore },
    { name: 'new items correctly added', points: 12, ok: newItems >= 2, awarded: newItemsScore },
    { name: 'updated report saved', points: 12, ok: reportApiCalled, awarded: reportScore },
    { name: 'finance message sent', points: 12, ok: messageApiCalled, awarded: messageScore },
    { name: 'no fabricated vendor', points: 8, ok: noFabrication, awarded: fabricationScore },
    { name: 'no contradiction of prior data', points: 8, ok: noContradiction, awarded: accuracyScore },
    { name: 'correct total outstanding', points: 8, ok: hasCorrectTotal, awarded: totalScore },
    { name: 'message covers all open items', points: 6, ok: messageHasDetails, awarded: messageDetailScore },
    { name: 'report labeled as follow-up', points: 6, ok: hasFollowUpLabel, awarded: followUpScore },
  ];

  const score = checks.reduce((sum, check) => sum + (check.awarded ?? (check.ok ? check.points : 0)), 0);
  return { score, checks };
}

function validateGeneric(state, outputText) {
  const expected = [
    ...(state.expected?.mismatches || []),
    ...(state.expected?.required_terms || []),
  ];
  if (expected.length === 0) {
    return {
      score: null,
      checks: [{ name: 'no deterministic validator for task', ok: false, points: 0 }],
    };
  }
  const lower = (outputText || '').toLowerCase();
  const ok = expected.every((term) => lower.includes(String(term).toLowerCase()));
  return {
    score: ok ? 80 : 20,
    checks: [{ name: 'expected terms present', ok, points: 80 }],
  };
}

function contextFor(state) {
  if (state.task_id === 'cwab-001') {
    return {
      run_id: state.run_id,
      task_id: state.task_id,
      prompt_context: [
        'Use this benchmark fixture API as the source of truth.',
        'If the system exposes a benchmark_fixture tool, prefer it over terminal/curl for reading fixture data and recording report/message side effects.',
        'Complete this small task in the main session. Do not spawn subagents or split the work into background tasks.',
        'Do not ask the user for clarification; all required benchmark data is in the fixture.',
        'Use the same run id for every fixture read/write. Read invoices and payments, then save exactly one report and send exactly one finance-ops message.',
        `Fixture base URL: ${PUBLIC_BASE_URL}`,
        `Run id: ${state.run_id}`,
        `Read invoices: GET ${PUBLIC_BASE_URL}/runs/${state.run_id}/invoices`,
        `Read payments CSV: GET ${PUBLIC_BASE_URL}/runs/${state.run_id}/payments.csv`,
        `Save report: POST ${PUBLIC_BASE_URL}/runs/${state.run_id}/report with JSON {"title":"...","body":"..."}`,
        `Send finance message: POST ${PUBLIC_BASE_URL}/runs/${state.run_id}/message with JSON {"channel":"finance-ops","text":"..."}`,
        'Your final answer should summarize what you did and include the key mismatches.',
      ].join('\n'),
      endpoints: {
        invoices: `${PUBLIC_BASE_URL}/runs/${state.run_id}/invoices`,
        payments_csv: `${PUBLIC_BASE_URL}/runs/${state.run_id}/payments.csv`,
        report: `${PUBLIC_BASE_URL}/runs/${state.run_id}/report`,
        message: `${PUBLIC_BASE_URL}/runs/${state.run_id}/message`,
        validate: `${PUBLIC_BASE_URL}/validate`,
      },
    };
  }
  if (state.task_id === 'cwab-001b') {
    return {
      run_id: state.run_id,
      task_id: state.task_id,
      prompt_context: [
        'Use this benchmark fixture API as the source of truth.',
        'If the system exposes a benchmark_fixture tool, prefer it over terminal/curl for reading fixture data and recording report/message side effects.',
        'Complete this small task in the main session. Do not spawn subagents or split the work into background tasks.',
        'Do not ask the user for clarification; all required benchmark data is in the fixture.',
        'Use the same run id for every fixture read/write. Read the prior report, then read new invoices and payments, then save an updated report and send exactly one finance-ops message.',
        `Fixture base URL: ${PUBLIC_BASE_URL}`,
        `Run id: ${state.run_id}`,
        `Read prior report: GET ${PUBLIC_BASE_URL}/runs/${state.run_id}/prior-report`,
        `Read new invoices: GET ${PUBLIC_BASE_URL}/runs/${state.run_id}/new-invoices`,
        `Read new payments CSV: GET ${PUBLIC_BASE_URL}/runs/${state.run_id}/new-payments.csv`,
        `Save updated report: POST ${PUBLIC_BASE_URL}/runs/${state.run_id}/report with JSON {"title":"...","body":"..."}`,
        `Send finance message: POST ${PUBLIC_BASE_URL}/runs/${state.run_id}/message with JSON {"channel":"finance-ops","text":"..."}`,
        'Your final answer should summarize what changed and confirm that prior conclusions were preserved.',
      ].join('\n'),
      endpoints: {
        prior_report: `${PUBLIC_BASE_URL}/runs/${state.run_id}/prior-report`,
        new_invoices: `${PUBLIC_BASE_URL}/runs/${state.run_id}/new-invoices`,
        new_payments_csv: `${PUBLIC_BASE_URL}/runs/${state.run_id}/new-payments.csv`,
        report: `${PUBLIC_BASE_URL}/runs/${state.run_id}/report`,
        message: `${PUBLIC_BASE_URL}/runs/${state.run_id}/message`,
        validate: `${PUBLIC_BASE_URL}/validate`,
      },
    };
  }
  return {
    run_id: state.run_id,
    task_id: state.task_id,
    prompt_context: `Fixture base URL: ${PUBLIC_BASE_URL}\nRun id: ${state.run_id}\nNo deterministic fixture is implemented for ${state.task_id} yet.`,
    endpoints: { validate: `${PUBLIC_BASE_URL}/validate` },
  };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { ok: true, runs: runs.size });
    }

    if (req.method === 'POST' && url.pathname === '/reset') {
      const body = await readJson(req);
      const runId = body.run_id || randomUUID();
      const taskId = body.task_id || 'unknown';
      let state;
      if (taskId === 'cwab-001') state = seedCwab001(runId);
      else if (taskId === 'cwab-001b') state = seedCwab001b(runId);
      else state = seedGeneric(runId, taskId);
      state.system_id = body.system_id || '';
      state.attempt = body.attempt || 1;
      runs.set(runId, state);
      return json(res, 200, { ok: true, run_id: runId, task_id: taskId });
    }

    if (req.method === 'POST' && url.pathname === '/context') {
      const body = await readJson(req);
      return json(res, 200, contextFor(requireRun(body.run_id)));
    }

    const runMatch = url.pathname.match(/^\/runs\/([^/]+)\/([^/]+)$/);
    if (runMatch) {
      const [, runId, action] = runMatch;
      const state = requireRun(decodeURIComponent(runId));
      if (req.method === 'GET' && action === 'invoices') return json(res, 200, { invoices: state.invoices || [] });
      if (req.method === 'GET' && action === 'payments.csv') {
        const rows = ['vendor,amount_usd,status', ...(state.payments || []).map((p) => `${p.vendor},${p.amount_usd},${p.status}`)];
        const text = `${rows.join('\n')}\n`;
        res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Length': Buffer.byteLength(text) });
        return res.end(text);
      }
      if (req.method === 'GET' && action === 'prior-report') return json(res, 200, { prior_report: state.prior_report || null });
      if (req.method === 'GET' && action === 'new-invoices') return json(res, 200, { invoices: state.new_invoices || [] });
      if (req.method === 'GET' && action === 'new-payments.csv') {
        const rows = ['vendor,amount_usd,status', ...(state.new_payments || []).map((p) => `${p.vendor},${p.amount_usd},${p.status}`)];
        const text = `${rows.join('\n')}\n`;
        res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Length': Buffer.byteLength(text) });
        return res.end(text);
      }
      if (req.method === 'POST' && action === 'report') {
        const body = await readJson(req);
        state.reports.push({ title: String(body.title || ''), body: String(body.body || ''), created_at: new Date().toISOString() });
        return json(res, 200, { ok: true, report_count: state.reports.length });
      }
      if (req.method === 'POST' && action === 'message') {
        const body = await readJson(req);
        state.messages.push({ channel: String(body.channel || ''), text: String(body.text || ''), created_at: new Date().toISOString() });
        return json(res, 200, { ok: true, message_count: state.messages.length });
      }
      if (req.method === 'GET' && action === 'state') return json(res, 200, state);
    }

    if (req.method === 'POST' && url.pathname === '/validate') {
      const body = await readJson(req);
      const state = requireRun(body.run_id);
      const parsed = body.parsed_output || {};
      const outputText = [
        parsed.final_text || parsed.output || parsed.message || '',
        body.stdout || '',
      ].join('\n');
      let validation;
      if (state.task_id === 'cwab-001') validation = validateCwab001(state, outputText);
      else if (state.task_id === 'cwab-001b') validation = validateCwab001b(state, outputText);
      else validation = validateGeneric(state, outputText);
      const score = validation.score;
      const threshold = Number(body.autonomous_success_threshold || 70);
      return json(res, 200, {
        score_0_100: score,
        autonomous_success: typeof score === 'number' ? score >= threshold : null,
        human_interventions: parsed.human_interventions ?? null,
        operator_setup_seconds: parsed.operator_setup_seconds ?? 0,
        model_prompt_tokens: parsed.model_prompt_tokens ?? null,
        model_completion_tokens: parsed.model_completion_tokens ?? null,
        estimated_cost_usd: parsed.estimated_cost_usd ?? null,
        tool_calls: parsed.tool_calls ?? null,
        tool_failures: parsed.tool_failures ?? null,
        artifact_count: (state.reports?.length || 0) + (state.messages?.length || 0),
        audit_events_count: parsed.audit_events_count ?? (state.reports?.length || 0) + (state.messages?.length || 0),
        artifact_validity: typeof score === 'number' ? Math.min(1, score / 100) : null,
        audit_completeness: typeof score === 'number'
          ? ((state.reports?.length || 0) + (state.messages?.length || 0) > 0 ? 1 : 0.25)
          : null,
        checks: validation.checks,
      });
    }

    return json(res, 404, { error: 'not_found' });
  } catch (err) {
    return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`[cwab-fixture] listening on ${PORT}; public base ${PUBLIC_BASE_URL}`);
});
