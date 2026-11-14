import { Button, Card, FormFeedback, Input, Select, Textarea } from '@olivias/ui';
import { useState, type FormEvent } from 'react';
import { trackEvent } from '../../observability/analytics';
import { PageHero, Section } from '../chrome';
import { foundationOrganization } from '../organization';
import { webApiBase } from '../routes';

const CONTACT_EMAIL = foundationOrganization.contactEmail;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PARTNER_TYPE_OPTIONS = [
  { value: 'extension', label: 'Extension or Master Gardener program' },
  { value: 'college', label: 'College or university' },
  { value: 'nonprofit', label: 'Nonprofit or food access group' },
  { value: 'school', label: 'School or youth program' },
  { value: 'business', label: 'Local business' },
  { value: 'other', label: 'Something else' },
];

const PARTNER_AUDIENCES = [
  {
    title: 'Extension and Master Gardener programs',
    body: 'Groups like Texas A&M AgriLife Extension and county Master Gardener associations already help Texans grow food with research-based guidance. We would love to point our growers to that expertise and help put it in more hands.',
  },
  {
    title: 'Colleges and universities',
    body: 'Agriculture, horticulture, and nutrition programs at Texas A&M and other schools could work with us on student service projects, growing guides, and helping new gardeners get started.',
  },
  {
    title: 'Nonprofits and food access groups',
    body: 'Food pantries, community gardens, and faith communities can become local sharing spots for free okra seeds, and can use the Good Roots Network to organize shared gardens.',
  },
  {
    title: 'Local businesses',
    body: 'Garden centers, feed stores, and other local businesses can grow okra for seed, give seed packets a home on their counter, or donate supplies that keep the garden going.',
  },
];

const SPONSOR_WAYS = [
  {
    title: 'Bulk growing',
    body: "Grow a plot of Clemson Spineless okra from Olivia's line and save the seed. Every plant you let go to seed becomes packets we can send out for free, so more people can grow her okra without the foundation having to grow it all.",
  },
  {
    title: 'Satellite sharing',
    body: 'Become a local sharing spot. We send you okra seed packets, and you hand them out to people in your community, at your pantry, plant sale, classroom, or front counter. It gets seeds into hands faster than the mail and saves postage.',
  },
];

const OTHER_WAYS = [
  'Share growing expertise for our guides and FAQ',
  'Donate seeds, tools, or supplies',
  'Plan future hands-on programs with us once we open the gate',
];

function PartnerInquiryForm() {
  const [orgName, setOrgName] = useState('');
  const [partnerType, setPartnerType] = useState('extension');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const canSubmit =
    orgName.trim().length > 0
    && contactName.trim().length > 0
    && EMAIL_PATTERN.test(email.trim())
    && message.trim().length > 0;

  const clearFeedback = () => {
    if (feedback) setFeedback(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || submitting) {
      setFeedback({
        type: 'error',
        message: 'Add your organization, your name, a valid email, and a short note before sending.',
      });
      return;
    }

    setSubmitting(true);
    setFeedback(null);

    const typeLabel = PARTNER_TYPE_OPTIONS.find((option) => option.value === partnerType)?.label ?? partnerType;

    try {
      // Partnership notes go through the existing general inquiry flow, so
      // they land in the same inbox and admin activity as contact messages.
      const response = await fetch(`${webApiBase}/contact`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'general_inquiry',
          contactName: contactName.trim(),
          email: email.trim(),
          message: `Partnership inquiry\nOrganization: ${orgName.trim()}\nType: ${typeLabel}\n\n${message.trim()}`,
          referral: 'Partners page',
        }),
      });

      if (!response.ok) {
        throw new Error(`Submission failed (${response.status})`);
      }

      trackEvent('partner_inquiry_submitted', { partner_type: partnerType });
      setFeedback({
        type: 'success',
        message: "Thank you. We'll read this closely and get back to you by email.",
      });
      setOrgName('');
      setContactName('');
      setEmail('');
      setMessage('');
    } catch {
      setFeedback({
        type: 'error',
        message: `We couldn't send your note. Please try again or email ${CONTACT_EMAIL} directly.`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="contact-form partners-form" onSubmit={handleSubmit} noValidate>
      <div className="partners-form__row">
        <Input
          label="Organization"
          value={orgName}
          onChange={(event) => { clearFeedback(); setOrgName(event.target.value); }}
          required
          autoComplete="organization"
        />
        <Select
          label="Type of organization"
          value={partnerType}
          onChange={(value) => { clearFeedback(); setPartnerType(value); }}
          options={PARTNER_TYPE_OPTIONS}
          required
        />
      </div>
      <div className="partners-form__row">
        <Input
          label="Your name"
          value={contactName}
          onChange={(event) => { clearFeedback(); setContactName(event.target.value); }}
          required
          autoComplete="name"
        />
        <Input
          type="email"
          label="Email"
          value={email}
          onChange={(event) => { clearFeedback(); setEmail(event.target.value); }}
          required
          autoComplete="email"
        />
      </div>
      <Textarea
        label="What do you have in mind?"
        rows={5}
        value={message}
        onChange={(event) => { clearFeedback(); setMessage(event.target.value); }}
        required
      />
      <Button type="submit" disabled={!canSubmit} loading={submitting}>
        {submitting ? 'Sending...' : 'Start the conversation'}
      </Button>
      {feedback ? <FormFeedback tone={feedback.type}>{feedback.message}</FormFeedback> : null}
    </form>
  );
}

export function PartnersPage() {
  return (
    <div className="partners-page">
      <PageHero
        title="Partner with us"
        titleClassName="partners-hero__title"
        body="We're a young, family-run foundation, and we'd like to grow alongside organizations that share the work of helping people grow their own food. We don't have any partners yet. You could be the first."
      />

      <Section
        title="Who we'd love to work with"
        intro="If your organization helps people grow, cook, or share food, there's probably a way to work together."
      >
        <div className="partners-audiences">
          {PARTNER_AUDIENCES.map((audience) => (
            <article key={audience.title} className="partners-audience">
              <h3>{audience.title}</h3>
              <p>{audience.body}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section
        title="Ways to sponsor"
        intro="The best way to help right now is to help Olivia's okra spread. There's no formal program or tier list yet, and we're open to ideas we haven't thought of."
      >
        <div className="partners-sponsor-ways">
          {SPONSOR_WAYS.map((way) => (
            <article key={way.title} className="partners-audience partners-sponsor-way">
              <h3>{way.title}</h3>
              <p>{way.body}</p>
            </article>
          ))}
        </div>
        <h3 className="partners-other-ways__title">Other ways to help</h3>
        <ul className="site-list partners-ways">
          {OTHER_WAYS.map((way) => <li key={way}>{way}</li>)}
        </ul>
      </Section>

      <Section title="Start a conversation" className="partners-contact-section">
        <div className="partners-contact">
          <Card title="Tell us about your organization" className="partners-contact__form">
            <PartnerInquiryForm />
          </Card>
          <div className="partners-contact__aside">
            <p className="page-text">
              {foundationOrganization.legalName} is an IRS-recognized 501(c)(3) public charity
              (EIN {foundationOrganization.ein}) based in McKinney, Texas.
            </p>
            <p className="page-text">
              Prefer email? Write to{' '}
              <a href={`mailto:${CONTACT_EMAIL}?subject=Partnership`}>{CONTACT_EMAIL}</a>.
            </p>
          </div>
        </div>
      </Section>
    </div>
  );
}
