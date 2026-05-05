# Cloud Workstation Automation Benchmark Findings

Run directory: `/Users/weeblet/Developer/construct-computer/monorepo/construct/benchmarks/automation/results/cwab_seed_v0_claude-sonnet-4.6/cwab_seed_v0_2026-05-05T00-50-46-232Z`
Generated: 2026-05-05T01:02:21.891Z
Shared model: `anthropic/claude-sonnet-4.6` via `openrouter`

| System | Autonomous success | Pass@3 | Median score | Median task time | Setup time/task | Interventions/task | Tokens/task | Cost/task | Cost/1k tok | Artifact validity | Audit completeness |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Construct | 100% | 100% | 92 | 0.6 min | 0.0 min | 0.00 | 0.6k | $0.0057 | $0.0090 | 93% | 100% | |
| OpenClaw | 100% | 100% | 94 | 0.7 min | 0.0 min | 0.00 | 13.2k | $0.0562 | $0.0048 | 94% | 100% | |
| Hermes Agent | 100% | 100% | 94 | 0.6 min | 0.0 min | 0.00 | 0.6k | $0.0052 | $0.0090 | 94% | 100% | |

## Findings

- Highest autonomous success: Construct at 100%.
- Fastest median task time: Hermes Agent at 0.6 minutes.
- Lowest median setup time: Construct at 0.0 minutes.
- Most token-efficient: Hermes Agent at 0.6k tokens/task.

## Data Quality Warnings

- No obvious data quality warnings.

## Next Steps

- Replace mock systems with real wrapper commands in `systems.local.json`.
- Add deterministic fixture validators so `score_0_100`, artifact validity, and audit completeness are not self-reported by the product under test.
- Run each task with at least three attempts per system, then rerun with hidden variants for deck numbers.

