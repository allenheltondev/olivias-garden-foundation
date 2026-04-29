export const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Content-Type,Authorization,Idempotency-Key,X-Correlation-Id,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

export function errorResponse(statusCode, code, message) {
  return new Response(
    JSON.stringify({ error: { code, message } }),
    { status: statusCode, headers: { 'content-type': 'application/json', ...corsHeaders } }
  );
}

export function encodeCursor(row) {
  // Use created_at_raw (text) to preserve full PostgreSQL microsecond precision
  return Buffer.from(
    JSON.stringify({ created_at: row.created_at_raw, id: row.id })
  ).toString('base64url');
}

export function decodeCursor(token) {
  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64url').toString());
    if (!parsed.created_at || !parsed.id) return null;

    // Validate created_at is a parseable timestamp string
    if (typeof parsed.created_at !== 'string') return null;
    const ts = new Date(parsed.created_at);
    if (isNaN(ts.getTime())) return null;

    // Validate id is a valid UUID
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id)) return null;

    return { created_at: parsed.created_at, id: parsed.id };
  } catch {
    return null;
  }
}
