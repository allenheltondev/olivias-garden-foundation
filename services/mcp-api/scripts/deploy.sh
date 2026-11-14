#!/usr/bin/env bash
# Build and deploy the operator MCP stack (docs/mcp-server.md, "Deploying").
#
# Reads the four service functions' ARNs from their stacks' outputs, so the
# MCP stack deploys after them and never hard-imports from them.
#
# Required env: ENVIRONMENT, MCP_STACK_NAME, ADMIN_STACK_NAME, OKRA_STACK_NAME,
#               STORE_STACK_NAME, GRN_STACK_NAME, AWS_REGION
# Optional env: FOUNDATION_DOMAIN_NAME, DOMAIN_HOSTED_ZONE_ID
# Run from the repository root.
set -euo pipefail

: "${ENVIRONMENT:?}" "${MCP_STACK_NAME:?}" "${ADMIN_STACK_NAME:?}" "${OKRA_STACK_NAME:?}"
: "${STORE_STACK_NAME:?}" "${GRN_STACK_NAME:?}" "${AWS_REGION:?}"

stack_output() {
  local stack="$1" key="$2" value
  value=$(aws cloudformation describe-stacks \
    --stack-name "$stack" \
    --region "$AWS_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$key'].OutputValue | [0]" \
    --output text)
  if [ -z "$value" ] || [ "$value" = "None" ]; then
    echo "Stack $stack has no $key output; deploy it first." >&2
    exit 1
  fi
  printf '%s' "$value"
}

ADMIN_ARN=$(stack_output "$ADMIN_STACK_NAME" ApiFunctionArn)
OKRA_ARN=$(stack_output "$OKRA_STACK_NAME" AdminApiFunctionArn)
STORE_ARN=$(stack_output "$STORE_STACK_NAME" ApiFunctionArn)
GRN_ARN=$(stack_output "$GRN_STACK_NAME" ApiFunctionArn)

PARAM_OVERRIDES=(
  "EnvironmentName=$ENVIRONMENT"
  "AdminApiFunctionArn=$ADMIN_ARN"
  "OkraAdminApiFunctionArn=$OKRA_ARN"
  "StoreApiFunctionArn=$STORE_ARN"
  "GrnApiFunctionArn=$GRN_ARN"
)
if [ -n "${FOUNDATION_DOMAIN_NAME:-}" ] && [ -n "${DOMAIN_HOSTED_ZONE_ID:-}" ]; then
  PARAM_OVERRIDES+=("DomainName=$FOUNDATION_DOMAIN_NAME" "DomainHostedZoneId=$DOMAIN_HOSTED_ZONE_ID")
fi

sam build --template-file services/mcp-api/template.yaml --build-dir services/mcp-api/.aws-sam/build

sam deploy \
  --template-file services/mcp-api/.aws-sam/build/template.yaml \
  --stack-name "$MCP_STACK_NAME" \
  --resolve-s3 \
  --s3-prefix "$MCP_STACK_NAME" \
  --region "$AWS_REGION" \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides "${PARAM_OVERRIDES[@]}"

MCP_URL=$(stack_output "$MCP_STACK_NAME" McpServerUrl)
echo "MCP server: $MCP_URL"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "mcp-url=$MCP_URL" >> "$GITHUB_OUTPUT"
fi
