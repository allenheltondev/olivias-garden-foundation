import type { SeedRequestQueueItem } from '../api';

export function firstName(name: string | null): string {
  return name?.trim().split(/\s+/)[0] || 'this grower';
}

export function describePlannedPin(request: SeedRequestQueueItem): string {
  if (request.fulfillmentMethod !== 'mail' || !request.shippingAddress) {
    return 'No map pin for in-person exchanges.';
  }
  const { city, region } = request.shippingAddress;
  const where = [city, region].filter(Boolean).join(', ') || 'their city';
  return `Will show as ${firstName(request.name)} in ${where}. No street address or last name.`;
}

export function describeCurrentPin(request: SeedRequestQueueItem): string {
  if (request.mapPin === undefined) return 'Couldn’t check the map pin right now.';
  if (request.mapPin === null) {
    return request.fulfillmentMethod === 'mail' ? 'Not on the map.' : 'No map pin for in-person exchanges.';
  }
  const where = request.mapPin.locality ?? 'their city';
  return `On the map as ${firstName(request.name)} in ${where}.`;
}
