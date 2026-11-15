// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { getProductBySlug } from '../api';
import { ProductPage } from './ProductPage';
import { product } from '../test/fixtures';
const cart = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('../api', () => ({ getProductBySlug: vi.fn() }));
vi.mock('../cart/CartContext', () => ({ useCart: () => cart, formatMoney: () => '$15.00' }));
function show() { return render(<MemoryRouter initialEntries={['/products/garden-shirt']}><Routes><Route path="/products/:slug" element={<ProductPage />} /><Route path="/cart" element={<h1>Your cart</h1>} /></Routes></MemoryRouter>); }
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); vi.mocked(getProductBySlug).mockResolvedValue(product); });
describe('product purchase presentation', () => {
  it('requires each option and adds the chosen options and quantity to the cart', async () => {
    vi.mocked(getProductBySlug).mockResolvedValue({ ...product, variations: [{ name: 'Size', values: ['S', 'M'] }, { name: 'Color', values: ['Green', 'Cream'] }] });
    show();
    expect(await screen.findByRole('heading', { level: 1, name: 'Garden shirt' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    expect(cart.add).not.toHaveBeenCalled();
    expect(screen.getByText('Please choose a Size and Color.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'M' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Green' }));
    expect((screen.getByRole('radio', { name: 'M' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('group', { name: 'Size: M' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    expect(cart.add).toHaveBeenCalledWith(expect.objectContaining({ id: 'shirt' }), 2, { Size: 'M', Color: 'Green' });
    expect(screen.getByRole('heading', { name: 'Your cart' })).toBeTruthy();
  });
  it('offers retry when product loading fails, and shows an honest photo fallback', async () => {
    vi.mocked(getProductBySlug).mockRejectedValueOnce(new Error('Not Found')).mockResolvedValueOnce(product);
    show();
    expect(await screen.findByRole('heading', { level: 1, name: 'Product unavailable' })).toBeTruthy();
    expect(screen.queryByText('Not Found')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Garden shirt' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Photo unavailable: Garden shirt' })).toBeTruthy();
  });
  it('replaces a broken product image and disables purchasing unavailable products', async () => {
    vi.mocked(getProductBySlug).mockResolvedValue({ ...product, image_url: '/missing-shirt.jpg', status: 'archived' });
    show();
    fireEvent.error(await screen.findByRole('img', { name: 'Garden shirt' }));
    expect(screen.getByRole('img', { name: 'Photo unavailable: Garden shirt' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Currently unavailable' }) as HTMLButtonElement).disabled).toBe(true);
    expect(cart.add).not.toHaveBeenCalled();
  });
});

