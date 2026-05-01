import { LegalDocument, LegalSection, LegalTableOfContents } from '../chrome';
import { foundationOrganization } from '../organization';

const CONTACT_EMAIL = foundationOrganization.contactEmail;

const REFUND_POLICY_SECTIONS = [
  { id: 'one-time-donations', title: 'One-time donations' },
  { id: 'recurring-donations', title: 'Recurring donations' },
  { id: 'how-to-request-a-refund', title: 'How to request a refund' },
  { id: 'tax-deductibility', title: 'Tax-deductibility' },
  { id: 'changes-to-this-policy', title: 'Changes to this policy' },
  { id: 'contact', title: 'Contact' },
];

export function RefundPolicyPage() {
  return (
    <LegalDocument
      title="Refund Policy"
      effectiveDate="May 1, 2026"
      intro={(
        <p>
          This policy explains how Olivia&apos;s Garden Foundation handles refund requests for
          one-time donations and recurring Garden Club support.
        </p>
      )}
    >
      <LegalTableOfContents items={REFUND_POLICY_SECTIONS} />

      <LegalSection id="one-time-donations" number={1} title="One-time donations">
        <p>
          One-time donations are refundable within 7 days when the gift was accidental, entered
          with the wrong amount, duplicated, or otherwise made in error. After 7 days, one-time
          donations are generally final unless a refund is required by law or approved by the
          foundation in its discretion.
        </p>
      </LegalSection>

      <LegalSection id="recurring-donations" number={2} title="Recurring donations">
        <p>
          Garden Club recurring support can be canceled at any time. Cancellation stops future
          charges, including cancel-at-period-end requests when supported by the payment provider.
          Past monthly donations are generally not refunded unless they were accidental,
          duplicated, or required to be refunded by law.
        </p>
      </LegalSection>

      <LegalSection id="how-to-request-a-refund" number={3} title="How to request a refund">
        <p>
          To request a refund or cancel recurring support, email{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with the transaction reference,
          donation date, donation amount, and the email address used for the donation. We review
          refund and cancellation requests and respond within 5 business days.
        </p>
      </LegalSection>

      <LegalSection id="tax-deductibility" number={4} title="Tax-deductibility">
        <p>
          Donations to Olivia&apos;s Garden Foundation may be tax-deductible as allowed by law.
          If a donation is refunded, the refunded amount is no longer a completed charitable
          contribution and any related deduction should be reversed or excluded from your tax
          records. Please consult your tax advisor for guidance specific to your situation.
        </p>
      </LegalSection>

      <LegalSection id="changes-to-this-policy" number={5} title="Changes to this policy">
        <p>
          We may update this Refund Policy from time to time. When we do, we will post the
          updated version on this page and update the effective date above.
        </p>
      </LegalSection>

      <LegalSection id="contact" number={6} title="Contact">
        <p>
          Questions about this Refund Policy can be sent through the contact information provided
          on this website, or by writing to{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
