import { Router } from '@aws-lambda-powertools/event-handler/http';
import { registerAdminRoutes } from './admin-routes.mjs';

const app = new Router();

registerAdminRoutes(app);

app.notFound(() => {
  return new Response(
    JSON.stringify({
      error: {
        code: 'NOT_FOUND',
        message: 'Admin route not found'
      }
    }),
    {
      status: 404,
      headers: {
        'content-type': 'application/json'
      }
    }
  );
});

export const handler = async (event, context) => {
  try {
    return await app.resolve(event, context);
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      message: err instanceof Error ? err.message : String(err),
      errorName: err instanceof Error ? err.name : 'UnknownError',
      stack: err instanceof Error ? err.stack : undefined,
      handler: 'admin-api'
    }));
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } })
    };
  }
};
