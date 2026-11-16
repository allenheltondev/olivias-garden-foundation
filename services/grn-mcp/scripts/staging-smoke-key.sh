#!/usr/bin/env bash
# A short-lived GRN API key for the staging MCP smoke test
# (docs/grn-mcp-server.md, "Deploying and testing").
#
#   staging-smoke-key.sh mint     seeds the dedicated grower, revokes any keys
#                                 it holds, mints a fresh one, and writes
#                                 grn-key, key-id, user-id and auth-token to
#                                 $GITHUB_OUTPUT (the key and token masked)
#   staging-smoke-key.sh revoke   revokes KEY_ID with AUTH_TOKEN
#
# Keys can only be managed from a signed-in session, so this uses the
# grower's session token, never a key.
#
# Required env: AWS_REGION, GRN_STACK_NAME; for revoke also KEY_ID, AUTH_TOKEN.
set -euo pipefail

: "${AWS_REGION:?}" "${GRN_STACK_NAME:?}"
GROWER="mcp-smoke-grower"

stack_output() {
  aws cloudformation describe-stacks \
    --stack-name "$GRN_STACK_NAME" \
    --region "$AWS_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" \
    --output text
}

API_URL="$(stack_output ApiUrl)"
API_URL="${API_URL%/}"
if [ -z "$API_URL" ] || [ "$API_URL" = "None" ]; then
  echo "Stack $GRN_STACK_NAME has no ApiUrl output." >&2
  exit 1
fi

api() {
  # api METHOD PATH TOKEN [BODY] → body on stdout; fails on a non-2xx status.
  local method="$1" path="$2" token="$3" body="${4:-}"
  local args=(-sS -X "$method" "$API_URL$path" -H "Authorization: Bearer $token" -H 'Accept: application/json' -w '\n%{http_code}')
  if [ -n "$body" ]; then args+=(-H 'Content-Type: application/json' --data "$body"); fi
  local out status
  out="$(curl "${args[@]}")"
  status="${out##*$'\n'}"
  out="${out%$'\n'*}"
  if [ "${status:0:1}" != "2" ]; then
    echo "$method $path answered $status" >&2
    exit 1
  fi
  printf '%s' "$out"
}

case "${1:-}" in
  mint)
    # Never print the key or token: outputs go to the step's GITHUB_OUTPUT only.
    : "${GITHUB_OUTPUT:?mint writes the key to GITHUB_OUTPUT; run it in a GitHub Actions step}"
    FUNCTION_NAME="$(stack_output CiAuthSeedUsersFunctionName)"
    if [ -z "$FUNCTION_NAME" ] || [ "$FUNCTION_NAME" = "None" ]; then
      echo "Stack $GRN_STACK_NAME has no CiAuthSeedUsersFunctionName output." >&2
      exit 1
    fi
    aws lambda invoke \
      --function-name "$FUNCTION_NAME" \
      --region "$AWS_REGION" \
      --payload "{\"users\":[{\"name\":\"$GROWER\",\"role\":\"grower\",\"tier\":\"free\"}]}" \
      --cli-binary-format raw-in-base64-out \
      seed-response.json > /dev/null
    TOKEN="$(jq -r --arg u "$GROWER" '(if (.body | type) == "string" then (.body | fromjson) else (.body // .) end).users[$u].access_token' seed-response.json)"
    rm -f seed-response.json
    if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
      echo "Seeding $GROWER returned no access token." >&2
      exit 1
    fi
    echo "::add-mask::$TOKEN"

    USER_ID="$(api GET /me "$TOKEN" | jq -r '.id')"

    # Keys are capped at five per grower: clear any an interrupted run left.
    for id in $(api GET /me/api-keys "$TOKEN" | jq -r '.items[]?.id'); do
      api DELETE "/me/api-keys/$id" "$TOKEN" > /dev/null
    done

    CREATED="$(api POST /me/api-keys "$TOKEN" '{"name":"MCP staging smoke test"}')"
    KEY="$(printf '%s' "$CREATED" | jq -r '.key')"
    KEY_ID="$(printf '%s' "$CREATED" | jq -r '.id')"
    echo "::add-mask::$KEY"
    {
      echo "grn-key=$KEY"
      echo "key-id=$KEY_ID"
      echo "user-id=$USER_ID"
      echo "auth-token=$TOKEN"
    } >> "$GITHUB_OUTPUT"
    echo "Minted smoke-test key $KEY_ID for grower $USER_ID."
    ;;
  revoke)
    : "${KEY_ID:?}" "${AUTH_TOKEN:?}"
    api DELETE "/me/api-keys/$KEY_ID" "$AUTH_TOKEN" > /dev/null
    echo "Revoked smoke-test key $KEY_ID."
    ;;
  *)
    echo "usage: staging-smoke-key.sh mint|revoke" >&2
    exit 2
    ;;
esac
