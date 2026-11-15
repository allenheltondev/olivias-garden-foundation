import { useEffect, useState } from 'react';
import { Button, Card, FormFeedback, Input, PageHeading, SectionHeading, Textarea } from '@olivias/ui';
import {
  listImpactMetrics,
  listTestimonials,
  saveImpactMetrics,
  saveTestimonials,
  type ImpactMetricInput,
  type TestimonialInput,
} from '../api';
import type { AdminSession } from '../auth/session';

export interface ImpactPageProps {
  session: AdminSession;
}

let rowCounter = 0;
function nextKey(prefix: string): string {
  rowCounter += 1;
  return `${prefix}-${rowCounter}`;
}

type EditableMetric = {
  key: string;
  label: string;
  value: string;
  caption: string;
};

type EditableTestimonial = {
  key: string;
  quote: string;
  attribution: string;
  role: string;
};

function MetricsEditor({ session }: { session: AdminSession }) {
  const [rows, setRows] = useState<EditableMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    listImpactMetrics(session.accessToken)
      .then((metrics) => {
        if (!active) return;
        setRows(
          metrics.map((metric) => ({
            key: metric.id,
            label: metric.label,
            value: metric.value,
            caption: metric.caption ?? '',
          })),
        );
        setError(null);
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message || 'Unable to load impact metrics.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.accessToken]);

  const updateRow = (key: string, patch: Partial<EditableMetric>) => {
    setSavedAt(null);
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const removeRow = (key: string) => {
    setSavedAt(null);
    setRows((current) => current.filter((row) => row.key !== key));
  };

  const moveRow = (index: number, direction: -1 | 1) => {
    setSavedAt(null);
    setRows((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const addRow = () => {
    setSavedAt(null);
    setRows((current) => [...current, { key: nextKey('metric'), label: '', value: '', caption: '' }]);
  };

  const handleSave = async () => {
    setError(null);
    setSavedAt(null);

    const metrics: ImpactMetricInput[] = [];
    for (const row of rows) {
      const label = row.label.trim();
      const value = row.value.trim();
      const caption = row.caption.trim();
      if (!label || !value) {
        setError('Every metric needs both a label and a value. Remove empty rows or fill them in.');
        return;
      }
      metrics.push({ label, value, caption: caption || null });
    }

    setSaving(true);
    try {
      const saved = await saveImpactMetrics(session.accessToken, metrics);
      setRows(
        saved.map((metric) => ({
          key: metric.id,
          label: metric.label,
          value: metric.value,
          caption: metric.caption ?? '',
        })),
      );
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save impact metrics.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-section">
      <div className="admin-section__header">
        <SectionHeading
          title="Impact numbers"
          body="These appear on the public impact section alongside live Okra map figures. The label is the description, the value is shown big (e.g. 2,733), and the optional caption sits underneath (e.g. as of June 2026)."
        />
        <Button className="admin-refresh-action" variant="outline" size="sm" onClick={addRow} disabled={loading}>
          Add number
        </Button>
      </div>

      {error ? <FormFeedback tone="error">{error}</FormFeedback> : null}
      {savedAt ? <FormFeedback tone="success">{`Saved at ${savedAt}.`}</FormFeedback> : null}

      {loading ? (
        <p className="admin-muted">Loading impact numbers…</p>
      ) : (
        <>
          {rows.length === 0 ? (
            <Card>
              <p className="admin-muted">No impact numbers yet. Add one to show a number on the public site.</p>
            </Card>
          ) : (
            <div className="admin-impact-list">
              {rows.map((row, index) => (
                <Card key={row.key} className="admin-impact-row">
                  <div className="admin-impact-row__fields">
                    <Input
                      label="Label"
                      placeholder="Volunteer hours logged"
                      value={row.label}
                      onChange={(event) => updateRow(row.key, { label: event.target.value })}
                    />
                    <Input
                      label="Value"
                      placeholder="2,733"
                      value={row.value}
                      onChange={(event) => updateRow(row.key, { value: event.target.value })}
                    />
                    <Input
                      label="Caption (optional)"
                      placeholder="as of June 2026"
                      value={row.caption}
                      onChange={(event) => updateRow(row.key, { caption: event.target.value })}
                    />
                  </div>
                  <div className="admin-impact-row__actions">
                    <Button variant="outline" size="sm" onClick={() => moveRow(index, -1)} disabled={index === 0} aria-label="Move up">
                      ↑
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => moveRow(index, 1)} disabled={index === rows.length - 1} aria-label="Move down">
                      ↓
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => removeRow(row.key)}>
                      Remove
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}

          <div className="admin-impact-save">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save numbers'}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function TestimonialsEditor({ session }: { session: AdminSession }) {
  const [rows, setRows] = useState<EditableTestimonial[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    listTestimonials(session.accessToken)
      .then((testimonials) => {
        if (!active) return;
        setRows(
          testimonials.map((testimonial) => ({
            key: testimonial.id,
            quote: testimonial.quote,
            attribution: testimonial.attribution,
            role: testimonial.role ?? '',
          })),
        );
        setError(null);
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message || 'Unable to load testimonials.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.accessToken]);

  const updateRow = (key: string, patch: Partial<EditableTestimonial>) => {
    setSavedAt(null);
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const removeRow = (key: string) => {
    setSavedAt(null);
    setRows((current) => current.filter((row) => row.key !== key));
  };

  const moveRow = (index: number, direction: -1 | 1) => {
    setSavedAt(null);
    setRows((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const addRow = () => {
    setSavedAt(null);
    setRows((current) => [...current, { key: nextKey('testimonial'), quote: '', attribution: '', role: '' }]);
  };

  const handleSave = async () => {
    setError(null);
    setSavedAt(null);

    const testimonials: TestimonialInput[] = [];
    for (const row of rows) {
      const quote = row.quote.trim();
      const attribution = row.attribution.trim();
      const role = row.role.trim();
      if (!quote || !attribution) {
        setError('Every testimonial needs a quote and an attribution. Remove empty rows or fill them in.');
        return;
      }
      testimonials.push({ quote, attribution, role: role || null });
    }

    setSaving(true);
    try {
      const saved = await saveTestimonials(session.accessToken, testimonials);
      setRows(
        saved.map((testimonial) => ({
          key: testimonial.id,
          quote: testimonial.quote,
          attribution: testimonial.attribution,
          role: testimonial.role ?? '',
        })),
      );
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save testimonials.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-section">
      <div className="admin-section__header">
        <SectionHeading
          title="Testimonials"
          body="Short, approved quotes shown on the public home page. Attribution is who said it (e.g. Seed recipient); role is an optional second line (e.g. McKinney, TX)."
        />
        <Button className="admin-refresh-action" variant="outline" size="sm" onClick={addRow} disabled={loading}>
          Add testimonial
        </Button>
      </div>

      {error ? <FormFeedback tone="error">{error}</FormFeedback> : null}
      {savedAt ? <FormFeedback tone="success">{`Saved at ${savedAt}.`}</FormFeedback> : null}

      {loading ? (
        <p className="admin-muted">Loading testimonials…</p>
      ) : (
        <>
          {rows.length === 0 ? (
            <Card>
              <p className="admin-muted">
                No testimonials yet. Add one to show a quote on the public home page.
              </p>
            </Card>
          ) : (
            <div className="admin-impact-list">
              {rows.map((row, index) => (
                <Card key={row.key} className="admin-testimonial-row">
                  <Textarea
                    label="Quote"
                    placeholder="The okra seeds were the first thing my kids ever grew."
                    rows={3}
                    value={row.quote}
                    onChange={(event) => updateRow(row.key, { quote: event.target.value })}
                  />
                  <div className="admin-impact-row__fields admin-impact-row__fields--two">
                    <Input
                      label="Attribution"
                      placeholder="Seed recipient"
                      value={row.attribution}
                      onChange={(event) => updateRow(row.key, { attribution: event.target.value })}
                    />
                    <Input
                      label="Role (optional)"
                      placeholder="McKinney, TX"
                      value={row.role}
                      onChange={(event) => updateRow(row.key, { role: event.target.value })}
                    />
                  </div>
                  <div className="admin-impact-row__actions">
                    <Button variant="outline" size="sm" onClick={() => moveRow(index, -1)} disabled={index === 0} aria-label="Move up">
                      ↑
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => moveRow(index, 1)} disabled={index === rows.length - 1} aria-label="Move down">
                      ↓
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => removeRow(row.key)}>
                      Remove
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}

          <div className="admin-impact-save">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save testimonials'}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

export function ImpactPage({ session }: ImpactPageProps) {
  return (
    <>
      <PageHeading title="Foundation impact">
        <p>Manage the numbers and stories shared on the public site.</p>
      </PageHeading>
      <MetricsEditor session={session} />
      <TestimonialsEditor session={session} />
    </>
  );
}
