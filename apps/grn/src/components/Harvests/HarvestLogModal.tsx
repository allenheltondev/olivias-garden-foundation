import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@olivias/ui';
import { completeTodayAction } from '../../utils/todayActionTracking';
import { CropArtwork } from '../branding/GardenArt';
import { visualForCrop } from '../CropPlanner/cropVisuals';
import {
  deleteHarvest,
  listHarvests,
  recordHarvest,
  updateHarvest,
  type HarvestItem,
} from '../../services/api';

interface HarvestLogModalProps {
  cropId: string;
  cropName: string;
  defaultUnit?: string | null;
  onClose: () => void;
  onShareHarvest?: (harvest: HarvestItem) => void;
  highlightedHarvestId?: string | null;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? iso
    : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

interface EditState {
  amount: string;
  unit: string;
  harvestedOn: string;
  notes: string;
}

export function HarvestLogModal({
  cropId,
  cropName,
  defaultUnit,
  onClose,
  onShareHarvest,
  highlightedHarvestId,
}: HarvestLogModalProps) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState(defaultUnit ?? '');
  const [harvestedOn, setHarvestedOn] = useState(todayIsoDate());
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [savedHarvest, setSavedHarvest] = useState<HarvestItem | null>(null);

  // Close on Escape, matching the app's other dialogs.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const logQuery = useQuery({
    queryKey: ['harvests', cropId],
    queryFn: () => listHarvests(cropId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['harvests', cropId] });
    // Crop detail reads expose totals; keep them fresh too.
    void queryClient.invalidateQueries({ queryKey: ['myCrops'] });
  };

  const recordMutation = useMutation({
    mutationFn: (input: { amount: number; unit?: string; harvestedOn?: string; notes?: string }) =>
      recordHarvest(cropId, input),
    onSuccess: (response) => {
      invalidate();
      completeTodayAction('harvest');
      setSavedHarvest(response.harvest);
      setAmount('');
      setNotes('');
      setHarvestedOn(todayIsoDate());
      setFormError(null);
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : 'Failed to log harvest');
    },
  });

  const updateMutation = useMutation({
    mutationFn: (vars: {
      harvestId: string;
      input: { amount: number; unit?: string; harvestedOn?: string; notes?: string };
    }) => updateHarvest(cropId, vars.harvestId, vars.input),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      setEditState(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (harvestId: string) => deleteHarvest(cropId, harvestId),
    onSuccess: invalidate,
  });

  const submitNew = () => {
    const parsed = Number(amount);
    if (!amount.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      setFormError('Enter an amount greater than 0.');
      return;
    }
    recordMutation.mutate({
      amount: parsed,
      unit: unit.trim() || undefined,
      harvestedOn: harvestedOn || undefined,
      notes: notes.trim() || undefined,
    });
  };

  const startEditing = (harvest: HarvestItem) => {
    setEditingId(harvest.id);
    setEditState({
      amount: harvest.amount,
      unit: harvest.unit ?? '',
      harvestedOn: harvest.harvestedOn,
      notes: harvest.notes ?? '',
    });
  };

  const saveEditing = () => {
    if (!editingId || !editState) return;
    const parsed = Number(editState.amount);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    updateMutation.mutate({
      harvestId: editingId,
      input: {
        amount: parsed,
        unit: editState.unit.trim() || undefined,
        harvestedOn: editState.harvestedOn || undefined,
        notes: editState.notes.trim() || undefined,
      },
    });
  };

  const remove = (harvestId: string) => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this harvest entry?')) return;
    deleteMutation.mutate(harvestId);
  };

  const log = logQuery.data;
  const harvests = log?.harvests ?? [];

  useEffect(() => {
    if (!highlightedHarvestId || harvests.length === 0) return;
    const row = document.getElementById(`harvest-${highlightedHarvestId}`);
    row?.focus();
    row?.scrollIntoView?.({ block: 'center' });
  }, [highlightedHarvestId, harvests.length]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl space-y-4"
        role="dialog"
        aria-modal="true"
        aria-label={`Harvests for ${cropName}`}
        data-testid="harvest-log-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Harvests · {cropName}</h3>
            <p className="text-sm text-gray-600 mt-1" data-testid="harvest-total">
              {log
                ? `${log.totalHarvested}${unit ? ` ${unit}` : ''} brought in across ${log.harvestCount} ${
                    log.harvestCount === 1 ? 'harvest' : 'harvests'
                  }`
                : 'Loading total…'}
            </p>
          </div>
          <button
            type="button"
            className="text-gray-500 hover:text-gray-800 text-xl leading-none"
            onClick={onClose}
            aria-label="Close harvests"
          >
            ×
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Amount</span>
            <input
              type="number"
              min={0}
              step="any"
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="3.5"
            />
          </label>
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Unit</span>
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              placeholder="lb"
            />
          </label>
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Date</span>
            <input
              type="date"
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={harvestedOn}
              onChange={(event) => setHarvestedOn(event.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Notes</span>
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="First picking"
            />
          </label>
        </div>

        {formError ? <p className="text-sm text-red-600">{formError}</p> : null}

        <Button onClick={submitNew} disabled={recordMutation.isPending} variant="primary">
          {recordMutation.isPending ? 'Logging...' : 'Log harvest'}
        </Button>

        {savedHarvest && onShareHarvest ? (
          <div className="rounded-base border border-primary-200 bg-primary-50 px-4 py-3" role="status">
            <span className="grn-harvest-saved-art" aria-hidden="true">
              <CropArtwork iconKey={visualForCrop(cropName, null).iconKey} size={48} />
            </span>
            <p className="font-medium text-primary-900">Harvest saved.</p>
            <p className="mt-1 text-sm text-primary-900">
              {savedHarvest.amount}{savedHarvest.unit ? ` ${savedHarvest.unit}` : ''} of {cropName} added to your garden story.
            </p>
            <p className="mt-1 text-sm text-primary-800">
              Have extra? Choose how much to offer. You can review everything before sharing.
            </p>
            <Button
              className="mt-3"
              variant="secondary"
              onClick={() => onShareHarvest(savedHarvest)}
            >
              Share some food
            </Button>
            <Button className="mt-3" variant="ghost" onClick={() => setSavedHarvest(null)}>
              Keep for my household
            </Button>
          </div>
        ) : null}

        <div className="border-t pt-4">
          {logQuery.isLoading ? <p className="text-sm text-gray-600">Loading harvests...</p> : null}
          {logQuery.isError ? (
            <p className="text-sm text-red-600">Could not load harvests right now.</p>
          ) : null}
          {!logQuery.isLoading && !logQuery.isError && harvests.length === 0 ? (
            <p className="text-sm text-gray-600">No harvests logged yet.</p>
          ) : null}

          <ul className="space-y-2">
            {harvests.map((harvest) => (
              <li
                key={harvest.id}
                id={`harvest-${harvest.id}`}
                tabIndex={-1}
                aria-current={highlightedHarvestId === harvest.id ? 'true' : undefined}
                className={`rounded-md border px-3 py-2 ${
                  highlightedHarvestId === harvest.id
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-gray-200'
                }`}
              >
                {editingId === harvest.id && editState ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      aria-label="Edit amount"
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                      value={editState.amount}
                      onChange={(event) =>
                        setEditState({ ...editState, amount: event.target.value })
                      }
                    />
                    <input
                      aria-label="Edit unit"
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                      value={editState.unit}
                      onChange={(event) => setEditState({ ...editState, unit: event.target.value })}
                    />
                    <input
                      type="date"
                      aria-label="Edit date"
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                      value={editState.harvestedOn}
                      onChange={(event) =>
                        setEditState({ ...editState, harvestedOn: event.target.value })
                      }
                    />
                    <input
                      aria-label="Edit notes"
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                      value={editState.notes}
                      onChange={(event) => setEditState({ ...editState, notes: event.target.value })}
                    />
                    <div className="flex gap-2 sm:col-span-2">
                      <Button
                        variant="primary"
                        onClick={saveEditing}
                        disabled={updateMutation.isPending}
                      >
                        Save
                      </Button>
                      <Button variant="secondary" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">
                        {harvest.amount}
                        {harvest.unit ? ` ${harvest.unit}` : ''} · {formatDate(harvest.harvestedOn)}
                      </p>
                      {harvest.notes ? (
                        <p className="text-xs text-gray-600 truncate">{harvest.notes}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
                      {onShareHarvest ? (
                        <Button variant="secondary" onClick={() => onShareHarvest(harvest)}>
                          Share food
                        </Button>
                      ) : null}
                      <Button variant="secondary" onClick={() => startEditing(harvest)}>
                        Edit
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => remove(harvest.id)}
                        disabled={deleteMutation.isPending}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default HarvestLogModal;
