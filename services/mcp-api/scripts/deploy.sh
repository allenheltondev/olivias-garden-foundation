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

# A service function's ARN: its stack's `<LogicalId>Arn` output, or, when that
# output is absent, the function the stack's <LogicalId> resource names.
#
# The fallback matters on shared staging stacks: other workflows (e.g. the
# foundation web PR preview, which deploys ogf-okra-staging) redeploy them from
# branches that predate the output, which removes it. The resource itself is
# there whichever template deployed last.
function_arn() {
  local stack="$1" logical_id="$2" value name
  value=$(aws cloudformation describe-stacks \
    --stack-name "$stack" \
    --region "$AWS_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='${logical_id}Arn'].OutputValue | [0]" \
    --output text)
  if [ -n "$value" ] && [ "$value" != "None" ]; then
    printf '%s' "$value"
    return
  fi
  name=$(aws cloudformation describe-stack-resource \
    --stack-name "$stack" \
    --logical-resource-id "$logical_id" \
    --region "$AWS_REGION" \
    --query "StackResourceDetail.PhysicalResourceId" \
    --output text)
  if [ -z "$name" ] || [ "$name" = "None" ]; then
    echo "Stack $stack has no ${logical_id}Arn output or $logical_id resource; deploy it first." >&2
    exit 1
  fi
  echo "Stack $stack has no ${logical_id}Arn output; using its $logical_id resource ($name)." >&2
  aws lambda get-function-configuration \
    --function-name "$name" \
    --region "$AWS_REGION" \
    --query FunctionArn \
    --output text
}

ADMIN_ARN=$(function_arn "$ADMIN_STACK_NAME" ApiFunction)
OKRA_ARN=$(function_arn "$OKRA_STACK_NAME" AdminApiFunction)
STORE_ARN=$(function_arn "$STORE_STACK_NAME" ApiFunction)
GRN_ARN=$(function_arn "$GRN_STACK_NAME" ApiFunction)
for arn in "$ADMIN_ARN" "$OKRA_ARN" "$STORE_ARN" "$GRN_ARN"; do
  if [[ "$arn" != arn:*:lambda:*:function:* ]]; then
    echo "Could not resolve a service function ARN (got: ${arn:-nothing})." >&2
    exit 1
  fi
done

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

# A first create that failed leaves the stack in ROLLBACK_COMPLETE, which
# CloudFormation can only delete, never update. Such a stack holds no
# resources, so delete it and create afresh.
STACK_STATUS=$(aws cloudformation describe-stacks \
  --stack-name "$MCP_STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].StackStatus" \
  --output text 2>/dev/null || echo "NONE")
if [ "$STACK_STATUS" = "ROLLBACK_COMPLETE" ]; then
  echo "Stack $MCP_STACK_NAME is in ROLLBACK_COMPLETE from a failed first create; deleting it before deploying."
  aws cloudformation delete-stack --stack-name "$MCP_STACK_NAME" --region "$AWS_REGION"
  aws cloudformation wait stack-delete-complete --stack-name "$MCP_STACK_NAME" --region "$AWS_REGION"
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
