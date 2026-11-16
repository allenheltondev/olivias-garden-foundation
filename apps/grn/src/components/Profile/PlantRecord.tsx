import { useEffect, useState } from 'react';
import { Button } from '@olivias/ui';
import type { HarvestItem } from '../../services/api';
import type { GrowerCropItem } from '../../types/listing';
import { usePlantRecord } from '../../hooks/usePlantRecord';
import { formatDate } from '../../utils/cropTiming';
import './PlantRecord.css';

interface PlantRecordProps {
  crop: GrowerCropItem;
  onOpenHarvests: () => void;
  onShareHarvest: (harvest: HarvestItem) => void;
  writesBlocked?: boolean;
}

export function PlantRecord({ crop, onOpenHarvests, onShareHarvest, writesBlocked = false }: PlantRecordProps) {
  const { harvests, notes } = usePlantRecord(crop);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const connect = () => setOnline(true);
    const disconnect = () => setOnline(false);
    window.addEventListener('online', connect);
    window.addEventListener('offline', disconnect);
    return () => { window.removeEventListener('online', connect); window.removeEventListener('offline', disconnect); };
  }, []);
  const records = (harvests.data?.harvests ?? []).filter((harvest) => harvest.growerCropId === crop.id);
  const milestones = [
    { id: 'added', date: crop.createdAt.slice(0, 10), title: 'Added to your garden', harvest: null },
    ...(crop.plantingDate ? [{ id: 'planted', date: crop.plantingDate, title: 'Planted', harvest: null }] : []),
    ...records.map((harvest) => ({ id: harvest.id, date: harvest.harvestedOn, title: `Harvested ${harvest.amount}${harvest.unit ? ` ${harvest.unit}` : ''}`, harvest })),
  ].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));

  return (
    <div className="grn-plant-record">
      {!online ? <p role="status">You are offline. Saved plant information is available; reconnect to save changes.</p> : null}
      <section aria-labelledby={`plant-notes-${crop.id}`}>
        <div className="grn-plant-record__heading">
          <h3 id={`plant-notes-${crop.id}`}>Growing notes</h3>
          {!editing ? <Button variant="ghost" size="sm" disabled={!online || writesBlocked} onClick={() => { setDraft(crop.notes ?? ''); setEditing(true); setSaved(false); notes.reset(); }}>Edit notes</Button> : null}
        </div>
        {editing ? (
          <form onSubmit={async (event) => {
            event.preventDefault();
            if (!online || notes.isPending || writesBlocked) return;
            try { await notes.mutateAsync(draft); setEditing(false); setSaved(true); } catch { /* Keep the draft so saving can be retried. */ }
          }}>
            <label htmlFor={`plant-notes-input-${crop.id}`}>What would you like to remember?</label>
            <textarea id={`plant-notes-input-${crop.id}`} value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} disabled={notes.isPending} autoFocus />
            <p>Keep observations here, such as how it is growing or what worked well.</p>
            {notes.isError ? <p role="alert">Your notes could not be saved. Your draft is still here; try again.</p> : null}
            <div className="grn-plant-record__actions">
              <Button type="submit" disabled={!online || notes.isPending || writesBlocked}>{notes.isPending ? 'Saving…' : 'Save notes'}</Button>
              <Button variant="ghost" disabled={notes.isPending} onClick={() => { setEditing(false); notes.reset(); }}>Cancel</Button>
            </div>
          </form>
        ) : <p className="grn-plant-record__notes">{crop.notes || 'No growing notes yet. Save a few observations to remember for next season.'}</p>}
        {saved ? <p role="status">Notes saved.</p> : null}
      </section>

      <section aria-labelledby={`plant-story-${crop.id}`}>
        <div className="grn-plant-record__heading">
          <h3 id={`plant-story-${crop.id}`}>Plant history</h3>
          <Button variant="secondary" size="sm" onClick={onOpenHarvests}>Manage harvests</Button>
        </div>
        <p>Planting milestones and recorded harvests, newest first. Harvest amounts keep their original units.</p>
        {harvests.isPending ? <p role="status">Loading harvest history…</p> : null}
        {harvests.isError ? <div role="alert"><p>Harvest history could not refresh. Available records are still shown.</p><Button variant="ghost" size="sm" disabled={!online} onClick={() => { void harvests.refetch(); }}>Retry harvest history</Button></div> : null}
        {harvests.isSuccess && records.length === 0 ? <p>No harvests recorded yet. Log the first when this plant is ready.</p> : null}
        <ol className="grn-plant-record__timeline" aria-label="Plant history">
          {milestones.map((entry) => (
            <li key={entry.id}>
              <time dateTime={entry.date}>{formatDate(entry.date)}</time>
              <h4>{entry.title}</h4>
              {entry.harvest?.notes ? <p className="grn-plant-record__notes">{entry.harvest.notes}</p> : null}
              {entry.harvest ? <Button variant="ghost" size="sm" onClick={() => onShareHarvest(entry.harvest!)}>Share from this harvest</Button> : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
