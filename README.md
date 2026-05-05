# Cloud Workspace Agent Benchmark (CWAB)

Deterministic, reproducible benchmark for autonomous cloud-workstation agents. Tests whether an AI system can independently complete multi-step office automation tasks — reading fixture data, creating artifacts, and communicating results — without human intervention.

## What It Measures

| Dimension | Weight | Question Answered |
|-----------|--------|------------------|
| **Functional Correctness** | 35% | Did it do the task right? (find invoices, reconcile payments, identify mismatches) |
| **Artifact Quality** | 15% | Are outputs well-formed and accurate? (reports, messages, summaries) |
| **Autonomy** | 25% | Did it complete without human help? (no clarifications, no timeouts, no crashes) |
| **Setup Complexity** | 10% | How much configuration was needed? (zero-setup vs manual provisioning) |
| **Speed** | 5% | How fast did it complete? (wall-clock time) |
| **Observability** | 10% | Can you audit what it did? (logs, tool calls, artifact trails) |

## Quick Start

```bash
# 1. Configure environment
cp benchmark.env.example benchmark.local.env
# Edit benchmark.local.env with your OpenRouter API key

# 2. Build agent images (first time only)
node prepare-images.mjs --openclaw-version latest

# 3. Run benchmark with default model (Claude Sonnet 4.6)
node run-suite.mjs --task cwab-001,cwab-001b

# 4. Run across multiple models
bash run-all-models.sh

# 5. Generate report
node generate-report.mjs --run-dir results/<run-folder>
```

## Benchmark Tasks

### cwab-001: Invoice Reconciliation Brief
**Setup:** 6 vendor invoices + 8 payment records with intentional mismatches (underpayments, overpayments, name mismatches, orphaned payments).

**Prompt:** "Find vendor invoices, reconcile against payments CSV, create a reconciliation report highlighting mismatches, save it, and send a summary to finance-ops."

**Scoring checks:**
- All 6 invoices referenced with exact amounts
- All 8 payments referenced with exact amounts
- 5 mismatches identified (underpaid, overpaid, unpaid, orphaned)
- Report artifact created via API
- Finance-ops message sent via API
- No fabricated vendor data

### cwab-001b: Follow-Up Reconciliation
**Setup:** Prior report from yesterday + 2 new invoices with 1 mismatch.

**Prompt:** "Read the prior report, reconcile new invoices, update the report preserving all previous conclusions, and send a delta summary."

**Scoring checks:**
- Prior report is referenced
- Old conclusions preserved (3 items)
- New items correctly added (2 items)
- Updated report saved
- Correct total outstanding calculated
- No contradiction of prior data

## Metrics Explained

### Score (0-100)
Awarded by deterministic fixture validators that parse system output against ground truth. No self-reporting. Each point corresponds to specific evidence found in the output (e.g., "Bravo Design underpaid by $50" = +5 pts).

### Pass@3
Probability that at least 1 of 3 attempts succeeds autonomously (score ≥ 70, zero interventions):
```
Pass@3 = 1 - (1 - p)^3
```
A system with 33% success rate still gives you 70% odds if you retry 3x.

### Autonomous Success Rate
Percentage of attempts completing without human help AND scoring ≥ 70. Distinguishes "works sometimes" from "works reliably."

### Task Time
Wall-clock minutes from prompt to final output. Includes API calls, tool execution, LLM generation.

### Tokens per Task
Total LLM tokens consumed (prompt + completion). Lower = cheaper + faster.

### Cost per Task
Estimated USD: `(prompt_tokens × input_price + completion_tokens × output_price) / 1,000,000`. Uses OpenRouter pricing.

### Artifact Validity
`score / 100` capped at 1.0. Measures whether created artifacts (reports, messages) are actually correct, not just present.

### Audit Completeness
1.0 if reports + messages exist, 0.25 if nothing logged. Measures debuggability.

## Systems Under Test

| System | Adapter | How It Works |
|--------|---------|-------------|
| **Construct** | HTTP API | Sends prompt to Construct agent API, polls for completion, extracts final message |
| **OpenClaw** | CLI | Runs `openclaw agent --local --json` in Docker container, captures CLI output |
| **Hermes Agent** | CLI | Runs `hermes chat -Q` in Docker container, captures CLI output |

All three systems use the **same LLM model** (configured via `CWAB_MODEL_ID`) to ensure fair comparison.

## Models Tested

The benchmark supports any OpenRouter model. Results from our test runs:

| Model | Provider | Price | Construct Score | Pass@3 |
|-------|----------|-------|----------------|--------|
| Claude Sonnet 4.6 | Anthropic | Paid | 92 | 100% |
| Gemma 4 31B IT | Google | Free | 91 | 100% |
| GLM-4.5 Air | Z-AI | Free | 91 | 100% |
| Nemotron 3 Super 120B | NVIDIA | Free | 88 | 100% |
| GPT-OSS 120B | OpenAI | Free | 78 | 100% |

See `results/CWAB_MULTI_MODEL_COMPARISON_REPORT.md` for full comparison.

## Architecture

```
run-suite.mjs          # One-command orchestrator
  ├── run-benchmark.mjs  # Core runner (Docker per attempt)
  │     ├── Fixture Server (fixtures/cwab-fixture-server.mjs)
  │     ├── System Wrapper (wrappers/)
  │     └── Validator (wrappers/fixture-validator-wrapper.mjs)
  └── generate-report.mjs # DOCX/HTML report generation
```

### Flow
1. `run-suite.mjs` starts fixture server on port 6789
2. For each system × task × attempt:
   - Resets fixture with seeded data
   - Spins up Docker container with system wrapper
   - Wrapper submits prompt to agent, captures output
   - Sends output + fixture state to validator
   - Validator scores against ground truth
3. Aggregates results into `summary.json` + `findings.md`

### Determinism
- Same model for all systems
- Same seeded fixture data per attempt
- Same validator logic (not self-reported)
- Docker isolation per attempt
- Idempotent runs (each writes to timestamped directory)

## File Structure

```
.
├── tasks.json                  # Task definitions (cwab-001, cwab-001b)
├── systems.json                # System configs (construct, openclaw, hermes)
├── run-suite.mjs               # One-command entry point
├── run-benchmark.mjs           # Core benchmark runner
├── run-all-models.sh           # Batch runner across 5 models
├── generate-report.mjs         # DOCX/HTML report generator
├── prepare-images.mjs          # Build Docker images for OpenClaw/Hermes
├── compose.yaml                # Docker Compose setup
├── benchmark.env.example       # Environment template
├── fixtures/
│   └── cwab-fixture-server.mjs # HTTP fixture server + validators
└── wrappers/
    ├── construct-http-wrapper.mjs      # Construct HTTP adapter
    ├── generic-cli-agent-wrapper.mjs   # CLI adapters (OpenClaw, Hermes)
    ├── fixture-validator-wrapper.mjs   # Deterministic scoring
    └── README.md                       # Wrapper contract docs
```

## Requirements

- Node.js 20+
- Docker Desktop / Docker Engine
- OpenRouter API key (for LLM calls)
- Construct worker running locally (for Construct benchmarks)

## Environment Variables

```bash
# Required
OPENROUTER_API_KEY=sk-or-...
CWAB_MODEL_ID=anthropic/claude-sonnet-4.6

# For Construct benchmarks
CONSTRUCT_BENCHMARK_URL=http://host.docker.internal:8787

# Optional overrides
CONSTRUCT_BENCHMARK_TIMEOUT_MS=270000
HERMES_MAX_TURNS=90
OPENCLAW_TIMEOUT_SECONDS=1200
```

## Adding a New System

1. Create a wrapper in `wrappers/` that accepts JSON on stdin
2. Add entry to `systems.json` with Docker config
3. Run: `node run-suite.mjs --include your_system`

See `wrappers/README.md` for the full wrapper contract.

## License

MIT — Part of the Construct Computer monorepo.
