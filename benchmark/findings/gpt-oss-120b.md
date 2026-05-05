# Cloud Workstation Automation Benchmark Findings

Run directory: `/Users/weeblet/Developer/construct-computer/monorepo/construct/benchmarks/automation/results/cwab_seed_v0_gpt-oss-120b-free/cwab_seed_v0_2026-05-05T01-02-22-687Z`
Generated: 2026-05-05T01:07:32.807Z
Shared model: `openai/gpt-oss-120b` via `openrouter`

| System | Autonomous success | Pass@3 | Median score | Median task time | Setup time/task | Interventions/task | Tokens/task | Cost/task | Cost/1k tok | Artifact validity | Audit completeness |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Construct | 100% | 100% | 78 | 0.4 min | 0.0 min | 0.00 | 0.4k | $0.0028 | $0.0061 | 81% | 100% | |
| OpenClaw | 17% | 50% | 26 | 0.1 min | 0.0 min | 0.00 | 20.9k | $0.0546 | $0.0032 | 35% | 38% | |
| Hermes Agent | 83% | 100% | 84 | 0.2 min | 0.0 min | 0.00 | 0.3k | $0.0026 | $0.0090 | 73% | 88% | |

## Findings

- Highest autonomous success: Construct at 100%.
- Fastest median task time: OpenClaw at 0.1 minutes.
- Lowest median setup time: Construct at 0.0 minutes.
- Most token-efficient: Hermes Agent at 0.3k tokens/task.

## Data Quality Warnings

- OpenClaw: 1 attempt(s) failed or timed out.
- Hermes Agent: 1 attempt(s) failed or timed out.

## Next Steps

- Replace mock systems with real wrapper commands in `systems.local.json`.
- Add deterministic fixture validators so `score_0_100`, artifact validity, and audit completeness are not self-reported by the product under test.
- Run each task with at least three attempts per system, then rerun with hidden variants for deck numbers.

