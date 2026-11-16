/**
 * The grower MCP server's address, derived from the API's. Behind the shared
 * API domain the API is `https://api.<domain>/grn` and the MCP server sits
 * beside it at `/grn-mcp` (services/grn-mcp). On a raw API Gateway URL there
 * is no such neighbour, so this returns null rather than a wrong address.
 */
export function mcpEndpointFor(apiUrl: string | null): string | null {
  if (!apiUrl) return null;
  try {
    const url = new URL(apiUrl);
    const path = url.pathname.replace(/\/+$/, '');
    if (!path.endsWith('/grn')) return null;
    url.pathname = `${path}-mcp`;
    return url.toString();
  } catch {
    return null;
  }
}
