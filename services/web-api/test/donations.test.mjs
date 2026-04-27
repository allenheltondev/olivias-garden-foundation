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

const { createDonationCheckoutSession, handleEventBridgeEvent } = await import('../src/services/donations.mjs');

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
});
