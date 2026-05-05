#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();

function usage(exitCode = 0) {
  const text = `
CWAB benchmark runner

Usage:
  node ./run-benchmark.mjs [options]

Options:
  --manifest <path>      Task manifest JSON. Default: ./tasks.json
  --systems <path>       Systems config JSON. Default: ./systems.example.json
  --output <dir>         Output directory. Default: config default or ./results
  --include <ids>        Comma-separated system ids to run. Overrides enabled=false.
  --exclude <ids>        Comma-separated system ids to skip.
  --task <ids>           Comma-separated task ids to run.
  --runs <n>             Attempts per task/system.
  --timeout-ms <n>       Per-attempt timeout.
  --fixture-url <url>    Optional fixture server base URL for reset/context.
  --doctor               Validate selected systems/config without running attempts.
  --require-pinned       Doctor exits non-zero if Docker images are not digest-pinned.
  --dry-run              Write the planned run without executing systems.
  --fail-on-error        Exit non-zero if any attempt fails or times out.
  --require-scores       Exit non-zero if any attempt lacks score_0_100.
  --help                 Show this help.

Shared LLM env:
  OPENROUTER_API_KEY + CWAB_MODEL_ID are normalized across Construct,
  OpenClaw, Hermes, and n8n AI Agent. CWAB_MODEL_ID accepts either
  provider/model or openrouter/provider/model.

Examples:
  node ./run-benchmark.mjs --task cwab-001 --runs 1
  node ./run-benchmark.mjs --systems ./systems.local.json --include construct,openclaw,hermes,n8n_ai_agent,n8n_built_workflow --runs 3
`;
  console.log(text.trim());
  process.exit(exitCode);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') usage(0);
    if (arg === '--dry-run') {
      out.dryRun = true;
      continue;
    }
    if (arg === '--fail-on-error') {
      out.failOnError = true;
      continue;
    }
    if (arg === '--require-scores') {
      out.requireScores = true;
      continue;
    }
    if (arg === '--doctor') {
      out.doctor = true;
      continue;
    }
    if (arg === '--require-pinned') {
      out.requirePinned = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    out[key] = value;
  }
  return out;
}

function splitList(value) {
  if (!value) return null;
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

function firstPresent(env, names) {
  for (const name of names) {
    const value = env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function stripOpenRouterPrefix(model) {
  return String(model || '').trim().replace(/^openrouter\//i, '');
}

function withOpenRouterPrefix(model) {
  const trimmed = String(model || '').trim();
  if (!trimmed) return '';
  return trimmed.toLowerCase().startsWith('openrouter/') ? trimmed : `openrouter/${trimmed}`;
}

function normalizeSharedModelEnv(env) {
  const openRouterKey = firstPresent(env, ['OPENROUTER_API_KEY', 'CWAB_OPENROUTER_API_KEY']);
  const rawModel = firstPresent(env, [
    'CWAB_MODEL_ID',
    'OPENROUTER_MODEL',
    'MODEL_ID',
    'CWAB_OPENROUTER_MODEL',
    'HERMES_MODEL',
    'OPENCLAW_MODEL',
  ]);
  if (openRouterKey) {
    env.OPENROUTER_API_KEY = openRouterKey;
  }
  if (rawModel) {
    const openRouterModel = stripOpenRouterPrefix(rawModel);
    const constructModel = withOpenRouterPrefix(openRouterModel);
    env.CWAB_MODEL_ID ||= rawModel;
    env.CWAB_OPENROUTER_MODEL ||= openRouterModel;
    env.CWAB_OPENCLAW_MODEL ||= constructModel;
    env.CONSTRUCT_BENCHMARK_PROVIDER ||= 'openrouter';
    env.CONSTRUCT_BENCHMARK_MODEL ||= constructModel;
    env.CWAB_AGENT_PROVIDER ||= 'openrouter';
    env.CWAB_AGENT_MODEL ||= openRouterModel;
    env.OPENCLAW_MODEL ||= constructModel;
    env.HERMES_PROVIDER ||= 'openrouter';
    env.HERMES_MODEL ||= openRouterModel;
    env.HERMES_INFERENCE_PROVIDER ||= env.HERMES_PROVIDER;
    env.HERMES_INFERENCE_MODEL ||= env.HERMES_MODEL;
  }
  if (env.OPENROUTER_API_KEY && env.CWAB_SEND_OPENROUTER_API_KEY_TO_HTTP === undefined) {
    env.CWAB_SEND_OPENROUTER_API_KEY_TO_HTTP = '1';
  }
  if (env.OPENROUTER_API_KEY && env.CONSTRUCT_BENCHMARK_CONFIGURE_BYOK === undefined) {
    env.CONSTRUCT_BENCHMARK_CONFIGURE_BYOK = '1';
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function renderString(value, ctx) {
  return value
    .replace(/\{\{prompt\}\}/g, ctx.task.prompt)
    .replace(/\{\{task_id\}\}/g, ctx.task.task_id)
    .replace(/\{\{task_name\}\}/g, ctx.task.name)
    .replace(/\{\{system_id\}\}/g, ctx.system.id)
    .replace(/\{\{run_id\}\}/g, ctx.runId)
    .replace(/\{\{attempt\}\}/g, String(ctx.attempt))
    .replace(/\{\{attempt_dir\}\}/g, ctx.attemptDir)
    .replace(/\{\{input_json_path\}\}/g, ctx.inputJsonPath)
    .replace(/\{\{parsed_output_path\}\}/g, ctx.parsedOutputPath || '')
    .replace(/\{\{stdout_path\}\}/g, ctx.stdoutPath || '')
    .replace(/\{\{stderr_path\}\}/g, ctx.stderrPath || '')
    .replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => process.env[name] || '');
}

function renderEnvString(value) {
  return String(value ?? '').replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => process.env[name] || '');
}

function renderValue(value, ctx) {
  if (typeof value === 'string') return renderString(value, ctx);
  if (Array.isArray(value)) return value.map((v) => renderValue(v, ctx));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderValue(v, ctx)]));
  }
  return value;
}

function appendFixtureContext(task, fixtureContext) {
  if (!fixtureContext) return task;
  const text = typeof fixtureContext.prompt_context === 'string'
    ? fixtureContext.prompt_context
    : JSON.stringify(fixtureContext, null, 2);
  return {
    ...task,
    original_prompt: task.prompt,
    fixture_context: fixtureContext,
    prompt: `${task.prompt}\n\nBenchmark fixture context:\n${text}`,
  };
}

async function prepareFixture(fixtureUrl, ctx) {
  if (!fixtureUrl) return null;
  const base = fixtureUrl.replace(/\/$/, '');
  const resetRes = await fetch(`${base}/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      suite_id: ctx.suite.suite_id,
      run_id: ctx.runId,
      task_id: ctx.task.task_id,
      system_id: ctx.system.id,
      attempt: ctx.attempt,
    }),
  });
  if (!resetRes.ok) throw new Error(`fixture reset failed (${resetRes.status}): ${await resetRes.text()}`);

  const contextRes = await fetch(`${base}/context`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      suite_id: ctx.suite.suite_id,
      run_id: ctx.runId,
      task_id: ctx.task.task_id,
      system_id: ctx.system.id,
      attempt: ctx.attempt,
    }),
  });
  if (!contextRes.ok) throw new Error(`fixture context failed (${contextRes.status}): ${await contextRes.text()}`);
  return contextRes.json();
}

function sanitizeDockerName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

function hostPath(absPath) {
  const hostRoot = process.env.CWAB_HOST_REPO || process.env.CWAB_HOST_ROOT;
  if (!hostRoot) return absPath;
  const root = path.resolve(ROOT);
  const abs = path.resolve(absPath);
  if (abs === root) return hostRoot;
  if (abs.startsWith(`${root}${path.sep}`)) {
    return path.join(hostRoot, path.relative(root, abs));
  }
  return abs;
}

function parseJsonOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Many CLIs print logs before a final JSON line. Accept the last JSON line.
  }

  const lines = trimmed.split(/\r?\n/).reverse();
  for (const line of lines) {
    const candidate = line.trim();
    if (!candidate.startsWith('{') || !candidate.endsWith('}')) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep looking.
    }
  }
  return null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function openRouterPricing() {
  return {
    inputPricePer1M: Number(process.env.CWAB_OR_INPUT_PRICE_PER_1M || 3.00),
    outputPricePer1M: Number(process.env.CWAB_OR_OUTPUT_PRICE_PER_1M || 15.00),
  };
}

function calculateCostFromTokens(promptTokens, completionTokens) {
  if (promptTokens === null && completionTokens === null) return null;
  const pricing = openRouterPricing();
  const p = (promptTokens || 0) * (pricing.inputPricePer1M / 1_000_000);
  const c = (completionTokens || 0) * (pricing.outputPricePer1M / 1_000_000);
  return Math.round((p + c) * 10_000) / 10_000;
}

function boolOrNull(value) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8' });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

function envPresent(name) {
  return !!process.env[name];
}

function imageLooksPinned(image) {
  return typeof image === 'string' && (image.includes('@sha256:') || /^sha256:[a-f0-9]{64}$/i.test(image));
}

function imageLooksUnstable(image) {
  return /:(latest|stable|main)$/i.test(image || '') || !/[:@]/.test(image || '');
}

function isSensitiveName(name) {
  return /(TOKEN|SECRET|PASSWORD|PASS|API[_-]?KEY|AUTH|JWT|CREDENTIAL|PRIVATE)/i.test(name || '');
}

function redactEnvAssignment(value) {
  const text = String(value);
  const eq = text.indexOf('=');
  if (eq === -1) return isSensitiveName(text) ? `${text}=<redacted>` : text;
  const name = text.slice(0, eq);
  return isSensitiveName(name) ? `${name}=<redacted>` : text;
}

function redactArgs(args) {
  const out = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index]);
    const previous = String(args[index - 1] || '');
    if (previous === '-e' || previous === '--env' || previous === '--env-file') {
      out.push(redactEnvAssignment(arg));
    } else if (arg.startsWith('-e') && arg.length > 2 && arg.includes('=')) {
      out.push(`-e${redactEnvAssignment(arg.slice(2))}`);
    } else if (arg.startsWith('--env=')) {
      out.push(`--env=${redactEnvAssignment(arg.slice('--env='.length))}`);
    } else {
      out.push(arg);
    }
  }
  return out;
}

function envFileValue(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ');
}

function falseLike(value) {
  return ['0', 'false', 'no', 'off'].includes(String(value || '').trim().toLowerCase());
}

async function fixtureHealth(fixtureUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  const base = fixtureUrl.replace(/\/$/, '');
  try {
    const response = await fetch(`${base}/health`, { signal: controller.signal });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      body: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function selectedSystems(config, include, exclude) {
  let systems = config.systems || [];
  systems = systems.filter((system) => {
    if (exclude.has(system.id)) return false;
    if (include) return include.includes(system.id);
    return system.enabled !== false;
  });
  return systems;
}

async function doctorSystems({ systems, suite, fixtureUrl, requirePinned }) {
  const checks = [];
  const add = (system, status, message, detail = {}) => checks.push({ system, status, message, ...detail });

  const dockerNeeded = systems.some((system) => system.adapter === 'docker' || system.validator?.adapter === 'docker');
  if (dockerNeeded) {
    const docker = commandOutput('docker', ['info', '--format', '{{.ServerVersion}}']);
    add('environment', docker.ok ? 'pass' : 'fail', docker.ok ? `Docker daemon available (${docker.stdout})` : `Docker unavailable: ${docker.stderr || docker.stdout || 'unknown error'}`);
  }

  if (fixtureUrl) {
    const health = await fixtureHealth(fixtureUrl);
    add(
      'environment',
      health.ok ? 'pass' : 'fail',
      health.ok
        ? `Fixture reachable: ${fixtureUrl}`
        : `Fixture unreachable at ${fixtureUrl}: ${health.body || health.status || 'unknown error'}`,
    );
  } else if (systems.some((s) => s.validator)) {
    add('environment', 'warn', 'Validators are configured but no --fixture-url/CWAB_FIXTURE_URL was provided.');
  }

  for (const system of systems) {
    add(system.id, 'pass', `Selected system: ${system.label || system.id}`);
    for (const name of system.requiredEnv || []) {
      add(system.id, envPresent(name) ? 'pass' : 'fail', envPresent(name) ? `env ${name} present` : `missing required env ${name}`);
    }
    for (const group of system.requiredAnyEnv || []) {
      const present = group.filter(envPresent);
      add(system.id, present.length > 0 ? 'pass' : 'fail', present.length > 0 ? `one provider env present: ${present.join(', ')}` : `missing one of env group: ${group.join(', ')}`);
    }

    const containers = [
      ...(system.adapter === 'docker' ? [{ label: 'main', container: system.container }] : []),
      ...(system.validator?.adapter === 'docker' ? [{ label: 'validator', container: system.validator.container }] : []),
    ];
    for (const entry of containers) {
      const rawImage = entry.container?.image || '';
      const image = renderEnvString(rawImage);
      if (!rawImage) {
        add(system.id, 'fail', `${entry.label} container missing image`);
        continue;
      }
      if (rawImage.includes('${')) {
        const names = [...rawImage.matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((m) => m[1]);
        for (const name of names) {
          add(system.id, envPresent(name) ? 'pass' : 'fail', envPresent(name) ? `image env ${name} present` : `image env ${name} missing`);
        }
        if (!image) continue;
      }
      if (imageLooksPinned(image)) {
        add(system.id, 'pass', `${entry.label} image is digest-pinned: ${image}`);
      } else if (requirePinned) {
        add(system.id, 'fail', `${entry.label} image is not digest-pinned: ${image}`);
      } else if (imageLooksUnstable(image)) {
        add(system.id, 'warn', `${entry.label} image is not reproducibly pinned: ${image}`);
      } else {
        add(system.id, 'warn', `${entry.label} image has a tag but no digest pin: ${image}`);
      }
      const inspect = commandOutput('docker', ['image', 'inspect', image, '--format', '{{.Id}}']);
      add(system.id, inspect.ok ? 'pass' : 'warn', inspect.ok ? `${entry.label} image available locally: ${inspect.stdout}` : `${entry.label} image not available locally yet: ${image}`);
    }
  }

  if (!suite.tasks?.length) add('manifest', 'fail', 'No tasks found in manifest');
  else add('manifest', 'pass', `${suite.tasks.length} task(s) found`);

  return checks;
}

function printDoctor(checks) {
  for (const check of checks) {
    const prefix = check.status.toUpperCase().padEnd(4);
    console.log(`[${prefix}] ${check.system}: ${check.message}`);
  }
}

function captureModelPolicy() {
  const openRouterKeyPresent = Boolean(process.env.OPENROUTER_API_KEY || process.env.CWAB_OPENROUTER_API_KEY);
  const httpWrappersReceiveKey = openRouterKeyPresent && !falseLike(process.env.CWAB_SEND_OPENROUTER_API_KEY_TO_HTTP);
  return {
    shared_provider: process.env.CWAB_AGENT_PROVIDER || process.env.CONSTRUCT_BENCHMARK_PROVIDER || process.env.HERMES_PROVIDER || 'openrouter',
    requested_model: process.env.CWAB_MODEL_ID || process.env.OPENROUTER_MODEL || process.env.MODEL_ID || null,
    openrouter_model: process.env.CWAB_OPENROUTER_MODEL || null,
    construct_model: process.env.CONSTRUCT_BENCHMARK_MODEL || null,
    openclaw_model: process.env.OPENCLAW_MODEL || process.env.CWAB_OPENCLAW_MODEL || null,
    hermes_provider: process.env.HERMES_PROVIDER || process.env.HERMES_INFERENCE_PROVIDER || null,
    hermes_model: process.env.HERMES_MODEL || process.env.HERMES_INFERENCE_MODEL || null,
    n8n_agent_model: process.env.CWAB_AGENT_MODEL || null,
    openrouter_key_present: openRouterKeyPresent,
    http_wrappers_receive_openrouter_key: httpWrappersReceiveKey,
    construct_configures_byok: openRouterKeyPresent
      && httpWrappersReceiveKey
      && !falseLike(process.env.CONSTRUCT_BENCHMARK_CONFIGURE_BYOK),
  };
}

function captureEnvironment(systems) {
  const git = commandOutput('git', ['rev-parse', 'HEAD']);
  const branch = commandOutput('git', ['branch', '--show-current']);
  const docker = commandOutput('docker', ['version', '--format', '{{json .}}']);
  return {
    generated_at: new Date().toISOString(),
    cwd: ROOT,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    git_commit: git.ok ? git.stdout : null,
    git_branch: branch.ok ? branch.stdout : null,
    docker_version_json: docker.ok ? docker.stdout : null,
    model_policy: captureModelPolicy(),
    systems: systems.map((system) => ({
      id: system.id,
      label: system.label || system.id,
      adapter: system.adapter,
      image: system.container?.image || null,
      validator_image: system.validator?.container?.image || null,
    })),
  };
}

function extractMetrics(parsed, suite) {
  const source = parsed?.metrics && typeof parsed.metrics === 'object' ? parsed.metrics : parsed;
  if (!source || typeof source !== 'object') return {};

  const score = numberOrNull(source.score_0_100 ?? source.score);
  const interventions = numberOrNull(source.human_interventions);
  const threshold = suite.scoring?.autonomous_success_threshold ?? 80;
  const explicitAutonomous = boolOrNull(source.autonomous_success);
  const explicitAssisted = boolOrNull(source.assisted_success);

  const promptTokens = numberOrNull(source.model_prompt_tokens);
  const completionTokens = numberOrNull(source.model_completion_tokens);
  const explicitCost = numberOrNull(source.estimated_cost_usd);
  const fallbackCost = explicitCost !== null ? explicitCost : calculateCostFromTokens(promptTokens, completionTokens);
  const totalTokens = (promptTokens || 0) + (completionTokens || 0) || null;

  return {
    score_0_100: score,
    autonomous_success: explicitAutonomous ?? (score === null ? null : score >= threshold && (interventions ?? 0) === 0),
    assisted_success: explicitAssisted ?? (score === null ? null : score >= threshold && (interventions ?? 0) > 0),
    human_interventions: interventions,
    operator_setup_seconds: numberOrNull(source.operator_setup_seconds),
    model_prompt_tokens: promptTokens,
    model_completion_tokens: completionTokens,
    estimated_cost_usd: fallbackCost,
    tool_calls: numberOrNull(source.tool_calls),
    tool_failures: numberOrNull(source.tool_failures),
    artifact_count: numberOrNull(source.artifact_count),
    audit_events_count: numberOrNull(source.audit_events_count),
    artifact_validity: numberOrNull(source.artifact_validity),
    audit_completeness: numberOrNull(source.audit_completeness),
  };
}

async function runCommand(system, ctx, timeoutMs) {
  const command = renderValue(system.command, ctx);
  const args = renderValue(system.args || [], ctx);
  const cwd = path.resolve(ROOT, renderValue(system.cwd || '.', ctx));
  const env = {
    ...process.env,
    CWAB_RUN_ID: ctx.runId,
    CWAB_TASK_ID: ctx.task.task_id,
    CWAB_TASK_NAME: ctx.task.name,
    CWAB_SYSTEM_ID: system.id,
    CWAB_ATTEMPT_DIR: ctx.attemptDir,
    ...renderValue(system.env || {}, ctx),
  };
  const input = ctx.stdinPayload || {
    suite_id: ctx.suite.suite_id,
    run_id: ctx.runId,
    attempt: ctx.attempt,
    system: { id: system.id, label: system.label || system.id },
    task: ctx.task,
    attempt_dir: ctx.attemptDir,
  };

  const startedAt = Date.now();
  const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const stdout = [];
  const stderr = [];
  let timedOut = false;
  let killed = false;
  let exited = false;

  const timer = setTimeout(() => {
    timedOut = true;
    killed = child.kill('SIGTERM');
    if (system.timeoutCleanup?.command) {
      try {
        spawnSync(system.timeoutCleanup.command, system.timeoutCleanup.args || [], {
          cwd,
          env,
          stdio: 'ignore',
          timeout: 15_000,
        });
      } catch {
        // Timeout cleanup is best-effort. The attempt still records as timed out.
      }
    }
    setTimeout(() => {
      if (!exited) child.kill('SIGKILL');
    }, 5_000).unref();
  }, timeoutMs);

  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));

  if (system.stdin === 'json' || system.stdin_json === true) {
    child.stdin.write(JSON.stringify(input, null, 2));
  }
  child.stdin.end();

  const exit = await new Promise((resolve) => {
    child.on('error', (error) => resolve({ code: null, signal: null, error }));
    child.on('close', (code, signal) => {
      exited = true;
      resolve({ code, signal, error: null });
    });
  });
  clearTimeout(timer);

  const finishedAt = Date.now();
  return {
    command,
    args,
    cwd,
    started_at: new Date(startedAt).toISOString(),
    finished_at: new Date(finishedAt).toISOString(),
    wall_clock_seconds: (finishedAt - startedAt) / 1000,
    exit_code: exit.code,
    signal: exit.signal,
    timed_out: timedOut,
    killed,
    spawn_error: exit.error ? String(exit.error.message || exit.error) : null,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
  };
}

async function runDocker(system, ctx, timeoutMs) {
  const container = system.container || {};
  if (!container.image) throw new Error(`Docker system "${system.id}" is missing container.image`);

  const image = renderValue(container.image, ctx);
  const command = renderValue(container.command || [], ctx);
  const args = renderValue(container.args || [], ctx);
  const workdir = renderValue(container.workdir || '/workspace', ctx);
  const network = renderValue(container.network || 'none', ctx);
  const name = sanitizeDockerName(`cwab-${ctx.runId}-${Date.now()}`);
  const dockerArgs = ['run', '--rm', '--name', name, '--network', network];
  if (system.stdin === 'json' || system.stdin_json === true || container.stdin === 'json') {
    dockerArgs.push('-i');
  }

  if (container.memory) dockerArgs.push('--memory', renderValue(container.memory, ctx));
  if (container.cpus) dockerArgs.push('--cpus', String(renderValue(container.cpus, ctx)));
  if (container.shmSize) dockerArgs.push('--shm-size', renderValue(container.shmSize, ctx));
  if (container.user) dockerArgs.push('--user', String(renderValue(container.user, ctx)));
  if (workdir) dockerArgs.push('-w', workdir);

  const mounts = [
    { source: hostPath(ROOT), target: '/workspace', readonly: true },
    { source: hostPath(ctx.attemptDir), target: '/cwab/attempt', readonly: false },
    ...(container.mounts || []),
  ];
  for (const mount of mounts) {
    const source = renderValue(mount.source, ctx);
    const target = renderValue(mount.target, ctx);
    const mode = mount.readonly ? 'ro' : 'rw';
    dockerArgs.push('-v', `${source}:${target}:${mode}`);
  }

  const env = {
    CWAB_RUN_ID: ctx.runId,
    CWAB_TASK_ID: ctx.task.task_id,
    CWAB_TASK_NAME: ctx.task.name,
    CWAB_SYSTEM_ID: system.id,
    CWAB_ATTEMPT_DIR: '/cwab/attempt',
    ...renderValue(system.env || {}, ctx),
    ...renderValue(container.env || {}, ctx),
  };
  const envFilePath = path.join(ctx.attemptDir, '.cwab-docker-env');
  const envFile = Object.entries(env)
    .map(([key, value]) => `${key}=${envFileValue(value)}`)
    .join('\n');
  await writeFile(envFilePath, `${envFile}\n`, { mode: 0o600 });
  dockerArgs.push('--env-file', hostPath(envFilePath));

  if (container.entrypoint) dockerArgs.push('--entrypoint', renderValue(container.entrypoint, ctx));
  dockerArgs.push(image);
  dockerArgs.push(...(Array.isArray(command) ? command : [command]).filter(Boolean));
  dockerArgs.push(...(Array.isArray(args) ? args : [args]).filter(Boolean));

  const dockerSystem = {
    ...system,
    command: 'docker',
    args: dockerArgs,
    cwd: '.',
    env: {},
    stdin: system.stdin || container.stdin,
    timeoutCleanup: {
      command: 'docker',
      args: ['stop', '-t', '2', name],
    },
  };
  try {
    return await runCommand(dockerSystem, ctx, timeoutMs);
  } finally {
    await rm(envFilePath, { force: true });
  }
}

async function runMock(system, ctx) {
  const startedAt = Date.now();
  const output = {
    mock: true,
    final_text: `Mock output for ${system.id} on ${ctx.task.task_id}. This is only a harness smoke test and must not be used as benchmark evidence.`,
    score_0_100: null,
    human_interventions: null,
    estimated_cost_usd: null,
    artifact_count: 0,
    audit_events_count: 0,
  };
  const finishedAt = Date.now();
  return {
    command: '<internal mock>',
    args: [],
    cwd: ROOT,
    started_at: new Date(startedAt).toISOString(),
    finished_at: new Date(finishedAt).toISOString(),
    wall_clock_seconds: (finishedAt - startedAt) / 1000,
    exit_code: 0,
    signal: null,
    timed_out: false,
    killed: false,
    spawn_error: null,
    stdout: `${JSON.stringify(output)}\n`,
    stderr: '',
  };
}

async function runValidator(validator, ctx, parsedOutput) {
  if (!validator) return null;
  const validatorSystem = {
    id: `${ctx.system.id}_validator`,
    label: `${ctx.system.label || ctx.system.id} validator`,
    adapter: validator.adapter || 'command',
    command: validator.command,
    args: validator.args || [],
    cwd: validator.cwd || '.',
    stdin: validator.stdin || 'json',
    env: validator.env || {},
    container: validator.container,
  };
  const validatorInput = {
    suite_id: ctx.suite.suite_id,
    run_id: ctx.runId,
    attempt: ctx.attempt,
    system: { id: ctx.system.id, label: ctx.system.label || ctx.system.id },
    task: ctx.task,
    attempt_dir: ctx.attemptDir,
    parsed_output: parsedOutput,
    parsed_output_path: ctx.parsedOutputPath,
    stdout_path: ctx.stdoutPath,
    stderr_path: ctx.stderrPath,
    autonomous_success_threshold: ctx.suite.scoring?.autonomous_success_threshold ?? 70,
  };
  const validatorCtx = {
    ...ctx,
    stdinPayload: validatorInput,
  };
  const raw = validatorSystem.adapter === 'docker'
    ? await runDocker(validatorSystem, validatorCtx, validator.timeoutMs || 120_000)
    : await runCommand(validatorSystem, validatorCtx, validator.timeoutMs || 120_000);
  await writeFile(path.join(ctx.attemptDir, 'validator-stdout.txt'), raw.stdout);
  await writeFile(path.join(ctx.attemptDir, 'validator-stderr.txt'), raw.stderr);
  const parsed = parseJsonOutput(raw.stdout);
  await writeFile(path.join(ctx.attemptDir, 'validator-output.json'), `${JSON.stringify({
    status: raw.exit_code === 0 ? 'completed' : 'failed',
    exit_code: raw.exit_code,
    timed_out: raw.timed_out,
    parsed_json: parsed,
  }, null, 2)}\n`);
  return parsed;
}

async function runAttempt({ suite, system, task, attempt, runDir, timeoutMs, dryRun, fixtureUrl }) {
  const runId = `${task.task_id}__${system.id}__a${attempt}`;
  const attemptDir = path.join(runDir, 'attempts', runId);
  await mkdir(attemptDir, { recursive: true });
  const inputJsonPath = path.join(attemptDir, 'input.json');
  const stdoutPath = path.join(attemptDir, 'stdout.txt');
  const stderrPath = path.join(attemptDir, 'stderr.txt');
  const parsedOutputPath = path.join(attemptDir, 'parsed-output.json');
  let ctx = { suite, system, task, attempt, runId, runDir, attemptDir, inputJsonPath, stdoutPath, stderrPath, parsedOutputPath, fixtureUrl };
  let fixtureContext = null;
  if (!dryRun && fixtureUrl) {
    fixtureContext = await prepareFixture(fixtureUrl, ctx);
    await writeFile(path.join(attemptDir, 'fixture-context.json'), `${JSON.stringify(fixtureContext, null, 2)}\n`);
    task = appendFixtureContext(task, fixtureContext);
    ctx = { ...ctx, task, fixtureContext };
  }
  const input = {
    suite_id: suite.suite_id,
    run_id: runId,
    attempt,
    system: { id: system.id, label: system.label || system.id },
    task,
    attempt_dir: attemptDir,
  };
  await writeFile(inputJsonPath, `${JSON.stringify(input, null, 2)}\n`);

  if (dryRun) {
    const dry = {
      run_id: runId,
      system_id: system.id,
      task_id: task.task_id,
      status: 'planned',
    dry_run: true,
      wall_clock_seconds: null,
      metrics: {},
    };
    await writeFile(path.join(attemptDir, 'result.json'), `${JSON.stringify(dry, null, 2)}\n`);
    return dry;
  }

  const raw = system.adapter === 'mock'
    ? await runMock(system, ctx)
    : system.adapter === 'docker'
      ? await runDocker(system, ctx, timeoutMs)
      : await runCommand(system, ctx, timeoutMs);
  await writeFile(stdoutPath, raw.stdout);
  await writeFile(stderrPath, raw.stderr);

  const parsed = parseJsonOutput(raw.stdout);
  await writeFile(parsedOutputPath, `${JSON.stringify(parsed, null, 2)}\n`);
  const validatorParsed = await runValidator(system.validator, ctx, parsed);
  const metrics = extractMetrics(validatorParsed || parsed, suite);
  const status = raw.timed_out
    ? 'timeout'
    : raw.spawn_error
      ? 'spawn_error'
      : raw.exit_code === 0
        ? 'completed'
        : 'failed';
  const result = {
    run_id: runId,
    system_id: system.id,
    system_label: system.label || system.id,
    task_id: task.task_id,
    task_name: task.name,
    status,
    parsed_json: parsed,
    metrics: {
      ...metrics,
      wall_clock_seconds: raw.wall_clock_seconds,
    },
    command: raw.command,
    args: redactArgs(raw.args || []),
    cwd: raw.cwd,
    exit_code: raw.exit_code,
    signal: raw.signal,
    timed_out: raw.timed_out,
    spawn_error: raw.spawn_error,
    stdout_path: stdoutPath,
    stderr_path: stderrPath,
    input_path: inputJsonPath,
    parsed_output_path: parsedOutputPath,
    validator_json: validatorParsed,
    fixture_context_path: fixtureContext ? path.join(attemptDir, 'fixture-context.json') : null,
  };
  await writeFile(path.join(attemptDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function median(values) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function mean(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function rate(values) {
  const known = values.filter((v) => typeof v === 'boolean');
  if (known.length === 0) return null;
  return known.filter(Boolean).length / known.length;
}

function aggregate(results, systems, tasks) {
  const bySystem = new Map(systems.map((s) => [s.id, []]));
  for (const result of results) {
    if (!bySystem.has(result.system_id)) bySystem.set(result.system_id, []);
    bySystem.get(result.system_id).push(result);
  }

  const summaries = [];
  for (const system of systems) {
    const attempts = bySystem.get(system.id) || [];
    const scored = attempts.filter((a) => Number.isFinite(a.metrics.score_0_100));
    const successes = attempts.filter((a) => a.metrics.autonomous_success === true);
    const attemptedTaskIds = [...new Set(attempts.map((a) => a.task_id))];
    const passByTask = attemptedTaskIds.map((taskId) => {
      const taskAttempts = attempts.filter((a) => a.task_id === taskId);
      if (!taskAttempts.some((a) => typeof a.metrics.autonomous_success === 'boolean')) return null;
      return taskAttempts.some((a) => a.metrics.autonomous_success === true);
    });
    const totalCost = attempts
      .map((a) => a.metrics.estimated_cost_usd)
      .filter((v) => Number.isFinite(v))
      .reduce((a, b) => a + b, 0);
    const hasCost = attempts.some((a) => Number.isFinite(a.metrics.estimated_cost_usd));

    summaries.push({
      system_id: system.id,
      system_label: system.label || system.id,
      attempts: attempts.length,
      scored_attempts: scored.length,
      completed_attempts: attempts.filter((a) => a.status === 'completed').length,
      failed_attempts: attempts.filter((a) => a.status !== 'completed' && a.status !== 'planned').length,
      autonomous_success_rate: rate(attempts.map((a) => a.metrics.autonomous_success)),
      pass_at_3: rate(passByTask),
      median_score: median(attempts.map((a) => a.metrics.score_0_100)),
      median_wall_clock_seconds: median(attempts.map((a) => a.metrics.wall_clock_seconds)),
      median_setup_seconds: median(attempts.map((a) => a.metrics.operator_setup_seconds)),
      interventions_per_task: mean(attempts.map((a) => a.metrics.human_interventions)),
      cost_per_success_usd: hasCost && successes.length > 0 ? totalCost / successes.length : null,
      total_prompt_tokens: attempts
        .map((a) => a.metrics.model_prompt_tokens)
        .filter((v) => Number.isFinite(v))
        .reduce((a, b) => a + b, 0) || null,
      total_completion_tokens: attempts
        .map((a) => a.metrics.model_completion_tokens)
        .filter((v) => Number.isFinite(v))
        .reduce((a, b) => a + b, 0) || null,
      total_cost_usd: hasCost ? totalCost : null,
      median_cost_usd: median(attempts.map((a) => a.metrics.estimated_cost_usd)),
      cost_per_1k_tokens: (() => {
        const allPrompt = attempts.map((a) => a.metrics.model_prompt_tokens).filter(Number.isFinite);
        const allCompletion = attempts.map((a) => a.metrics.model_completion_tokens).filter(Number.isFinite);
        const sumPrompt = allPrompt.reduce((a, b) => a + b, 0);
        const sumCompletion = allCompletion.reduce((a, b) => a + b, 0);
        const sumTokens = sumPrompt + sumCompletion;
        if (!sumTokens || !hasCost) return null;
        return Math.round((totalCost / sumTokens * 1000) * 100_000) / 100_000;
      })(),
      tokens_per_task: (() => {
        const allPrompt = attempts.map((a) => a.metrics.model_prompt_tokens).filter(Number.isFinite);
        const allCompletion = attempts.map((a) => a.metrics.model_completion_tokens).filter(Number.isFinite);
        const sumPrompt = allPrompt.reduce((a, b) => a + b, 0);
        const sumCompletion = allCompletion.reduce((a, b) => a + b, 0);
        const total = sumPrompt + sumCompletion;
        return total && attempts.length ? Math.round(total / attempts.length) : null;
      })(),
      artifact_validity: mean(attempts.map((a) => a.metrics.artifact_validity)),
      audit_completeness: mean(attempts.map((a) => a.metrics.audit_completeness)),
      tasks_attempted: attemptedTaskIds.length,
      tasks_total: tasks.length,
    });
  }
  return summaries;
}

function pct(value) {
  return value === null || value === undefined ? 'TBD' : `${Math.round(value * 100)}%`;
}

function num(value, digits = 1) {
  return value === null || value === undefined || !Number.isFinite(value) ? 'TBD' : value.toFixed(digits);
}

function money(value) {
  return value === null || value === undefined || !Number.isFinite(value) ? 'TBD' : `$${value.toFixed(2)}`;
}

function generateFindings({ suite, summaries, results, runDir, dryRun, modelPolicy }) {
  const lines = [];
  lines.push(`# ${suite.suite_name} Findings`);
  lines.push('');
  lines.push(`Run directory: \`${runDir}\``);
  lines.push(`Generated: ${new Date().toISOString()}`);
  if (modelPolicy?.requested_model || modelPolicy?.openrouter_model) {
    lines.push(`Shared model: \`${modelPolicy.openrouter_model || modelPolicy.requested_model}\` via \`${modelPolicy.shared_provider || 'openrouter'}\``);
  }
  if (dryRun) lines.push('');
  if (dryRun) lines.push('This was a dry run. No systems were executed.');
  lines.push('');
  lines.push('| System | Autonomous success | Pass@3 | Median score | Median task time | Setup time/task | Interventions/task | Tokens/task | Cost/task | Cost/1k tok | Artifact validity | Audit completeness |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const s of summaries) {
    const totalTokens = (s.total_prompt_tokens || 0) + (s.total_completion_tokens || 0);
    lines.push([
      `| ${s.system_label}`,
      pct(s.autonomous_success_rate),
      pct(s.pass_at_3),
      num(s.median_score, 0),
      s.median_wall_clock_seconds === null ? 'TBD' : `${num(s.median_wall_clock_seconds / 60, 1)} min`,
      s.median_setup_seconds === null ? 'TBD' : `${num(s.median_setup_seconds / 60, 1)} min`,
      num(s.interventions_per_task, 2),
      s.tokens_per_task ? `${(s.tokens_per_task / 1000).toFixed(1)}k` : 'TBD',
      s.median_cost_usd !== null ? `$${num(s.median_cost_usd, 4)}` : 'TBD',
      s.cost_per_1k_tokens !== null ? `$${num(s.cost_per_1k_tokens, 4)}` : 'TBD',
      pct(s.artifact_validity),
      pct(s.audit_completeness),
      '|',
    ].join(' | '));
  }

  const scoredSummaries = summaries.filter((s) => s.scored_attempts > 0);
  lines.push('');
  lines.push('## Findings');
  if (scoredSummaries.length === 0) {
    lines.push('');
    lines.push('- No scored attempts were found. Configure product adapters to emit metrics or attach deterministic validators before using this as benchmark evidence.');
  } else {
    const bestSuccess = [...scoredSummaries].sort((a, b) => (b.autonomous_success_rate ?? -1) - (a.autonomous_success_rate ?? -1))[0];
    const fastest = [...scoredSummaries].filter((s) => s.median_wall_clock_seconds !== null).sort((a, b) => a.median_wall_clock_seconds - b.median_wall_clock_seconds)[0];
    const lowestSetup = [...scoredSummaries].filter((s) => s.median_setup_seconds !== null).sort((a, b) => a.median_setup_seconds - b.median_setup_seconds)[0];
    const mostEfficient = [...scoredSummaries].filter((s) => s.tokens_per_task !== null).sort((a, b) => (a.tokens_per_task ?? Infinity) - (b.tokens_per_task ?? Infinity))[0];
    lines.push('');
    if (bestSuccess) lines.push(`- Highest autonomous success: ${bestSuccess.system_label} at ${pct(bestSuccess.autonomous_success_rate)}.`);
    if (fastest) lines.push(`- Fastest median task time: ${fastest.system_label} at ${num(fastest.median_wall_clock_seconds / 60, 1)} minutes.`);
    if (lowestSetup) lines.push(`- Lowest median setup time: ${lowestSetup.system_label} at ${num(lowestSetup.median_setup_seconds / 60, 1)} minutes.`);
    if (mostEfficient) lines.push(`- Most token-efficient: ${mostEfficient.system_label} at ${(mostEfficient.tokens_per_task / 1000).toFixed(1)}k tokens/task.`);
  }

  lines.push('');
  lines.push('## Data Quality Warnings');
  const warnings = [];
  for (const s of summaries) {
    if (s.attempts === 0) warnings.push(`${s.system_label}: no attempts were run.`);
    if (s.attempts > 0 && s.scored_attempts === 0) warnings.push(`${s.system_label}: attempts completed but no scores were reported.`);
    if (s.failed_attempts > 0) warnings.push(`${s.system_label}: ${s.failed_attempts} attempt(s) failed or timed out.`);
  }
  if (results.some((r) => r.parsed_json?.mock === true)) warnings.push('Mock adapter output is present; do not use mock rows in investor-facing results.');
  if (warnings.length === 0) {
    lines.push('');
    lines.push('- No obvious data quality warnings.');
  } else {
    lines.push('');
    for (const warning of warnings) lines.push(`- ${warning}`);
  }

  lines.push('');
  lines.push('## Next Steps');
  lines.push('');
  lines.push('- Replace mock systems with real wrapper commands in `systems.local.json`.');
  lines.push('- Add deterministic fixture validators so `score_0_100`, artifact validity, and audit completeness are not self-reported by the product under test.');
  lines.push('- Run each task with at least three attempts per system, then rerun with hidden variants for deck numbers.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  normalizeSharedModelEnv(process.env);
  const cli = parseArgs(process.argv.slice(2));
  const manifestPath = path.resolve(ROOT, cli.manifest || './tasks.json');
  const systemsPath = path.resolve(ROOT, cli.systems || './systems.example.json');
  const suite = await readJson(manifestPath);
  const config = await readJson(systemsPath);

  const include = splitList(cli.include);
  const exclude = new Set(splitList(cli.exclude) || []);
  const taskFilter = new Set(splitList(cli.task) || []);
  const runsPerTask = Number(cli.runs || config.defaults?.runsPerTask || 1);
  const timeoutMs = Number(cli.timeoutMs || config.defaults?.timeoutMs || 900_000);
  const fixtureUrl = cli.fixtureUrl || config.defaults?.fixtureUrl || process.env.CWAB_FIXTURE_URL || '';
  if (!Number.isInteger(runsPerTask) || runsPerTask < 1) throw new Error('--runs must be a positive integer');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) throw new Error('--timeout-ms must be at least 1000');

  const tasks = suite.tasks.filter((task) => taskFilter.size === 0 || taskFilter.has(task.task_id));
  if (tasks.length === 0) throw new Error('No tasks selected');

  let systems = selectedSystems(config, include, exclude);
  if (systems.length === 0) throw new Error('No systems selected. Use --include or enable a system in the config.');

  if (cli.doctor) {
    const checks = await doctorSystems({ systems, suite, fixtureUrl, requirePinned: cli.requirePinned === true });
    printDoctor(checks);
    if (checks.some((check) => check.status === 'fail')) process.exit(2);
    return;
  }

  const outputRoot = path.resolve(ROOT, cli.output || config.defaults?.outputDir || './results');
  const runDir = path.join(outputRoot, `${suite.suite_id}_${timestampSlug()}`);
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, 'run-config.json'), `${JSON.stringify({
    manifest: path.relative(ROOT, manifestPath),
    systems: path.relative(ROOT, systemsPath),
    dry_run: cli.dryRun === true,
    runs_per_task: runsPerTask,
    timeout_ms: timeoutMs,
    fixture_url: fixtureUrl || null,
    selected_systems: systems.map((s) => s.id),
    selected_tasks: tasks.map((t) => t.task_id),
  }, null, 2)}\n`);
  const environment = captureEnvironment(systems);
  await writeFile(path.join(runDir, 'environment.json'), `${JSON.stringify(environment, null, 2)}\n`);

  const results = [];
  for (const system of systems) {
    for (const task of tasks) {
      for (let attempt = 1; attempt <= runsPerTask; attempt++) {
        console.log(`[cwab] ${system.id} ${task.task_id} attempt ${attempt}/${runsPerTask}`);
        const result = await runAttempt({
          suite,
          system,
          task,
          attempt,
          runDir,
          timeoutMs,
          dryRun: cli.dryRun === true,
          fixtureUrl,
        });
        results.push(result);
      }
    }
  }

  const summaries = aggregate(results, systems, tasks);
  const failedAttempts = results.filter((result) => result.status !== 'completed' && result.status !== 'planned');
  const unscoredAttempts = results.filter((result) => !Number.isFinite(result.metrics?.score_0_100));
  const summary = {
    suite_id: suite.suite_id,
    run_dir: runDir,
    generated_at: new Date().toISOString(),
    dry_run: cli.dryRun === true,
    model_policy: environment.model_policy,
    systems: summaries,
    attempts: results,
  };
  await writeFile(path.join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(path.join(runDir, 'findings.md'), generateFindings({
    suite,
    summaries,
    results,
    runDir,
    dryRun: cli.dryRun === true,
    modelPolicy: environment.model_policy,
  }));

  console.log(`[cwab] wrote ${path.join(runDir, 'summary.json')}`);
  console.log(`[cwab] wrote ${path.join(runDir, 'findings.md')}`);
  if (cli.failOnError && failedAttempts.length > 0) {
    console.error(`[cwab] ${failedAttempts.length} attempt(s) failed or timed out`);
    process.exitCode = 2;
  }
  if (cli.requireScores && unscoredAttempts.length > 0) {
    console.error(`[cwab] ${unscoredAttempts.length} attempt(s) did not report score_0_100`);
    process.exitCode = process.exitCode || 3;
  }
}

main().catch((err) => {
  console.error(`[cwab] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
