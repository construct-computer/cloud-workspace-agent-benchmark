#!/bin/bash
# Run CWAB benchmark across multiple models
# Usage: bash run-all-models.sh

cd "$(dirname "$0")"

MODELS=(
  "anthropic/claude-sonnet-4.6:claude-sonnet-4.6"
  "openai/gpt-oss-120b:free:gpt-oss-120b-free"
  "z-ai/glm-4.5-air:free:glm-4.5-air-free"
  "nvidia/nemotron-3-super-120b-a12b:free:nemotron-3-super-free"
  "google/gemma-4-31b-it:free:gemma-4-31b-it-free"
)

for entry in "${MODELS[@]}"; do
  model_id="${entry%%:*}"
  folder_suffix="${entry##*:}"
  output_dir="results/cwab_seed_v0_$folder_suffix"
  
  if [ -d "$output_dir" ] && [ -f "$output_dir"/*/findings.md ]; then
    echo "Skipping $model_id (already completed)"
    continue
  fi
  
  echo ""
  echo "========================================"
  echo "Model: $model_id"
  echo "Output: $output_dir"
  echo "========================================"
  
  # Update model in env file
  if [ -f benchmark.local.env ]; then
    sed -i.bak "s|^CWAB_MODEL_ID=.*|CWAB_MODEL_ID=$model_id|" benchmark.local.env
  fi
  
  node run-suite.mjs \
    --task cwab-001,cwab-001b \
    --output "$output_dir" \
    --allow-errors \
    --allow-unscored || true
  
  echo "Completed: $model_id"
done

# Restore original env if backup exists
if [ -f benchmark.local.env.bak ]; then
  cp benchmark.local.env.bak benchmark.local.env
  rm benchmark.local.env.bak
fi

echo ""
echo "All benchmarks complete!"
echo "Run 'node generate-report.mjs' to generate comparison reports."
