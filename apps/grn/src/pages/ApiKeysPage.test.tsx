import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApiKeysPage } from './ApiKeysPage';
import { listApiKeys } from '../services/api';
import { getApiEndpoint } from '../config/amplify';
import { mcpEndpointFor } from '../config/mcp';

vi.mock('../services/api', () => ({
  listApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  renameApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
}));

vi.mock('../config/amplify', () => ({
  getApiEndpoint: vi.fn(),
}));

const mockListKeys = vi.mocked(listApiKeys);
const mockApiEndpoint = vi.mocked(getApiEndpoint);

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ApiKeysPage />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe('ApiKeysPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListKeys.mockResolvedValue({ items: [] });
    mockApiEndpoint.mockReturnValue('https://api.example.org/grn');
  });

  it('lets a grower create a key straight away, with no access request', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'API keys' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /create key/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request a key' })).not.toBeInTheDocument();
  });

  it('shows the MCP server address for AI assistants', async () => {
    renderPage();

    const section = (await screen.findByRole('heading', { name: 'Use with an AI assistant' })).closest('section')!;
    expect(within(section).getByText('https://api.example.org/grn-mcp')).toBeInTheDocument();
    expect(within(section).getByText(/Authorization: Bearer/)).toBeInTheDocument();
  });

  it('says the address is unavailable rather than guessing one', async () => {
    mockApiEndpoint.mockReturnValue('https://abc123.execute-api.us-east-1.amazonaws.com/api');
    renderPage();

    expect(await screen.findByText(/address isn.t available in this environment/i)).toBeInTheDocument();
  });
});

describe('mcpEndpointFor', () => {
  it('puts the MCP server beside the API on the shared domain', () => {
    expect(mcpEndpointFor('https://api.example.org/grn')).toBe('https://api.example.org/grn-mcp');
    expect(mcpEndpointFor('https://api.example.org/grn/')).toBe('https://api.example.org/grn-mcp');
  });

  it('has no address for a raw API Gateway URL, an unset URL or nonsense', () => {
    expect(mcpEndpointFor('https://abc123.execute-api.us-east-1.amazonaws.com/api')).toBeNull();
    expect(mcpEndpointFor(null)).toBeNull();
    expect(mcpEndpointFor('not a url')).toBeNull();
  });
});
