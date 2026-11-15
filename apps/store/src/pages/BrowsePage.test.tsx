// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { listPublicProducts, type StoreProduct } from '../api';
import { BrowsePage } from './BrowsePage';

vi.mock('../api', () => ({ listPublicProducts: vi.fn() }));
vi.mock('../cart/CartContext', () => ({ useCart: () => ({ add: vi.fn() }), formatMoney: () => '$15.00' }));

afterEach(() => { cleanup(); vi.unstubAllEnvs(); });
beforeEach(() => {
  vi.mocked(listPublicProducts).mockReset();
  vi.stubEnv('VITE_FOUNDATION_URL', 'https://oliviasgarden.org');
});

describe('store catalog recovery', () => {
  it('provides a useful error state and retries without leaving the store', async () => {
    vi.mocked(listPublicProducts).mockRejectedValueOnce(new Error('Not Found')).mockResolvedValueOnce([]);
    render(<MemoryRouter><BrowsePage /></MemoryRouter>);
    expect((await screen.findByRole('alert')).textContent).toContain("We couldn't load the store.");
    expect(screen.queryByText('Not Found')).toBeNull();
    expect(screen.getByRole('link', { name: 'Contact the garden' }).getAttribute('href')).toBe('https://oliviasgarden.org/contact');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Something new is growing.' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(listPublicProducts).toHaveBeenCalledTimes(2);
  });

  it('offers a foundation link when the catalog has no products', async () => {
    vi.mocked(listPublicProducts).mockResolvedValueOnce([]);
    const { container } = render(<MemoryRouter><BrowsePage /></MemoryRouter>);
    expect((await screen.findByRole('link', { name: 'Visit the garden' })).getAttribute('href')).toBe('https://oliviasgarden.org');
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders products after a failed request is retried', async () => {
    const product = { id: 'shirt', slug: 'garden-shirt', name: 'Garden shirt', kind: 'merchandise', images: [], image_url: null, short_description: 'Made for garden days.', variations: [], unit_amount_cents: 1500, currency: 'usd', description: null, status: 'active', fulfillment_type: 'shipping', is_public: true, is_featured: false, statement_descriptor: null, nonprofit_program: null, impact_summary: null, legacy_image_url: null, image_urls: [], metadata: {}, stripe_product_id: 'prod_shirt', stripe_price_id: 'price_shirt', created_at: '2026-01-01', updated_at: '2026-01-01' } satisfies StoreProduct;
    vi.mocked(listPublicProducts).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce([product]);
    render(<MemoryRouter><BrowsePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect((await screen.findByRole('link', { name: 'Garden shirt' })).getAttribute('href')).toBe('/products/garden-shirt');
    expect(screen.getByRole('button', { name: 'Add to cart' }).hasAttribute('disabled')).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
