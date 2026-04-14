import { handler } from '../../src/handlers/api.mjs';

function makeRestApiEvent(path, method = 'POST', body = null) {
  return {
    resource: '/{proxy+}',
    path,
    httpMethod: method,
    headers: {
      'content-type': 'application/json'
    },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {
      requestId: 'req-submit',
      path,
      stage: 'api',
      identity: {
        sourceIp: '127.0.0.1',
        userAgent: 'vitest'
      }
    },
    body,
    isBase64Encoded: false
  };
}

describe('submit endpoint validation', () => {
  it('returns 422 when required fields are missing', async () => {
    const res = await handler(
      makeRestApiEvent('/submissions', 'POST', JSON.stringify({ contributorName: 'A' }))
    );

    expect(res.statusCode).toBe(422);
    const payload = JSON.parse(String(res.body));
    expect(payload.error).toBe('RequestValidationError');
  });
});
