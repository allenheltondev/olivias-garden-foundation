import { LegalDocument, LegalSection, LegalTableOfContents } from '../chrome';
import { foundationOrganization } from '../organization';
import { candidProfileUrl, candidSealImageUrl } from '../routes';

const CONTACT_EMAIL = foundationOrganization.contactEmail;

const TRANSPARENCY_SECTIONS = [
  { id: 'organization', title: 'Organization details' },
  { id: 'leadership', title: 'Leadership' },
  { id: 'mission-and-programs', title: 'Mission and programs' },
  { id: 'non-discrimination', title: 'Non-discrimination policy' },
  { id: 'financial-information', title: 'Financial information' },
  { id: 'public-records', title: 'Public records and filings' },
  { id: 'contact', title: 'Contact' },
];

export function TransparencyPage() {
  const { legalName, ein, mailingAddress, foundedYear, irsDeterminationDate } = foundationOrganization;
  const formattedAddress = `${mailingAddress.line1}, ${mailingAddress.city}, ${mailingAddress.region} ${mailingAddress.postalCode}`;

  return (
    <LegalDocument
      title="Transparency"
      effectiveDate="May 11, 2026"
      intro={(
        <p>
          This page consolidates the public information about Olivia&apos;s Garden Foundation:
          our legal status, leadership, mailing address, financial situation, and where to
          find our public filings. We are a young organization and we want supporters,
          partners, and regulators to be able to see exactly where we stand.
        </p>
      )}
    >
      <LegalTableOfContents items={TRANSPARENCY_SECTIONS} />

      <LegalSection id="organization" number={1} title="Organization details">
        <p>
          <strong>Legal name:</strong> {legalName}
          <br />
          <strong>EIN (Employer Identification Number):</strong> {ein}
          <br />
          <strong>Tax status:</strong> 501(c)(3) public charity, recognized by the United
          States Internal Revenue Service.
          <br />
          <strong>IRS determination date:</strong> {irsDeterminationDate}
          <br />
          <strong>Year founded:</strong> {foundedYear}
          <br />
          <strong>State of incorporation:</strong> Texas
          <br />
          <strong>Mailing address:</strong>
          <br />
          <span itemProp="address" itemScope itemType="https://schema.org/PostalAddress">
            <span itemProp="streetAddress">{mailingAddress.line1}</span>
            <br />
            <span itemProp="addressLocality">{mailingAddress.city}</span>
            ,{' '}
            <span itemProp="addressRegion">{mailingAddress.region}</span>{' '}
            <span itemProp="postalCode">{mailingAddress.postalCode}</span>
            <br />
            <span itemProp="addressCountry">{mailingAddress.country}</span>
          </span>
        </p>
        <p>
          Donations to Olivia&apos;s Garden Foundation are tax-deductible to the extent
          allowed by United States law.
        </p>
      </LegalSection>

      <LegalSection id="leadership" number={2} title="Leadership">
        <p>
          Olivia&apos;s Garden Foundation is run by the Helton family of McKinney, Texas:
        </p>
        <ul className="site-list">
          <li>
            <strong>Allen Helton</strong> &mdash; co-founder and president. Designs and
            builds the gardens, runs the technology platform, and leads day-to-day
            operations.
          </li>
          <li>
            <strong>Mallory Helton</strong> &mdash; co-founder. Leads workshops,
            community programs, and animal care on the property.
          </li>
          <li>
            <strong>Isabella Helton</strong> &mdash; family contributor. Helps with
            workdays and community events.
          </li>
        </ul>
        <p>
          The foundation has no paid staff. All program work is performed by the founders
          and volunteers.
        </p>
      </LegalSection>

      <LegalSection id="mission-and-programs" number={3} title="Mission and programs">
        <p>
          Our mission is to teach individuals and families how to grow food, care for
          animals, preserve what they produce, and build practical self-sufficiency. The
          foundation operates a working garden and small homestead in McKinney, Texas in
          memory of our daughter Olivia.
        </p>
        <p>Current programs include:</p>
        <ul className="site-list">
          <li>
            <strong>The Okra Project</strong> &mdash; a free seed program and public map
            of community growers.
          </li>
          <li>
            <strong>Hands-on workshops</strong> &mdash; in-person sessions on garden
            preparation, animal care, food preservation, and related practical skills.
          </li>
          <li>
            <strong>The Good Roots Network</strong> &mdash; a garden planning app that
            helps home gardeners plan and grow more food, with neighbor-to-neighbor
            food sharing built in.
          </li>
          <li>
            <strong>Community workdays</strong> &mdash; regular volunteer days on the
            property tied to seasonal garden and animal care work.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="non-discrimination" number={4} title="Non-discrimination policy">
        <p>
          Olivia&apos;s Garden Foundation is committed to serving everyone in our
          community. We do not discriminate on the basis of race, color, ethnic or
          national origin, ancestry, gender, gender identity or expression, sexual
          orientation, age, disability, religion, marital status, military or veteran
          status, or any other category protected by applicable law in the administration
          of our programs, services, volunteer opportunities, or employment.
        </p>
        <p>
          This commitment applies to seed program participants, workshop attendees,
          volunteers, donors, partners, and anyone else who interacts with the foundation.
          Concerns about how this policy is being applied can be sent to{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and will be reviewed
          directly by foundation leadership.
        </p>
      </LegalSection>

      <LegalSection id="financial-information" number={5} title="Financial information">
        <p>
          Olivia&apos;s Garden Foundation was founded in {foundedYear} and received IRS
          501(c)(3) recognition on {irsDeterminationDate}. Because we are a new
          organization, we do not yet have a published annual report or a filed IRS Form
          990. Our first IRS filing, covering our initial reporting period, will be made
          in 2026, and a summary will be posted on this page once filed.
        </p>
        <p>
          We operate at a small scale, well below the IRS thresholds for a full Form 990,
          and we expect to file Form 990-N (e-Postcard) for our first reporting period.
          Once our annual receipts grow past those thresholds, we will move to Form 990-EZ
          or full Form 990 as required.
        </p>
        <p>
          In plain language, the money that comes in is used for:
        </p>
        <ul className="site-list">
          <li>Seeds, plants, soil, and garden materials</li>
          <li>Lumber, fencing, and hardware for raised beds, animal enclosures, and on-site infrastructure</li>
          <li>Feed, bedding, and veterinary care for chickens, turkeys, geese, goats, bees, and guineas</li>
          <li>Supplies and materials for workshops</li>
          <li>Shipping costs for the free okra seed program</li>
          <li>Software, hosting, and operational costs for the Good Roots Network platform and the foundation website</li>
        </ul>
        <p>
          We have no paid staff, no office lease, and no fundraising contractors. The
          founders cover incidental overhead personally rather than from donated funds
          where practical.
        </p>
      </LegalSection>

      <LegalSection id="public-records" number={6} title="Public records and filings">
        <p>
          Olivia&apos;s Garden Foundation maintains a public profile on Candid (formerly
          GuideStar), which surfaces our IRS determination data and any future Form 990
          filings:
        </p>
        <p>
          <a href={candidProfileUrl} target="_blank" rel="noreferrer">
            View our Candid profile
          </a>
        </p>
        <p>
          Our 501(c)(3) status can also be independently verified through the IRS Tax
          Exempt Organization Search at{' '}
          <a
            href="https://apps.irs.gov/app/eos/"
            target="_blank"
            rel="noreferrer"
          >
            apps.irs.gov/app/eos
          </a>{' '}
          using EIN {ein}.
        </p>
        <div className="candid-seal">
          <a
            className="candid-seal__link"
            aria-label="View Olivia's Garden Foundation on Candid"
            href={candidProfileUrl}
            target="_blank"
            rel="noreferrer"
          >
            <img alt="" src={candidSealImageUrl} loading="lazy" />
          </a>
        </div>
      </LegalSection>

      <LegalSection id="contact" number={7} title="Contact">
        <p>
          Questions about the organization, requests for additional information, or press
          inquiries can be sent to{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>, or by mail to{' '}
          {formattedAddress}.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
