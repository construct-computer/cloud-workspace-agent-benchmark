# Cloud Workstation Automation Benchmark Findings

Run directory: `/Users/weeblet/Developer/construct-computer/monorepo/construct/benchmarks/automation/results/cwab_seed_v0_glm-4.5-air-free/cwab_seed_v0_2026-05-05T01-08-44-556Z`
Generated: 2026-05-05T01:22:37.115Z
Shared model: `z-ai/glm-4.5-air` via `openrouter`

| System | Autonomous success | Pass@3 | Median score | Median task time | Setup time/task | Interventions/task | Tokens/task | Cost/task | Cost/1k tok | Artifact validity | Audit completeness |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Construct | 100% | 100% | 91 | 0.6 min | 0.0 min | 0.00 | 0.5k | $0.0038 | $0.0076 | 89% | 100% | |
| OpenClaw | 0% | 0% | 26 | 0.3 min | 0.0 min | 0.00 | 10.9k | $0.0207 | $0.0033 | 26% | 25% | |
| Hermes Agent | 100% | 100% | 93 | 1.0 min | 0.0 min | 0.00 | 1.2k | $0.0054 | $0.0090 | 92% | 100% | |

## Findings

- Highest autonomous success: Construct at 100%.
- Fastest median task time: OpenClaw at 0.3 minutes.
- Lowest median setup time: Construct at 0.0 minutes.
- Most token-efficient: Construct at 0.5k tokens/task.

## Data Quality Warnings

- No obvious data quality warnings.

## Next Steps

- Replace mock systems with real wrapper commands in `systems.local.json`.
- Add deterministic fixture validators so `score_0_100`, artifact validity, and audit completeness are not self-reported by the product under test.
- Run each task with at least three attempts per system, then rerun with hidden variants for deck numbers.

