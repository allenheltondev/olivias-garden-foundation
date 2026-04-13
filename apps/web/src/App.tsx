import { Button, Card } from '@olivias/ui';

const initiatives = [
  {
    title: 'Foundation',
    description:
      "Olivia's story, mission, donations, classes, shop, and the broader public-facing foundation site.",
  },
  {
    title: 'The Okra Project',
    description:
      'A story-centered memorial experience with a seed request flow, grower map, and approved photo gallery.',
  },
  {
    title: 'Good Roots Network',
    description:
      'The existing gardener and local food coordination app that will later migrate into the shared platform.',
  },
  {
    title: 'Admin',
    description:
      'A role-gated workspace for approvals, donor operations, fulfillment, and day-to-day foundation workflows.',
  },
];

const phaseOneScope = [
  'Shared identity, shared auth, and a shared design system',
  'Donation and pasture naming entry points',
  'Operational admin foundation for donor and renewal tracking',
  'A clean migration path that does not interrupt the current Good Roots app',
];

function App() {
  return (
    <main className="og-shell">
      <section className="og-hero">
        <div className="og-hero-copy">
          <p className="og-eyebrow">Phase 1 Foundation First</p>
          <h1>Olivia&apos;s Garden Foundation</h1>
          <p className="og-lede">
            A unified digital home for Olivia&apos;s story, foundation programs, and the Good Roots
            platform that grows out of them.
          </p>
          <div className="og-actions">
            <Button>Read Olivia&apos;s Story</Button>
            <Button variant="secondary">View Phase 1 Scope</Button>
          </div>
        </div>

        <Card className="og-highlight" title="What this scaffold starts">
          <ul>
            {phaseOneScope.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
      </section>

      <section className="og-section">
        <div className="og-section-heading">
          <p className="og-eyebrow">Core Initiatives</p>
          <h2>One platform, four clear surfaces</h2>
        </div>
        <div className="og-grid">
          {initiatives.map((initiative) => (
            <Card key={initiative.title} title={initiative.title}>
              <p>{initiative.description}</p>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
