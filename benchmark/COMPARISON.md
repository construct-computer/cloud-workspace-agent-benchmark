# CWAB Multi-Model Benchmark Comparison Report

**Generated:** 2026-05-05
**Suite:** cwab_seed_v0 (cwab-001 + cwab-001b)
**Systems Tested:** Construct, OpenClaw, Hermes Agent
**Models Tested:** 5 (via OpenRouter)
**Attempts:** 3 per system per task

---

## Model Index

| # | Model | Provider | Pricing |
|---|-------|----------|---------|
| 1 | Claude Sonnet 4.6 | Anthropic | Paid |
| 2 | GPT-OSS 120B | OpenAI | Free |
| 3 | GLM-4.5 Air | Z-AI | Free |
| 4 | Nemotron 3 Super 120B | NVIDIA | Free |
| 5 | Gemma 4 31B IT | Google | Free |

---

## 1. Head-to-Head: Median Score by System × Model

| Model | Construct | OpenClaw | Hermes | Best |
|-------|----------:|---------:|-------:|------|
| Claude Sonnet 4.6 | **92** | **94** | **94** | OpenClaw / Hermes (tie) |
| GPT-OSS 120B | **78** | 26 | **84** | Hermes |
| GLM-4.5 Air | **91** | 26 | **93** | Hermes |
| Nemotron 3 Super | **88** | 26 | 27 | Construct |
| Gemma 4 31B | **91** | **90** | **82** | Construct |

---

## 2. Pass@3 (≥70 threshold) by System × Model

| Model | Construct | OpenClaw | Hermes |
|-------|----------:|---------:|-------:|
| Claude Sonnet 4.6 | 100% | 100% | 100% |
| GPT-OSS 120B | 100% | 50% | 100% |
| GLM-4.5 Air | 100% | 0% | 100% |
| Nemotron 3 Super | 100% | 0% | 0% |
| Gemma 4 31B | 100% | 100% | 100% |

---

## 3. Autonomous Success Rate by System × Model

| Model | Construct | OpenClaw | Hermes |
|-------|----------:|---------:|-------:|
| Claude Sonnet 4.6 | 100% | 100% | 100% |
| GPT-OSS 120B | 100% | 17% | 83% |
| GLM-4.5 Air | 100% | 0% | 100% |
| Nemotron 3 Super | 67% | 0% | 0% |
| Gemma 4 31B | 100% | 100% | 100% |

---

## 4. Efficiency Metrics

### 4.1 Task Time (median minutes)

| Model | Construct | OpenClaw | Hermes |
|-------|----------:|---------:|-------:|
| Claude Sonnet 4.6 | 0.6 | 0.7 | 0.6 |
| GPT-OSS 120B | 0.4 | 0.1 | 0.2 |
| GLM-4.5 Air | 0.6 | 0.3 | 1.0 |
| Nemotron 3 Super | 2.0 | 0.2 | 0.2 |
| Gemma 4 31B | 0.9 | 0.5 | 0.4 |

### 4.2 Tokens per Task (median)

| Model | Construct | OpenClaw | Hermes |
|-------|----------:|---------:|-------:|
| Claude Sonnet 4.6 | 0.6k | 13.2k | 0.6k |
| GPT-OSS 120B | 0.4k | 20.9k | 0.3k |
| GLM-4.5 Air | 0.5k | 10.9k | 1.2k |
| Nemotron 3 Super | 0.5k | 47.4k | 0.4k |
| Gemma 4 31B | 0.5k | 82.6k | 0.3k |

### 4.3 Cost per Task (median USD)

| Model | Construct | OpenClaw | Hermes |
|-------|----------:|---------:|-------:|
| Claude Sonnet 4.6 | $0.0057 | $0.0562 | $0.0052 |
| GPT-OSS 120B | $0.0028 | $0.0546 | $0.0026 |
| GLM-4.5 Air | $0.0038 | $0.0207 | $0.0054 |
| Nemotron 3 Super | $0.0030 | $0.1724 | $0.0019 |
| Gemma 4 31B | $0.0032 | $0.2566 | $0.0023 |

---

## 5. System Resilience Summary

### Construct
- **Consistent performer:** 100% Pass@3 on 4/5 models, 67% on Nemotron
- **Scores:** 92, 78, 91, 88, 91 (mean: 88.0)
- **Never times out** across any model
- **Token-efficient:** 0.4–0.6k tokens/task
- **Best for:** Reliable baseline across all model tiers

### OpenClaw
- **Bimodal behavior:** Works great with strong models (Claude, Gemma), fails on weak ones
- **Scores:** 94, 26, 26, 26, 90
- **High token usage:** 10–80k tokens/task when working
- **Expensive when working:** $0.06–$0.26/task
- **Best for:** Premium models only

### Hermes Agent
- **Middle ground:** Reliable with Claude/GLM/Gemma, struggles with GPT-OSS/Nemotron
- **Scores:** 94, 84, 93, 27, 82 (mean: 76.0)
- **Most token-efficient:** 0.3–1.2k tokens/task
- **Lowest cost:** $0.002–$0.005/task
- **Best for:** Cost-conscious deployments with mid-tier models

---

## 6. Model Tier Rankings

### By Average Median Score (across all 3 systems)

| Rank | Model | Avg Score | Pass@3 Avg |
|------|-------|----------:|-----------:|
| 1 | Claude Sonnet 4.6 | 93.3 | 100% |
| 2 | Gemma 4 31B | 87.7 | 100% |
| 3 | GLM-4.5 Air | 70.0 | 67% |
| 4 | GPT-OSS 120B | 62.7 | 83% |
| 5 | Nemotron 3 Super | 47.0 | 33% |

### By Construct Score (our primary metric)

| Rank | Model | Construct Score | Pass@3 |
|------|-------|----------------:|-------:|
| 1 | Claude Sonnet 4.6 | 92 | 100% |
| 2 | GLM-4.5 Air | 91 | 100% |
| 2 | Gemma 4 31B | 91 | 100% |
| 4 | Nemotron 3 Super | 88 | 100% |
| 5 | GPT-OSS 120B | 78 | 100% |

---

## 7. Key Insights

1. **Claude Sonnet 4.6 is the clear winner** — highest average score (93.3) and 100% reliability across all systems.

2. **Gemma 4 31B is the best free model** — matches Claude on Construct (91), works with all 3 systems, and is 100% Pass@3.

3. **GLM-4.5 Air is a strong free alternative** — excellent Construct score (91) but OpenClaw can't handle it.

4. **Nemotron 3 Super is unpredictable** — decent Construct score (88) but causes failures in Hermes and OpenClaw.

5. **GPT-OSS 120B has reliability issues** — weakest Construct score (78) and causes failures across systems.

6. **OpenClaw is model-sensitive** — works only with Claude and Gemma; fails on all 3 free models (GPT-OSS, GLM, Nemotron).

7. **Construct is the most resilient** — 100% Pass@3 on 4/5 models, never times out.

---

## 8. Raw Results Paths

| Model | Results Folder |
|-------|---------------|
| Claude Sonnet 4.6 | `results/cwab_seed_v0_claude-sonnet-4.6/` |
| GPT-OSS 120B Free | `results/cwab_seed_v0_gpt-oss-120b-free/` |
| GLM-4.5 Air Free | `results/cwab_seed_v0_glm-4.5-air-free/` |
| Nemotron 3 Super Free | `results/cwab_seed_v0_nemotron-3-super-free/` |
| Gemma 4 31B Free | `results/cwab_seed_v0_gemma-4-31b-it-free/` |

---

---

## Appendix A: Detailed Metric Explanations

### A.1 Score Metrics

#### `score_0_100` (Median Score)
**What it is:** A 0-100 point score awarded by deterministic fixture validators that inspect the system's output against ground truth.

**How it's calculated:**
- Each task has a fixture server that seeds known data (e.g., 6 invoices, 8 payments)
- The system reads fixture data, performs the task, and produces output
- A validator parses the output text + API side effects (saved reports, sent messages)
- Points are awarded for:
  - **Invoice/Payment references** (~30 pts): Did the system mention all items with correct amounts?
  - **Mismatch identification** (~25 pts): Did it find underpayments, overpayments, unmatched items?
  - **Artifact creation** (~15 pts): Did it actually call the report API?
  - **Message delivery** (~15 pts): Did it send the finance-ops message?
  - **Accuracy checks** (~10-15 pts): Totals correct? No contradictions? Due dates included?
  - **No fabrication** (~10 pts): No invented vendors or hallucinated data

**Why it matters:** Measures actual task correctness, not self-reported success.

---

#### `Pass@3`
**What it is:** The probability that at least 1 out of 3 attempts achieves an autonomous success (score ≥ 70, zero human interventions).

**How it's calculated:**
```
Pass@3 = 1 - (1 - p)^3
where p = success_rate (attempts with score ≥ 70 and 0 interventions / total attempts)
```

**Example:**
- If 2/3 attempts succeed → p = 0.667 → Pass@3 = 1 - (0.333)^3 = 96.3%
- If 1/3 attempts succeed → p = 0.333 → Pass@3 = 1 - (0.667)^3 = 70.4%
- If 0/3 attempts succeed → Pass@3 = 0%

**Why it matters:** Measures reliability. A system that succeeds 1/3 times gives you a 70% chance of getting a good result if you run it 3 times.

---

#### `Autonomous Success Rate`
**What it is:** The percentage of attempts where the system completed the task without human help and scored above threshold.

**Threshold:** 70/100 (configured in `tasks.json` as `autonomous_success_threshold`)

**Requirements for success:**
1. Score ≥ 70
2. Zero human interventions
3. No timeout or crash

**Why it matters:** Distinguates between "it works sometimes" vs "it works reliably." A system with 100% autonomous success is truly hands-off.

---

### A.2 Efficiency Metrics

#### `Median Task Time`
**What it is:** Wall-clock time from task start to final output, in minutes.

**How it's measured:**
- Start: Benchmark runner sends the prompt
- End: System produces final output or timeout
- Includes: API calls, tool execution, LLM generation time
- Excludes: Docker image pull time, setup commands

**Why it matters:** Lower is better for user experience. Construct at 0.6 min means sub-minute task completion.

---

#### `Setup Time per Task`
**What it is:** Time spent on per-task setup (profile creation, model switching, auth refresh).

**How it's measured:**
- Summed duration of setup commands defined in `CWAB_CLI_SETUP_COMMANDS_JSON`
- For Construct: auto-dev-login time
- For OpenClaw: `openclaw --profile ... models set ...` command
- For Hermes: None (stateless CLI)

**Why it matters:** Zero setup means the system is ready to run immediately. High setup time adds friction.

---

#### `Tokens per Task`
**What it is:** Total LLM tokens consumed (prompt + completion) per task.

**How it's measured:**
- Construct: Extracted from message history `usage` field
- Hermes: Extracted from CLI output `meta.agentMeta.lastCallUsage`
- OpenClaw: Extracted from CLI output JSON
- Fallback: Estimated from text length (~4 chars/token) if API doesn't report usage

**Why it matters:** Lower tokens = lower cost + faster inference. Construct's 0.5k vs OpenClaw's 13-82k is a 25-160x difference.

---

#### `Cost per Task`
**What it is:** Estimated USD cost per task attempt.

**How it's calculated:**
```
cost = (prompt_tokens × input_price_per_1M + completion_tokens × output_price_per_1M) / 1,000,000
```

**Pricing sources:**
- OpenRouter API provides actual pricing
- For models without pricing data, benchmark uses provider-published rates
- Free models show non-zero costs because OpenRouter still charges for routing

**Why it matters:** At 100 tasks/day, a $0.05/task system costs $5/day; a $0.25/task system costs $25/day.

---

#### `Cost per 1K Tokens`
**What it is:** Normalized cost metric showing price efficiency.

**How it's calculated:**
```
cost_per_1k = total_cost_usd / (total_tokens / 1000)
```

**Why it matters:** Shows whether a system is expensive because it uses many tokens or because the model itself is pricey. OpenClaw's $0.0031/1k is cheap per token, but it uses 82k tokens — that's why total cost is high.

---

### A.3 Quality Metrics

#### `Artifact Validity`
**What it is:** A 0-1 score representing whether created artifacts (reports, messages) are well-formed and contain expected content.

**How it's calculated:**
```
artifact_validity = score_0_100 / 100 (capped at 1.0)
```

**Example:**
- Score 92 → validity 0.92 (92%)
- Score 26 → validity 0.26 (26%)
- Score 100 → validity 1.0 (100%)

**Why it matters:** Distinguishes between "it created something" and "it created something correct." A system that saves a report but with wrong data gets low validity.

---

#### `Audit Completeness`
**What it is:** A 0-1 score representing whether the system left a complete audit trail.

**How it's calculated:**
```
if reports.length + messages.length > 0:
  audit_completeness = 1.0 (100%)
else:
  audit_completeness = 0.25 (25%)
```

**Why it matters:** In production, you need to know what the agent did. A system that produces output but doesn't log side effects is hard to debug and audit.

---

#### `Human Interventions per Task`
**What it is:** How many times a human had to step in during the task.

**How it's measured:**
- Construct: 0 (fully autonomous HTTP API)
- Hermes: 0 (batch CLI mode)
- OpenClaw: Usually 0, but can be >0 if the embedded agent pauses for approval

**Why it matters:** The benchmark's goal is autonomous automation. Every intervention means the system failed to self-correct.

---

### A.4 Task Scoring Dimensions (from tasks.json)

The 100-point score is conceptually broken into dimensions:

| Dimension | Weight | What It Measures |
|-----------|--------|-----------------|
| **Functional Correctness** | 35% | Did the system do the task correctly? (find invoices, reconcile payments, identify mismatches) |
| **Artifact Quality** | 15% | Are outputs well-formed, complete, and accurate? (report content, message detail) |
| **Autonomy** | 25% | Did it complete without human help? (no clarifications, no approval gates, no timeouts) |
| **Setup Complexity** | 10% | How much configuration was needed? (zero-setup vs API key provisioning) |
| **Speed** | 5% | How fast did it complete? (wall-clock time) |
| **Observability** | 10% | Can you see what it did? (audit logs, artifact trails, tool call history) |

**Note:** The actual validator scoring is more granular than these weights — validators award points for specific evidence found in output (e.g., "$50 underpaid" = +5 pts), not abstract dimensions.

---

### A.5 Metric Interactions

Some metrics correlate or trade off:

**Speed vs Score:**
- OpenClaw on GPT-OSS: 0.1 min but score 26 (fast but wrong)
- Construct on Nemotron: 2.0 min but score 88 (slow but correct)
- Fast + correct = best (Construct on GPT-OSS: 0.4 min, score 78)

**Tokens vs Cost:**
- OpenClaw uses 10-80k tokens but pays $0.003/1k token → $0.03-0.26/task
- Hermes uses 0.3-1.2k tokens but pays $0.009/1k token → $0.002-0.005/task
- Construct uses 0.4-0.6k tokens at $0.007-0.009/1k → $0.003-0.006/task

**Pass@3 vs Autonomous Success:**
- Pass@3 is forgiving: 1 success in 3 = 70% Pass@3
- Autonomous Success is strict: 1/3 = 33%
- A system with 33% success rate still gives you 70% odds if you retry 3x

---

### A.6 Why These Metrics Were Chosen

The CWAB benchmark prioritizes metrics that matter for production agent deployment:

1. **Correctness first** — `score_0_100` and `Pass@3` measure whether it actually works
2. **Cost transparency** — `cost/task` and `tokens/task` measure operational expenses
3. **Reliability** — `autonomous_success` and `interventions` measure hands-off capability
4. **Speed** — `task_time` measures user experience
5. **Observability** — `artifact_validity` and `audit_completeness` measure debuggability

No metric is self-reported by the product under test — all scores come from deterministic fixture validators that inspect actual outputs.

---

*Report generated by aggregating findings.md from each model-specific benchmark run.*
