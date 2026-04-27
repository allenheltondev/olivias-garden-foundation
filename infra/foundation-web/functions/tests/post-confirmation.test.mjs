import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  POST_CONFIRMATION_TRIGGERS,
  SIGNUP_NOTIFICATION_TRIGGERS,
  buildSignupEventDetail,
  createHandler,
  extractSignupContext,
  linkGuestOrders,
} from "../post-confirmation.mjs";

function buildEvent(overrides = {}) {
  return {
    triggerSource: "PostConfirmation_ConfirmSignUp",
    request: {
      clientMetadata: { correlationId: "corr-123" },
      userAttributes: {
        sub: "11111111-1111-1111-1111-111111111111",
        email: "new-user@example.com",
        given_name: "Olivia",
        family_name: "Garden",
        "custom:newsletter_opt_in": "true",
      },
    },
    ...overrides,
  };
}

describe("post-confirmation trigger sets", () => {
  it("accepts supported post-confirmation triggers", () => {
    assert.ok(POST_CONFIRMATION_TRIGGERS.has("PostConfirmation_ConfirmSignUp"));
    assert.ok(POST_CONFIRMATION_TRIGGERS.has("PostConfirmation_AdminConfirmSignUp"));
    assert.ok(POST_CONFIRMATION_TRIGGERS.has("PostConfirmation_ConfirmForgotPassword"));
  });

  it("limits signup notifications to signup confirmations", () => {
    assert.ok(SIGNUP_NOTIFICATION_TRIGGERS.has("PostConfirmation_ConfirmSignUp"));
    assert.ok(!SIGNUP_NOTIFICATION_TRIGGERS.has("PostConfirmation_ConfirmForgotPassword"));
  });
});

describe("extractSignupContext", () => {
  it("extracts user details and newsletter opt-in", () => {
    const context = extractSignupContext(buildEvent());
    assert.equal(context.supported, true);
    assert.equal(context.userId, "11111111-1111-1111-1111-111111111111");
    assert.equal(context.email, "new-user@example.com");
    assert.equal(context.fullName, "Olivia Garden");
    assert.equal(context.newsletterOptIn, true);
  });

  it("supports snake_case correlation ids", () => {
    const context = extractSignupContext(
      buildEvent({
        request: {
          clientMetadata: { correlation_id: "corr-456" },
          userAttributes: { sub: "22222222-2222-2222-2222-222222222222" },
        },
      }),
    );

    assert.equal(context.correlationId, "corr-456");
  });

  it("returns unsupported for non-post-confirmation triggers", () => {
    const context = extractSignupContext(buildEvent({ triggerSource: "PreSignUp_SignUp" }));
    assert.equal(context.supported, false);
  });

  it("throws when sub is missing", () => {
    assert.throws(
      () =>
        extractSignupContext(
          buildEvent({
            request: {
              userAttributes: { email: "missing-sub@example.com" },
            },
          }),
        ),
      /Missing userAttributes\.sub/,
    );
  });
});

describe("buildSignupEventDetail", () => {
  it("includes the key signup fields", () => {
    const detail = buildSignupEventDetail(extractSignupContext(buildEvent()));
    assert.equal(detail.userId, "11111111-1111-1111-1111-111111111111");
    assert.equal(detail.email, "new-user@example.com");
    assert.equal(detail.fullName, "Olivia Garden");
    assert.equal(detail.newsletterOptIn, true);
    assert.equal(detail.correlationId, "corr-123");
  });
});

function makeFakeEventBridgeClient() {
  const sent = [];
  return {
    sent,
    send: async (command) => {
      sent.push(command);
      return { FailedEntryCount: 0, Entries: [] };
    },
  };
}

function makeFakeClient({ insertedFlag = true, ordersUpdated = 0, throwOnOrders = null } = {}) {
  const queries = [];
  return {
    queries,
    client: {
      connect: async () => {},
      query: async (sql, params) => {
        queries.push({ sql, params });
        if (/INSERT INTO users/i.test(sql)) {
          return { rows: [{ inserted: insertedFlag }] };
        }
        if (/UPDATE store_orders/i.test(sql)) {
          if (throwOnOrders) throw throwOnOrders;
          return { rowCount: ordersUpdated };
        }
        return { rows: [] };
      },
      end: async () => {},
    },
  };
}

describe("createHandler", () => {
  it("provisions the shell user and publishes a signup event", async () => {
    const fake = makeFakeClient({ insertedFlag: true });
    const eventBridgeClient = makeFakeEventBridgeClient();

    const handler = createHandler({
      createClient: () => fake.client,
      eventBridgeClient,
      logger: () => {},
      errorLogger: () => {},
    });

    const event = buildEvent();
    const result = await handler(event);

    assert.equal(result, event);
    assert.equal(fake.queries.length, 2, "should run both upsert and order-link queries");
    assert.match(fake.queries[0].sql, /INSERT INTO users/i);
    assert.equal(fake.queries[0].params[0], "11111111-1111-1111-1111-111111111111");
    assert.match(fake.queries[1].sql, /UPDATE store_orders/i);
    assert.equal(eventBridgeClient.sent.length, 1);
    const detail = JSON.parse(eventBridgeClient.sent[0].input.Entries[0].Detail);
    assert.equal(detail.userId, "11111111-1111-1111-1111-111111111111");
  });

  it("skips publishing when the user already exists", async () => {
    const fake = makeFakeClient({ insertedFlag: false });
    const eventBridgeClient = makeFakeEventBridgeClient();

    const handler = createHandler({
      createClient: () => fake.client,
      eventBridgeClient,
      logger: () => {},
      errorLogger: () => {},
    });

    await handler(buildEvent());
    assert.equal(eventBridgeClient.sent.length, 0);
  });

  it("does not let EventBridge failures fail the Cognito flow", async () => {
    const fake = makeFakeClient({ insertedFlag: true });
    let errorLogged = false;
    const eventBridgeClient = {
      send: async () => ({ FailedEntryCount: 1, Entries: [{ ErrorCode: "boom" }] }),
    };

    const handler = createHandler({
      createClient: () => fake.client,
      eventBridgeClient,
      logger: () => {},
      errorLogger: () => {
        errorLogged = true;
      },
    });

    const event = buildEvent();
    const result = await handler(event);

    assert.equal(result, event);
    assert.equal(errorLogged, true);
  });

  it("skips unsupported triggers", async () => {
    let queryCalled = false;
    const eventBridgeClient = makeFakeEventBridgeClient();

    const handler = createHandler({
      createClient: () => ({
        connect: async () => {},
        query: async () => {
          queryCalled = true;
          return { rows: [] };
        },
        end: async () => {},
      }),
      eventBridgeClient,
      logger: () => {},
      errorLogger: () => {},
    });

    const result = await handler(buildEvent({ triggerSource: "PreSignUp_SignUp" }));
    assert.equal(result.triggerSource, "PreSignUp_SignUp");
    assert.equal(queryCalled, false);
    assert.equal(eventBridgeClient.sent.length, 0);
  });
});

describe("linkGuestOrders", () => {
  it("updates store_orders rows that match the new user's email", async () => {
    let queryParams = null;
    const client = {
      query: async (_sql, params) => {
        queryParams = params;
        return { rowCount: 3 };
      },
    };

    const linked = await linkGuestOrders(client, {
      userId: "user-1",
      email: "alice@example.com",
    });

    assert.equal(linked, 3);
    assert.deepEqual(queryParams, ["user-1", "alice@example.com"]);
  });

  it("returns 0 when the user has no email", async () => {
    let called = false;
    const client = { query: async () => { called = true; return { rowCount: 0 }; } };
    const linked = await linkGuestOrders(client, { userId: "user-1", email: null });
    assert.equal(linked, 0);
    assert.equal(called, false);
  });

  it("swallows missing-table errors silently", async () => {
    const client = {
      query: async () => {
        const err = new Error("relation \"store_orders\" does not exist");
        err.code = "42P01";
        throw err;
      },
    };
    const linked = await linkGuestOrders(client, {
      userId: "user-1",
      email: "alice@example.com",
    });
    assert.equal(linked, 0);
  });

  it("logs but does not throw on unexpected errors", async () => {
    let errorLogged = false;
    const client = {
      query: async () => {
        throw new Error("connection lost");
      },
    };
    const linked = await linkGuestOrders(
      client,
      { userId: "user-1", email: "alice@example.com" },
      () => { errorLogged = true; },
    );
    assert.equal(linked, 0);
    assert.equal(errorLogged, true);
  });
});
