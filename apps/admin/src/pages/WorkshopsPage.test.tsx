// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listAdminWorkshops, listAdminWorkshopSignups, type AdminWorkshop } from '../api';
import { WorkshopsPage } from './WorkshopsPage';
vi.mock('../api', () => ({ listAdminWorkshops: vi.fn(), listAdminWorkshopSignups: vi.fn(), createWorkshop: vi.fn(), deleteWorkshop: vi.fn(), updateWorkshop: vi.fn(), uploadWorkshopImage: vi.fn() }));
const session = { accessToken: 'token', email: 'admin@example.com', displayName: 'Admin', isAdmin: true };
const workshop: AdminWorkshop = { id: 'sample', slug: 'sample', title: 'Seed saving', short_description: null, description: null, status: 'open', workshop_date: null, location: null, capacity: 10, image_s3_key: null, image_url: null, is_paid: false, price_cents: null, currency: 'usd', stripe_product_id: null, stripe_price_id: null, signup_counts: { registered: 0, waitlisted: 0, interested: 0 }, created_at: '2026-01-01', updated_at: '2026-01-01' };
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); vi.mocked(listAdminWorkshopSignups).mockResolvedValue([]); });
describe('workshop operational presentation', () => {
  it('does not show an empty catalog while loading or after a failed request', async () => {
    vi.mocked(listAdminWorkshops).mockRejectedValue(new Error('Unable to load workshops.'));
    render(<WorkshopsPage session={session} />);
    expect(screen.getByRole('status').textContent).toBe('Loading workshops…');
    expect(screen.queryByText('No workshops yet')).toBeNull();
    expect(await screen.findByText('Unable to load workshops.')).toBeTruthy();
    expect(screen.queryByText('No workshops yet')).toBeNull();
  });
  it('gives the sign-up table a labeled keyboard-focusable scroll region', async () => {
    vi.mocked(listAdminWorkshops).mockResolvedValue([workshop]);
    render(<WorkshopsPage session={session} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Hands-on workshops' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Signups' }));
    const region = await screen.findByRole('region', { name: 'Workshop sign-ups' });
    expect(region.tabIndex).toBe(0);
    expect(region.querySelector('table')).toBeTruthy();
    expect(screen.getByText('No signups yet.')).toBeTruthy();
  });
});

