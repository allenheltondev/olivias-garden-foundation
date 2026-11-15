// Types for hardiness-zones.mjs.
import type { ZoneLookupRow } from './guide-core.mjs';

export const PHZMAPI_URL: string;
export const HARDINESS_ZONE_SOURCE: { name: string; url: string; mapName: string; accessed: string };

export type PostalInput = { kind: 'zip'; zip: string } | { kind: 'canada' } | { kind: 'invalid' };
export function parsePostalInput(input: string): PostalInput;
export function zoneNumber(zone: string): number | undefined;
export function zoneLookupUrl(zip: string): string;

export type ZoneLookupResult =
  | { status: 'found'; zip: string; zone: string; zoneNumber: number }
  | { status: 'not-found'; zip: string };
export function createZoneLookup(fetchImpl?: typeof fetch, options?: { timeoutMs?: number }): (zip: string) => Promise<ZoneLookupResult>;

export function findZoneRow(block: { rows: ZoneLookupRow[] }, zoneNumber: number): ZoneLookupRow | undefined;
