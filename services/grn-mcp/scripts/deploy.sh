#!/usr/bin/env bash
# Build and deploy the Good Roots Network MCP stack (docs/grn-mcp-server.md).
#
# Reads the GRN API's URL from its stack's ApiUrl output, so this deploys
# after the GRN backend and is never hard-wired to it.
#
# Required env: ENVIRONMENT, GRN_MCP_STACK_NAME, GRN_STACK_NAME, AWS_REGION
# Optional env: FOUNDATION_DOMAIN_NAME, DOMAIN_HOSTED_ZONE_ID
# Run from the repository root.
set -euo pipefail

: "${ENVIRONMENT:?}" "${GRN_MCP_STACK_NAME:?}" "${GRN_STACK_NAME:?}" "${AWS_REGION:?}"

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

GRN_API_URL=$(stack_output "$GRN_STACK_NAME" ApiUrl)
GRN_API_URL="${GRN_API_URL%/}"

PARAM_OVERRIDES=(
  "EnvironmentName=$ENVIRONMENT"
  "GrnApiUrl=$GRN_API_URL"
)
if [ -n "${FOUNDATION_DOMAIN_NAME:-}" ] && [ -n "${DOMAIN_HOSTED_ZONE_ID:-}" ]; then
  PARAM_OVERRIDES+=("DomainName=$FOUNDATION_DOMAIN_NAME" "DomainHostedZoneId=$DOMAIN_HOSTED_ZONE_ID")
fi

# A first create that failed leaves the stack in ROLLBACK_COMPLETE, which
# CloudFormation can only delete. Such a stack holds no resources.
STACK_STATUS=$(aws cloudformation describe-stacks \
  --stack-name "$GRN_MCP_STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].StackStatus" \
  --output text 2>/dev/null || echo "NONE")
if [ "$STACK_STATUS" = "ROLLBACK_COMPLETE" ]; then
  echo "Stack $GRN_MCP_STACK_NAME is in ROLLBACK_COMPLETE from a failed first create; deleting it before deploying."
  aws cloudformation delete-stack --stack-name "$GRN_MCP_STACK_NAME" --region "$AWS_REGION"
  aws cloudformation wait stack-delete-complete --stack-name "$GRN_MCP_STACK_NAME" --region "$AWS_REGION"
fi

sam build --template-file services/grn-mcp/template.yaml --build-dir services/grn-mcp/.aws-sam/build

sam deploy \
  --template-file services/grn-mcp/.aws-sam/build/template.yaml \
  --stack-name "$GRN_MCP_STACK_NAME" \
  --resolve-s3 \
  --s3-prefix "$GRN_MCP_STACK_NAME" \
  --region "$AWS_REGION" \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides "${PARAM_OVERRIDES[@]}"

MCP_URL=$(stack_output "$GRN_MCP_STACK_NAME" McpServerUrl)
echo "Good Roots Network MCP server: $MCP_URL"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "mcp-url=$MCP_URL" >> "$GITHUB_OUTPUT"
fi
