import type { SVGProps } from 'react';

export type GardenIconName = 'seeds' | 'tools' | 'map' | 'basket' | 'journal' | 'bed';

/** Small garden illustrations. Pair with a visible label; these are decorative. */
export function GardenIcon({ name, className = '', ...props }: SVGProps<SVGSVGElement> & { name: GardenIconName }) {
  return (
    <svg {...props} className={`og-garden-icon ${className}`.trim()} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="29" fill="var(--og-icon-wash, #edf1e5)" stroke="none" />
      {name === 'seeds' ? <>
        <path d="M17 16h30v36H17z" fill="#fffaf1" />
        <path d="m17 16 15 10 15-10M32 44V32m0 7c-8 0-11-4-11-9 7 0 11 3 11 9Zm0-4c0-6 4-9 10-9 0 6-4 9-10 9Z" />
        <path d="M24 48h16" stroke="#b68a35" />
      </> : null}
      {name === 'tools' ? <>
        <path d="m22 14 7 7-6 6-7-7a5 5 0 0 1 6-6Z" fill="#fffaf1" />
        <path d="m26 24 16 16m-5 5 5-5 9 12c-6 2-13-1-14-7Z" fill="#d5b66e" />
        <path d="m44 15-7 11m4-13 7 4m-11 9-7 10-5-3 7-10m-8 11-9 15" />
        <path d="M12 52h12m23-26 3-4" stroke="#b68a35" />
      </> : null}
      {name === 'map' ? <>
        <path d="m11 27 13-4 16 5 13-4v26l-13 4-16-5-13 4V27Z" fill="#fffaf1" />
        <path d="M24 35v14m16-11v16" stroke="#b68a35" />
        <path d="M42 21c0 7-10 16-10 16s-10-9-10-16a10 10 0 0 1 20 0Z" fill="#edf1e5" />
        <circle cx="32" cy="21" r="3" fill="#b68a35" stroke="none" />
      </> : null}
      {name === 'basket' ? <>
        <path d="M20 31c-7-12-3-17 1-15 4-2 8 3 4 15m8-2c-6-10-3-17 2-16 6 4 8 10 5 17" fill="#fffaf1" />
        <path d="M40 29c0-8 5-12 10-10-1 7-4 11-10 10Z" fill="#d5b66e" />
        <path d="m13 32 5 20h28l5-20H13Z" fill="#fffaf1" />
        <path d="M11 32h42M20 39h24m-22 7h20m-16-7 1 13m10-13-1 13M20 31l12-8 12 8" />
      </> : null}
      {name === 'journal' ? <>
        <path d="M18 13h29v40H18a4 4 0 0 1-4-4V17a4 4 0 0 1 4-4Z" fill="#fffaf1" />
        <path d="M22 13v40m-11-31h7m-7 10h7m-7 10h7M30 44h10" stroke="#b68a35" />
        <path d="M32 37c-4-8-1-14 9-16 1 9-3 14-9 16Zm0 0 6-10" />
      </> : null}
      {name === 'bed' ? <>
        <path d="m10 34 22-11 22 11-22 13-22-13Zm0 0v9l22 12 22-12v-9M32 47v8" fill="#fffaf1" />
        <path d="M24 33V23m0 4c-6 0-8-3-8-7 5 0 8 2 8 7Zm0-4c0-5 3-7 8-7 0 5-3 7-8 7Zm17 11v-8m0 4c-5 0-7-2-7-6 4 0 7 2 7 6Z" />
        <path d="m19 39 9 5m10-3 8-5" stroke="#b68a35" />
      </> : null}
    </svg>
  );
}
