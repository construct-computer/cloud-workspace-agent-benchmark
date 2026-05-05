#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import path from 'node:path';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function readStdinJson() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  return JSON.parse(input || '{}');
}

function authHeaders() {
  const token = process.env.CWAB_AUTH_TOKEN || '';
  if (!token) return {};
  const header = process.env.CWAB_AUTH_HEADER || 'Authorization';
  const scheme = process.env.CWAB_AUTH_SCHEME ?? 'Bearer';
  return { [header]: scheme ? `${scheme} ${token}` : token };
}

function falseLike(value) {
  return ['0', 'false', 'no', 'off'].includes(String(value || '').trim().toLowerCase());
}

function firstEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function stripOpenRouterPrefix(model) {
  return String(model || '').trim().replace(/^openrouter\//i, '');
}

function llmConfig() {
  const model = stripOpenRouterPrefix(firstEnv([
    'CWAB_AGENT_MODEL',
    'CWAB_OPENROUTER_MODEL',
    'CWAB_MODEL_ID',
    'OPENROUTER_MODEL',
    'MODEL_ID',
  ]));
  const apiKey = firstEnv(['OPENROUTER_API_KEY', 'CWAB_OPENROUTER_API_KEY']);
  const provider = firstEnv(['CWAB_AGENT_PROVIDER', 'CWAB_PROVIDER']) || (model || apiKey ? 'openrouter' : '');
  const includeKey = apiKey && !falseLike(process.env.CWAB_SEND_OPENROUTER_API_KEY_TO_HTTP);
  return {
    provider,
    model,
    apiKey: includeKey ? apiKey : '',
    sentOpenRouterKey: Boolean(includeKey),
  };
}

function normalizeResponse(data) {
  if (!data || typeof data !== 'object') {
    return { final_text: typeof data === 'string' ? data : JSON.stringify(data) };
  }
  if (data.metrics && typeof data.metrics === 'object') return data;
  return {
    final_text: data.final_text || data.text || data.message || data.output || JSON.stringify(data),
    score_0_100: data.score_0_100 ?? data.score ?? null,
    human_interventions: data.human_interventions ?? null,
    operator_setup_seconds: data.operator_setup_seconds ?? null,
    model_prompt_tokens: data.model_prompt_tokens ?? data.prompt_tokens ?? null,
    model_completion_tokens: data.model_completion_tokens ?? data.completion_tokens ?? null,
    estimated_cost_usd: data.estimated_cost_usd ?? data.cost_usd ?? null,
    tool_calls: data.tool_calls ?? null,
    tool_failures: data.tool_failures ?? null,
    artifact_count: data.artifact_count ?? null,
    audit_events_count: data.audit_events_count ?? null,
    artifact_validity: data.artifact_validity ?? null,
    audit_completeness: data.audit_completeness ?? null
  };
}

const payload = await readStdinJson();
const endpoint = requireEnv('CWAB_AGENT_ENDPOINT');
const attemptDir = process.env.CWAB_ATTEMPT_DIR || payload.attempt_dir || '.';
const llm = llmConfig();
const requestBody = {
  run_id: payload.run_id,
  task_id: payload.task?.task_id,
  task_name: payload.task?.name,
  prompt: payload.task?.prompt,
  task: payload.task,
  attempt: payload.attempt,
  system: payload.system,
  ...(llm.provider ? { provider: llm.provider } : {}),
  ...(llm.model ? { model: llm.model } : {}),
  ...(llm.apiKey ? { openrouter_api_key: llm.apiKey, openrouterApiKey: llm.apiKey } : {}),
  llm: {
    ...(llm.provider ? { provider: llm.provider } : {}),
    ...(llm.model ? { model: llm.model } : {}),
    ...(llm.apiKey ? { openrouter_api_key: llm.apiKey, openrouterApiKey: llm.apiKey } : {}),
  },
};

await writeFile(path.join(attemptDir, 'http-request-config.json'), JSON.stringify({
  provider: llm.provider || null,
  model: llm.model || null,
  sentOpenRouterKey: llm.sentOpenRouterKey,
}, null, 2));

const started = Date.now();
const res = await fetch(endpoint, {
  method: process.env.CWAB_HTTP_METHOD || 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...authHeaders()
  },
  body: JSON.stringify(requestBody)
});
const text = await res.text();
await writeFile(path.join(attemptDir, 'http-response.txt'), text);

let data;
try {
  data = JSON.parse(text);
} catch {
  data = { final_text: text };
}

const normalized = normalizeResponse(data);
normalized.wrapper = 'generic-http-agent-wrapper';
normalized.http_status = res.status;
normalized.wall_clock_seconds = (Date.now() - started) / 1000;
if (!res.ok && normalized.score_0_100 === undefined) normalized.score_0_100 = null;

console.log(JSON.stringify(normalized));
