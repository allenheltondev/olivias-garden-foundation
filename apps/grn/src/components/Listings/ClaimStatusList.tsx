import type { Claim, ClaimStatus } from '../../types/claim';
import { Button } from '../ui/Button';

interface ClaimStatusListProps {
  title: string;
  description: string;
  claims: Claim[];
  pendingClaimIds: ReadonlySet<string>;
  successMessage: string | null;
  errorMessage: string | null;
  emptyMessage: string;
  getActions: (claim: Claim) => ClaimStatus[];
  onTransition: (claimId: string, status: ClaimStatus) => Promise<void>;
}

const actionLabels: Record<ClaimStatus, string> = {
  pending: 'Set Pending',
  confirmed: 'Confirm',
  completed: 'Complete',
  cancelled: 'Cancel',
  no_show: 'No Show',
};

function formatStatus(status: ClaimStatus): string {
  return status.replace('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function ClaimStatusList({
  title,
  description,
  claims,
  pendingClaimIds,
  successMessage,
  errorMessage,
  emptyMessage,
  getActions,
  onTransition,
}: ClaimStatusListProps) {
  return (
    <div className="rounded-base border border-neutral-200 bg-white px-4 py-4 space-y-3">
      <div className="space-y-1">
        <h4 className="text-base font-semibold text-neutral-900">{title}</h4>
        <p className="text-sm text-neutral-600">{description}</p>
      </div>

      {successMessage && (
        <p className="rounded-base border border-success bg-primary-50 px-3 py-2 text-sm text-primary-800" role="status">
          {successMessage}
        </p>
      )}

      {errorMessage && (
        <p className="rounded-base border border-error bg-red-50 px-3 py-2 text-sm text-error" role="alert">
          {errorMessage}
        </p>
      )}

      {claims.length === 0 && <p className="text-sm text-neutral-600">{emptyMessage}</p>}

      {claims.map((claim) => {
        const actions = getActions(claim);

        return (
          <div key={claim.id} className="rounded-base border border-neutral-200 bg-neutral-50 px-3 py-3">
            <div className="space-y-2">
              <p className="text-sm text-neutral-800">
                Claim <span className="font-medium">{claim.id}</span>
              </p>
              <p className="text-sm text-neutral-700">
                Status: <span className="font-medium">{formatStatus(claim.status)}</span>
              </p>
              <p className="text-sm text-neutral-700">
                Quantity: {claim.quantityClaimed}
              </p>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {actions.map((status) => (
                <Button
                  key={`${claim.id}:${status}`}
                  size="sm"
                  variant="outline"
                  disabled={pendingClaimIds.has(claim.id)}
                  onClick={() => onTransition(claim.id, status)}
                >
                  {actionLabels[status]}
                </Button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
