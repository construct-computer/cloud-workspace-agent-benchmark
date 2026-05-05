# Cloud Workstation Automation Benchmark Findings

Run directory: `/Users/weeblet/Developer/construct-computer/monorepo/construct/benchmarks/automation/results/cwab_seed_v0_nemotron-3-super-free/cwab_seed_v0_2026-05-05T01-22-37-932Z`
Generated: 2026-05-05T01:34:09.882Z
Shared model: `nvidia/nemotron-3-super-120b-a12b` via `openrouter`

| System | Autonomous success | Pass@3 | Median score | Median task time | Setup time/task | Interventions/task | Tokens/task | Cost/task | Cost/1k tok | Artifact validity | Audit completeness |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Construct | 67% | 100% | 88 | 2.0 min | 0.0 min | 0.00 | 0.5k | $0.0030 | $0.0066 | 75% | 75% | |
| OpenClaw | 0% | 0% | 26 | 0.2 min | 0.0 min | 0.00 | 47.4k | $0.1724 | $0.0030 | 26% | 25% | |
| Hermes Agent | 0% | 0% | 27 | 0.2 min | 0.0 min | 0.00 | 0.4k | $0.0019 | $0.0090 | 29% | 25% | |

## Findings

- Highest autonomous success: Construct at 67%.
- Fastest median task time: Hermes Agent at 0.2 minutes.
- Lowest median setup time: Construct at 0.0 minutes.
- Most token-efficient: Hermes Agent at 0.4k tokens/task.

## Data Quality Warnings

- No obvious data quality warnings.

## Next Steps

- Replace mock systems with real wrapper commands in `systems.local.json`.
- Add deterministic fixture validators so `score_0_100`, artifact validity, and audit completeness are not self-reported by the product under test.
- Run each task with at least three attempts per system, then rerun with hidden variants for deck numbers.

