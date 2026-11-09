import { useCallback, useEffect, useState } from 'react';
import { Button, Card, FormFeedback, SectionHeading } from '@olivias/ui';
import {
  addSeedRequestMapPin,
  cancelSeedRequest,
  listSeedRequestQueue,
  markSeedRequestHandled,
  removeSeedRequestMapPin,
  reopenSeedRequest,
  setSeedRequestPinAddress,
  type SeedRequestAddress,
  type SeedRequestQueueItem,
  type SeedRequestStatus,
} from '../api';
import type { AdminSession } from '../auth/session';
import { findSeedPinLocation } from '../services/seed-pin-geocoder';
import { PinAddressForm } from './PinAddressForm';
import {
  canAddToMap,
  describeCurrentPin,
  describePlannedPin,
  firstName,
  formatPinAddress,
  wantsMapPin,
} from './seed-request-display';

export interface SeedRequestsPageProps {
  session: AdminSession;
}

const PAGE_SIZE = 10;

const STATUS_TABS: { id: SeedRequestStatus; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'handled', label: 'Done' },
  { id: 'cancelled', label: 'Cancelled' },
];

const TAB_COPY: Record<SeedRequestStatus, { title: string; body: string; empty: string }> = {
  open: {
    title: 'Open seed requests',
    body: 'Mark a request as done once the seeds are on their way or picked up. Mailed requests get a pin on the public okra map at their city, with a first name only if the sender opted in. Requests made when the form said unchecked meant no pin stay off the map. In-person exchanges only get an anonymous pin once you set a map address on their row.',
    empty: 'No open seed requests right now.',
  },
  handled: {
    title: 'Done seed requests',
    body: 'Requests you’ve sent seeds for. Undo moves a request back to open, takes it out of the packets-sent count, and removes its map pin.',
    empty: 'No requests have been marked done yet.',
  },
  cancelled: {
    title: 'Cancelled seed requests',
    body: 'Requests closed without sending seeds. Reopen one to put it back in the open queue.',
    empty: 'No cancelled requests.',
  },
};

type Notice = { tone: 'success' | 'info'; message: string };

function formatAddress(request: SeedRequestQueueItem): string {
  if (request.fulfillmentMethod !== 'mail' || !request.shippingAddress) {
    return 'In-person exchange';
  }
  const a = request.shippingAddress;
  const street = [a.line1, a.line2].filter(Boolean).join(', ');
  const locality = [a.city, a.region, a.postalCode].filter(Boolean).join(' ');
  return [street, locality, a.country].filter(Boolean).join(' · ') || 'Mail — address incomplete';
}

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : '—';
}

function statusDate(request: SeedRequestQueueItem, status: SeedRequestStatus): string {
  if (status === 'handled') return `Done ${formatDate(request.handledAt)}`;
  if (status === 'cancelled') return `Cancelled ${formatDate(request.cancelledAt)}`;
  return formatDate(request.createdAt);
}

export function SeedRequestsPage({ session }: SeedRequestsPageProps) {
  const [status, setStatus] = useState<SeedRequestStatus>('open');
  const [requests, setRequests] = useState<SeedRequestQueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const copy = TAB_COPY[status];

  const load = useCallback(
    async (targetStatus: SeedRequestStatus, targetPage: number, isActive: () => boolean = () => true) => {
      setLoading(true);
      try {
        const next = await listSeedRequestQueue(session.accessToken, {
          status: targetStatus,
          page: targetPage,
          limit: PAGE_SIZE,
        });
        if (!isActive()) return;
        setRequests(next.data);
        setTotal(next.total);
        setError(null);
      } catch (err) {
        if (!isActive()) return;
        setError(err instanceof Error ? err.message : 'Unable to load seed requests.');
      } finally {
        if (isActive()) setLoading(false);
      }
    },
    [session.accessToken],
  );

  useEffect(() => {
    let active = true;
    void load(status, page, () => active);
    return () => {
      active = false;
    };
  }, [load, status, page]);

  const switchTab = (next: SeedRequestStatus) => {
    if (next === status) return;
    setRequests([]);
    setTotal(0);
    setNotice(null);
    setError(null);
    setEditingAddressId(null);
    setStatus(next);
    setPage(1);
  };

  /** After an item leaves this tab, refetch (stepping back a page if it emptied). */
  const refreshAfterRemoval = async () => {
    const newTotal = Math.max(0, total - 1);
    const nextPage = Math.min(page, Math.max(1, Math.ceil(newTotal / PAGE_SIZE)));
    if (nextPage !== page) {
      setPage(nextPage);
    } else {
      await load(status, nextPage);
    }
  };

  const runAction = async (
    request: SeedRequestQueueItem,
    action: () => Promise<Notice>,
    fallbackError: string,
    leavesTab = true,
  ) => {
    setBusyId(request.id);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
      if (leavesTab) {
        await refreshAfterRemoval();
      } else {
        await load(status, page);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : fallbackError);
    } finally {
      setBusyId(null);
    }
  };

  const handleMarkDone = (request: SeedRequestQueueItem) =>
    runAction(request, async () => {
      // City-level only — see seed-pin-geocoder for what is (and isn't) sent.
      const mapLocation = wantsMapPin(request) ? await findSeedPinLocation(request) : null;
      const result = await markSeedRequestHandled(session.accessToken, request.id, {
        status: 'handled',
        ...(mapLocation ? { map_location: mapLocation } : {}),
      });
      const who = firstName(request.name);
      if (result?.mapPin) {
        const where = result.mapPin.locality ? ` near ${result.mapPin.locality}` : '';
        const kind = request.pinVisibility === 'named' ? `pin for ${who}` : 'anonymous pin';
        return {
          tone: 'success',
          message: `Marked done. A "seeds sent" ${kind}${where} will show on the okra map shortly.`,
        };
      }
      if (wantsMapPin(request)) {
        return { tone: 'info', message: `Marked done, but we couldn't place a map pin for ${who}'s city.` };
      }
      return { tone: 'success', message: 'Marked done.' };
    }, 'Unable to mark request as done.');

  const handleCancel = (request: SeedRequestQueueItem) => {
    const reason = window.prompt(
      `Cancel ${firstName(request.name)}'s request without sending seeds?\n\nOptional reason (e.g. duplicate, spam, can't ship there):`,
      '',
    );
    if (reason === null) return;
    return runAction(request, async () => {
      await cancelSeedRequest(session.accessToken, request.id, reason.trim() || undefined);
      return { tone: 'success', message: `Cancelled ${firstName(request.name)}'s request. You can reopen it from the Cancelled tab.` };
    }, 'Unable to cancel request.');
  };

  const handleUndo = (request: SeedRequestQueueItem) => {
    const pinNote = request.mapPin ? ' and remove its pin from the okra map' : '';
    if (!window.confirm(`Move ${firstName(request.name)}'s request back to open? This takes it out of the seed packets sent count${pinNote}.`)) {
      return;
    }
    return runAction(request, async () => {
      const result = await reopenSeedRequest(session.accessToken, request.id);
      if (result.mapPinRemoved === null) {
        return {
          tone: 'info',
          message: 'Moved back to open, but the map pin couldn’t be removed. Use "Remove map pin" on the Open tab to try again.',
        };
      }
      return { tone: 'success', message: `Moved ${firstName(request.name)}'s request back to open.` };
    }, 'Unable to undo.');
  };

  const handleReopen = (request: SeedRequestQueueItem) =>
    runAction(request, async () => {
      await reopenSeedRequest(session.accessToken, request.id);
      return { tone: 'success', message: `Reopened ${firstName(request.name)}'s request.` };
    }, 'Unable to reopen request.');

  const handleAddToMap = (request: SeedRequestQueueItem) =>
    runAction(request, async () => {
      const mapLocation = await findSeedPinLocation(request);
      const where = request.shippingAddress?.city ?? 'their city';
      if (!mapLocation) {
        return { tone: 'info', message: `Couldn't find ${where} on the map, so no pin was added.` };
      }
      const result = await addSeedRequestMapPin(session.accessToken, request.id, mapLocation);
      if (!result.mapPin) {
        return { tone: 'info', message: 'The request changed before the pin was added. Refresh and try again.' };
      }
      const placed = result.mapPin.locality ?? where;
      return { tone: 'success', message: `Added a "seeds sent" pin near ${placed} to the okra map.` };
    }, 'Unable to add to map.', false);

  const handleSavePinAddress = (request: SeedRequestQueueItem, address: SeedRequestAddress) =>
    runAction(request, async () => {
      const saved = await setSeedRequestPinAddress(session.accessToken, request.id, address);
      setEditingAddressId(null);
      if (request.requestStatus !== 'handled') {
        return { tone: 'success', message: 'Map address saved. The pin goes up when you mark this request as done.' };
      }
      // Already done: place the pin now, from the saved address.
      const located = { ...request, pinAddress: saved.pinAddress, pinVisibility: 'anonymous' as const };
      const mapLocation = await findSeedPinLocation(located);
      const where = saved.pinAddress?.city ?? 'that city';
      if (!mapLocation) {
        return { tone: 'info', message: `Map address saved, but we couldn't find ${where} on the map, so no pin was added.` };
      }
      const result = await addSeedRequestMapPin(session.accessToken, request.id, mapLocation);
      if (!result.mapPin) {
        return { tone: 'info', message: 'Map address saved, but the request changed before the pin was added. Refresh and try again.' };
      }
      return { tone: 'success', message: `Added an anonymous "seeds sent" pin near ${result.mapPin.locality ?? where} to the okra map.` };
    }, 'Unable to save the map address.', false);

  const handleClearPinAddress = (request: SeedRequestQueueItem) => {
    if (!window.confirm(`Clear the map address for ${firstName(request.name)}${request.mapPin ? ' and remove its pin from the okra map' : ''}?`)) {
      return;
    }
    return runAction(request, async () => {
      await setSeedRequestPinAddress(session.accessToken, request.id, null);
      setEditingAddressId(null);
      return { tone: 'success', message: 'Map address cleared.' };
    }, 'Unable to clear the map address.', false);
  };

  const handleRemovePin = (request: SeedRequestQueueItem) => {
    if (!window.confirm(`Remove ${firstName(request.name)}'s "seeds sent" pin from the public okra map? The request stays as it is.`)) {
      return;
    }
    return runAction(request, async () => {
      await removeSeedRequestMapPin(session.accessToken, request.id);
      return { tone: 'success', message: 'Map pin removed.' };
    }, 'Unable to remove map pin.', false);
  };

  const renderActions = (request: SeedRequestQueueItem) => {
    const disabled = busyId !== null;
    const loadingThis = busyId === request.id;
    const setAddress = request.fulfillmentMethod === 'in_person' && status !== 'cancelled' ? (
      <Button
        variant="outline"
        onClick={() => setEditingAddressId(editingAddressId === request.id ? null : request.id)}
        disabled={disabled}
      >
        {request.pinAddress ? 'Edit map address' : 'Set map address'}
      </Button>
    ) : null;
    const removePin = request.mapPin ? (
      <Button variant="outline" onClick={() => void handleRemovePin(request)} disabled={disabled}>
        Remove map pin
      </Button>
    ) : null;

    if (status === 'open') {
      return (
        <>
          <Button onClick={() => void handleMarkDone(request)} loading={loadingThis} disabled={disabled}>
            Mark as done
          </Button>
          <Button variant="ghost" onClick={() => void handleCancel(request)} disabled={disabled}>
            Cancel request
          </Button>
          {setAddress}
          {removePin}
        </>
      );
    }
    if (status === 'handled') {
      return (
        <>
          <Button variant="outline" onClick={() => void handleUndo(request)} loading={loadingThis} disabled={disabled}>
            Undo — move back to open
          </Button>
          {canAddToMap(request) ? (
            <Button variant="outline" onClick={() => void handleAddToMap(request)} disabled={disabled}>
              Add to map
            </Button>
          ) : null}
          {setAddress}
          {removePin}
        </>
      );
    }
    return (
      <Button variant="outline" onClick={() => void handleReopen(request)} loading={loadingThis} disabled={disabled}>
        Reopen
      </Button>
    );
  };

  return (
    <section className="admin-section">
      <div className="admin-section__header">
        <SectionHeading title={`${copy.title} (${total})`} body={copy.body} />
        <Button
          className="admin-refresh-action"
          variant="outline"
          size="sm"
          onClick={() => void load(status, page)}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>

      <div className="admin-tabs" role="tablist" aria-label="Seed request status">
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab.id}
            variant={tab.id === status ? 'primary' : 'ghost'}
            size="sm"
            role="tab"
            aria-selected={tab.id === status}
            onClick={() => switchTab(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {error ? (
        <FormFeedback tone="error" className="admin-load-error">{error}</FormFeedback>
      ) : null}

      {notice ? (
        <FormFeedback tone={notice.tone} className="admin-load-error">{notice.message}</FormFeedback>
      ) : null}

      {loading && requests.length === 0 ? (
        <Card><p>Loading seed requests…</p></Card>
      ) : requests.length === 0 ? (
        <Card><p>{copy.empty}</p></Card>
      ) : (
        <>
          <div className="admin-stack">
            {requests.map((request) => (
              <Card key={request.id} className="admin-request-card">
                <div className="admin-request-card__meta">
                  <div>
                    <h3>{request.name || 'Unknown contributor'}</h3>
                    <p>{request.email || 'No email provided'}</p>
                  </div>
                  <span>{statusDate(request, status)}</span>
                </div>
                <dl className="admin-request-card__details">
                  <div>
                    <dt>Fulfillment</dt>
                    <dd>{request.fulfillmentMethod === 'mail' ? 'Mail' : 'In-person exchange'}</dd>
                  </div>
                  <div>
                    <dt>Address / visit</dt>
                    <dd>
                      {request.fulfillmentMethod === 'mail'
                        ? formatAddress(request)
                        : request.visitDetails?.approximateDate || 'No date provided'}
                    </dd>
                  </div>
                  {request.visitDetails?.notes ? (
                    <div>
                      <dt>Visit notes</dt>
                      <dd>{request.visitDetails.notes}</dd>
                    </div>
                  ) : null}
                  {request.message ? (
                    <div>
                      <dt>Message</dt>
                      <dd>{request.message}</dd>
                    </div>
                  ) : null}
                  {status !== 'open' ? (
                    <div>
                      <dt>Requested</dt>
                      <dd>{formatDate(request.createdAt)}</dd>
                    </div>
                  ) : null}
                  {request.reviewNotes ? (
                    <div>
                      <dt>{status === 'cancelled' ? 'Reason' : 'Notes'}</dt>
                      <dd>{request.reviewNotes}</dd>
                    </div>
                  ) : null}
                  {request.fulfillmentMethod === 'in_person' && request.pinAddress ? (
                    <div>
                      <dt>Map address (private)</dt>
                      <dd>{formatPinAddress(request.pinAddress)}</dd>
                    </div>
                  ) : null}
                  {status !== 'cancelled' ? (
                    <div>
                      <dt>Okra map</dt>
                      <dd>
                        {status === 'open' && !request.mapPin ? describePlannedPin(request) : describeCurrentPin(request)}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                <div className="admin-request-card__actions">{renderActions(request)}</div>
                {editingAddressId === request.id ? (
                  <PinAddressForm
                    initial={request.pinAddress ?? null}
                    busy={busyId === request.id}
                    onSave={(address) => void handleSavePinAddress(request, address)}
                    onClear={() => void handleClearPinAddress(request)}
                    onCancel={() => setEditingAddressId(null)}
                  />
                ) : null}
              </Card>
            ))}
          </div>

          {pageCount > 1 ? (
            <nav className="admin-pagination" aria-label="Seed request pages">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="admin-pagination__status" aria-live="polite">
                Page {page} of {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount || loading}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                Next
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}
