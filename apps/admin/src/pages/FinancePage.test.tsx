// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFinanceRevenue, type FinanceRevenueResponse } from '../api';
import { FinancePage } from './FinancePage';
vi.mock('../api', () => ({ getFinanceRevenue: vi.fn() }));
const session = { accessToken: 'token', email: 'admin@example.com', displayName: 'Admin', isAdmin: true };
const empty: FinanceRevenueResponse = { range: { from: '2026-01-01', to: '2026-06-30', granularity: 'month' }, totals: { totalCents: 0, donationOneTimeCents: 0, donationRecurringCents: 0, merchandiseCents: 0 }, buckets: [] };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
afterEach(cleanup);
beforeEach(() => vi.mocked(getFinanceRevenue).mockReset());
describe('finance data states', () => {
  it('distinguishes loading, unavailable, and a successful zero total, with retry', async () => {
    const pending = deferred<FinanceRevenueResponse>();
    vi.mocked(getFinanceRevenue).mockReturnValueOnce(pending.promise).mockRejectedValueOnce(new Error('Service unavailable')).mockResolvedValueOnce(empty);
    render(<FinancePage session={session} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Revenue' })).toBeTruthy();
    expect(screen.getAllByText('Loading…')).toHaveLength(4);
    expect(screen.queryByText('$0.00')).toBeNull();
    await act(async () => pending.resolve(empty));
    expect(await screen.findByRole('heading', { name: 'No revenue in this range yet' })).toBeTruthy();
    expect(screen.getAllByText('$0.00')).toHaveLength(4);
    fireEvent.click(screen.getByRole('tab', { name: 'Last 30 days' }));
    expect(await screen.findByRole('heading', { name: 'Revenue is unavailable' })).toBeTruthy();
    expect(screen.getAllByText('Unavailable')).toHaveLength(4);
    expect(screen.queryByText('$0.00')).toBeNull();
    expect(screen.queryByText('No revenue in this range yet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No revenue in this range yet')).toBeTruthy();
    expect(screen.getAllByText('$0.00')).toHaveLength(4);
  });
  it('ignores an older response after a date range changes', async () => {
    const older = deferred<FinanceRevenueResponse>();
    vi.mocked(getFinanceRevenue).mockReturnValueOnce(older.promise).mockResolvedValueOnce(empty);
    render(<FinancePage session={session} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Last 30 days' }));
    await waitFor(() => expect(screen.getAllByText('$0.00')).toHaveLength(4));
    await act(async () => older.resolve({ ...empty, totals: { ...empty.totals, totalCents: 5000 } }));
    expect(screen.queryByText('$50.00')).toBeNull();
    expect(screen.getAllByText('$0.00')).toHaveLength(4);
  });
});
