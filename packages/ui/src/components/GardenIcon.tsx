import type { SVGProps } from 'react';

export type GardenIconName = 'seeds' | 'tools' | 'map' | 'basket' | 'journal' | 'bed';

/** Decorative garden symbols: a shared grid, quiet accent, and generous clear space. */
export function GardenIcon({ name, className = '', ...props }: Omit<SVGProps<SVGSVGElement>, 'ref'> & { name: GardenIconName }) {
  return (
    <svg {...props} className={`og-garden-icon ${className}`.trim()} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="29" fill="var(--og-icon-wash, #edf1e5)" stroke="none" />
      {name === 'seeds' ? <>
        <rect x="18" y="14" width="28" height="38" rx="3" fill="#fffaf1" />
        <path d="M18 22h28M32 43V32m0 5c-5 0-8-3-8-7 5 0 8 3 8 7Zm0-4c0-5 3-8 8-8 0 5-3 8-8 8Z" />
        <path d="M27 47h10" stroke="#b68a35" />
      </> : null}
      {name === 'tools' ? <>
        <rect x="19" y="14" width="8" height="12" rx="4" fill="#fffaf1" />
        <path d="M23 26v12m-6 0h12v5a6 6 0 0 1-12 0v-5Z" fill="#fffaf1" />
        <rect x="37" y="38" width="8" height="14" rx="4" fill="#fffaf1" />
        <path d="M41 38V26m-6-12v9a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-9m-6 0v12" />
        <path d="M20 42h6m12 0h6" stroke="#b68a35" />
      </> : null}
      {name === 'map' ? <>
        <path d="m14 27 12-4 12 4 12-4v26l-12 4-12-4-12 4V27Z" fill="#fffaf1" />
        <path d="M26 38v11m12-7v11" stroke="#b68a35" />
        <path d="M41 22c0 7-9 15-9 15s-9-8-9-15a9 9 0 0 1 18 0Z" fill="#fffaf1" />
        <circle cx="32" cy="22" r="3" fill="#b68a35" stroke="none" />
      </> : null}
      {name === 'basket' ? <>
        <path d="M22 32v-7a10 10 0 0 1 20 0v7" />
        <path d="m16 32 4 17a4 4 0 0 0 4 3h16a4 4 0 0 0 4-3l4-17" fill="#fffaf1" />
        <rect x="14" y="28" width="36" height="6" rx="3" fill="#fffaf1" />
        <path d="M25 40v6m7-6v6m7-6v6" stroke="#b68a35" />
      </> : null}
      {name === 'journal' ? <>
        <rect x="18" y="14" width="28" height="38" rx="3" fill="#fffaf1" />
        <path d="M24 14v38M15 23h6m-6 10h6m-6 10h6" />
        <path d="M32 38c-3-7 0-12 8-14 0 8-3 12-8 14Zm0 0 5-8" />
        <path d="M31 46h9" stroke="#b68a35" />
      </> : null}
      {name === 'bed' ? <>
        <path d="M24 36V24m0 5c-5 0-8-3-8-7 5 0 8 3 8 7Zm0-5c0-5 3-8 8-8 0 5-3 8-8 8Zm17 12v-7m0 3c-4 0-6-2-6-6 4 0 6 2 6 6Zm0-5c0-4 2-6 6-6 0 4-2 6-6 6Z" />
        <rect x="14" y="36" width="36" height="14" rx="2" fill="#fffaf1" />
        <path d="M19 50v3m26-3v3M14 41h36" />
        <path d="M20 46h5m14 0h5" stroke="#b68a35" />
      </> : null}
    </svg>
  );
}
