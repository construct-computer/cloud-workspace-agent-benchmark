#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const ROOT = process.cwd();

function usage() {
  console.log(`
Usage:
  node ./prepare-images.mjs [options]

Options:
  --openclaw-version <version>              OpenClaw version/dist-tag. Default: 2026.4.15
  --openclaw-installer-url <url>            Official installer URL. Default: https://openclaw.ai/install.sh
  --openclaw-installer-sha256 <sha256>      Optional checksum pin for the installer script.
  --hermes-ref <ref>                        Hermes git tag/commit. Default: v2026.4.30
  --hermes-installer-url <url>              Official installer URL. Default: https://hermes-agent.nousresearch.com/install.sh
  --hermes-installer-sha256 <sha256>        Optional checksum pin for the installer script.
  --output-env <path>                       Env file to write. Default: ./.cwab-images.env
  --skip-openclaw                           Do not build OpenClaw image.
  --skip-hermes                             Do not build Hermes image.
`);
}

function parseArgs(argv) {
  const out = {
    openclawVersion: '2026.4.15',
    openclawInstallerUrl: 'https://openclaw.ai/install.sh',
    openclawInstallerSha256: '',
    hermesRef: 'v2026.4.30',
    hermesInstallerUrl: 'https://hermes-agent.nousresearch.com/install.sh',
    hermesInstallerSha256: '',
    outputEnv: './.cwab-images.env',
    skipOpenclaw: false,
    skipHermes: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--skip-openclaw') {
      out.skipOpenclaw = true;
      continue;
    }
    if (arg === '--skip-hermes') {
      out.skipHermes = true;
      continue;
    }
    const value = argv[++i];
    if (!value) throw new Error(`Missing value for ${arg}`);
    if (arg === '--openclaw-version') out.openclawVersion = value;
    else if (arg === '--openclaw-installer-url') out.openclawInstallerUrl = value;
    else if (arg === '--openclaw-installer-sha256') out.openclawInstallerSha256 = value;
    else if (arg === '--hermes-ref') out.hermesRef = value;
    else if (arg === '--hermes-installer-url') out.hermesInstallerUrl = value;
    else if (arg === '--hermes-installer-sha256') out.hermesInstallerSha256 = value;
    else if (arg === '--output-env') out.outputEnv = value;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return out;
}

function safeTag(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
}

function run(command, args) {
  console.log(`[cwab-images] ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

function inspectImageId(tag) {
  const result = spawnSync('docker', ['image', 'inspect', tag, '--format', '{{.Id}}'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`docker image inspect failed for ${tag}: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

async function readExistingEnv(path) {
  try {
    const raw = await readFile(path, 'utf8');
    const env = new Map();
    for (const line of raw.split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      if (match) env.set(match[1], match[2]);
    }
    return env;
  } catch (error) {
    if (error && error.code === 'ENOENT') return new Map();
    throw error;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const env = await readExistingEnv(opts.outputEnv);

  if (!opts.skipOpenclaw) {
    const tag = `cwab-openclaw:${safeTag(opts.openclawVersion)}`;
    run('docker', [
      'build',
      '-f',
      './Dockerfile.openclaw',
      '--build-arg',
      `OPENCLAW_VERSION=${opts.openclawVersion}`,
      '--build-arg',
      `OPENCLAW_INSTALLER_URL=${opts.openclawInstallerUrl}`,
      '--build-arg',
      `OPENCLAW_INSTALLER_SHA256=${opts.openclawInstallerSha256}`,
      '-t',
      tag,
      '.',
    ]);
    env.set('CWAB_OPENCLAW_IMAGE', inspectImageId(tag));
    env.set('CWAB_OPENCLAW_TAG', tag);
    env.set('CWAB_OPENCLAW_VERSION', opts.openclawVersion);
    env.set('CWAB_OPENCLAW_INSTALLER_URL', opts.openclawInstallerUrl);
    if (opts.openclawInstallerSha256) {
      env.set('CWAB_OPENCLAW_INSTALLER_SHA256', opts.openclawInstallerSha256);
    }
  }

  if (!opts.skipHermes) {
    const tag = `cwab-hermes:${safeTag(opts.hermesRef)}`;
    run('docker', [
      'build',
      '-f',
      './Dockerfile.hermes',
      '--build-arg',
      `HERMES_REF=${opts.hermesRef}`,
      '--build-arg',
      `HERMES_INSTALLER_URL=${opts.hermesInstallerUrl}`,
      '--build-arg',
      `HERMES_INSTALLER_SHA256=${opts.hermesInstallerSha256}`,
      '-t',
      tag,
      '.',
    ]);
    env.set('CWAB_HERMES_IMAGE', inspectImageId(tag));
    env.set('CWAB_HERMES_TAG', tag);
    env.set('CWAB_HERMES_REF', opts.hermesRef);
    env.set('CWAB_HERMES_INSTALLER_URL', opts.hermesInstallerUrl);
    if (opts.hermesInstallerSha256) {
      env.set('CWAB_HERMES_INSTALLER_SHA256', opts.hermesInstallerSha256);
    }
  }

  const orderedKeys = [
    'CWAB_OPENCLAW_IMAGE',
    'CWAB_OPENCLAW_TAG',
    'CWAB_OPENCLAW_VERSION',
    'CWAB_OPENCLAW_INSTALLER_URL',
    'CWAB_OPENCLAW_INSTALLER_SHA256',
    'CWAB_HERMES_IMAGE',
    'CWAB_HERMES_TAG',
    'CWAB_HERMES_REF',
    'CWAB_HERMES_INSTALLER_URL',
    'CWAB_HERMES_INSTALLER_SHA256',
  ];
  const envLines = [
    '# Generated by ./prepare-images.mjs',
    '# Source this file before running systems.docker.example.json.',
  ];
  for (const key of orderedKeys) {
    if (env.has(key)) envLines.push(`${key}=${env.get(key)}`);
  }
  for (const [key, value] of env) {
    if (!orderedKeys.includes(key)) envLines.push(`${key}=${value}`);
  }
  await writeFile(opts.outputEnv, `${envLines.join('\n')}\n`);
  console.log(`[cwab-images] wrote ${opts.outputEnv}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
