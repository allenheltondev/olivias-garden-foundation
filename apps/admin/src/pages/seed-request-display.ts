import type { SeedRequestQueueItem } from '../api';

export function firstName(name: string | null): string {
  return name?.trim().split(/\s+/)[0] || 'this grower';
}

/** Whether this request can have a pin on the map (any mailed request). */
export function wantsMapPin(request: SeedRequestQueueItem): boolean {
  return request.fulfillmentMethod === 'mail' && Boolean(request.shippingAddress);
}

/** Whether a done request is eligible for "Add to map" (mailed, no pin yet). */
export function canAddToMap(request: SeedRequestQueueItem): boolean {
  return request.requestStatus === 'handled' && wantsMapPin(request) && request.mapPin === null;
}

/** How the person appears on their pin: first name if they opted in, else anonymous. */
function pinIdentity(request: SeedRequestQueueItem): string {
  return request.showOnMap === true ? firstName(request.name) : 'an anonymous pin';
}

export function describePlannedPin(request: SeedRequestQueueItem): string {
  if (!wantsMapPin(request)) {
    return 'No map pin for in-person exchanges.';
  }
  const { city, region } = request.shippingAddress!;
  const where = [city, region].filter(Boolean).join(', ') || 'their city';
  return `Will show as ${pinIdentity(request)} in ${where}. No street address or last name.`;
}

export function describeCurrentPin(request: SeedRequestQueueItem): string {
  if (request.mapPin === undefined) return 'Couldn\u2019t check the map pin right now.';
  if (request.mapPin === null) {
    return wantsMapPin(request) ? 'Not on the map.' : 'No map pin for in-person exchanges.';
  }
  const where = request.mapPin.locality ?? 'their city';
  return `On the map as ${pinIdentity(request)} in ${where}.`;
}
