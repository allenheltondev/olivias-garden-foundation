import type { SeedRequestAddress, SeedRequestPinVisibility, SeedRequestQueueItem } from '../api';

export function firstName(name: string | null): string {
  return name?.trim().split(/\s+/)[0] || 'this grower';
}

/**
 * The address a pin is placed from: the shipping address for mailed requests,
 * or the admin-set map address for in-person ones.
 */
export function pinAddressOf(request: SeedRequestQueueItem): SeedRequestAddress | null {
  if (request.fulfillmentMethod === 'mail') return request.shippingAddress ?? null;
  if (request.fulfillmentMethod === 'in_person') return request.pinAddress ?? null;
  return null;
}

/** The API's verdict; missing data (or an in-person exchange with no map address) means no pin. */
export function pinVisibilityOf(request: SeedRequestQueueItem): SeedRequestPinVisibility {
  if (!pinAddressOf(request)) return 'none';
  return request.pinVisibility ?? 'none';
}

/** Whether this request may have a pin on the map. */
export function wantsMapPin(request: SeedRequestQueueItem): boolean {
  return pinVisibilityOf(request) !== 'none';
}

/** Whether a done request is eligible for "Add to map" (allowed a pin, none yet). */
export function canAddToMap(request: SeedRequestQueueItem): boolean {
  return request.requestStatus === 'handled' && wantsMapPin(request) && request.mapPin === null;
}

function pinIdentity(request: SeedRequestQueueItem): string {
  return pinVisibilityOf(request) === 'named' ? firstName(request.name) : 'an anonymous pin';
}

function noPinReason(request: SeedRequestQueueItem): string {
  return request.fulfillmentMethod === 'mail'
    ? 'No map pin \u2014 they were told they wouldn\u2019t get one.'
    : 'No map pin. Set a map address to add this exchange to the map.';
}

export function describePlannedPin(request: SeedRequestQueueItem): string {
  if (!wantsMapPin(request)) return noPinReason(request);
  const { city, region } = pinAddressOf(request)!;
  const where = [city, region].filter(Boolean).join(', ') || 'their city';
  return `Will show as ${pinIdentity(request)} in ${where}. No street address or last name.`;
}

export function describeCurrentPin(request: SeedRequestQueueItem): string {
  if (request.mapPin === undefined) return 'Couldn\u2019t check the map pin right now.';
  if (request.mapPin === null) {
    return wantsMapPin(request) ? 'Not on the map.' : noPinReason(request);
  }
  const where = request.mapPin.locality ?? 'their city';
  return `On the map as ${pinIdentity(request)} in ${where}.`;
}

/** One-line, human form of an address: "12 Oak St, Apt 2 · Austin TX 78701 · US". */
export function formatPinAddress(address: SeedRequestAddress): string {
  const street = [address.line1, address.line2].filter(Boolean).join(', ');
  const locality = [address.city, address.region, address.postalCode].filter(Boolean).join(' ');
  return [street, locality, address.country].filter(Boolean).join(' · ');
}
