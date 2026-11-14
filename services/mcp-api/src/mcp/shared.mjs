/**
 * Building blocks for the tool modules, after kids-and-dragons'
 * mcp/shared.ts: annotation presets, and `guarded`, which turns a tool body
 * into structuredContent plus the same JSON as text, and failures into
 * `isError` results the model can read and act on.
 */

import { z } from 'zod';

export const READ = { readOnlyHint: true, openWorldHint: false };
export const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
/** Changes that remove or replace data: archive, delete, replace a whole list. */
export const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

export const anyObject = z.looseObject({});

export const uuid = (what) => z.uuid().describe(`The ${what}'s id (a UUID).`);

export const idempotencyKey = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/)
  .optional()
  .describe('Optional. Reuse the same value when retrying the same change so it is applied only once.');

/** An error whose message is safe, and useful, to show the model. */
export class ToolError extends Error {}

export function guarded(fn, logger = console) {
  return async (args) => {
    try {
      const data = await fn(args ?? {});
      const structured = Array.isArray(data) ? { items: data } : (data ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(structured) }], structuredContent: structured };
    } catch (error) {
      let message;
      if (error instanceof ToolError) {
        message = error.message;
      } else {
        logger.error?.(JSON.stringify({
          level: 'ERROR',
          msg: 'MCP tool failed',
          error: error instanceof Error ? error.stack : String(error)
        }));
        message = 'Internal error. Try again later.';
      }
      return { content: [{ type: 'text', text: message }], isError: true };
    }
  };
}

/** Drop keys whose value is undefined, so a partial update only touches what was given. */
export function defined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined));
}
