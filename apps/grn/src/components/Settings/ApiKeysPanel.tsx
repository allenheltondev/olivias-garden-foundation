import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@olivias/ui';
import {
  createApiKey,
  deleteApiKey,
  listApiKeys,
  renameApiKey,
  type CreatedApiKey,
} from '../../services/api';

/** Live keys a grower may hold at once; the API refuses a sixth with 409. */
export const MAX_API_KEYS = 5;

function formatTimestamp(value: string | null): string {
  if (!value) return 'never';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'never' : parsed.toLocaleString();
}

export function ApiKeysPanel() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const keysQuery = useQuery({
    queryKey: ['api-keys'],
    queryFn: listApiKeys,
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: (keyName: string) => createApiKey(keyName),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      setCreatedKey(created);
      setCopied(false);
      setName('');
      setFormError(null);
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : 'Failed to create API key');
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, newName }: { id: string; newName: string }) => renameApiKey(id, newName),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      setEditingId(null);
      setEditingName('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteApiKey(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const keys = keysQuery.data?.items ?? [];
  // Keys are self-serve up to the cap. Until the list has loaded the count is
  // unknown, so the form waits rather than offering a create the API refuses.
  const atKeyCap = keys.length >= MAX_API_KEYS;
  const canCreateKey = keysQuery.isSuccess && !atKeyCap;

  const submitCreate = () => {
    if (!name.trim()) {
      setFormError('Name is required.');
      return;
    }
    createMutation.mutate(name.trim());
  };

  const copySecret = async () => {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey.key);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const startEditing = (id: string, currentName: string) => {
    setEditingId(id);
    setEditingName(currentName);
  };

  const saveEditing = () => {
    if (!editingId || !editingName.trim()) return;
    renameMutation.mutate({ id: editingId, newName: editingName.trim() });
  };

  const revoke = (id: string) => {
    if (typeof window !== 'undefined' && !window.confirm('Revoke this API key? Apps using it will stop working.')) {
      return;
    }
    deleteMutation.mutate(id);
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Your keys</h3>
        <p className="text-sm text-gray-600 mt-1">
          A key acts as you, so treat it like a password. Use it in your own scripts as{' '}
          <code>Authorization: Bearer &lt;key&gt;</code>, or give it to an AI assistant (see
          below). You can have up to {MAX_API_KEYS} keys; revoke one you no longer use to make
          room.
        </p>
      </div>

      {createdKey ? (
        <div
          className="rounded-md border border-emerald-300 bg-emerald-50 p-4 space-y-2"
          role="status"
        >
          <p className="text-sm font-semibold text-emerald-900">
            Copy your new key now — you won&apos;t be able to see it again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-white px-3 py-2 text-sm text-gray-900 border border-emerald-200">
              {createdKey.key}
            </code>
            <Button variant="secondary" onClick={copySecret}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <Button variant="secondary" onClick={() => setCreatedKey(null)}>
            Done
          </Button>
        </div>
      ) : null}

      {canCreateKey ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Key name</span>
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="My laptop script"
              maxLength={100}
            />
          </label>
          <Button onClick={submitCreate} disabled={createMutation.isPending} variant="primary">
            {createMutation.isPending ? 'Creating...' : 'Create key'}
          </Button>
        </div>
      ) : null}

      {keysQuery.isSuccess && atKeyCap ? (
        <p className="text-sm text-gray-700" role="status">
          You have {MAX_API_KEYS} keys, the most you can hold. Revoke one to create another.
        </p>
      ) : null}

      {formError ? <p className="text-sm text-red-600">{formError}</p> : null}

      <div className="border-t pt-4">
        <h4 className="text-sm font-semibold text-gray-900 mb-2">Your keys</h4>

        {keysQuery.isLoading ? <p className="text-sm text-gray-600">Loading keys...</p> : null}

        {keysQuery.isError ? (
          <p className="text-sm text-red-600">Could not load your API keys right now.</p>
        ) : null}

        {!keysQuery.isLoading && !keysQuery.isError && keys.length === 0 ? (
          <p className="text-sm text-gray-600">No API keys yet. Create one above.</p>
        ) : null}

        <ul className="space-y-2">
          {keys.map((key) => (
            <li
              key={key.id}
              className="rounded-md border border-gray-200 px-3 py-2 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                {editingId === key.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      aria-label="New key name"
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      maxLength={100}
                    />
                    <Button
                      variant="primary"
                      onClick={saveEditing}
                      disabled={renameMutation.isPending || !editingName.trim()}
                    >
                      Save
                    </Button>
                    <Button variant="secondary" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-medium text-gray-900 truncate">{key.name}</p>
                    <p className="text-xs text-gray-600">
                      <code>{key.keyPrefix}…</code> • last used {formatTimestamp(key.lastUsedAt)}
                    </p>
                  </>
                )}
              </div>

              {editingId === key.id ? null : (
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="secondary" onClick={() => startEditing(key.id, key.name)}>
                    Rename
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => revoke(key.id)}
                    disabled={deleteMutation.isPending}
                  >
                    Revoke
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default ApiKeysPanel;
