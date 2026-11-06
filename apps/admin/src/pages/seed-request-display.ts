import type { SeedRequestQueueItem } from '../api';

export function firstName(name: string | null): string {
  return name?.trim().split(/\s+/)[0] || 'this grower';
}

/** Whether marking this request done should try to put a pin on the map. */
export function wantsMapPin(request: SeedRequestQueueItem): boolean {
  return request.fulfillmentMethod === 'mail' && Boolean(request.shippingAddress) && request.showOnMap === true;
}

export function describePlannedPin(request: SeedRequestQueueItem): string {
  if (request.fulfillmentMethod !== 'mail' || !request.shippingAddress) {
    return 'No map pin for in-person exchanges.';
  }
  if (request.showOnMap !== true) {
    return 'They didn\u2019t opt in, so no map pin.';
  }
  const { city, region } = request.shippingAddress;
  const where = [city, region].filter(Boolean).join(', ') || 'their city';
  return `Will show as ${firstName(request.name)} in ${where}. No street address or last name.`;
}

export function describeCurrentPin(request: SeedRequestQueueItem): string {
  if (request.mapPin === undefined) return 'Couldn’t check the map pin right now.';
  if (request.mapPin === null) {
    if (request.fulfillmentMethod !== 'mail') return 'No map pin for in-person exchanges.';
    return request.showOnMap === true ? 'Not on the map.' : 'They didn\u2019t opt in, so no map pin.';
  }
  const where = request.mapPin.locality ?? 'their city';
  return `On the map as ${firstName(request.name)} in ${where}.`;
}
