#!/usr/bin/env node

function parseCsv(text) {
  const [headerLine, ...rows] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(',');
  return rows.map((row) => Object.fromEntries(row.split(',').map((value, i) => [headers[i], value])));
}

async function readStdinJson() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  return JSON.parse(input || '{}');
}

const payload = await readStdinJson();
const endpoints = payload.task?.fixture_context?.endpoints || {};
if (!endpoints.invoices || !endpoints.payments_csv || !endpoints.report || !endpoints.message) {
  throw new Error('fixture_demo_agent requires cwab-001 fixture endpoints');
}

const invoices = (await (await fetch(endpoints.invoices)).json()).invoices;
const payments = parseCsv(await (await fetch(endpoints.payments_csv)).text());
const invoiceByVendor = new Map(invoices.map((invoice) => [invoice.vendor, invoice]));
const paymentByVendor = new Map(payments.map((payment) => [payment.vendor, payment]));

const lines = [];
for (const invoice of invoices) {
  const payment = paymentByVendor.get(invoice.vendor);
  if (!payment) {
    lines.push(`${invoice.vendor} unpaid (${invoice.id}, $${invoice.amount_usd}).`);
    continue;
  }
  const paid = Number(payment.amount_usd);
  if (paid === Number(invoice.amount_usd)) {
    lines.push(`${invoice.vendor} paid in full ($${invoice.amount_usd}).`);
  } else if (paid < Number(invoice.amount_usd)) {
    lines.push(`${invoice.vendor} underpaid by ${Number(invoice.amount_usd) - paid} ($${paid} paid vs $${invoice.amount_usd} invoice).`);
  } else {
    lines.push(`${invoice.vendor} overpaid by ${paid - Number(invoice.amount_usd)}.`);
  }
}
for (const payment of payments) {
  if (!invoiceByVendor.has(payment.vendor)) {
    lines.push(`${payment.vendor} payment without invoice ($${payment.amount_usd}).`);
  }
}

const body = [
  'Invoice reconciliation report',
  '',
  ...lines,
].join('\n');

await fetch(endpoints.report, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Invoice reconciliation report', body }),
});
await fetch(endpoints.message, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ channel: 'finance-ops', text: body }),
});

console.log(JSON.stringify({
  final_text: body,
  human_interventions: 0,
  operator_setup_seconds: 0,
  estimated_cost_usd: 0,
  tool_calls: 4,
  tool_failures: 0
}));
