import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@olivias/ui';
import type { GrowerCropItem } from '../../types/listing';
import { createLogger } from '../../utils/logging';
import { buildFirstSteps, type FirstStep } from './firstSteps';
import { GardenScene } from '../branding/GardenArt';
import './FirstStepsPanel.css';

const HIDDEN_STORAGE_PREFIX = 'og-grn-first-steps-hidden';
const logger = createLogger('first-steps');

export interface FirstStepsPanelProps {
  /** Scopes the hidden preference; browsers get shared between accounts. */
  userId?: string | null;
  homeZone?: string | null;
  crops: GrowerCropItem[];
  bedCount: number;
  reminderCount: number;
  /**
   * True once the records behind the checklist have loaded. Rendering before
   * then would flash steps as incomplete that the grower has already done.
   */
  ready: boolean;
}

/**
 * One grower hiding their checklist must not hide it for the next person to
 * sign in on the same device, so the preference is keyed per user.
 */
function hiddenStorageKey(userId?: string | null): string {
  return `${HIDDEN_STORAGE_PREFIX}:${userId ?? 'unknown'}`;
}

function readHidden(userId?: string | null): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(hiddenStorageKey(userId)) === 'true';
  } catch {
    return false;
  }
}

/**
 * The getting-started checklist on Today. It appears for growers who still
 * have setup left, disappears on its own once every step is satisfied, and can
 * be hidden at any time — it is orientation, not a gate.
 */
export function FirstStepsPanel({
  userId,
  homeZone,
  crops,
  bedCount,
  reminderCount,
  ready,
}: FirstStepsPanelProps) {
  const navigate = useNavigate();
  const [hidden, setHidden] = useState<boolean>(() => readHidden(userId));
  const [hiddenFor, setHiddenFor] = useState<string | null | undefined>(userId);

  // The signed-in identity can change without this component unmounting, so
  // re-read the preference rather than carrying the previous grower's choice.
  if (hiddenFor !== userId) {
    setHiddenFor(userId);
    setHidden(readHidden(userId));
  }

  const summary = useMemo(
    () => buildFirstSteps({ homeZone, crops, bedCount, reminderCount }),
    [bedCount, crops, homeZone, reminderCount]
  );

  if (!ready || hidden || summary.allComplete) return null;

  const hide = () => {
    try {
      window.localStorage.setItem(hiddenStorageKey(userId), 'true');
    } catch {
      // Hiding is a convenience; a storage failure should not break Today.
    }
    logger.info('First steps checklist hidden', {
      completedCount: summary.completedCount,
      totalCount: summary.totalCount,
    });
    setHidden(true);
  };

  const openStep = (step: FirstStep) => {
    logger.info('First step opened', { stepId: step.id, done: step.done });
    navigate(step.to);
  };

  return (
    <section className="grn-first-steps" aria-labelledby="first-steps-heading">
      <header className="grn-first-steps__header">
        <div className="grn-first-steps__copy">
          <h2 id="first-steps-heading">Getting started</h2>
          <p>
            These four steps teach Good Roots enough about your garden to be useful. Do them in
            any order, at whatever pace suits you.
          </p>
        </div>
        {crops.length === 0 ? <GardenScene name="first-garden" className="grn-first-steps__art" /> : null}
        <div className="grn-first-steps__progress">
          <span className="grn-first-steps__progress-count">
            {summary.completedCount} of {summary.totalCount} done
          </span>
          <span
            className="grn-first-steps__progress-track"
            role="progressbar"
            aria-valuenow={summary.percentComplete}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Setup progress"
          >
            <span
              className="grn-first-steps__progress-fill"
              style={{ width: `${summary.percentComplete}%` }}
            />
          </span>
        </div>
      </header>

      <ol className="grn-first-steps__list" aria-label="Setup steps">
        {summary.steps.map((step, index) => {
          const isNext = summary.nextStep?.id === step.id;
          return (
            <li
              key={step.id}
              className={`grn-first-step ${step.done ? 'is-done' : ''} ${isNext ? 'is-next' : ''}`.trim()}
            >
              <span className="grn-first-step__marker" aria-hidden="true">
                {step.done ? '✓' : index + 1}
              </span>
              <div className="grn-first-step__body">
                <h3>
                  {step.title}
                  {step.done ? <span className="grn-first-step__status"> — done</span> : null}
                </h3>
                <p>{step.done ? step.doneNote : step.body}</p>
              </div>
              <Button
                variant={isNext ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => openStep(step)}
              >
                {step.done ? step.doneCta : step.cta}
              </Button>
            </li>
          );
        })}
      </ol>

      <footer className="grn-first-steps__footer">
        <p>
          That is all the setup there is. Sharing extra food with neighbors stays optional — Share
          is there if and when you want it.
        </p>
        <button type="button" className="grn-first-steps__hide" onClick={hide}>
          Hide this
        </button>
      </footer>
    </section>
  );
}

export default FirstStepsPanel;
