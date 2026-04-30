import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveOptionalAuthContextMock = vi.fn();
const createDbClientMock = vi.fn();
const eventBridgeSendMock = vi.fn();

vi.mock('../src/services/auth.mjs', () => ({
  resolveOptionalAuthContext: resolveOptionalAuthContextMock,
}));

vi.mock('../scripts/db-client.mjs', () => ({
  createDbClient: createDbClientMock,
}));

vi.mock('@aws-sdk/client-eventbridge', async () => {
  const actual = await vi.importActual('@aws-sdk/client-eventbridge');
  return {
    ...actual,
    EventBridgeClient: class {
      send = eventBridgeSendMock;
    },
  };
});

const {
  cancelGardenClubSubscription,
  createDonationCheckoutSession,
  handleEventBridgeEvent,
  resumeGardenClubSubscription
} = await import('../src/services/donations.mjs');

describe('donations service', () => {
  beforeEach(() => {
    resolveOptionalAuthContextMock.mockResolvedValue(null);
    eventBridgeSendMock.mockReset();
    eventBridgeSendMock.mockResolvedValue({ FailedEntryCount: 0, Entries: [] });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.DATABASE_URL;
  });

  it('prefills checkout with a Stripe customer and includes the bee dedication in the description', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';

    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'cus_123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'cs_123', client_secret: 'cs_secret_123' }),
      });

    const result = await createDonationCheckoutSession(
      {
        mode: 'one_time',
        amountCents: 5000,
        returnUrl: 'https://oliviasgarden.org/donate?session_id={CHECKOUT_SESSION_ID}',
        donorName: 'Olivia Donor',
        donorEmail: 'donor@example.com',
        dedicationName: 'Grandma June',
      },
      { headers: {} },
      'corr-123',
    );

    expect(result).toEqual({
      clientSecret: 'cs_secret_123',
      checkoutSessionId: 'cs_123',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [customerUrl, customerOptions] = fetchMock.mock.calls[0];
    expect(customerUrl).toBe('https://api.stripe.com/v1/customers');
    expect(customerOptions.method).toBe('POST');
    const customerParams = customerOptions.body;
    expect(customerParams).toBeInstanceOf(URLSearchParams);
    expect(customerParams.get('email')).toBe('donor@example.com');
    expect(customerParams.get('name')).toBe('Olivia Donor');
    expect(customerParams.get('metadata[dedication_name]')).toBe('Grandma June');

    const [checkoutUrl, checkoutOptions] = fetchMock.mock.calls[1];
    expect(checkoutUrl).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(checkoutOptions.method).toBe('POST');
    const checkoutParams = checkoutOptions.body;
    expect(checkoutParams).toBeInstanceOf(URLSearchParams);
    expect(checkoutParams.get('ui_mode')).toBe('embedded_page');
    expect(checkoutParams.get('customer')).toBe('cus_123');
    expect(checkoutParams.get('customer_email')).toBeNull();
    expect(checkoutParams.get('line_items[0][price_data][product_data][description]')).toContain('Bee dedication: Grandma June.');
  });

  it('falls back to customer_email when Stripe customer prefill creation fails', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';

    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'no customer' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'cs_123', client_secret: 'cs_secret_123' }),
      });

    await createDonationCheckoutSession(
      {
        mode: 'recurring',
        amountCents: 2500,
        returnUrl: 'https://oliviasgarden.org/donate?session_id={CHECKOUT_SESSION_ID}',
        donorName: 'Olivia Donor',
        donorEmail: 'donor@example.com',
        dedicationName: 'Olivia',
        tShirtPreference: 'Medium',
      },
      { headers: {} },
      'corr-456',
    );

    const [, checkoutOptions] = fetchMock.mock.calls[1];
    const checkoutParams = checkoutOptions.body;
    expect(checkoutParams.get('customer')).toBeNull();
    expect(checkoutParams.get('customer_email')).toBe('donor@example.com');
    expect(checkoutParams.get('metadata[t_shirt_preference]')).toBe('Medium');
    expect(checkoutParams.get('line_items[0][price_data][product_data][description]')).toContain('Bee dedication: Olivia.');
  });

  it('does not prefill donor identity from auth context when anonymous donation is requested', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    resolveOptionalAuthContextMock.mockResolvedValue({
      userId: 'cf399090-0f65-4d15-bd10-50944ce0ff9b',
      name: 'Signed In Donor',
      email: 'signed-in@example.com',
    });

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'cs_anon_123', client_secret: 'cs_secret_anon_123' }),
    });

    const result = await createDonationCheckoutSession(
      {
        mode: 'one_time',
        amountCents: 2500,
        returnUrl: 'https://oliviasgarden.org/donate?session_id={CHECKOUT_SESSION_ID}',
        anonymousDonation: true,
        dedicationName: 'Anonymous donor',
      },
      { headers: {} },
      'corr-anon-123',
    );

    expect(result).toEqual({
      clientSecret: 'cs_secret_anon_123',
      checkoutSessionId: 'cs_anon_123',
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    const [checkoutUrl, checkoutOptions] = fetchMock.mock.calls[0];
    expect(checkoutUrl).toBe('https://api.stripe.com/v1/checkout/sessions');
    const checkoutParams = checkoutOptions.body;
    expect(checkoutParams.get('metadata[anonymous_donation]')).toBe('true');
    expect(checkoutParams.get('metadata[user_id]')).toBe('cf399090-0f65-4d15-bd10-50944ce0ff9b');
    expect(checkoutParams.get('metadata[donor_name]')).toBeNull();
    expect(checkoutParams.get('metadata[donor_email]')).toBeNull();
    expect(checkoutParams.get('customer')).toBeNull();
    expect(checkoutParams.get('customer_email')).toBeNull();
  });

  it('skips checkout.session.completed events that lack donation_mode metadata (e.g. store checkouts)', async () => {
    const queryMock = vi.fn();
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      end: vi.fn().mockResolvedValue(undefined),
      query: queryMock,
    };
    createDbClientMock.mockResolvedValue(client);

    await handleEventBridgeEvent({
      id: 'evtbridge-store-1',
      'detail-type': 'checkout.session.completed',
      detail: {
        id: 'evt_store_1',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_store_1',
            amount_total: 5000,
            currency: 'usd',
            metadata: { og_kind: 'store' },
          },
        },
      },
    });

    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.end).toHaveBeenCalledOnce();
    // No DB writes should happen — the donation consumer must ignore non-donation events.
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('publishes a donation event with details after checkout.session.completed from EventBridge', async () => {
    const queryMock = vi.fn((sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') {
        return Promise.resolve({ rowCount: null });
      }

      return Promise.resolve({ rowCount: 1 });
    });
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      end: vi.fn().mockResolvedValue(undefined),
      query: queryMock,
    };
    createDbClientMock.mockResolvedValue(client);

    await handleEventBridgeEvent({
      id: 'evtbridge-123',
      'detail-type': 'checkout.session.completed',
      detail: {
        id: 'evt_123',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_123',
            payment_intent: 'pi_123',
            customer: 'cus_123',
            subscription: null,
            amount_total: 5000,
            currency: 'usd',
            metadata: {
              donation_mode: 'one_time',
              donor_name: 'Olivia Donor',
              donor_email: 'donor@example.com',
              dedication_name: 'Grandma June',
            },
          },
        },
      },
    });

    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.end).toHaveBeenCalledOnce();
    expect(queryMock).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(queryMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('insert into donation_events'),
      [
        'evt_123',
        'cs_123',
        'pi_123',
        'cus_123',
        null,
        null,
        'one_time',
        5000,
        'usd',
        'Olivia Donor',
        'donor@example.com',
        'Grandma June',
        null,
      ],
    );
    expect(queryMock).toHaveBeenNthCalledWith(3, 'COMMIT');
    expect(eventBridgeSendMock).toHaveBeenCalledTimes(1);
    const command = eventBridgeSendMock.mock.calls[0][0];
    const entry = command.input.Entries[0];
    expect(entry.Source).toBe('ogf.donations');
    expect(entry.DetailType).toBe('donation.completed');
    const detail = JSON.parse(entry.Detail);
    expect(detail.mode).toBe('one_time');
    expect(detail.amountCents).toBe(5000);
    expect(detail.currency).toBe('usd');
    expect(detail.donorName).toBe('Olivia Donor');
    expect(detail.donorEmail).toBe('donor@example.com');
    expect(detail.dedicationName).toBe('Grandma June');
    expect(detail.anonymous).toBe(false);
  });

  it('marks anonymous donations explicitly in the published event', async () => {
    const queryMock = vi.fn((sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') {
        return Promise.resolve({ rowCount: null });
      }

      return Promise.resolve({ rowCount: 1 });
    });
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      end: vi.fn().mockResolvedValue(undefined),
      query: queryMock,
    };
    createDbClientMock.mockResolvedValue(client);

    await handleEventBridgeEvent({
      id: 'evtbridge-456',
      'detail-type': 'checkout.session.completed',
      detail: {
        id: 'evt_456',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_456',
            payment_intent: 'pi_456',
            customer: 'cus_456',
            subscription: null,
            amount_total: 2500,
            currency: 'usd',
            metadata: {
              donation_mode: 'one_time',
              anonymous_donation: 'true',
              dedication_name: 'Anonymous donor',
            },
          },
        },
      },
    });

    expect(eventBridgeSendMock).toHaveBeenCalledTimes(1);
    const detail = JSON.parse(eventBridgeSendMock.mock.calls[0][0].input.Entries[0].Detail);
    expect(detail.anonymous).toBe(true);
    expect(detail.donorEmail).toBeNull();
    expect(detail.dedicationName).toBe('Anonymous donor');
  });

  it('schedules Garden Club cancellation at period end and returns the cancel date', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    resolveOptionalAuthContextMock.mockResolvedValue({
      userId: 'cf399090-0f65-4d15-bd10-50944ce0ff9b',
    });

    const cancelAtSeconds = 1_900_000_000;
    const queryMock = vi.fn((sql) => {
      if (sql.includes('select id::text as id') && sql.includes('from users')) {
        return Promise.resolve({
          rows: [
            {
              id: 'cf399090-0f65-4d15-bd10-50944ce0ff9b',
              email: 'donor@example.com',
              stripe_garden_club_subscription_id: 'sub_123',
              garden_club_status: 'active',
              garden_club_cancel_at: null,
            },
          ],
        });
      }

      if (sql.includes('update users') && sql.includes('garden_club_status')) {
        return Promise.resolve({
          rows: [
            {
              id: 'cf399090-0f65-4d15-bd10-50944ce0ff9b',
              email: 'donor@example.com',
              garden_club_cancel_at: new Date(cancelAtSeconds * 1000).toISOString(),
            },
          ],
        });
      }

      return Promise.resolve({ rowCount: 0 });
    });
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      end: vi.fn().mockResolvedValue(undefined),
      query: queryMock,
    };
    createDbClientMock.mockResolvedValue(client);

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'sub_123',
        cancel_at_period_end: true,
        cancel_at: cancelAtSeconds,
        current_period_end: cancelAtSeconds,
        status: 'active',
      }),
    });

    const result = await cancelGardenClubSubscription({ headers: {} }, 'corr-cancel-1');

    expect(result.gardenClubStatus).toBe('canceling');
    expect(result.gardenClubCancelAt).toBe(new Date(cancelAtSeconds * 1000).toISOString());

    const [stripeUrl, stripeOptions] = vi.mocked(fetch).mock.calls[0];
    expect(stripeUrl).toBe('https://api.stripe.com/v1/subscriptions/sub_123');
    expect(stripeOptions.method).toBe('POST');
    expect(stripeOptions.body).toBeInstanceOf(URLSearchParams);
    expect(stripeOptions.body.get('cancel_at_period_end')).toBe('true');

    expect(eventBridgeSendMock).toHaveBeenCalledTimes(1);
    const entry = eventBridgeSendMock.mock.calls[0][0].input.Entries[0];
    expect(entry.DetailType).toBe('garden-club.cancellation_scheduled');
    const detail = JSON.parse(entry.Detail);
    expect(detail.userId).toBe('cf399090-0f65-4d15-bd10-50944ce0ff9b');
    expect(detail.donorEmail).toBe('donor@example.com');
    expect(detail.cancelAt).toBe(new Date(cancelAtSeconds * 1000).toISOString());
  });

  it('rejects cancel requests when the user has no Garden Club subscription on file', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    resolveOptionalAuthContextMock.mockResolvedValue({ userId: 'cf399090-0f65-4d15-bd10-50944ce0ff9b' });

    const queryMock = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'cf399090-0f65-4d15-bd10-50944ce0ff9b',
          email: 'donor@example.com',
          stripe_garden_club_subscription_id: null,
          garden_club_status: 'none',
          garden_club_cancel_at: null,
        },
      ],
    });
    createDbClientMock.mockResolvedValue({
      connect: vi.fn().mockResolvedValue(undefined),
      end: vi.fn().mockResolvedValue(undefined),
      query: queryMock,
    });

    await expect(cancelGardenClubSubscription({ headers: {} }, 'corr-cancel-2'))
      .rejects.toThrow('No active Garden Club membership');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('reverts a scheduled cancellation when the donor resumes monthly support', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    resolveOptionalAuthContextMock.mockResolvedValue({ userId: 'cf399090-0f65-4d15-bd10-50944ce0ff9b' });

    const queryMock = vi.fn((sql) => {
      if (sql.includes('select id::text as id') && sql.includes('from users')) {
        return Promise.resolve({
          rows: [
            {
              id: 'cf399090-0f65-4d15-bd10-50944ce0ff9b',
              email: 'donor@example.com',
              stripe_garden_club_subscription_id: 'sub_123',
              garden_club_status: 'canceling',
              garden_club_cancel_at: '2027-05-15T00:00:00.000Z',
            },
          ],
        });
      }

      if (sql.includes('update users') && sql.includes('garden_club_status')) {
        return Promise.resolve({
          rows: [
            {
              id: 'cf399090-0f65-4d15-bd10-50944ce0ff9b',
              email: 'donor@example.com',
              garden_club_cancel_at: null,
            },
          ],
        });
      }

      return Promise.resolve({ rowCount: 0 });
    });
    createDbClientMock.mockResolvedValue({
      connect: vi.fn().mockResolvedValue(undefined),
      end: vi.fn().mockResolvedValue(undefined),
      query: queryMock,
    });

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'sub_123',
        cancel_at_period_end: false,
        status: 'active',
      }),
    });

    const result = await resumeGardenClubSubscription({ headers: {} }, 'corr-resume-1');

    expect(result.gardenClubStatus).toBe('active');
    expect(result.gardenClubCancelAt).toBeNull();
    expect(vi.mocked(fetch).mock.calls[0][1].body.get('cancel_at_period_end')).toBe('false');

    expect(eventBridgeSendMock).toHaveBeenCalledTimes(1);
    expect(eventBridgeSendMock.mock.calls[0][0].input.Entries[0].DetailType).toBe('garden-club.cancellation_reverted');
  });

  it('rejects resume when the membership is already active', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    resolveOptionalAuthContextMock.mockResolvedValue({ userId: 'cf399090-0f65-4d15-bd10-50944ce0ff9b' });

    createDbClientMock.mockResolvedValue({
      connect: vi.fn().mockResolvedValue(undefined),
      end: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: 'cf399090-0f65-4d15-bd10-50944ce0ff9b',
            email: 'donor@example.com',
            stripe_garden_club_subscription_id: 'sub_123',
            garden_club_status: 'active',
            garden_club_cancel_at: null,
          },
        ],
      }),
    });

    await expect(resumeGardenClubSubscription({ headers: {} }, 'corr-resume-2'))
      .rejects.toThrow('already active');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('marks the user as canceling when customer.subscription.updated arrives with cancel_at_period_end', async () => {
    const cancelAtSeconds = 1_900_000_000;
    const queryMock = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'cf399090-0f65-4d15-bd10-50944ce0ff9b',
          email: 'donor@example.com',
          garden_club_cancel_at: new Date(cancelAtSeconds * 1000).toISOString(),
        },
      ],
    });
    createDbClientMock.mockResolvedValue({
      connect: vi.fn().mockResolvedValue(undefined),
      end: vi.fn().mockResolvedValue(undefined),
      query: queryMock,
    });

    await handleEventBridgeEvent({
      id: 'evtbridge-canceling-1',
      'detail-type': 'customer.subscription.updated',
      detail: {
        id: 'evt_canceling_1',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_123',
            cancel_at_period_end: true,
            cancel_at: cancelAtSeconds,
            current_period_end: cancelAtSeconds,
            status: 'active',
          },
        },
      },
    });

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('update users'),
      ['sub_123', 'canceling', new Date(cancelAtSeconds * 1000).toISOString()],
    );
    expect(eventBridgeSendMock).toHaveBeenCalledTimes(1);
    expect(eventBridgeSendMock.mock.calls[0][0].input.Entries[0].DetailType).toBe('garden-club.cancellation_scheduled');
  });

  it('reverts to active when customer.subscription.updated reports cancel_at_period_end=false on an active sub', async () => {
    const queryMock = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'cf399090-0f65-4d15-bd10-50944ce0ff9b',
          email: 'donor@example.com',
          garden_club_cancel_at: null,
        },
      ],
    });
    createDbClientMock.mockResolvedValue({
      connect: vi.fn().mockResolvedValue(undefined),
      end: vi.fn().mockResolvedValue(undefined),
      query: queryMock,
    });

    await handleEventBridgeEvent({
      id: 'evtbridge-active-1',
      'detail-type': 'customer.subscription.updated',
      detail: {
        id: 'evt_active_1',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_123',
            cancel_at_period_end: false,
            status: 'active',
          },
        },
      },
    });

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('update users'),
      ['sub_123', 'active', null],
    );
    expect(eventBridgeSendMock).toHaveBeenCalledTimes(1);
    expect(eventBridgeSendMock.mock.calls[0][0].input.Entries[0].DetailType).toBe('garden-club.cancellation_reverted');
  });

  it('clears cancel_at when customer.subscription.deleted finalizes the cancellation', async () => {
    const queryMock = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'cf399090-0f65-4d15-bd10-50944ce0ff9b',
          email: 'donor@example.com',
          garden_club_cancel_at: null,
        },
      ],
    });
    createDbClientMock.mockResolvedValue({
      connect: vi.fn().mockResolvedValue(undefined),
      end: vi.fn().mockResolvedValue(undefined),
      query: queryMock,
    });

    await handleEventBridgeEvent({
      id: 'evtbridge-deleted-1',
      'detail-type': 'customer.subscription.deleted',
      detail: {
        id: 'evt_deleted_1',
        type: 'customer.subscription.deleted',
        data: {
          object: { id: 'sub_123' },
        },
      },
    });

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('update users'),
      ['sub_123', 'canceled', null],
    );
    expect(eventBridgeSendMock).toHaveBeenCalledTimes(1);
    expect(eventBridgeSendMock.mock.calls[0][0].input.Entries[0].DetailType).toBe('garden-club.canceled');
  });
});
