import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ZONE_LOOKUP_HEADERS, zoneRowLabel, type ZoneLookupBlock } from './guide-core.mjs';
import {
  createZoneLookup,
  findZoneRow,
  HARDINESS_ZONE_SOURCE,
  PHZMAPI_URL,
  parsePostalInput,
} from './hardiness-zones.mjs';

type LookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; zip: string; zone: string; zoneNumber: number }
  | { status: 'not-found'; zip: string }
  | { status: 'canada' }
  | { status: 'invalid' }
  | { status: 'error' };

// One lookup (and its per-ZIP cache) for the whole app session.
const lookupZone = createZoneLookup();

function formatAccessDate(isoDate: string) {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function ZoneLookup({ block, renderText }: { block: ZoneLookupBlock; renderText: (text: string) => ReactNode }) {
  const inputId = useId();
  const hintId = useId();
  const [value, setValue] = useState('');
  const [state, setState] = useState<LookupState>({ status: 'idle' });

  const matchedRow = useMemo(
    () => (state.status === 'found' ? findZoneRow(block, state.zoneNumber) : undefined),
    [block, state],
  );

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parsePostalInput(value);
    if (parsed.kind !== 'zip') {
      setState({ status: parsed.kind });
      return;
    }
    setState({ status: 'loading' });
    try {
      setState(await lookupZone(parsed.zip));
    } catch {
      setState({ status: 'error' });
    }
  };

  return (
    <div className="okra-zone-lookup">
      <form className="okra-zone-lookup__form" onSubmit={onSubmit} noValidate>
        <label className="okra-zone-lookup__label" htmlFor={inputId}>Your ZIP code</label>
        <div className="okra-zone-lookup__controls">
          <input
            id={inputId}
            className="okra-zone-lookup__input"
            type="text"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={10}
            placeholder="75070"
            aria-describedby={hintId}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <button type="submit" className="ok-btn ok-btn--ghost" disabled={state.status === 'loading'}>
            {state.status === 'loading' ? 'Looking up...' : 'Find my zone'}
          </button>
        </div>
        <p id={hintId} className="okra-zone-lookup__hint">
          We only use your ZIP code to look up the zone, and we don&apos;t save it.
        </p>
      </form>

      <div className="okra-zone-lookup__result" aria-live="polite">
        {state.status === 'found' && matchedRow ? (
          <div className="okra-zone-lookup__answer">
            <p className="okra-zone-lookup__zone">{state.zip} is in zone {state.zone}.</p>
            <p className="okra-guide__text">When to plant okra: {renderText(matchedRow.plant)}</p>
          </div>
        ) : null}
        {state.status === 'not-found' ? (
          <p className="okra-guide__text">
            We don&apos;t have a zone for {state.zip}. Some ZIP codes, like PO boxes, aren&apos;t in the map data. Try a nearby ZIP code, or use the table below.
          </p>
        ) : null}
        {state.status === 'canada' ? (
          <p className="okra-guide__text">
            This lookup covers US ZIP codes. In Canada, plant okra 2 to 3 weeks after your last spring frost, once the soil is warm, and use the cooler zones below as a guide.
          </p>
        ) : null}
        {state.status === 'invalid' ? (
          <p className="okra-guide__text">Enter a 5-digit US ZIP code, like 75070.</p>
        ) : null}
        {state.status === 'error' ? (
          <p className="okra-guide__text">
            We couldn&apos;t look that up right now. Check your connection and try again, or use the table below.
          </p>
        ) : null}
      </div>

      <div className="okra-guide__table-wrap">
        <table className="okra-guide__table okra-zone-lookup__table">
          {block.caption ? <caption>{block.caption}</caption> : null}
          <thead>
            <tr>
              {ZONE_LOOKUP_HEADERS.map((header) => <th key={header} scope="col">{header}</th>)}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => {
              const current = row === matchedRow;
              return (
                <tr key={row.zones.join('-')} className={current ? 'okra-zone-lookup__row--current' : undefined} aria-current={current ? 'true' : undefined}>
                  <th scope="row">{zoneRowLabel(row.zones)}{current ? <span className="okra-zone-lookup__you"> (your zone)</span> : null}</th>
                  <td>{renderText(row.plant)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="okra-zone-lookup__source">
        Zones from the {HARDINESS_ZONE_SOURCE.mapName} data by the{' '}
        <a href={HARDINESS_ZONE_SOURCE.url} rel="noopener">{HARDINESS_ZONE_SOURCE.name}</a>, accessed {formatAccessDate(HARDINESS_ZONE_SOURCE.accessed)},
        looked up through <a href={PHZMAPI_URL} rel="noopener">phzmapi.org</a>.
        Frost dates vary within a zone, so check your local forecast too.
      </p>
    </div>
  );
}
