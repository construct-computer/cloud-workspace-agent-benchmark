#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function readStdinJson() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  return JSON.parse(input || '{}');
}

function parseCommandJson(name, fallback = null) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`${name} must be a JSON array`);
  return parsed;
}

function replaceTokens(value, ctx) {
  if (typeof value !== 'string') return value;
  return value
    .replaceAll('__CWAB_PROMPT__', ctx.prompt)
    .replaceAll('__CWAB_PROMPT_FILE__', ctx.promptPath)
    .replaceAll('__CWAB_ATTEMPT_DIR__', ctx.attemptDir)
    .replaceAll('__CWAB_RUN_ID__', ctx.runId)
    .replaceAll('__CWAB_TASK_ID__', ctx.taskId)
    .replaceAll('__CWAB_SYSTEM_ID__', ctx.systemId);
}

function commandName(command) {
  return Array.isArray(command) ? command[0] : '';
}

function commandArgs(command, ctx) {
  return command.slice(1).map((value) => replaceTokens(value, ctx));
}

async function runOne(command, ctx, label) {
  const cmd = commandName(command);
  const args = commandArgs(command, ctx);
  const started = Date.now();
  const child = spawn(cmd, args, {
    cwd: ctx.cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  const exit = await new Promise((resolve) => {
    child.on('error', (error) => resolve({ code: null, signal: null, error }));
    child.on('close', (code, signal) => resolve({ code, signal, error: null }));
  });
  const result = {
    label,
    command: cmd,
    args,
    exit_code: exit.code,
    signal: exit.signal,
    spawn_error: exit.error ? String(exit.error.message || exit.error) : null,
    wall_clock_seconds: (Date.now() - started) / 1000,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
  };
  await writeFile(path.join(ctx.attemptDir, `${label}-stdout.txt`), result.stdout);
  await writeFile(path.join(ctx.attemptDir, `${label}-stderr.txt`), result.stderr);
  return result;
}

function parseJsonOutput(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // CLIs often print logs before a final JSON line.
  }
  const lines = trimmed.split(/\r?\n/).reverse();
  for (const line of lines) {
    const candidate = line.trim();
    if (!candidate.startsWith('{') || !candidate.endsWith('}')) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Continue.
    }
  }
  return null;
}

function deepFind(obj, ...paths) {
  let current = obj;
  for (const path of paths) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    if (Array.isArray(path)) {
      let found = undefined;
      for (const key of path) {
        if (key in current) { found = current[key]; break; }
      }
      if (found === undefined) return undefined;
      current = found;
    } else {
      if (!(path in current)) return undefined;
      current = current[path];
    }
  }
  return current;
}

function extractTokenUsage(parsed) {
  if (!parsed || typeof parsed !== 'object') return { prompt: null, completion: null, total: null };

  const usagePaths = [
    ['meta', 'agentMeta', 'usage'],
    ['meta', 'agentMeta', 'lastCallUsage'],
    ['meta', 'usage'],
    ['usage'],
    ['token_usage'],
    ['tokens'],
  ];

  for (const usagePath of usagePaths) {
    const usage = deepFind(parsed, ...usagePath);
    if (usage && typeof usage === 'object') {
      const prompt = Number(
        usage.prompt_tokens
        || usage.input_tokens
        || usage.input
        || usage.prompt
        || 0
      );
      const completion = Number(
        usage.completion_tokens
        || usage.output_tokens
        || usage.output
        || usage.completion
        || 0
      );
      const total = Number(
        usage.total_tokens
        || usage.total
        || (prompt + completion)
        || 0
      );
      if (prompt > 0 || completion > 0) {
        return { prompt: prompt || null, completion: completion || null, total: total || null };
      }
    }
  }

  const flatPrompt = Number(parsed.model_prompt_tokens || parsed.prompt_tokens || 0);
  const flatCompletion = Number(parsed.model_completion_tokens || parsed.completion_tokens || 0);
  if (flatPrompt > 0 || flatCompletion > 0) {
    return { prompt: flatPrompt, completion: flatCompletion, total: flatPrompt + flatCompletion };
  }

  return { prompt: null, completion: null, total: null };
}

function openRouterPricing() {
  return {
    inputPricePer1M: Number(process.env.CWAB_OR_INPUT_PRICE_PER_1M || 3.00),
    outputPricePer1M: Number(process.env.CWAB_OR_OUTPUT_PRICE_PER_1M || 15.00),
    cacheWritePricePer1M: Number(process.env.CWAB_OR_CACHE_WRITE_PRICE_PER_1M || 3.75),
    cacheReadPricePer1M: Number(process.env.CWAB_OR_CACHE_READ_PRICE_PER_1M || 0.30),
  };
}

function calculateCost(promptTokens, completionTokens) {
  if (promptTokens === null && completionTokens === null) return null;
  const pricing = openRouterPricing();
  const p = (promptTokens || 0) * (pricing.inputPricePer1M / 1_000_000);
  const c = (completionTokens || 0) * (pricing.outputPricePer1M / 1_000_000);
  return Math.round((p + c) * 10_000) / 10_000;
}

function extractToolCallCount(parsed) {
  if (!parsed || typeof parsed !== 'object') return { calls: null, failures: null };

  const calls = Number(parsed.tool_calls ?? parsed.tool_call_count
    ?? deepFind(parsed, 'meta', 'agentMeta', 'tool_calls')
    ?? deepFind(parsed, 'meta', 'tool_calls')
    ?? deepFind(parsed, 'tool_use', 'count')
    ?? NaN);
  const failures = Number(parsed.tool_failures ?? parsed.tool_failure_count
    ?? deepFind(parsed, 'meta', 'agentMeta', 'tool_failures')
    ?? deepFind(parsed, 'meta', 'tool_failures')
    ?? NaN);

  return {
    calls: Number.isFinite(calls) ? calls : null,
    failures: Number.isFinite(failures) ? failures : null,
  };
}

function normalizeCliOutput(main, parsed) {
  const rawText = [main.stdout, main.stderr].filter(Boolean).join('\n').trim();
  const output = parsed && typeof parsed === 'object' ? parsed : {};

  const tokenUsage = extractTokenUsage(parsed);
  const toolCounts = extractToolCallCount(parsed);

  const promptTokens = output.model_prompt_tokens ?? output.prompt_tokens ?? tokenUsage.prompt ?? null;
  const completionTokens = output.model_completion_tokens ?? output.completion_tokens ?? tokenUsage.completion ?? null;
  const explicitCost = output.estimated_cost_usd ?? output.cost_usd ?? null;

  const calculatedCost = explicitCost !== null
    ? Number(explicitCost)
    : calculateCost(promptTokens, completionTokens);

  const finalText = output.final_text || output.text || output.message || output.output || output.response || rawText;

  // Token estimation fallback when no structured data available (~4 chars per token)
  const estimatedPrompt = promptTokens ?? (rawText ? Math.round(rawText.length / 4) : null);
  const estimatedCompletion = completionTokens ?? (finalText ? Math.round(finalText.length / 4) : null);

  return {
    wrapper: 'generic-cli-agent-wrapper',
    final_text: finalText,
    raw_cli_json: parsed,
    cli_exit_code: main.exit_code,
    cli_signal: main.signal,
    cli_spawn_error: main.spawn_error,
    human_interventions: output.human_interventions ?? 0,
    operator_setup_seconds: Number(process.env.CWAB_OPERATOR_SETUP_SECONDS || output.operator_setup_seconds || 0),
    model_prompt_tokens: estimatedPrompt,
    model_completion_tokens: estimatedCompletion,
    estimated_cost_usd: calculatedCost,
    tool_calls: output.tool_calls ?? toolCounts.calls ?? null,
    tool_failures: output.tool_failures ?? toolCounts.failures ?? null,
    artifact_count: output.artifact_count ?? null,
    audit_events_count: output.audit_events_count ?? null,
    artifact_validity: output.artifact_validity ?? null,
    audit_completeness: output.audit_completeness ?? null,
  };
}

try {
  const payload = await readStdinJson();
  const attemptDir = process.env.CWAB_ATTEMPT_DIR || payload.attempt_dir || '.';
  await mkdir(attemptDir, { recursive: true });
  const prompt = payload.task?.prompt || '';
  const promptPath = path.join(attemptDir, 'prompt.txt');
  await writeFile(promptPath, prompt);

  const ctx = {
    attemptDir,
    prompt,
    promptPath,
    runId: payload.run_id || process.env.CWAB_RUN_ID || '',
    taskId: payload.task?.task_id || process.env.CWAB_TASK_ID || '',
    systemId: payload.system?.id || process.env.CWAB_SYSTEM_ID || '',
    cwd: process.env.CWAB_CLI_CWD || attemptDir,
  };

  const setupCommands = parseCommandJson('CWAB_CLI_SETUP_COMMANDS_JSON', []);
  const setupResults = [];
  for (const [index, command] of setupCommands.entries()) {
    if (!Array.isArray(command) || command.length === 0) throw new Error('setup command must be a non-empty array');
    const result = await runOne(command, ctx, `setup-${index + 1}`);
    setupResults.push(result);
    if (result.exit_code !== 0 || result.spawn_error) {
      const output = normalizeCliOutput(result, null);
      output.setup_results = setupResults.map(({ stdout, stderr, ...rest }) => rest);
      output.final_text = `Setup command failed: ${result.stderr || result.stdout || result.spawn_error || result.exit_code}`;
      console.log(JSON.stringify(output));
      process.exit(1);
    }
  }

  const command = parseCommandJson('CWAB_CLI_COMMAND_JSON');
  if (!command || command.length === 0) throw new Error('CWAB_CLI_COMMAND_JSON is required');
  const main = await runOne(command, ctx, 'cli');
  const parsed = parseJsonOutput(main.stdout);
  const output = normalizeCliOutput(main, parsed);

  const realSetupSeconds = setupResults.reduce((sum, r) => sum + (r.wall_clock_seconds || 0), 0);
  if (realSetupSeconds > 0 && !process.env.CWAB_OPERATOR_SETUP_SECONDS) {
    output.operator_setup_seconds = Math.round(realSetupSeconds);
  }

  output.setup_results = setupResults.map(({ stdout, stderr, ...rest }) => rest);
  output.wall_clock_seconds = main.wall_clock_seconds;
  console.log(JSON.stringify(output));
  process.exit(main.exit_code === 0 && !main.spawn_error ? 0 : 1);
} catch (error) {
  console.log(JSON.stringify({
    wrapper: 'generic-cli-agent-wrapper',
    final_text: '',
    error: error instanceof Error ? error.message : String(error),
    score_0_100: null,
  }));
  process.exit(1);
}
