/**
 * The MCP server, built per request for one verified key (docs/mcp-server.md).
 * After kids-and-dragons' mcp/server.ts.
 *
 * A tool belongs to an area. A key with `<area>:write` gets every tool in it;
 * a key with `<area>:read` gets only the tools annotated readOnlyHint, and
 * that annotation is the single source of truth for it. A tool the key may
 * not use is never registered: it is absent from tools/list, and calling it
 * is an unknown-tool error. A tool whose service is not connected in this
 * environment is not registered either.
 */

import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { READ, guarded } from './shared.mjs';
import { registerStoreTools } from './tools/store.mjs';
import { registerWorkshopTools } from './tools/workshops.mjs';
import { registerContentTools } from './tools/content.mjs';
import { registerQueueTools } from './tools/queues.mjs';
import { registerReportTools } from './tools/reports.mjs';

export const SERVER_INFO = { name: 'olivias-garden-operator', version: '1.0.0' };

const INSTRUCTIONS =
  "Operate Olivia's Garden Foundation's sites as the site operator. " +
  'Start with whats_pending for what needs attention (seed requests to send, okra photos to review, API access requests). ' +
  'Store tools manage store products and list orders; workshop tools manage workshops and their signups; ' +
  'content tools edit the impact metrics and testimonials on the site; queue tools mark seed requests done and review submissions; ' +
  'report tools read activity, revenue and dashboard stats. Every change is made as the key\'s operator and recorded in the ' +
  'owning service exactly as an admin-app change would be. Prices are in cents. whoami says what this key may do.';

export function buildServer(key, deps) {
  const server = new McpServer(SERVER_INFO, {
    instructions: `${INSTRUCTIONS} This key may: ${key.scopes.join(', ') || 'nothing'}.`
  });

  server.registerTool(
    'whoami',
    {
      title: 'Who am I',
      description: "This key's label, scopes, expiry, and the operator it acts as.",
      inputSchema: z.object({}),
      annotations: READ
    },
    guarded(async () => ({
      label: key.label,
      scopes: key.scopes,
      expires_at: key.expiresAt,
      operator: { email: key.operator.email ?? null }
    }), deps.logger)
  );

  const ctx = {
    backends: deps.backends,
    logger: deps.logger ?? console,
    // Shared across requests: made once by the endpoint (handler.mjs).
    locateSeedPin: deps.locateSeedPin
  };
  registerStoreTools(scoped(server, 'store', key.scopes), ctx);
  registerWorkshopTools(scoped(server, 'workshops', key.scopes), ctx);
  registerContentTools(scoped(server, 'content', key.scopes), ctx);
  registerQueueTools(scoped(server, 'queues', key.scopes), ctx);
  registerReportTools(scoped(server, 'reports', key.scopes), ctx);
  return server;
}

/**
 * The tools of one area that these scopes reach; the rest are silently not
 * registered. Tool modules call `register(name, config, handler, { service })`;
 * a tool needing a service the deployment has not connected is skipped too.
 */
export function scoped(server, area, scopes) {
  const write = scopes.includes(`${area}:write`);
  const read = write || scopes.includes(`${area}:read`);
  return {
    area,
    allows(config) {
      return write || (read && config.annotations?.readOnlyHint === true);
    },
    register(name, config, handler, { backends, services = [] } = {}) {
      if (!this.allows(config)) return false;
      if (backends && !services.every((s) => backends.has(s))) return false;
      server.registerTool(name, config, handler);
      return true;
    }
  };
}
