import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeysPanel, MAX_API_KEYS } from './ApiKeysPanel';

const listApiKeys = vi.hoisted(() => vi.fn());
const createApiKey = vi.hoisted(() => vi.fn());
const renameApiKey = vi.hoisted(() => vi.fn());
const deleteApiKey = vi.hoisted(() => vi.fn());

vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/api')>();
  return {
    ...actual,
    listApiKeys,
    createApiKey,
    renameApiKey,
    deleteApiKey,
  };
});

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ApiKeysPanel />
    </QueryClientProvider>
  );
}

describe('ApiKeysPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listApiKeys.mockResolvedValue({ items: [] });
  });

  it('lists existing keys without exposing secrets', async () => {
    listApiKeys.mockResolvedValue({
      items: [
        {
          id: 'key-1',
          name: 'Laptop script',
          keyPrefix: 'grnk_1a2b3c4d',
          lastUsedAt: null,
          createdAt: '2026-06-22T00:00:00Z',
        },
      ],
    });

    renderPanel();

    expect(await screen.findByText('Laptop script')).toBeInTheDocument();
    expect(screen.getByText(/grnk_1a2b3c4d/)).toBeInTheDocument();
    expect(screen.getByText(/last used never/i)).toBeInTheDocument();
  });

  it('shows the one-time secret after creating a key', async () => {
    createApiKey.mockResolvedValue({
      id: 'key-2',
      name: 'New key',
      keyPrefix: 'grnk_99887766',
      key: 'grnk_99887766aabbccddeeff00112233445566778899aabbccddeeff0011',
      lastUsedAt: null,
      createdAt: '2026-06-22T00:00:00Z',
    });

    renderPanel();
    await screen.findByText(/no api keys yet/i);

    await userEvent.type(screen.getByLabelText(/key name/i), 'New key');
    await userEvent.click(screen.getByRole('button', { name: /create key/i }));

    expect(createApiKey).toHaveBeenCalledWith('New key');
    const status = await screen.findByRole('status');
    expect(within(status).getByText(/you won't be able to see it again/i)).toBeInTheDocument();
    expect(
      within(status).getByText('grnk_99887766aabbccddeeff00112233445566778899aabbccddeeff0011')
    ).toBeInTheDocument();
  });

  it('validates that a name is required before creating', async () => {
    renderPanel();
    await screen.findByText(/no api keys yet/i);

    await userEvent.click(screen.getByRole('button', { name: /create key/i }));

    expect(createApiKey).not.toHaveBeenCalled();
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
  });

  it('renames a key', async () => {
    listApiKeys.mockResolvedValue({
      items: [
        {
          id: 'key-1',
          name: 'Old name',
          keyPrefix: 'grnk_1a2b3c4d',
          lastUsedAt: null,
          createdAt: '2026-06-22T00:00:00Z',
        },
      ],
    });
    renameApiKey.mockResolvedValue({
      id: 'key-1',
      name: 'Renamed',
      keyPrefix: 'grnk_1a2b3c4d',
      lastUsedAt: null,
      createdAt: '2026-06-22T00:00:00Z',
    });

    renderPanel();
    await screen.findByText('Old name');

    await userEvent.click(screen.getByRole('button', { name: /rename/i }));
    const input = screen.getByLabelText(/new key name/i);
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(renameApiKey).toHaveBeenCalledWith('key-1', 'Renamed')
    );
  });

  it('offers the key form with no access request: keys are self-serve', async () => {
    renderPanel();

    await screen.findByText(/no api keys yet/i);
    expect(screen.getByRole('button', { name: /create key/i })).toBeInTheDocument();
    expect(screen.queryByText(/approv/i)).not.toBeInTheDocument();
  });

  it('hides the form at the key limit and says how to make room', async () => {
    listApiKeys.mockResolvedValue({
      items: Array.from({ length: MAX_API_KEYS }, (_, i) => ({
        id: `key-${i}`,
        name: `Key ${i}`,
        keyPrefix: `grnk_0000000${i}`,
        lastUsedAt: null,
        createdAt: '2026-06-22T00:00:00Z',
      })),
    });
    renderPanel();

    expect(await screen.findByText(/the most you can hold/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create key/i })).not.toBeInTheDocument();
  });

  it('offers no form until the key list has loaded', async () => {
    listApiKeys.mockReturnValue(new Promise(() => {}));
    renderPanel();

    expect(await screen.findByText(/loading keys/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create key/i })).not.toBeInTheDocument();
  });

  it('shows the API\'s refusal when a create is refused', async () => {
    createApiKey.mockRejectedValue(new Error('You already have 5 active API keys. Revoke one before creating another.'));
    renderPanel();
    await screen.findByText(/no api keys yet/i);

    await userEvent.type(screen.getByLabelText(/key name/i), 'One too many');
    await userEvent.click(screen.getByRole('button', { name: /create key/i }));

    expect(await screen.findByText(/already have 5 active api keys/i)).toBeInTheDocument();
  });
});
