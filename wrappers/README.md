# Product Wrapper Contract

The CWAB runner executes each product through a wrapper command. A wrapper can be a Node script, shell script, Python script, CLI call, or webhook client.

## Input

For `stdin: "json"`, the runner sends:

```json
{
  "suite_id": "cwab_seed_v0",
  "run_id": "cwab-001__construct__a1",
  "attempt": 1,
  "system": { "id": "construct", "label": "Construct" },
  "task": {
    "task_id": "cwab-001",
    "name": "Invoice reconciliation brief",
    "prompt": "..."
  },
  "attempt_dir": "/absolute/path/to/results/attempts/cwab-001__construct__a1"
}
```

## Output

The wrapper should submit `task.prompt` to the product under test, save any raw product logs/artifacts inside `attempt_dir`, and print a final JSON object to stdout.

### Preferred JSON shape

```json
{
  "final_text": "Product final answer or summary",
  "score_0_100": 86,
  "human_interventions": 0,
  "operator_setup_seconds": 120,
  "model_prompt_tokens": 18000,
  "model_completion_tokens": 2200,
  "estimated_cost_usd": 0.64,
  "tool_calls": 18,
  "tool_failures": 1,
  "artifact_count": 3,
  "audit_events_count": 41,
  "artifact_validity": 1,
  "audit_completeness": 0.93
}
```

**Important:** Do not let the product self-score. The runner calls deterministic fixture validators and uses validator results for scoring.

## Wrapper Types

### HTTP Wrapper (`construct-http-wrapper.mjs`)
- Sends prompt to product HTTP API
- Polls for completion
- Extracts final message + token usage

### CLI Wrapper (`generic-cli-agent-wrapper.mjs`)
- Runs configured product command inside Docker container
- Replaces tokens: `__CWAB_PROMPT_FILE__`, `__CWAB_RUN_ID__`, `__CWAB_TASK_ID__`
- Captures stdout/stderr, parses JSON output
- Set `CWAB_CLI_COMMAND_JSON` in systems.json to configure the command

### HTTP Agent Wrapper (`generic-http-agent-wrapper.mjs`)
- Sends payload as JSON POST to configured endpoint
- Expects `{ "metrics": { ... } }` or flat metrics object

## Adding a New Wrapper

1. Create a script in `wrappers/` that reads JSON from stdin
2. Submit `task.prompt` to your product
3. Save raw logs to `attempt_dir`
4. Print JSON with at least `final_text` to stdout
5. Add system entry to `systems.json`

The fixture validator will handle scoring independently.
