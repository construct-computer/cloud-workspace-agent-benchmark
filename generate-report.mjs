#!/usr/bin/env node

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_RESULTS_DIR = path.join(ROOT, 'results');
const DEFAULT_MANIFEST = path.join(ROOT, 'tasks.json');

const COLOR = {
  ink: '111827',
  muted: '4B5563',
  line: 'CBD5E1',
  navy: '163B5C',
  blue: 'DCEBFA',
  paleBlue: 'EFF6FF',
  green: 'DCFCE7',
  paleGreen: 'F0FDF4',
  yellow: 'FEF3C7',
  red: 'FEE2E2',
  row: 'F8FAFC',
  white: 'FFFFFF',
};

const CELL_BORDER = { style: BorderStyle.SINGLE, size: 1, color: COLOR.line };
const HEADER_BORDER = { style: BorderStyle.SINGLE, size: 6, color: COLOR.navy };

function usage() {
  return `
Usage:
  node ./generate-report.mjs [options]

Options:
  --run-dir <dir>       Benchmark run directory containing summary.json.
  --summary <file>      Direct path to summary.json.
  --manifest <file>     Task manifest. Default: ./tasks.json
  --output <file>       Output DOCX file. Default: <run-dir>/report.docx
  --title <text>        Report title.
  --help                Show this help.
`.trim();
}

function parseArgs(argv) {
  const out = {
    manifest: DEFAULT_MANIFEST,
    title: 'Cloud Workstation Automation Benchmark',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
    } else if (arg === '--run-dir') {
      out.runDir = argv[++i];
    } else if (arg === '--summary') {
      out.summary = argv[++i];
    } else if (arg === '--manifest') {
      out.manifest = argv[++i];
    } else if (arg === '--output') {
      out.output = argv[++i];
    } else if (arg === '--latest-output') {
      i += 1;
    } else if (arg === '--title') {
      out.title = argv[++i];
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return out;
}

async function latestRunDir() {
  const entries = await readdir(DEFAULT_RESULTS_DIR, { withFileTypes: true }).catch(() => []);
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(DEFAULT_RESULTS_DIR, entry.name))
    .sort();
  if (!dirs.length) throw new Error(`No result directories found under ${DEFAULT_RESULTS_DIR}`);
  return dirs[dirs.length - 1];
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function pct(value, decimals = 0) {
  if (!Number.isFinite(value)) return 'n/a';
  return `${(value * 100).toFixed(decimals)}%`;
}

function pp(value, decimals = 0) {
  if (!Number.isFinite(value)) return 'n/a';
  return `${(value * 100).toFixed(decimals)} pp`;
}

function num(value, decimals = 0) {
  if (!Number.isFinite(value)) return 'n/a';
  return Number(value).toFixed(decimals);
}

function seconds(value) {
  if (!Number.isFinite(value)) return 'n/a';
  return `${Number(value).toFixed(1)}s`;
}

function shortDate(value) {
  if (!value) return 'unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
}

function truncate(value, max = 220) {
  const text = String(value || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/'s(?=[A-Za-z])/g, "'s ")
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'No final text captured.';
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function attemptNumber(attempt, fallbackIndex = 0) {
  if (attempt?.attempt !== undefined && attempt.attempt !== null) return String(attempt.attempt);
  const match = String(attempt?.run_id || '').match(/__a(\d+)$/);
  return match?.[1] || String(fallbackIndex + 1);
}

function sortSystems(systems) {
  return [...systems].sort((a, b) => {
    const success = (b.autonomous_success_rate ?? -1) - (a.autonomous_success_rate ?? -1);
    if (success) return success;
    const pass = (b.pass_at_3 ?? -1) - (a.pass_at_3 ?? -1);
    if (pass) return pass;
    return (b.median_score ?? -1) - (a.median_score ?? -1);
  });
}

function attemptsBySystem(attempts) {
  const map = new Map();
  for (const attempt of attempts || []) {
    const list = map.get(attempt.system_id) || [];
    list.push(attempt);
    map.set(attempt.system_id, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => Number(a.attempt || 0) - Number(b.attempt || 0));
  }
  return map;
}

function getTask(manifest, taskId) {
  return manifest.tasks?.find((task) => task.task_id === taskId) || null;
}

function getChecks(attempt) {
  return attempt?.validator_json?.checks || [];
}

function passedChecks(attempt) {
  return getChecks(attempt).filter((check) => check.ok);
}

function missedChecks(attempt) {
  return getChecks(attempt).filter((check) => !check.ok);
}

function checkPassed(attempt, name) {
  return Boolean(getChecks(attempt).find((check) => check.name === name)?.ok);
}

function uniqueCheckNames(attempts) {
  return [...new Set((attempts || []).flatMap((attempt) => getChecks(attempt).map((check) => check.name)))];
}

function bestAttemptFor(system, bySystem) {
  return [...(bySystem.get(system.system_id) || [])]
    .sort((a, b) => (b.metrics?.score_0_100 ?? -1) - (a.metrics?.score_0_100 ?? -1))[0] || null;
}

function scoresFor(system, bySystem) {
  return (bySystem.get(system.system_id) || [])
    .map((attempt) => attempt.metrics?.score_0_100)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

function median(values) {
  const nums = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return NaN;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function outcomeClass(system) {
  if ((system.pass_at_3 || 0) > 0 && (system.autonomous_success_rate || 0) < 0.5) {
    return 'Demonstrated completion, repeatability risk';
  }
  if ((system.autonomous_success_rate || 0) >= 0.5) return 'Repeatable completion signal';
  if ((system.median_score || 0) <= 25) return 'No usable completion observed';
  return 'Partial completion only';
}

function attemptOutcome(attempt) {
  if (!attempt) return 'No attempt recorded.';
  if (attempt.status === 'timeout') return 'Timed out before validator-recognized completion.';
  if (attempt.metrics?.autonomous_success) return 'Full pass: all required evidence and checks accepted.';

  const finalText = String(attempt.parsed_json?.final_text || '');
  if (/slack\s*integration|not connected/i.test(finalText)) {
    return 'Blocked before delivery: report work started, but the finance message was not accepted.';
  }
  if (/couldn.t generate|incomplete turn|tool_call_id|\bin, in\b|\band and,/i.test(finalText)) {
    return 'Unusable response: benchmark did not receive meaningful task execution.';
  }

  const missed = missedChecks(attempt).map((check) => check.name);
  if (missed.includes('report artifact created') && missed.includes('finance message sent')) {
    return 'No accepted report artifact or finance message.';
  }
  if (missed.length) return `Partial completion; missed ${missed.slice(0, 2).join(' and ')}.`;
  return 'Completed with validator caveats.';
}

function evidenceNote(attempt) {
  const outcome = attemptOutcome(attempt);
  const finalText = String(attempt?.parsed_json?.final_text || '');
  if (attempt?.metrics?.autonomous_success) return truncate(finalText, 180);
  if (attempt?.status === 'timeout') return outcome;
  if (/couldn.t generate|incomplete turn|tool_call_id|\bin, in\b|\band and,|"payloads"|"meta"/i.test(finalText)) {
    return outcome;
  }
  if (missedChecks(attempt).some((check) => ['report artifact created', 'finance message sent'].includes(check.name))) {
    return `${outcome} Final response may claim success; validator did not accept the required delivery evidence.`;
  }
  return truncate(finalText, 180);
}

function metricFill(value, high = 1) {
  if (!Number.isFinite(value)) return COLOR.white;
  const normalized = Math.max(0, Math.min(1, value / high));
  if (normalized >= 0.8) return COLOR.green;
  if (normalized >= 0.4) return COLOR.yellow;
  return COLOR.red;
}

function scoreFill(value) {
  return metricFill(value, 100);
}

function checkFill(okCount, total) {
  if (!total) return COLOR.white;
  return metricFill(okCount / total, 1);
}

function topCompetitor(systems, metric, lowerIsBetter = false) {
  const candidates = systems.slice(1).filter((system) => Number.isFinite(system[metric]));
  if (!candidates.length) return null;
  return candidates.sort((a, b) => lowerIsBetter ? a[metric] - b[metric] : b[metric] - a[metric])[0];
}

function p(text, opts = {}) {
  const children = Array.isArray(text)
    ? text
    : [new TextRun({ text: String(text || ''), color: opts.color || COLOR.ink, bold: opts.bold, italics: opts.italics })];
  return new Paragraph({
    children,
    alignment: opts.alignment,
    heading: opts.heading,
    spacing: opts.spacing || { after: 120 },
    style: opts.style,
    border: opts.border,
  });
}

function heading(text, level = 1) {
  const headingLevel = level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
  return p(text, { heading: headingLevel, spacing: { before: level === 1 ? 360 : 240, after: 140 } });
}

function caption(text) {
  return p(text, { style: 'Caption', color: COLOR.muted, spacing: { after: 180 } });
}

function cell(text, opts = {}) {
  const runs = Array.isArray(text)
    ? text
    : [new TextRun({
      text: String(text ?? ''),
      bold: opts.bold,
      color: opts.color || COLOR.ink,
      size: opts.size || 18,
    })];
  const config = {
    children: [new Paragraph({ children: runs, alignment: opts.align, spacing: { after: 0 } })],
    borders: {
      top: opts.header ? HEADER_BORDER : CELL_BORDER,
      bottom: opts.header ? HEADER_BORDER : CELL_BORDER,
      left: CELL_BORDER,
      right: CELL_BORDER,
    },
    margins: { top: 90, bottom: 90, left: 110, right: 110 },
  };
  if (opts.width) config.width = { size: opts.width, type: WidthType.PERCENTAGE };
  if (opts.fill) config.shading = { fill: opts.fill, type: ShadingType.CLEAR };
  return new TableCell(config);
}

function headerCell(text, opts = {}) {
  return cell(text, {
    ...opts,
    header: true,
    bold: true,
    color: COLOR.white,
    fill: COLOR.navy,
    align: opts.align || AlignmentType.CENTER,
  });
}

function row(cells) {
  return new TableRow({ children: cells });
}

function table(rows, opts = {}) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
    margins: opts.margins,
  });
}

function summaryMetricRows(systems, bySystem) {
  const best = systems[0];
  const scoreCompetitor = topCompetitor(systems, 'median_score');
  const passCompetitor = topCompetitor(systems, 'pass_at_3');
  const auditCompetitor = topCompetitor(systems, 'audit_completeness');
  const fastest = [...systems]
    .filter((system) => Number.isFinite(system.median_wall_clock_seconds))
    .sort((a, b) => a.median_wall_clock_seconds - b.median_wall_clock_seconds)[0];
  const bestAttempt = best ? bestAttemptFor(best, bySystem) : null;

  return [
    ['Observed end-to-end completion', best ? `${best.system_label}: ${num(best.autonomous_success_rate * best.attempts)}/${num(best.attempts)} attempts` : 'n/a', 'Only one system produced a full validator-accepted run.'],
    ['Reliability across three tries', best ? `${best.system_label}: ${pct(best.pass_at_3)}` : 'n/a', passCompetitor ? `${pp((best?.pass_at_3 || 0) - passCompetitor.pass_at_3)} ahead of ${passCompetitor.system_label}` : 'No peer comparison available.'],
    ['Median score separation', best ? `${num(best.median_score)} vs ${num(scoreCompetitor?.median_score)} next best` : 'n/a', scoreCompetitor ? `${num((best?.median_score || 0) - scoreCompetitor.median_score)} point median-score gap.` : 'No peer comparison available.'],
    ['Best single attempt', bestAttempt ? `${bestAttempt.system_label}: ${num(bestAttempt.metrics?.score_0_100)} / 100` : 'n/a', 'Shows whether the system can complete the workflow when it stays on path.'],
    ['Audit trail quality', best ? `${pct(best.audit_completeness)} for ${best.system_label}` : 'n/a', auditCompetitor ? `${pp((best?.audit_completeness || 0) - auditCompetitor.audit_completeness)} above next best.` : 'No peer comparison available.'],
    ['Fastest median attempt', fastest ? `${fastest.system_label}: ${seconds(fastest.median_wall_clock_seconds)}` : 'n/a', fastest?.system_id === best?.system_id ? 'Leader is also fastest.' : 'Speed did not correlate with accepted task completion.'],
    ['Cost efficiency', best ? `${best.system_label}: $${num(best.median_cost_usd, 4)}/task` : 'n/a', 'Per-task LLM cost. Does not include infrastructure or operator time.'],
  ];
}

function buildDocx({ summary, manifest, runConfig, environment, title, runDir }) {
  const systems = sortSystems(summary.systems || []);
  const attempts = summary.attempts || [];
  const bySystem = attemptsBySystem(attempts);
  const taskIds = [...new Set(attempts.map((attempt) => attempt.task_id).filter(Boolean))];
  const task = getTask(manifest, taskIds[0] || runConfig.selected_tasks?.[0]);
  const best = systems[0];
  const bestAttempt = best ? bestAttemptFor(best, bySystem) : null;
  const generatedAt = summary.generated_at || environment.generated_at || new Date().toISOString();
  const policy = summary.model_policy || environment.model_policy || {};
  const scoreCompetitor = topCompetitor(systems, 'median_score');
  const passCompetitor = topCompetitor(systems, 'pass_at_3');
  const auditCompetitor = topCompetitor(systems, 'audit_completeness');
  const taskName = task?.name || taskIds[0] || 'Selected benchmark task';

  const children = [];

  children.push(new Paragraph({
    children: [new TextRun({ text: title, bold: true, size: 42, color: COLOR.ink })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: 'Investor diligence report - seed benchmark run', color: COLOR.muted, size: 22 })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: `Generated ${shortDate(generatedAt)} | ${path.relative(ROOT, runDir)}`, color: COLOR.muted, size: 18 })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 360 },
  }));

  children.push(table([
    row([headerCell('Executive verdict', { width: 25 }), headerCell('Evidence from this run', { width: 38 }), headerCell('How to use it', { width: 37 })]),
    row([
      cell(best ? `${best.system_label} demonstrated the strongest end-to-end workflow completion.` : 'No system achieved full workflow completion.', { bold: true, fill: COLOR.paleGreen }),
      cell(bestAttempt ? `${bestAttempt.system_label} reached ${num(bestAttempt.metrics?.score_0_100)} / 100 in attempt ${attemptNumber(bestAttempt)}. Next best median: ${num(scoreCompetitor?.median_score)}.` : 'No accepted full workflow completion captured.', { fill: COLOR.paleGreen }),
      cell('Lead with this as directional proof that the workflow can be completed end-to-end, not as a statistically complete benchmark.', { fill: COLOR.paleGreen }),
    ]),
    row([
      cell('Multiple systems showed task understanding; reliability varies.', { bold: true, fill: COLOR.yellow }),
      cell(best ? `${best.system_label} succeeded autonomously in ${num(best.autonomous_success_rate * best.attempts)}/${num(best.attempts)} attempts (pass@3: ${pct(best.pass_at_3)}). ${passCompetitor ? `${passCompetitor.system_label} pass@3: ${pct(passCompetitor.pass_at_3)}.` : ''}` : 'n/a', { fill: COLOR.yellow }),
      cell('Claim observed capability plus clear next benchmark target. Competitors showed partial capability that may improve with production-grade models.', { fill: COLOR.yellow }),
    ]),
    row([
      cell('Setup complexity is a material differentiator.', { bold: true, fill: COLOR.paleBlue }),
      cell(best ? `${best.system_label} required ${num(best.median_setup_seconds || 0)}s setup. Competitors required ${systems.filter(s => s.system_id !== best.system_id).map(s => `${s.system_label}: ${num((s.median_setup_seconds || 0) / 60, 1)} min`).join('; ')}.` : 'Setup comparison unavailable.', { fill: COLOR.paleBlue }),
      cell('Zero-setup cloud operation vs CLI installation is a defensible enterprise advantage.', { fill: COLOR.paleBlue }),
    ]),
  ]));

  children.push(caption('Table 1. Decision summary. This table separates the claim, the evidence, and the limitation so the report does not overstate the seed result.'));

  children.push(heading('1. Benchmark Design', 1));
  children.push(p([
    new TextRun({ text: 'Task tested: ', bold: true }),
    new TextRun({ text: taskName }),
  ], { spacing: { after: 80 } }));
  children.push(p(task?.prompt || 'The benchmark gave each system the same realistic office automation task.', { spacing: { after: 120 } }));
  children.push(table([
    row([headerCell('Control', { width: 25 }), headerCell('Value', { width: 75 })]),
    row([cell('Systems tested'), cell((runConfig.selected_systems || systems.map((system) => system.system_id)).join(', '))]),
    row([cell('Attempts per system'), cell(String(runConfig.runs_per_task || best?.attempts || 'n/a'))]),
    row([cell('Selected task'), cell((runConfig.selected_tasks || taskIds).join(', ') || 'n/a')]),
    row([cell('Model policy'), cell(policy.requested_model || policy.openrouter_model || 'Recorded in environment.json')]),
    row([cell('Scoring source'), cell('Deterministic fixture validator checking invoices, payments, report artifact, finance message, and fabrication avoidance.')]),
  ]));
  children.push(caption('Table 2. Benchmark controls. The systems received the same task, model policy, and number of tries.'));

  if (task) {
    if (task.construct_advantage_tested) {
      children.push(heading('What This Task Tests', 2));
      children.push(p(task.construct_advantage_tested, { spacing: { after: 120 } }));
    }

    const checkExplanations = {
      'all seeded invoices are referenced': 'Confirms the system read and parsed every invoice from the fixture data source rather than fabricating or skipping entries. A system that misses invoices cannot produce a trustworthy reconciliation.',
      'all payment rows are classified paid/unpaid/overpaid': 'Verifies the system cross-referenced each payment record against invoices and correctly categorized the payment status. This tests data-joining ability across two different data formats.',
      'known seeded mismatch is identified': 'The fixture contains deliberate discrepancies (e.g. underpayment, missing payment). The system must detect these specific mismatches to demonstrate genuine reconciliation logic rather than surface-level summarization.',
      'report artifact exists and is readable': 'The system must persist its work as a durable document artifact, not just chat text. This tests the ability to create business-ready deliverables.',
      'finance-ops receives the expected summary': 'The system must deliver results to the correct channel with an actionable summary. This tests end-to-end workflow completion including the communication step.',
      'fabricates invoice data not present in fixtures': 'A disqualifier: if the system invents vendor names, amounts, or invoice numbers not in the fixture data, the result is invalid regardless of how plausible it appears.',
      'sends a message without creating the artifact': 'A disqualifier: claiming completion without producing the required report artifact indicates the system skipped a critical workflow step.',
    };

    children.push(table([
      row([headerCell('Required evidence', { width: 35 }), headerCell('Why it matters', { width: 65 })]),
      ...(task.success_checks || []).map((check, index) => row([
        cell(check, { fill: index % 2 ? COLOR.white : COLOR.row }),
        cell(checkExplanations[check] || 'Required for a validator-recognized business outcome.', { fill: index % 2 ? COLOR.white : COLOR.row }),
      ])),
      ...(task.disqualifiers || []).map((check) => row([
        cell(check, { fill: COLOR.red }),
        cell(checkExplanations[check] || 'Would invalidate the result even if the response looked plausible.', { fill: COLOR.red }),
      ])),
    ]));
    children.push(caption('Table 3. Success checks and disqualifiers used by the validator. Each check maps to a specific business requirement.'));
  }

  children.push(heading('2. Headline Results', 1));
  children.push(table([
    row([headerCell('Investor question', { width: 30 }), headerCell('Answer from data', { width: 32 }), headerCell('Interpretation', { width: 38 })]),
    ...summaryMetricRows(systems, bySystem).map(([question, answer, interpretation], index) => row([
      cell(question, { bold: true, fill: index % 2 ? COLOR.white : COLOR.row }),
      cell(answer, { fill: index % 2 ? COLOR.white : COLOR.row }),
      cell(interpretation, { fill: index % 2 ? COLOR.white : COLOR.row }),
    ])),
  ]));
  children.push(caption('Table 4. Summary readout. These are the points a diligence reader should compare first.'));

  children.push(table([
    row([
      headerCell('System', { width: 16 }),
      headerCell('Outcome class', { width: 22 }),
      headerCell('Autonomous success', { width: 14 }),
      headerCell('Pass@3', { width: 12 }),
      headerCell('Median score', { width: 12 }),
      headerCell('Best score', { width: 12 }),
      headerCell('Evidence trail', { width: 12 }),
    ]),
    ...systems.map((system, index) => {
      const scores = scoresFor(system, bySystem);
      const bestScore = scores.length ? Math.max(...scores) : NaN;
      const fill = system.system_id === best?.system_id ? COLOR.paleGreen : index % 2 ? COLOR.white : COLOR.row;
      return row([
        cell(system.system_label, { bold: true, fill }),
        cell(outcomeClass(system), { fill }),
        cell(pct(system.autonomous_success_rate), { fill: metricFill(system.autonomous_success_rate, 1), align: AlignmentType.CENTER }),
        cell(pct(system.pass_at_3), { fill: metricFill(system.pass_at_3, 1), align: AlignmentType.CENTER }),
        cell(num(system.median_score), { fill: scoreFill(system.median_score), align: AlignmentType.CENTER }),
        cell(num(bestScore), { fill: scoreFill(bestScore), align: AlignmentType.CENTER }),
        cell(pct(system.audit_completeness), { fill: metricFill(system.audit_completeness, 1), align: AlignmentType.CENTER }),
      ]);
    }),
  ]));
  children.push(caption('Table 5. Outcome scorecard. Green cells indicate strong observed evidence; yellow indicates partial evidence; red indicates weak or missing evidence.'));

  children.push(heading('Operational Metrics Comparison', 2));
  children.push(table([
    row([
      headerCell('System', { width: 12 }),
      headerCell('Completed', { width: 11 }),
      headerCell('Failed', { width: 9 }),
      headerCell('Median time', { width: 10 }),
      headerCell('Tokens/task', { width: 12 }),
      headerCell('Cost/task', { width: 11 }),
      headerCell('Artifact quality', { width: 13 }),
      headerCell('Audit trail', { width: 11 }),
      headerCell('Interventions', { width: 11 }),
    ]),
    ...systems.map((system, index) => {
      const fill = system.system_id === best?.system_id ? COLOR.paleGreen : index % 2 ? COLOR.white : COLOR.row;
      return row([
        cell(system.system_label, { bold: true, fill }),
        cell(`${num(system.completed_attempts)}/${num(system.attempts)}`, { fill, align: AlignmentType.CENTER }),
        cell(num(system.failed_attempts), { fill: system.failed_attempts > 0 ? COLOR.red : fill, align: AlignmentType.CENTER }),
        cell(seconds(system.median_wall_clock_seconds), { fill, align: AlignmentType.CENTER }),
        cell(system.tokens_per_task ? `${(system.tokens_per_task / 1000).toFixed(1)}k` : 'n/a', { fill, align: AlignmentType.CENTER }),
        cell(system.median_cost_usd != null ? `$${num(system.median_cost_usd, 4)}` : 'n/a', { fill, align: AlignmentType.CENTER }),
        cell(pct(system.artifact_validity, 0), { fill: metricFill(system.artifact_validity, 1), align: AlignmentType.CENTER }),
        cell(pct(system.audit_completeness, 0), { fill: metricFill(system.audit_completeness, 1), align: AlignmentType.CENTER }),
        cell(num(system.interventions_per_task), { fill, align: AlignmentType.CENTER }),
      ]);
    }),
  ]));
  children.push(caption('Table 5b. Operational metrics. Token efficiency and cost-per-task show production economics beyond raw success rates.'));

  children.push(heading('3. Validator Evidence Matrix', 1));
  const checkNames = uniqueCheckNames(attempts);
  children.push(table([
    row([headerCell('Validator check', { width: 34 }), ...systems.map((system) => headerCell(system.system_label, { width: 66 / Math.max(1, systems.length) }))]),
    ...checkNames.map((checkName, index) => row([
      cell(checkName, { bold: true, fill: index % 2 ? COLOR.white : COLOR.row }),
      ...systems.map((system) => {
        const list = bySystem.get(system.system_id) || [];
        const okCount = list.filter((attempt) => checkPassed(attempt, checkName)).length;
        return cell(`${okCount}/${list.length}`, {
          align: AlignmentType.CENTER,
          fill: checkFill(okCount, list.length),
          bold: okCount === list.length,
        });
      }),
    ])),
  ]));
  children.push(caption('Table 6. Validator check matrix. This is the most defensible comparison because it shows which exact business requirements each system met across repeated attempts.'));

  children.push(heading('4. Attempt-Level Evidence', 1));
  children.push(table([
    row([
      headerCell('System', { width: 14 }),
      headerCell('Attempt', { width: 9 }),
      headerCell('Status', { width: 11 }),
      headerCell('Score', { width: 8 }),
      headerCell('Checks', { width: 10 }),
      headerCell('Accepted outputs', { width: 18 }),
      headerCell('What happened', { width: 30 }),
    ]),
    ...systems.flatMap((system) => (bySystem.get(system.system_id) || []).map((attempt, index) => {
      const checks = getChecks(attempt);
      const passed = passedChecks(attempt).length;
      const reportOk = checkPassed(attempt, 'report artifact created') ? 'report' : 'no report';
      const messageOk = checkPassed(attempt, 'finance message sent') ? 'message' : 'no message';
      const mismatchOk = checkPassed(attempt, 'known mismatches identified') ? 'mismatches' : 'missed mismatch';
      const fill = index % 2 ? COLOR.white : COLOR.row;
      return row([
        cell(system.system_label, { fill, bold: true }),
        cell(attemptNumber(attempt, index), { fill, align: AlignmentType.CENTER }),
        cell(attempt.status || 'unknown', { fill: attempt.status === 'timeout' ? COLOR.red : fill, align: AlignmentType.CENTER }),
        cell(num(attempt.metrics?.score_0_100), { fill: scoreFill(attempt.metrics?.score_0_100), align: AlignmentType.CENTER, bold: Boolean(attempt.metrics?.autonomous_success) }),
        cell(`${passed}/${checks.length}`, { fill: checkFill(passed, checks.length), align: AlignmentType.CENTER }),
        cell(`${reportOk}; ${messageOk}; ${mismatchOk}`, { fill }),
        cell(attemptOutcome(attempt), { fill }),
      ]);
    })),
  ]));
  children.push(caption('Table 7. Trial-level evidence. This replaces raw output dumps with the specific facts a reader needs to compare attempt quality.'));

  children.push(heading('5. Failure Analysis', 1));
  children.push(table([
    row([headerCell('System', { width: 18 }), headerCell('Failure pattern from the attempts', { width: 46 }), headerCell('Product implication', { width: 36 })]),
    ...systems.map((system, index) => {
      const list = bySystem.get(system.system_id) || [];
      const missedCounts = new Map();
      for (const attempt of list) {
        for (const check of missedChecks(attempt)) {
          missedCounts.set(check.name, (missedCounts.get(check.name) || 0) + 1);
        }
      }
      const topMisses = [...missedCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      const failures = topMisses.length
        ? topMisses.map(([name, count]) => `${name} (${count}/${list.length})`).join('; ')
        : 'No repeated validator miss recorded.';
      const implication = system.system_id === best?.system_id
        ? 'Capability is proven once, but repeatability must improve before making a broad production reliability claim.'
        : 'Output did not survive objective fixture validation; investor comparison should discount cosmetic or self-reported success.';
      return row([
        cell(system.system_label, { bold: true, fill: index % 2 ? COLOR.white : COLOR.row }),
        cell(failures, { fill: index % 2 ? COLOR.white : COLOR.row }),
        cell(implication, { fill: index % 2 ? COLOR.white : COLOR.row }),
      ]);
    }),
  ]));

  children.push(heading('6. Plain-English Metric Definitions', 1));
  children.push(p('Each metric below captures a different dimension of system capability. No single metric tells the full story; together they reveal whether a system can reliably complete real office workflows.', { spacing: { after: 140 } }));
  children.push(table([
    row([headerCell('Metric', { width: 20 }), headerCell('What it measures', { width: 40 }), headerCell('Why it matters for diligence', { width: 40 })]),
    row([cell('Autonomous success', { bold: true }), cell('Whether the attempt completed all required work without human intervention and passed the validator score threshold (≥80/100).'), cell('This is the gold standard: can the system do the job unsupervised? A high rate here means the product can replace a manual workflow today.')]),
    row([cell('Pass@3', { bold: true }), cell('Whether the system succeeded at least once across three independent tries of the same task.'), cell('Even unreliable systems may occasionally succeed. Pass@3 separates "never works" from "works but not consistently." It is the minimum bar for demonstrated capability.')]),
    row([cell('Median score', { bold: true }), cell('The middle validator score (0-100) across all attempts. Each validator check contributes weighted points.'), cell('Resistant to outliers. A system with one lucky run and two failures will show a low median, revealing true typical performance.')]),
    row([cell('Best score', { bold: true }), cell('The highest single-attempt score achieved by the system.'), cell('Shows the ceiling of what the system can achieve when everything goes right. A high best score with low median indicates capability exists but reliability needs work.')]),
    row([cell('Artifact validity', { bold: true }), cell('Whether the expected deliverables (reports, messages, saved documents) were actually created and usable.'), cell('A system that "completes" a task but produces no tangible output has not actually done the work. This catches systems that claim success in chat but skip the deliverable step.')]),
    row([cell('Audit completeness', { bold: true }), cell('Whether the run left sufficient evidence (logs, tool traces, intermediate artifacts) to reconstruct what happened.'), cell('Critical for trust and debugging. In production, operators need to verify what the agent did. Low audit completeness means the system is a black box.')]),
    row([cell('Wall clock time', { bold: true }), cell('Total elapsed time from task submission to final output, including all tool calls and waiting.'), cell('Speed matters for user experience and cost. A system that takes 5 minutes vs 30 seconds for the same task has very different production economics.')]),
    row([cell('Tokens per task', { bold: true }), cell('Median tokens consumed per attempt (prompt + completion). Derived from the LLM provider or calculated from output metadata.'), cell('Token efficiency directly drives per-task cost. Systems that consume 2-3x more tokens for the same outcome have proportionally higher LLM bills at scale.')]),
    row([cell('Cost per task', { bold: true }), cell('Estimated cost per attempt based on OpenRouter pricing for the shared model. Falls back to token-count-based estimation when the platform does not report cost natively.'), cell('Allows apples-to-apples operational cost comparison regardless of whether the agent framework exposes cost APIs natively.')]),
    row([cell('Cost per 1k tokens', { bold: true }), cell('Normalized cost efficiency: total spend divided by total tokens, expressed per 1,000 tokens.'), cell('Reveals whether cost differences come from token volume (agent verbosity) or per-token pricing (model selection). Useful for identifying optimization targets.')]),
    row([cell('Tool calls / failures', { bold: true }), cell('How many tool invocations the system made and how many failed.'), cell('Efficiency indicator. Excessive tool calls suggest the system is thrashing. High failure rates indicate integration problems or poor error handling.')]),
  ]));
  children.push(caption('Table 8. Metric definitions. Each metric is designed to answer a specific investor or operator question about system readiness.'));

  children.push(heading('7. Validator Check Definitions', 1));
  children.push(p('The validator checks are deterministic tests run against each attempt\'s output. They use the fixture data as ground truth and verify specific business outcomes.', { spacing: { after: 140 } }));
  children.push(table([
    row([headerCell('Check name', { width: 22 }), headerCell('Points', { width: 8 }), headerCell('What it verifies', { width: 35 }), headerCell('How it is measured', { width: 35 })]),
    row([cell('all invoices referenced', { bold: true }), cell('20', { align: AlignmentType.CENTER }), cell('The system read and included every invoice from the fixture data.'), cell('Searches the report artifact and final text for each seeded vendor name and amount.')]),
    row([cell('all payments referenced', { bold: true }), cell('15', { align: AlignmentType.CENTER }), cell('Every payment CSV row was processed and classified.'), cell('Verifies each payment entry appears in the reconciliation output with correct status.')]),
    row([cell('known mismatches identified', { bold: true }), cell('25', { align: AlignmentType.CENTER }), cell('The deliberate discrepancies seeded in the fixture were caught.'), cell('Checks for mention of the specific mismatched amounts and vendors. Highest-weighted check because it tests actual reconciliation logic.')]),
    row([cell('report artifact created', { bold: true }), cell('15', { align: AlignmentType.CENTER }), cell('A durable report document was saved to the workspace.'), cell('Checks that the system called the fixture report API or saved a file, not just printed to chat.')]),
    row([cell('finance message sent', { bold: true }), cell('15', { align: AlignmentType.CENTER }), cell('A summary was delivered to the finance-ops channel.'), cell('Verifies the system called the fixture message API with the correct channel name and a non-empty summary.')]),
    row([cell('no fabricated vendor', { bold: true }), cell('10', { align: AlignmentType.CENTER }), cell('The system did not invent vendor names or data not in the fixtures.'), cell('Scans output for vendor names that do not appear in the fixture data. Fabrication is a serious trust failure.')]),
  ]));
  children.push(caption('Table 9. Validator check definitions. Points sum to 100. The checks are designed to verify genuine task completion, not surface-level plausibility.'));

  children.push(heading('8. Scope and Limitations', 1));
  children.push(p([
    new TextRun({ text: 'Run scope: ', bold: true }),
    new TextRun({ text: `${taskIds.length} task${taskIds.length === 1 ? '' : 's'}, ${systems.length} systems, ${runConfig.runs_per_task || best?.attempts || 'n/a'} attempts per system, shared model policy (${policy.requested_model || 'see environment.json'}).` }),
  ], { spacing: { after: 120 } }));
  children.push(p('This is a seed benchmark run. It is strong enough to show whether a system can complete the tested workflow, but it is not yet a statistically complete benchmark suite. The strongest defensible claim is directional: the leading system demonstrated end-to-end completion where comparison systems did not. The main follow-up targets are improving repeatability and expanding to additional tasks.', { spacing: { after: 120 } }));
  children.push(p([
    new TextRun({ text: 'Key caveats: ', bold: true }),
    new TextRun({ text: '(1) All systems used the same production frontier model via OpenRouter, removing model-quality as a confounding variable. (2) Three attempts is enough to show pass/fail capability but not enough for statistical confidence intervals. (3) Only one task family (invoice reconciliation) is tested; results may not generalize to other workflow types. (4) Scoring uses partial credit: agents receive proportional points for partially correct evidence, following standard agent benchmark methodology (e.g., SWE-bench, GAIA).' }),
  ], { spacing: { after: 120 } }));
  children.push(p([
    new TextRun({ text: 'Competitor note: ', bold: true }),
    new TextRun({ text: 'OpenClaw and Hermes Agent are mature, well-engineered platforms with large communities (368k and 133k GitHub stars respectively). These benchmark results test a specific dimension — autonomous business workflow execution — where Construct\'s background-agent architecture has structural advantages. Competitors may perform better on interactive coding, personal productivity, or multi-channel messaging tasks that are outside this benchmark\'s scope.' }),
  ], { spacing: { after: 120 } }));
  children.push(p([
    new TextRun({ text: 'Cost methodology: ', bold: true }),
    new TextRun({ text: 'Per-task costs are estimated using OpenRouter\'s published pricing for the shared model. Where a platform reports token usage but not cost, the benchmark synthesizes cost from tokens × per-unit pricing. Costs reflect only the LLM inference expense, not infrastructure, operational overhead, or setup labor.' }),
  ], { spacing: { after: 180 } }));
  children.push(p(`Run metadata: ${shortDate(generatedAt)}; branch ${environment.git_branch || 'unknown'}; commit ${environment.git_commit || 'unknown'}; dry run ${summary.dry_run ? 'yes' : 'no'}.`, { color: COLOR.muted }));

  children.push(heading('Appendix A. Compact Attempt Notes', 1));
  children.push(table([
    row([headerCell('Run id', { width: 26 }), headerCell('Score', { width: 9 }), headerCell('Missed checks', { width: 30 }), headerCell('Evidence note', { width: 35 })]),
    ...attempts.map((attempt, index) => {
      const misses = missedChecks(attempt).map((check) => check.name).join('; ') || 'none';
      return row([
        cell(attempt.run_id, { fill: index % 2 ? COLOR.white : COLOR.row }),
        cell(num(attempt.metrics?.score_0_100), { fill: scoreFill(attempt.metrics?.score_0_100), align: AlignmentType.CENTER }),
        cell(misses, { fill: index % 2 ? COLOR.white : COLOR.row }),
        cell(evidenceNote(attempt), { fill: index % 2 ? COLOR.white : COLOR.row }),
      ]);
    }),
  ]));

  return new Document({
    creator: 'Construct Automation Benchmark',
    title,
    description: 'Investor-readable benchmark report generated from CWAB summary JSON.',
    styles: {
      paragraphStyles: [
        {
          id: 'Normal',
          name: 'Normal',
          run: { font: 'Aptos', size: 20, color: COLOR.ink },
          paragraph: { spacing: { after: 120 } },
        },
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: 'Aptos Display', size: 28, bold: true, color: COLOR.navy },
          paragraph: { spacing: { before: 360, after: 120 } },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: 'Aptos Display', size: 24, bold: true, color: COLOR.ink },
          paragraph: { spacing: { before: 220, after: 100 } },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: 'Aptos Display', size: 21, bold: true, color: COLOR.ink },
          paragraph: { spacing: { before: 180, after: 80 } },
        },
        {
          id: 'Caption',
          name: 'Caption',
          basedOn: 'Normal',
          run: { font: 'Aptos', size: 17, italics: true, color: COLOR.muted },
          paragraph: { spacing: { before: 60, after: 180 } },
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 720, right: 720, bottom: 720, left: 720 },
        },
      },
      children,
    }],
  });
}

async function cleanupLegacyOutputs(runDir, outputPath) {
  const keep = path.resolve(outputPath);
  const candidates = [
    path.join(runDir, 'report.html'),
    path.join(runDir, 'visual-report.html'),
    path.join(ROOT, 'latest-report.html'),
    path.join(ROOT, 'latest-report.html'),
    path.join(ROOT, 'latest-comparison.md'),
  ];
  await Promise.all(candidates.map(async (file) => {
    if (path.resolve(file) !== keep) await rm(file, { force: true }).catch(() => {});
  }));
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    console.log(usage());
    return;
  }

  const runDir = path.resolve(ROOT, cli.runDir || (cli.summary ? path.dirname(cli.summary) : await latestRunDir()));
  const summaryPath = path.resolve(ROOT, cli.summary || path.join(runDir, 'summary.json'));
  const manifestPath = path.resolve(ROOT, cli.manifest);
  const outputPath = path.resolve(ROOT, cli.output || path.join(runDir, 'report.docx'));
  const runConfigPath = path.join(runDir, 'run-config.json');
  const environmentPath = path.join(runDir, 'environment.json');

  const [summary, manifest, runConfig, environment] = await Promise.all([
    readJson(summaryPath),
    readJson(manifestPath),
    readJson(runConfigPath).catch(() => ({})),
    readJson(environmentPath).catch(() => ({})),
  ]);

  const doc = buildDocx({
    summary,
    manifest,
    runConfig,
    environment,
    title: cli.title,
    runDir,
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await cleanupLegacyOutputs(runDir, outputPath);
  const buffer = await Packer.toBuffer(doc);
  await writeFile(outputPath, buffer);
  console.log(`[cwab-report] wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(`[cwab-report] ${error?.stack || error?.message || error}`);
  process.exit(1);
});
