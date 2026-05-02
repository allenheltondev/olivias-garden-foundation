import { useState } from 'react';
import type { ActivityEvent } from '../api';

type Detail = Record<string, unknown>;

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  return null;
}

function asObject(value: unknown): Detail | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Detail;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function formatMoney(amountCents: unknown, currency: unknown): string {
  const cents = asNumber(amountCents) ?? 0;
  const code = (asString(currency) ?? 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(cents / 100);
  } catch {
    return `${code} ${(cents / 100).toFixed(2)}`;
  }
}

function formatDateTime(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.valueOf())) return raw;
  return date.toLocaleString();
}

function formatDate(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.valueOf())) return raw;
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatCoordinate(value: unknown): string | null {
  const num = asNumber(value);
  return num === null ? null : num.toFixed(5);
}

const ORG_TYPE_LABELS: Record<string, string> = {
  'food-pantry': 'Food pantry',
  shelter: 'Shelter',
  school: 'School or youth program',
  'mutual-aid': 'Mutual aid / community fridge',
  faith: 'Faith community',
  other: 'Other',
};

function orgTypeLabel(value: unknown): string | null {
  const key = asString(value);
  if (!key) return null;
  return ORG_TYPE_LABELS[key] ?? key;
}

const PRIVACY_LABELS: Record<string, string> = {
  exact: 'Exact location shown',
  city: 'City only',
  county: 'County only',
  region: 'Region only',
};

function privacyLabel(value: unknown): string | null {
  const key = asString(value);
  if (!key) return null;
  return PRIVACY_LABELS[key] ?? key;
}

function joinAddress(addr: Detail | null): string | null {
  if (!addr) return null;
  const line1 = asString(addr.line1);
  const line2 = asString(addr.line2);
  const city = asString(addr.city);
  const region = asString(addr.region);
  const postal = asString(addr.postalCode);
  const country = asString(addr.country);
  const street = [line1, line2].filter(Boolean).join(', ');
  const cityRegion = [city, region].filter(Boolean).join(', ');
  const tail = [cityRegion, postal].filter(Boolean).join(' ');
  return [street, tail, country].filter(Boolean).join(' • ') || null;
}

interface FieldRow {
  label: string;
  value: string | null;
  multiline?: boolean;
}

function FieldList({ fields }: { fields: FieldRow[] }) {
  const visible = fields.filter((f) => f.value && f.value.length > 0);
  if (!visible.length) return null;
  return (
    <dl className="admin-activity-detail__list">
      {visible.map((field) => (
        <div
          key={field.label}
          className={`admin-activity-detail__row${field.multiline ? ' admin-activity-detail__row--multiline' : ''}`}
        >
          <dt className="admin-activity-detail__label">{field.label}</dt>
          <dd className="admin-activity-detail__value">{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="admin-activity-detail__section">
      {title ? <h4 className="admin-activity-detail__section-title">{title}</h4> : null}
      {children}
    </section>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="admin-activity-detail__note">{children}</p>;
}

function RawPayload({ data }: { data: Detail }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="admin-activity-detail__raw"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="admin-activity-detail__raw-toggle">
        {open ? 'Hide raw payload' : 'Show raw payload'}
      </summary>
      <pre className="admin-activity-detail__raw-body">{JSON.stringify(data, null, 2)}</pre>
    </details>
  );
}

function DonationDetails({ data }: { data: Detail }) {
  const isRecurring = asString(data.mode) === 'recurring';
  const anonymous = asBool(data.anonymous) === true;
  const donorName = anonymous ? 'Anonymous donor' : asString(data.donorName) ?? '—';
  return (
    <>
      <Section title="Gift">
        <FieldList
          fields={[
            { label: 'Type', value: isRecurring ? 'Garden Club (recurring)' : 'One-time donation' },
            { label: 'Amount', value: formatMoney(data.amountCents, data.currency) },
            { label: 'Bee nameplate', value: asString(data.dedicationName) },
            { label: 'T-shirt choice', value: asString(data.tShirtPreference) },
          ]}
        />
      </Section>
      <Section title="Donor">
        <FieldList
          fields={[
            { label: 'Name', value: donorName },
            { label: 'Email', value: anonymous ? null : asString(data.donorEmail) },
            { label: 'Stripe customer', value: asString(data.stripeCustomerId) },
            { label: 'Stripe subscription', value: asString(data.stripeSubscriptionId) },
            { label: 'Stripe payment', value: asString(data.stripePaymentIntentId) },
          ]}
        />
      </Section>
      <Note>This gift includes a permanent acrylic bee placed in the garden.</Note>
    </>
  );
}

function GardenClubCancellationScheduled({ data }: { data: Detail }) {
  return (
    <Section title="Cancellation scheduled">
      <FieldList
        fields={[
          { label: 'Donor email', value: asString(data.donorEmail) },
          { label: 'Ends on', value: formatDate(data.cancelAt) },
          { label: 'Stripe subscription', value: asString(data.stripeSubscriptionId) },
        ]}
      />
      <Note>The Garden Club subscription will end on the date above. The donor can revert before then.</Note>
    </Section>
  );
}

function GardenClubCancellationReverted({ data }: { data: Detail }) {
  return (
    <Section title="Cancellation reverted">
      <FieldList
        fields={[
          { label: 'Donor email', value: asString(data.donorEmail) },
          { label: 'Stripe subscription', value: asString(data.stripeSubscriptionId) },
        ]}
      />
      <Note>The donor decided to keep their Garden Club subscription active.</Note>
    </Section>
  );
}

function GardenClubCanceled({ data }: { data: Detail }) {
  return (
    <Section title="Garden Club ended">
      <FieldList
        fields={[
          { label: 'Donor email', value: asString(data.donorEmail) },
          { label: 'Stripe subscription', value: asString(data.stripeSubscriptionId) },
        ]}
      />
    </Section>
  );
}

function UserSignupDetails({ data }: { data: Detail }) {
  const optedIn = asBool(data.newsletterOptIn);
  return (
    <Section title="New signup">
      <FieldList
        fields={[
          { label: 'Name', value: asString(data.fullName) },
          { label: 'Email', value: asString(data.email) },
          { label: 'User ID', value: asString(data.userId) },
          {
            label: 'Newsletter',
            value: optedIn === null ? null : optedIn ? 'Opted in' : 'Did not opt in',
          },
        ]}
      />
    </Section>
  );
}

function OkraSubmissionDetails({ data }: { data: Detail }) {
  const photos = asStringArray(data.photoUrls);
  const lat = formatCoordinate(data.displayLat);
  const lng = formatCoordinate(data.displayLng);
  const coords = lat && lng ? `${lat}, ${lng}` : null;
  return (
    <>
      <Section title="Contributor">
        <FieldList
          fields={[
            { label: 'Name', value: asString(data.contributorName) ?? 'Anonymous contributor' },
            { label: 'Email', value: asString(data.contributorEmail) },
            { label: 'Submitted', value: formatDateTime(data.createdAt) },
            { label: 'Submission ID', value: asString(data.submissionId) },
          ]}
        />
      </Section>
      <Section title="Location">
        <FieldList
          fields={[
            { label: 'Privacy', value: privacyLabel(data.privacyMode) ?? 'City' },
            { label: 'Raw location', value: asString(data.rawLocationText) },
            { label: 'Coordinates', value: coords },
          ]}
        />
      </Section>
      {asString(data.storyText) ? (
        <Section title="Story">
          <p className="admin-activity-detail__story">{asString(data.storyText)}</p>
        </Section>
      ) : null}
      {photos.length ? (
        <Section title={`Photos (${photos.length})`}>
          <div className="admin-activity-detail__photos">
            {photos.map((url, idx) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                className="admin-activity-detail__photo"
              >
                <img src={url} alt={`Okra submission photo ${idx + 1}`} loading="lazy" />
              </a>
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}

function SeedRequestDetails({ data }: { data: Detail }) {
  const method = asString(data.fulfillmentMethod);
  const isMail = method === 'mail';
  const address = joinAddress(asObject(data.shippingAddress));
  const visit = asObject(data.visitDetails);
  return (
    <>
      <Section title="Requester">
        <FieldList
          fields={[
            { label: 'Name', value: asString(data.name) },
            { label: 'Email', value: asString(data.email) },
          ]}
        />
      </Section>
      <Section title="Fulfillment">
        <FieldList
          fields={[
            {
              label: 'Method',
              value: isMail ? 'Mail to address' : method === 'in_person' ? 'In-person exchange' : method,
            },
            { label: 'Mailing address', value: isMail ? address : null, multiline: true },
            { label: 'Planned visit', value: !isMail ? formatDate(visit?.approximateDate) : null },
            {
              label: 'Visit notes',
              value: !isMail ? asString(visit?.notes) : null,
              multiline: true,
            },
          ]}
        />
      </Section>
      {asString(data.message) ? (
        <Section title="Message">
          <p className="admin-activity-detail__story">{asString(data.message)}</p>
        </Section>
      ) : null}
    </>
  );
}

function OrgInquiryDetails({ data }: { data: Detail }) {
  const location = [asString(data.city), asString(data.state)].filter(Boolean).join(', ') || null;
  return (
    <>
      <Section title="Organization">
        <FieldList
          fields={[
            { label: 'Name', value: asString(data.orgName) ?? '(no organization name)' },
            { label: 'Type', value: orgTypeLabel(data.orgType) },
            { label: 'Location', value: location },
          ]}
        />
      </Section>
      <Section title="Contact">
        <FieldList
          fields={[
            { label: 'Name', value: asString(data.contactName) },
            { label: 'Email', value: asString(data.email) },
            { label: 'Phone', value: asString(data.phone) },
          ]}
        />
      </Section>
      {asString(data.message) ? (
        <Section title="Message">
          <p className="admin-activity-detail__story">{asString(data.message)}</p>
        </Section>
      ) : null}
    </>
  );
}

function GeneralInquiryDetails({ data }: { data: Detail }) {
  return (
    <>
      <Section title="Contact">
        <FieldList
          fields={[
            { label: 'Name', value: asString(data.contactName) },
            { label: 'Email', value: asString(data.email) },
            { label: 'How they heard', value: asString(data.referral) },
          ]}
        />
      </Section>
      {asString(data.message) ? (
        <Section title="Message">
          <p className="admin-activity-detail__story">{asString(data.message)}</p>
        </Section>
      ) : null}
    </>
  );
}

function GenericDetails({ data }: { data: Detail }) {
  const fields: FieldRow[] = Object.entries(data)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => {
      let display: string | null = null;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        display = String(value);
      } else {
        try {
          display = JSON.stringify(value);
        } catch {
          display = null;
        }
      }
      return { label: key, value: display };
    });
  if (!fields.length) {
    return <Note>No additional details for this event.</Note>;
  }
  return (
    <Section>
      <FieldList fields={fields} />
    </Section>
  );
}

export interface ActivityDetailsProps {
  event: ActivityEvent;
}

export function ActivityDetails({ event }: ActivityDetailsProps) {
  const data: Detail = event.data ?? {};

  let body: React.ReactNode;
  switch (event.detailType) {
    case 'donation.completed':
      body = <DonationDetails data={data} />;
      break;
    case 'garden-club.cancellation_scheduled':
      body = <GardenClubCancellationScheduled data={data} />;
      break;
    case 'garden-club.cancellation_reverted':
      body = <GardenClubCancellationReverted data={data} />;
      break;
    case 'garden-club.canceled':
      body = <GardenClubCanceled data={data} />;
      break;
    case 'user.signed-up':
      body = <UserSignupDetails data={data} />;
      break;
    case 'submission.created':
      body = <OkraSubmissionDetails data={data} />;
      break;
    case 'seed-request.created':
      body = <SeedRequestDetails data={data} />;
      break;
    case 'org-inquiry.received':
      body = <OrgInquiryDetails data={data} />;
      break;
    case 'general-inquiry.received':
      body = <GeneralInquiryDetails data={data} />;
      break;
    default:
      body = <GenericDetails data={data} />;
  }

  return (
    <div className="admin-activity-detail">
      {body}
      <RawPayload data={data} />
    </div>
  );
}
