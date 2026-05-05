#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const DEFAULT_SYSTEMS = ['construct', 'openclaw', 'hermes'];
const DEFAULT_ENV_FILES = [
  './.cwab-images.env',
  './benchmark.env',
  './benchmark.local.env',
];
let activeFixture = null;
const activeChildren = new Set();

function usage(exitCode = 0) {
  console.log(`
CWAB one-command suite runner

Usage:
  node ./run-suite.mjs [options]

Options:
  --systems <path>          Systems config. Default: ./systems.docker.example.json
  --manifest <path>         Task manifest. Default: ./tasks.json
  --include <ids>           Comma-separated system ids. Default: construct,openclaw,hermes,n8n_ai_agent,n8n_built_workflow
  --exclude <ids>           Comma-separated system ids to skip.
  --task <ids>              Comma-separated task ids. Default: cwab-001
  --runs <n>                Attempts per system/task. Default: 3
  --timeout-ms <n>          Per-attempt timeout passed to run-benchmark.
  --output <dir>            Output directory passed to run-benchmark.
  --env-file <path>         Additional env file. Can be repeated.
  --fixture-url <url>       Local fixture URL. Default: http://localhost:6789
  --fixture-public-url <url> URL containers should use. Default: http://host.docker.internal:6789
  --fixture-port <n>        Port for an auto-started fixture. Default: 6789
  --include-controls        Also include fixture_demo_agent.
  --strict                  Fail if any selected system is missing env.
  --doctor-only             Start/check fixture and run doctor, but do not run attempts.
  --no-start-fixture        Require an already-running fixture server.
  --prepare-images          Build OpenClaw/Hermes images before loading env files.
  --openclaw-version <ver>  Version for --prepare-images. Default: prepare-images default.
  --openclaw-installer-url <url>
                            OpenClaw installer URL for --prepare-images.
  --openclaw-installer-sha256 <sha256>
                            Optional OpenClaw installer checksum for --prepare-images.
  --hermes-ref <ref>        Ref for --prepare-images. Default: prepare-images default.
  --pull-images             Pull registry digest images used by selected systems.
  --allow-unpinned          Do not pass --require-pinned.
  --allow-errors            Do not pass --fail-on-error.
  --allow-unscored          Do not pass --require-scores.
  --help                    Show this help.

Shared LLM env:
  OPENROUTER_API_KEY + CWAB_MODEL_ID are normalized across Construct,
  OpenClaw, Hermes, and n8n AI Agent. CWAB_MODEL_ID accepts either
  provider/model or openrouter/provider/model.

Examples:
  node ./run-suite.mjs --prepare-images --strict
  node ./run-suite.mjs --include n8n_built_workflow --runs 3
  node ./run-suite.mjs --env-file ./benchmark.local.env --strict --pull-images
`.trim());
  process.exit(exitCode);
}

function parseArgs(argv) {
  const out = {
    systems: './systems.docker.example.json',
    manifest: './tasks.json',
    include: DEFAULT_SYSTEMS.join(','),
    task: 'cwab-001',
    runs: '3',
    fixtureUrl: 'http://localhost:6789',
    fixturePublicUrl: 'http://host.docker.internal:6789',
    fixturePort: '6789',
    envFiles: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') usage(0);
    if (arg === '--include-controls') {
      out.includeControls = true;
      continue;
    }
    if (arg === '--strict') {
      out.strict = true;
      continue;
    }
    if (arg === '--doctor-only') {
      out.doctorOnly = true;
      continue;
    }
    if (arg === '--no-start-fixture') {
      out.noStartFixture = true;
      continue;
    }
    if (arg === '--prepare-images') {
      out.prepareImages = true;
      continue;
    }
    if (arg === '--pull-images') {
      out.pullImages = true;
      continue;
    }
    if (arg === '--allow-unpinned') {
      out.allowUnpinned = true;
      continue;
    }
    if (arg === '--allow-errors') {
      out.allowErrors = true;
      continue;
    }
    if (arg === '--allow-unscored') {
      out.allowUnscored = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (key === 'envFile') out.envFiles.push(value);
    else out[key] = value;
  }
  return out;
}

function splitList(value) {
  return String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function parseEnvValue(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function loadEnvFile(file, env) {
  const abs = path.resolve(ROOT, file);
  if (!(await fileExists(abs))) return false;
  const raw = await readFile(abs, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    env[match[1]] = parseEnvValue(match[2]);
  }
  return true;
}

async function loadEnv(files) {
  const fileEnv = {};
  const loaded = [];
  for (const file of files) {
    if (await loadEnvFile(file, fileEnv)) loaded.push(file);
  }
  return {
    env: {
      ...fileEnv,
      ...process.env,
    },
    loaded,
  };
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
    const openClawModel = withOpenRouterPrefix(openRouterModel);
    env.CWAB_MODEL_ID ||= rawModel;
    env.CWAB_OPENROUTER_MODEL ||= openRouterModel;
    env.CWAB_OPENCLAW_MODEL ||= openClawModel;
    env.CONSTRUCT_BENCHMARK_PROVIDER ||= 'openrouter';
    env.CONSTRUCT_BENCHMARK_MODEL ||= openRouterModel;
    env.CWAB_AGENT_PROVIDER ||= 'openrouter';
    env.CWAB_AGENT_MODEL ||= openRouterModel;
    env.OPENCLAW_MODEL ||= openClawModel;
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

function renderEnvString(value, env) {
  return String(value ?? '').replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => env[name] || '');
}

function selectedSystems(config, include, exclude) {
  return (config.systems || []).filter((system) => include.includes(system.id) && !exclude.has(system.id));
}

function missingRequirements(system, env) {
  const missing = [];
  for (const name of system.requiredEnv || []) {
    if (!env[name]) missing.push(name);
  }
  for (const group of system.requiredAnyEnv || []) {
    if (!group.some((name) => env[name])) missing.push(`one of ${group.join('/')}`);
  }
  const containers = [
    ...(system.adapter === 'docker' ? [system.container] : []),
    ...(system.validator?.adapter === 'docker' ? [system.validator.container] : []),
  ];
  for (const container of containers) {
    const rawImage = container?.image || '';
    for (const match of rawImage.matchAll(/\$\{([A-Z0-9_]+)\}/g)) {
      if (!env[match[1]]) missing.push(match[1]);
    }
  }
  return [...new Set(missing)];
}

function collectImages(systems, env) {
  const images = new Set();
  for (const system of systems) {
    const containers = [
      ...(system.adapter === 'docker' ? [system.container] : []),
      ...(system.validator?.adapter === 'docker' ? [system.validator.container] : []),
    ];
    for (const container of containers) {
      const image = renderEnvString(container?.image || '', env);
      if (image && !image.startsWith('sha256:')) images.add(image);
    }
  }
  return [...images];
}

function runStreaming(command, args, env, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    activeChildren.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderr += text;
      process.stderr.write(text);
    });
    child.on('error', (error) => {
      stderr += `${error.message}\n`;
      resolve({ code: 1, stdout, stderr, error, child });
    });
    child.on('close', (code, signal) => {
      activeChildren.delete(child);
      resolve({ code: code ?? (signal ? 1 : 0), signal, stdout, stderr, child });
    });
  });
}

async function fixtureHealth(fixtureUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${fixtureUrl.replace(/\/$/, '')}/health`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForFixture(fixtureUrl, timeoutMs = 12_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fixtureHealth(fixtureUrl)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function ensureFixture(cli, env) {
  if (await fixtureHealth(cli.fixtureUrl)) {
    console.log(`[cwab-suite] fixture already reachable at ${cli.fixtureUrl}`);
    return null;
  }
  if (cli.noStartFixture) throw new Error(`Fixture is not reachable at ${cli.fixtureUrl}`);

  console.log(`[cwab-suite] starting fixture on port ${cli.fixturePort}`);
  const child = spawn(process.execPath, ['./fixtures/cwab-fixture-server.mjs'], {
    cwd: ROOT,
    env: {
      ...env,
      CWAB_FIXTURE_PORT: cli.fixturePort,
      CWAB_FIXTURE_PUBLIC_URL: cli.fixturePublicUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  if (!(await waitForFixture(cli.fixtureUrl))) {
    child.kill('SIGTERM');
    throw new Error(`Fixture did not become reachable at ${cli.fixtureUrl}`);
  }
  return child;
}

function stopFixture(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
}

function stopActiveChildren() {
  for (const child of activeChildren) {
    if (!child.killed) child.kill('SIGTERM');
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopActiveChildren();
    stopFixture(activeFixture);
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

async function prepareImages(cli, env) {
  const args = ['./prepare-images.mjs'];
  if (cli.openclawVersion) args.push('--openclaw-version', cli.openclawVersion);
  if (cli.openclawInstallerUrl) args.push('--openclaw-installer-url', cli.openclawInstallerUrl);
  if (cli.openclawInstallerSha256) args.push('--openclaw-installer-sha256', cli.openclawInstallerSha256);
  if (cli.hermesRef) args.push('--hermes-ref', cli.hermesRef);
  const result = await runStreaming(process.execPath, args, env);
  if (result.code !== 0) throw new Error(`prepare-images failed with exit code ${result.code}`);
}

async function pullImages(images, env) {
  for (const image of images) {
    console.log(`[cwab-suite] pulling ${image}`);
    const result = await runStreaming('docker', ['pull', image], env);
    if (result.code !== 0) throw new Error(`docker pull failed for ${image}`);
  }
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));

  if (cli.prepareImages) {
    await prepareImages(cli, { ...process.env });
  }

  const envFiles = [...DEFAULT_ENV_FILES, ...cli.envFiles];
  const { env, loaded } = await loadEnv(envFiles);
  normalizeSharedModelEnv(env);
  env.CWAB_FIXTURE_URL = cli.fixtureUrl;
  env.CWAB_FIXTURE_PUBLIC_URL = cli.fixturePublicUrl;
  env.N8N_OPERATOR_SETUP_SECONDS = env.N8N_OPERATOR_SETUP_SECONDS || '600';

  const systemsConfig = await readJson(path.resolve(ROOT, cli.systems));
  const include = splitList(cli.include);
  if (cli.includeControls && !include.includes('fixture_demo_agent')) include.unshift('fixture_demo_agent');
  const exclude = new Set(splitList(cli.exclude));
  const systems = selectedSystems(systemsConfig, include, exclude);
  if (systems.length === 0) throw new Error('No matching systems selected.');

  const availability = systems.map((system) => ({
    system,
    missing: missingRequirements(system, env),
  }));
  const runnable = availability.filter((entry) => entry.missing.length === 0).map((entry) => entry.system);
  const skipped = availability.filter((entry) => entry.missing.length > 0);

  console.log(`[cwab-suite] loaded env files: ${loaded.length ? loaded.join(', ') : '(none)'}`);
  if (env.CWAB_OPENROUTER_MODEL || env.CWAB_MODEL_ID) {
    console.log(`[cwab-suite] shared OpenRouter model: ${env.CWAB_OPENROUTER_MODEL || env.CWAB_MODEL_ID}`);
  }
  console.log(`[cwab-suite] selected: ${systems.map((system) => system.id).join(', ')}`);
  if (skipped.length) {
    for (const entry of skipped) {
      console.log(`[cwab-suite] skipping ${entry.system.id}: missing ${entry.missing.join(', ')}`);
    }
  }
  console.log(`[cwab-suite] runnable: ${runnable.map((system) => system.id).join(', ') || '(none)'}`);

  if (cli.strict && skipped.length) {
    throw new Error('Strict mode requires every selected system to be runnable.');
  }
  if (runnable.length === 0) throw new Error('No runnable systems. Fill env vars or choose a runnable system.');

  if (cli.pullImages) await pullImages(collectImages(runnable, env), env);

  let fixture = null;
  try {
    fixture = await ensureFixture(cli, env);
    activeFixture = fixture;

    const commonArgs = [
      './run-benchmark.mjs',
      '--manifest',
      cli.manifest,
      '--systems',
      cli.systems,
      '--include',
      runnable.map((system) => system.id).join(','),
      '--fixture-url',
      cli.fixtureUrl,
    ];
    if (cli.task) commonArgs.push('--task', cli.task);
    if (cli.timeoutMs) commonArgs.push('--timeout-ms', cli.timeoutMs);
    if (cli.output) commonArgs.push('--output', cli.output);
    if (!cli.allowUnpinned) commonArgs.push('--require-pinned');

    const doctor = await runStreaming(process.execPath, [...commonArgs, '--doctor'], env);
    if (doctor.code !== 0) throw new Error(`doctor failed with exit code ${doctor.code}`);
    if (cli.doctorOnly) return;

    const runArgs = [...commonArgs, '--runs', cli.runs];
    if (!cli.allowErrors) runArgs.push('--fail-on-error');
    if (!cli.allowUnscored) runArgs.push('--require-scores');

    const run = await runStreaming(process.execPath, runArgs, env);
    if (run.code !== 0) throw new Error(`benchmark failed with exit code ${run.code}`);
  } finally {
    stopFixture(fixture);
    activeFixture = null;
  }
}

main().catch((error) => {
  console.error(`[cwab-suite] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
