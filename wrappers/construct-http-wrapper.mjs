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
  const token = process.env.CONSTRUCT_BENCHMARK_TOKEN || process.env.CWAB_AUTH_TOKEN || '';
  if (!token) return {};
  const header = process.env.CWAB_AUTH_HEADER || 'Authorization';
  const scheme = process.env.CWAB_AUTH_SCHEME ?? 'Bearer';
  return { [header]: scheme ? `${scheme} ${token}` : token };
}

async function obtainDevToken(base, attemptDir) {
  const existing = process.env.CONSTRUCT_BENCHMARK_TOKEN || process.env.CWAB_AUTH_TOKEN || '';
  if (existing) return existing;

  const email = process.env.CWAB_CONSTRUCT_EMAIL || 'benchmark@construct.computer';
  console.error(`[construct-wrapper] auto-signing up dev account: ${email}`);

  const res = await fetch(`${base}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();

  if (!res.ok || !data.token) {
    await writeFile(path.join(attemptDir, 'construct-dev-login-error.json'), JSON.stringify(data, null, 2));
    throw new Error(`Dev login failed (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }

  await writeFile(path.join(attemptDir, 'construct-dev-login.json'), JSON.stringify({
    ok: true,
    email,
    user_id: data.user?.id,
    username: data.user?.username,
    setup_completed: data.user?.setupCompleted,
  }, null, 2));

  process.env.CONSTRUCT_BENCHMARK_TOKEN = data.token;
  return data.token;
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

function openRouterApiKey() {
  return firstEnv(['OPENROUTER_API_KEY', 'CWAB_OPENROUTER_API_KEY']);
}

function openRouterModel() {
  return stripOpenRouterPrefix(firstEnv([
    'CONSTRUCT_BENCHMARK_MODEL',
    'CWAB_OPENROUTER_MODEL',
    'CWAB_MODEL_ID',
    'OPENROUTER_MODEL',
    'MODEL_ID',
  ]));
}

async function api(base, pathName, options = {}) {
  const res = await fetch(`${base}${pathName}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { text };
  }
  if (!res.ok) {
    const err = new Error(`Construct API ${pathName} failed (${res.status}): ${text.slice(0, 500)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function bestEffortDeleteSession(base, sessionKey, attemptDir) {
  try {
    const data = await api(base, `/api/agent/sessions/${encodeURIComponent(sessionKey)}`, {
      method: 'DELETE',
    });
    await writeFile(path.join(attemptDir, 'construct-session-delete.json'), JSON.stringify(data, null, 2));
  } catch (error) {
    await writeFile(path.join(attemptDir, 'construct-session-delete-error.txt'), String(error?.message || error));
  }
}

async function configureBenchmarkByok(base, attemptDir) {
  const provider = (firstEnv(['CONSTRUCT_BENCHMARK_PROVIDER', 'CWAB_AGENT_PROVIDER']) || 'openrouter').toLowerCase();
  const model = openRouterModel();
  const apiKey = openRouterApiKey();
  const shouldConfigure = provider === 'openrouter'
    && apiKey
    && !falseLike(process.env.CONSTRUCT_BENCHMARK_CONFIGURE_BYOK)
    && !falseLike(process.env.CWAB_SEND_OPENROUTER_API_KEY_TO_HTTP);
  const config = {
    provider,
    model,
    configureByok: Boolean(shouldConfigure),
    sentOpenRouterKey: Boolean(shouldConfigure),
  };
  await writeFile(path.join(attemptDir, 'construct-benchmark-config.json'), JSON.stringify(config, null, 2));
  if (!shouldConfigure) return;

  await api(base, '/api/billing/byok/key', {
    method: 'POST',
    body: JSON.stringify({ apiKey }),
  });

  await api(base, '/api/billing/byok/settings', {
    method: 'PUT',
    body: JSON.stringify({
      mode: 'exclusive',
      ...(model ? { model } : {}),
    }),
  });
}

function latestAssistant(messages, startedAt) {
  return [...(messages || [])]
    .filter((message) => message.role === 'assistant' && typeof message.content === 'string' && message.content.trim())
    .filter((message) => !startedAt || Number(message.created_at || 0) >= startedAt)
    .sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0))[0];
}

function hasPostStartActivity(messages, startedAt) {
  return [...(messages || [])].some((message) => {
    if (Number(message.created_at || 0) < startedAt) return false;
    return ['assistant', 'tool_call', 'tool_result'].includes(message.role);
  });
}

function activeSessionStillRunning(active, sessionKey) {
  const sessions = active?.sessions || active?.activeSessions || active?.data?.sessions || active;
  if (!Array.isArray(sessions)) return false;
  return sessions.some((session) => session.sessionKey === sessionKey || session.session_key === sessionKey);
}

const payload = await readStdinJson();
const base = requireEnv('CONSTRUCT_BENCHMARK_URL').replace(/\/$/, '');
const attemptDir = process.env.CWAB_ATTEMPT_DIR || payload.attempt_dir || '.';
const timeoutMs = Number(process.env.CONSTRUCT_BENCHMARK_TIMEOUT_MS || 900000);
const pollMs = Number(process.env.CONSTRUCT_BENCHMARK_POLL_MS || 2000);
const stopWhenIdleWithoutFinal = process.env.CONSTRUCT_BENCHMARK_STOP_WHEN_IDLE_WITHOUT_FINAL !== 'false';
const startedAt = Date.now();

await obtainDevToken(base, attemptDir);
const sessionKeyBase = String(payload.run_id || startedAt).replace(/[^A-Za-z0-9_-]+/g, '_');
const sessionKey = `cwab_${sessionKeyBase}_${startedAt.toString(36)}`;
const rawPrompt = payload.task?.prompt || '';
const prompt = [
  'CWAB benchmark mode: complete this task autonomously in the main session.',
  'Do not ask the user for clarification. Do not spawn subagents. Do not use terminal/sandbox tools for the fixture.',
  'If benchmark_fixture is available, use it for all fixture reads and side effects.',
  'In your final summary, include all invoice totals, payment totals, net financial gap, clean matches, and every mismatch with exact dollar amounts. Be thorough, not concise.',
  rawPrompt,
].filter(Boolean).join('\n\n');

await writeFile(path.join(attemptDir, 'construct-session.json'), JSON.stringify({
  sessionKey,
  sessionKeyBase,
  startedAt,
}, null, 2));

await configureBenchmarkByok(base, attemptDir);

await api(base, '/api/agent/chat', {
  method: 'POST',
  body: JSON.stringify({
    message: prompt,
    sessionKey,
    clientId: payload.run_id,
  }),
});

let finalMessage = null;
let lastHistory = null;
let lastActive = null;
const deadline = Date.now() + timeoutMs;
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, pollMs));
  lastHistory = await api(base, `/api/agent/history?session_key=${encodeURIComponent(sessionKey)}&limit=100`);
  const messages = lastHistory.messages || lastHistory.data?.messages || [];
  finalMessage = latestAssistant(messages, startedAt);
  let activeKnown = false;
  try {
    lastActive = await api(base, '/api/agent/active-sessions');
    activeKnown = true;
  } catch {
    lastActive = null;
  }
  const stillRunning = activeKnown ? activeSessionStillRunning(lastActive, sessionKey) : true;
  if (finalMessage && !stillRunning) break;
  if (stopWhenIdleWithoutFinal && activeKnown && !stillRunning && hasPostStartActivity(messages, startedAt)) break;
}

await writeFile(path.join(attemptDir, 'construct-history.json'), JSON.stringify(lastHistory, null, 2));
if (lastActive) await writeFile(path.join(attemptDir, 'construct-active-sessions.json'), JSON.stringify(lastActive, null, 2));

if (!finalMessage) {
  await bestEffortDeleteSession(base, sessionKey, attemptDir);
  console.log(JSON.stringify({
    final_text: '',
    score_0_100: null,
    human_interventions: null,
    tool_failures: null,
    error: 'Construct did not produce a final assistant message before timeout.',
  }));
  process.exit(1);
}

const messages = lastHistory.messages || lastHistory.data?.messages || [];
await bestEffortDeleteSession(base, sessionKey, attemptDir);

// Extract token usage from history messages
let totalPromptTokens = 0;
let totalCompletionTokens = 0;
for (const m of messages) {
  if (Number(m.created_at || 0) < startedAt) continue;
  const usage = m.usage || m.token_usage || m.metadata?.usage || {};
  totalPromptTokens += Number(usage.prompt_tokens || usage.input_tokens || 0);
  totalCompletionTokens += Number(usage.completion_tokens || usage.output_tokens || 0);
}
// Also check session-level usage summary if available
const sessionUsage = lastHistory.usage || lastHistory.data?.usage || lastHistory.token_usage || {};
if (sessionUsage.prompt_tokens || sessionUsage.input_tokens) {
  totalPromptTokens = Number(sessionUsage.prompt_tokens || sessionUsage.input_tokens || totalPromptTokens);
  totalCompletionTokens = Number(sessionUsage.completion_tokens || sessionUsage.output_tokens || totalCompletionTokens);
}

// Token estimation fallback (rough: ~4 chars per token for English)
function estimateTokens(text) {
  if (!text) return 0;
  // Count words and chars, use the more conservative estimate
  const words = text.split(/\s+/).filter(Boolean).length;
  const chars = text.length;
  return Math.round(Math.min(words * 1.3, chars / 4));
}

console.log(JSON.stringify({
  final_text: finalMessage.content,
  human_interventions: 0,
  operator_setup_seconds: Number(process.env.CONSTRUCT_OPERATOR_SETUP_SECONDS || 0),
  model_prompt_tokens: totalPromptTokens || estimateTokens(prompt),
  model_completion_tokens: totalCompletionTokens || estimateTokens(finalMessage.content),
  estimated_cost_usd: sessionUsage.total_cost_usd ?? sessionUsage.estimated_cost_usd ?? null,
  tool_calls: messages.filter((m) => m.role === 'tool_call').length,
  tool_failures: messages.filter((m) => m.role === 'tool_result' && /error|failed|auth_required/i.test(m.content || '')).length,
  artifact_count: messages.filter((m) => /workspace path|saved to|artifact/i.test(m.content || '')).length,
  audit_events_count: Array.isArray(lastHistory.events) ? lastHistory.events.length : null,
}));
