import { SectionHeading } from '@olivias/ui';
import { ReminderPanel } from '../components/Reminders/ReminderPanel';

export function RemindersPage() {
  return (
    <section className="grn-section">
      <SectionHeading
        eyebrow="Planning"
        title="Reminders"
        body="Stay on top of upcoming actions for your listings and requests."
      />
      <ReminderPanel />
    </section>
  );
}

export default RemindersPage;
