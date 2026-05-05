# Cloud Workstation Automation Benchmark Findings

Run directory: `/Users/weeblet/Developer/construct-computer/monorepo/construct/benchmarks/automation/results/cwab_seed_v0_gemma-4-31b-it-free/cwab_seed_v0_2026-05-05T01-34-10-652Z`
Generated: 2026-05-05T01:44:55.027Z
Shared model: `google/gemma-4-31b-it` via `openrouter`

| System | Autonomous success | Pass@3 | Median score | Median task time | Setup time/task | Interventions/task | Tokens/task | Cost/task | Cost/1k tok | Artifact validity | Audit completeness |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Construct | 100% | 100% | 91 | 0.9 min | 0.0 min | 0.00 | 0.5k | $0.0032 | $0.0068 | 89% | 100% | |
| OpenClaw | 100% | 100% | 90 | 0.5 min | 0.0 min | 0.00 | 82.6k | $0.2566 | $0.0031 | 88% | 100% | |
| Hermes Agent | 100% | 100% | 82 | 0.4 min | 0.0 min | 0.00 | 0.3k | $0.0023 | $0.0090 | 83% | 100% | |

## Findings

- Highest autonomous success: Construct at 100%.
- Fastest median task time: Hermes Agent at 0.4 minutes.
- Lowest median setup time: Construct at 0.0 minutes.
- Most token-efficient: Hermes Agent at 0.3k tokens/task.

## Data Quality Warnings

- No obvious data quality warnings.

## Next Steps

- Replace mock systems with real wrapper commands in `systems.local.json`.
- Add deterministic fixture validators so `score_0_100`, artifact validity, and audit completeness are not self-reported by the product under test.
- Run each task with at least three attempts per system, then rerun with hidden variants for deck numbers.

