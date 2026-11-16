/**
 * The grower MCP server, built per request for one grower's key
 * (docs/grn-mcp-server.md). Every tool comes from the catalog, which comes
 * from the GRN OpenAPI spec; each one calls the matching API operation.
 */

import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { buildCatalog } from './catalog.mjs';
import { ToolError } from './grn-client.mjs';

export const SERVER_INFO = { name: 'good-roots-network', version: '1.0.0' };

const INSTRUCTIONS =
  "Good Roots Network, Olivia's Garden Foundation's app for home growers to track their garden and share extra produce " +
  'with neighbors. These tools act as the grower whose key you hold, with exactly the access they have in the app. ' +
  'Start with get_me for who they are. Their garden: list_my_crops, list_my_beds, get_my_garden_canvas, harvests, ' +
  'get_journal and reminders. Sharing: create_listing posts extra produce, discover_listings finds what neighbors offer, ' +
  'create_claim claims some, create_request asks for something. Listings, requests and claims are seen by other people, ' +
  'so confirm the details with the grower before posting or claiming. Ids come from the list tools. Dates are ISO 8601.';

/** Tool results as structuredContent plus the same JSON as text; failures as readable isError results. */
export function guarded(fn, logger = console) {
  return async (args) => {
    try {
      const data = (await fn(args ?? {})) ?? {};
      return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    } catch (error) {
      let message = 'Internal error. Try again later.';
      if (error instanceof ToolError) message = error.message;
      else logger.error?.(JSON.stringify({ level: 'ERROR', msg: 'GRN MCP tool failed', error: error instanceof Error ? error.stack : String(error) }));
      return { content: [{ type: 'text', text: message }], isError: true };
    }
  };
}

// Built once per container: the catalog and its compiled input validators
// depend only on the generated spec, while a server is built per request.
let registrations = null;
function toolRegistrations() {
  registrations ??= buildCatalog().tools.map((tool) => ({
    tool,
    config: {
      title: tool.title,
      description: tool.description,
      inputSchema: fromJsonSchema(tool.inputSchema),
      annotations: tool.annotations
    }
  }));
  return registrations;
}

export function buildServer({ client, logger = console }) {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  for (const { tool, config } of toolRegistrations()) {
    server.registerTool(tool.name, config, guarded((args) => client.call(tool.operation, args), logger));
  }
  return server;
}
