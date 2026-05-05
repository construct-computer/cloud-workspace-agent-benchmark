#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

async function readStdinJson() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  return JSON.parse(input || '{}');
}

const payload = await readStdinJson();
const base = (process.env.CWAB_FIXTURE_URL || payload.task?.fixture_context?.endpoints?.validate || '').replace(/\/validate$/, '');
if (!base) throw new Error('CWAB_FIXTURE_URL or task.fixture_context.endpoints.validate is required');

let stdout = '';
try {
  stdout = payload.stdout_path ? await readFile(payload.stdout_path, 'utf8') : '';
} catch {
  stdout = '';
}

const res = await fetch(`${base}/validate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    suite_id: payload.suite_id,
    run_id: payload.run_id,
    task_id: payload.task?.task_id,
    system_id: payload.system?.id,
    attempt: payload.attempt,
    parsed_output: payload.parsed_output,
    autonomous_success_threshold: payload.autonomous_success_threshold,
    stdout,
  }),
});

const text = await res.text();
if (!res.ok) {
  console.error(text);
  process.exit(1);
}
console.log(text);
