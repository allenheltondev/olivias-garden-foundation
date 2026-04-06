import type { GardeningTip } from '../../types/tips';

interface TipsModuleProps {
  tips?: GardeningTip[];
  experienceLevel?: string;
}

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function TipsModule({ tips = [], experienceLevel }: TipsModuleProps) {
  if (!tips.length) {
    return null;
  }

  return (
    <section className="bg-white rounded-lg shadow-md p-4" aria-label="Personalized gardening tips">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-900">Recommended tips</h2>
        {experienceLevel ? (
          <span className="text-xs font-medium bg-emerald-50 text-emerald-800 rounded-full px-2 py-1">
            {toTitleCase(experienceLevel)}
          </span>
        ) : null}
      </div>

      <ul className="space-y-3">
        {tips.slice(0, 3).map((tip) => (
          <li key={tip.id} className="rounded-md border border-gray-200 p-3">
            <p className="text-sm font-medium text-gray-900">{tip.title}</p>
            <p className="mt-1 text-sm text-gray-700">{tip.body}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-600">
              <span className="rounded-full bg-gray-100 px-2 py-0.5">Why this tip: {tip.level}</span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5">{tip.season}</span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5">{tip.category}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default TipsModule;
