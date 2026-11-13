import { useEffect, useState } from 'react';
import type { SeedRequestQueueItem } from '../api';
import { lookupHardinessZone, okraPlantingWindow, usZipFromAddress } from '../services/planting';

/**
 * Hardiness zone and okra planting window rows for a mailed request's
 * <dl>, matching the Slack notification. Renders nothing for in-person or
 * non-US requests, or when the zone can't be found.
 */
export function GrowingConditions({ request }: { request: SeedRequestQueueItem }) {
  const zip = request.fulfillmentMethod === 'mail' ? usZipFromAddress(request.shippingAddress) : null;
  const [result, setResult] = useState<{ zip: string; zone: string | null } | null>(null);

  useEffect(() => {
    if (!zip) return;
    let active = true;
    void lookupHardinessZone(zip).then((zone) => {
      if (active) setResult({ zip, zone });
    });
    return () => {
      active = false;
    };
  }, [zip]);

  const zone = result && result.zip === zip ? result.zone : null;
  if (!zone) return null;
  const window = okraPlantingWindow(zone);

  return (
    <>
      <div>
        <dt>Hardiness zone</dt>
        <dd>{zone}</dd>
      </div>
      {window ? (
        <div>
          <dt>Growing window</dt>
          <dd>Clemson Spineless okra planting: {window}</dd>
        </div>
      ) : null}
    </>
  );
}
