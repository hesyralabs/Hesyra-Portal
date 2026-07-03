import React, { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useOnboarding } from '../../context/OnboardingContext';
import ProgressDots from './ProgressDots';
import './WelcomeModal.css';

const TOTAL_STEPS = 4;

const STAGES = [
  { num: 1, name: 'Submit', meta: 'You upload' },
  { num: 2, name: 'Design', meta: 'CAD + clinical' },
  { num: 3, name: 'Print', meta: 'Asiga · 385nm' },
  { num: 4, name: 'Finish', meta: 'Wash · cure · QA' },
  { num: 5, name: 'Ship', meta: 'Tracked dispatch' },
];

/**
 * Parse the user's name into a salutation for personalisation.
 * Handles: "Dr. Pranjal Agarwal", "Pranjal", "Mr. Smith"
 */
const getPersonalName = (user) => {
  const name = user?.name || 'Doctor';

  // Check for salutation prefix
  const salutationMatch = name.match(/^(Dr\.|Mr\.|Ms\.|Mrs\.)\s*(.*)/i);
  if (salutationMatch) {
    const salutation = salutationMatch[1];
    const rest = salutationMatch[2].trim();
    const lastName = rest.split(' ').pop();
    return `${salutation} ${lastName}`;
  }

  // No salutation — use whatever we have
  const parts = name.trim().split(' ');
  return parts.length > 1 ? parts[parts.length - 1] : parts[0];
};

const WelcomeModal = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const {
    currentWelcomeStep: step,
    advanceWelcomeStep,
    goBackWelcomeStep,
    completeWelcome,
    skipWelcome,
  } = useOnboarding();

  const continueRef = useRef(null);
  const modalRef = useRef(null);

  const personalName = getPersonalName(user);

  // Focus continue button on step change
  useEffect(() => {
    if (step < 4 && continueRef.current) {
      continueRef.current.focus();
    }
  }, [step]);

  // ESC to skip
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        skipWelcome();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [skipWelcome]);

  // Focus trap
  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;

    const handleTab = (e) => {
      if (e.key !== 'Tab') return;
      const focusable = modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };

    modal.addEventListener('keydown', handleTab);
    return () => modal.removeEventListener('keydown', handleTab);
  }, [step]);

  const handleSubmitCase = useCallback(() => {
    completeWelcome('submit');
    navigate('/new-case');
  }, [completeWelcome, navigate]);

  const handleShowAround = useCallback(() => {
    completeWelcome('tour');
  }, [completeWelcome]);

  const handleSkipFinal = useCallback(() => {
    completeWelcome('skip');
  }, [completeWelcome]);

  const continueLabel = step === 3 ? 'Almost done' : 'Continue';

  return (
    <div className="welcomeBackdrop onboarding" role="presentation">
      <div
        ref={modalRef}
        className="welcomeModal"
        role="dialog"
        aria-labelledby="welcome-step-title"
        aria-modal="true"
      >
        <div className="coralAccent" aria-hidden="true" />

        {/* ═══ Step Content ═══ */}
        <div className="stepBody" key={step} aria-live="polite">
          {/* ── STEP 1: Welcome ─── */}
          {step === 1 && (
            <>
              <div className="eyebrow">YOU'RE IN</div>
              <h2 className="stepTitle" id="welcome-step-title">
                Welcome aboard, {personalName}.
              </h2>
              <p className="stepLead">
                A few quick things, then we get out of your way.<br />
                This will take about 60 seconds.
              </p>
              <div className="infoCard">
                <h4>Why this matters</h4>
                <p>
                  Two minutes here saves you the back-and-forth that wastes your chair-time later. Promise.
                </p>
              </div>
            </>
          )}

          {/* ── STEP 2: How it works ─── */}
          {step === 2 && (
            <>
              <div className="eyebrow">HOW HESYRA WORKS</div>
              <h2 className="stepTitle" id="welcome-step-title">
                Five stages.<br />
                Live status on every one.
              </h2>
              <p className="stepLead">
                Every case — from a single crown to a full denture — flows through the same five stages.
              </p>
              <div className="stageGrid">
                {STAGES.map((s) => (
                  <div key={s.num} className="stageCard">
                    <div className="stageNumber">{s.num}</div>
                    <span className="stageName">{s.name}</span>
                    <span className="stageMeta">{s.meta}</span>
                  </div>
                ))}
              </div>
              <p className="footerLine">
                If anything slips the promised TAT — even by a day — you hear from us first.{' '}
                <strong>Silence is not something we do.</strong>
              </p>
            </>
          )}

          {/* ── STEP 3: Payment ─── */}
          {step === 3 && (
            <>
              <div className="eyebrow">HOW YOU PAY</div>
              <h2 className="stepTitle" id="welcome-step-title">
                Two ways.<br />
                Pick whichever fits.
              </h2>
              <p className="stepLead">
                You can mix and match across cases. Both work through Razorpay — UPI, cards, net banking, whatever.
              </p>
              <div className="paymentGrid">
                <div className="paymentCard">
                  <div className="paymentName">Pay-on-Go</div>
                  <span className="paymentTag">Pay per case, at dispatch</span>
                  <p>
                    We finish the case, then send a payment link. You pay only for what's actually shipping.
                  </p>
                </div>
                <div className="paymentCard">
                  <div className="paymentName">Hesyra Wallet</div>
                  <span className="paymentTag">Top up, draw down</span>
                  <p>
                    Load credit once. Each case auto-deducts. Fastest dispatch, cleanest book-keeping.
                  </p>
                </div>
              </div>
              <p className="footnote">
                You can change your default any time in Settings → Billing.
              </p>
            </>
          )}

          {/* ── STEP 4: Where to next ─── */}
          {step === 4 && (
            <>
              <div className="eyebrow">YOU'RE ALL SET</div>
              <h2 className="stepTitle" id="welcome-step-title">
                Where to next, {personalName}?
              </h2>
              <p className="stepLead">
                Pick whichever feels right.<br />
                You can always come back to either.
              </p>

              <div
                className="ctaRow ctaPrimary"
                onClick={handleSubmitCase}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmitCase()}
              >
                <div>
                  <div className="ctaName">Submit your first case</div>
                  <div className="ctaMeta">~2 minutes · we'll guide you through the form</div>
                </div>
                <span className="ctaArrow">→</span>
              </div>

              <div
                className="ctaRow ctaSecondary"
                onClick={handleShowAround}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleShowAround()}
              >
                <div>
                  <div className="ctaName">Show me around the portal first</div>
                  <div className="ctaMeta">~3 minutes · dashboard, payments, support</div>
                </div>
                <span className="ctaArrow">→</span>
              </div>

              <button className="skipLink" onClick={handleSkipFinal}>
                Skip — I'll figure it out as I go
              </button>
            </>
          )}
        </div>

        {/* ═══ Footer ═══ */}
        <div className="modalFooter">
          <ProgressDots total={TOTAL_STEPS} current={step} />

          {step < 4 && (
            <div className="footerButtons">
              <button className="btnSkip" onClick={skipWelcome}>
                Skip
              </button>
              {step > 1 && (
                <button className="btnBack" onClick={goBackWelcomeStep}>
                  ← Back
                </button>
              )}
              <button
                ref={continueRef}
                className="btnContinue"
                onClick={advanceWelcomeStep}
              >
                {continueLabel} →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WelcomeModal;
