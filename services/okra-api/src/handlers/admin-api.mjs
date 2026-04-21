import { Router } from '@aws-lambda-powertools/event-handler/http';
import { registerAdminRoutes } from './admin-routes.mjs';
import { createHttpRouterHandler } from '../services/http-handler.mjs';

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

export const handler = createHttpRouterHandler({ app, handlerName: 'admin-api' });
