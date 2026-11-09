import { useState, type FormEvent } from 'react';
import { Button, Input } from '@olivias/ui';
import type { SeedRequestAddress } from '../api';

export interface PinAddressFormProps {
  /** The address already saved on the request, if any. */
  initial: SeedRequestAddress | null;
  busy: boolean;
  onSave: (address: SeedRequestAddress) => void;
  onClear: () => void;
  onCancel: () => void;
}

/**
 * Where an in-person exchange happened. Only city and region ever reach the
 * public map (at an obscured spot); the rest stays on the request for reference.
 */
export function PinAddressForm({ initial, busy, onSave, onClear, onCancel }: PinAddressFormProps) {
  const [line1, setLine1] = useState(initial?.line1 ?? '');
  const [line2, setLine2] = useState(initial?.line2 ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [region, setRegion] = useState(initial?.region ?? '');
  const [postalCode, setPostalCode] = useState(initial?.postalCode ?? '');
  const [country, setCountry] = useState(initial?.country ?? 'US');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!city.trim()) {
      setError('Enter a city.');
      return;
    }
    if (!/^[A-Za-z]{2}$/.test(country.trim())) {
      setError('Enter a two-letter country code, like US or CA.');
      return;
    }
    setError(null);
    onSave({
      ...(line1.trim() ? { line1: line1.trim() } : {}),
      ...(line2.trim() ? { line2: line2.trim() } : {}),
      city: city.trim(),
      ...(region.trim() ? { region: region.trim() } : {}),
      ...(postalCode.trim() ? { postalCode: postalCode.trim() } : {}),
      country: country.trim().toUpperCase(),
    });
  };

  return (
    <form className="admin-pin-address" onSubmit={submit} aria-label="Map address">
      <p className="admin-pin-address__hint">
        The pin shows only the city and state, at an approximate spot, with no name. The full address stays private
        here.
      </p>
      <div className="admin-pin-address__grid">
        <Input label="Street" value={line1} onChange={(e) => setLine1(e.target.value)} autoComplete="off" />
        <Input label="Apt / unit" value={line2} onChange={(e) => setLine2(e.target.value)} autoComplete="off" />
        <Input label="City" value={city} onChange={(e) => setCity(e.target.value)} required autoComplete="off" />
        <Input label="State / province" value={region} onChange={(e) => setRegion(e.target.value)} autoComplete="off" />
        <Input label="Postal code" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} autoComplete="off" />
        <Input
          label="Country code"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          maxLength={2}
          required
          autoComplete="off"
        />
      </div>
      {error ? <p className="admin-pin-address__error" role="alert">{error}</p> : null}
      <div className="admin-request-card__actions">
        <Button type="submit" size="sm" loading={busy} disabled={busy}>
          Save map address
        </Button>
        {initial ? (
          <Button type="button" variant="outline" size="sm" onClick={onClear} disabled={busy}>
            Clear address
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
