import { useMemo, useState } from 'react';
import type { GardeningTip } from '../../types/tips';

interface TipsModuleProps {
  tips?: GardeningTip[];
  experienceLevel?: string;
}

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function TipsModule({ tips = [], experienceLevel }: TipsModuleProps) {
  const [dismissedTipIds, setDismissedTipIds] = useState<string[]>([]);
  const [savedTipIds, setSavedTipIds] = useState<string[]>([]);

  const visibleTips = useMemo(
    () => tips.filter((tip) => !dismissedTipIds.includes(tip.id)).slice(0, 3),
    [dismissedTipIds, tips]
  );

  if (!tips.length) {
    return null;
  }

  const dismissTip = (tipId: string) => {
    setDismissedTipIds((current) => (current.includes(tipId) ? current : [...current, tipId]));
  };

  const toggleSaveTip = (tipId: string) => {
    setSavedTipIds((current) =>
      current.includes(tipId) ? current.filter((id) => id !== tipId) : [...current, tipId]
    );
  };

  return (
    <section className="bg-white rounded-lg shadow-md p-4" aria-label="Personalized gardening tips">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h2 className="text-base font-semibold text-gray-900">Recommended tips</h2>
        <div className="flex items-center gap-2">
          {savedTipIds.length > 0 ? (
            <span className="text-xs font-medium bg-amber-50 text-amber-800 rounded-full px-2 py-1">
              Saved: {savedTipIds.length}
            </span>
          ) : null}
          {experienceLevel ? (
            <span className="text-xs font-medium bg-emerald-50 text-emerald-800 rounded-full px-2 py-1">
              {toTitleCase(experienceLevel)}
            </span>
          ) : null}
        </div>
      </div>

      {visibleTips.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 p-3 text-sm text-gray-600">
          <p>All current tips dismissed.</p>
          <button
            type="button"
            onClick={() => setDismissedTipIds([])}
            className="mt-2 text-xs rounded border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-50"
          >
            Restore tips
          </button>
        </div>
      ) : (
        <ul className="space-y-3">
          {visibleTips.map((tip) => {
            const isSaved = savedTipIds.includes(tip.id);

            return (
              <li key={tip.id} className="rounded-md border border-gray-200 p-3">
                <p className="text-sm font-medium text-gray-900">{tip.title}</p>
                <p className="mt-1 text-sm text-gray-700">{tip.body}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-600">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5">Why this tip: {tip.level}</span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5">{tip.season}</span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5">{tip.category}</span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleSaveTip(tip.id)}
                    className="text-xs rounded border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-50"
                    aria-pressed={isSaved}
                    aria-label={isSaved ? `Unsave tip: ${tip.title}` : `Save tip: ${tip.title}`}
                  >
                    {isSaved ? 'Saved' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => dismissTip(tip.id)}
                    className="text-xs rounded border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-50"
                    aria-label={`Dismiss tip: ${tip.title}`}
                  >
                    Dismiss
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default TipsModule;
