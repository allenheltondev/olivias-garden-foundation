import type { PinData } from './PinLayer';

const MONTH_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "2026-10" → "October 2026". Returns null for anything unparseable. */
export function formatSentMonth(sentMonth: string | null | undefined): string | null {
  if (!sentMonth || !/^\d{4}-\d{2}$/.test(sentMonth)) return null;
  const [year, month] = sentMonth.split('-').map(Number);
  if (month < 1 || month > 12) return null;
  return MONTH_FORMATTER.format(new Date(Date.UTC(year, month - 1, 1)));
}

/** Headline for a seeds-sent pin, e.g. "Seeds sent to Jane". */
export function getSeedPinTitle(pin: PinData): string {
  const name = pin.contributor_name?.trim();
  return name ? `Seeds sent to ${name}` : 'Seeds sent here';
}

export interface SeedPinDetailsProps {
  pin: PinData;
  /** BEM block prefix so the popup and bottom sheet keep their own styles */
  classPrefix: 'pin-popup' | 'bottom-sheet';
}

/** Seed packet illustration shown in place of a garden photo */
export function SeedPacketArt({ classPrefix }: { classPrefix: SeedPinDetailsProps['classPrefix'] }) {
  return (
    <div className={`${classPrefix}-placeholder ${classPrefix}-placeholder--seeds`} aria-hidden="true">
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="18" y="10" width="28" height="40" rx="3" fill="currentColor" opacity="0.18" />
        <path d="M18 18h28" stroke="currentColor" strokeWidth="2" opacity="0.6" />
        <ellipse cx="27" cy="30" rx="2.5" ry="4" fill="currentColor" opacity="0.7" />
        <ellipse cx="37" cy="34" rx="2.5" ry="4" fill="currentColor" opacity="0.7" />
        <ellipse cx="30" cy="41" rx="2.5" ry="4" fill="currentColor" opacity="0.7" />
      </svg>
    </div>
  );
}

/**
 * Body copy for a pin marking somewhere we've mailed okra seeds. Only the
 * first name and city/region ever reach the client for these pins.
 */
export function SeedPinDetails({ pin, classPrefix }: SeedPinDetailsProps) {
  const sentLabel = formatSentMonth(pin.sent_month);
  return (
    <div className={`${classPrefix}-body`}>
      <p className={`${classPrefix}-contributor`}>{getSeedPinTitle(pin)}</p>
      {pin.locality ? <p className={`${classPrefix}-locality`}>{pin.locality}</p> : null}
      <p className={`${classPrefix}-story`}>
        {sentLabel ? `Okra seeds went out in ${sentLabel}.` : 'Okra seeds are on their way.'}{' '}
        Hopefully there&rsquo;s a patch growing here soon.
      </p>
    </div>
  );
}
