import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useOnboarding } from '../../context/OnboardingContext';
import './CoachTour.css';

/* ─── Tour Step Definitions ─────────────────────────────────── *
 * Each step maps to a data-tour-target attribute in NewCase.jsx.
 * `formStep` tracks which NewCase wizard page the target lives on.
 * ─────────────────────────────────────────────────────────────── */
const TOUR_STEPS = [
  {
    target: 'sku',
    label: 'Case Type',
    title: 'Step 1 — Pick your SKU',
    body: 'The entire form adapts based on your selection. Crown & Bridge shows tooth notation and shade selectors; Aligners asks for arch and movement goals. Pick the one that matches your clinical intent.',
    formStep: 1,
  },
  {
    target: 'patient',
    label: 'Patient ID',
    title: 'Step 2 — Patient reference',
    body: 'Enter any non-identifying code — "JD-104", a chart number, or a nickname. Hesyra never stores real patient names, keeping your practice HIPAA/DPDP-compliant by default.',
    formStep: 2,
  },
  {
    target: 'tooth',
    label: 'Tooth Chart',
    title: 'Step 3 — FDI tooth selection',
    body: 'Click or tap to select teeth in standard FDI notation (e.g., 11 = upper-right central incisor, 36 = lower-left first molar). The system auto-groups contiguous teeth into bridge units.',
    formStep: 2,
  },
  {
    target: 'shade',
    label: 'Shade',
    title: 'Step 4 — Target shade',
    body: 'Pick a VITA Classical or 3D-Master reference. Critical for anterior crowns and veneers — optional for surgical guides and retainers. When in doubt, A2 is a safe default.',
    formStep: 2,
  },
  {
    target: 'notes',
    label: 'Instructions',
    title: 'Step 5 — Special instructions',
    body: 'Margin preferences, contact tightness, occlusion notes, pontic design — anything that helps us get it right on the first try. The more context you share, the fewer remakes.',
    formStep: 2,
  },
  {
    target: 'scan',
    label: 'Scan Upload',
    title: 'Step 6 — Upload digital scans',
    body: 'Drop STL, PLY, or OBJ files from any major intraoral scanner (3Shape, iTero, Medit, Carestream). For surgical guides, include the CBCT export as a .dcm or .zip archive.',
    formStep: 3,
  },
];

const TOTAL = TOUR_STEPS.length;

/**
 * Compute popover position relative to the spotlit target.
 */
const computePosition = (targetRect) => {
  const POPOVER_W = 340;
  const GAP = 16;
  const EDGE_MIN = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let arrow, top, left;

  // Prefer positioning to the right
  if (vw - targetRect.right >= POPOVER_W + GAP + EDGE_MIN) {
    arrow = 'left';
    left = targetRect.right + GAP;
    top = targetRect.top + Math.min(0, targetRect.height / 2 - 60);
  }
  // Else try left
  else if (targetRect.left >= POPOVER_W + GAP + EDGE_MIN) {
    arrow = 'right';
    left = targetRect.left - POPOVER_W - GAP;
    top = targetRect.top + Math.min(0, targetRect.height / 2 - 60);
  }
  // Else below
  else {
    arrow = 'top';
    left = Math.max(EDGE_MIN, targetRect.left + targetRect.width / 2 - POPOVER_W / 2);
    top = targetRect.bottom + GAP;
  }

  // Clamp to viewport edges
  left = Math.max(EDGE_MIN, Math.min(left, vw - POPOVER_W - EDGE_MIN));
  top = Math.max(EDGE_MIN, Math.min(top, vh - 260));

  return { top, left, arrow };
};

const CoachTour = () => {
  const {
    currentTourStep,
    advanceTourStep,
    skipTour,
    completeTour,
    showCoachTour,
  } = useOnboarding();

  const [position, setPosition] = useState({ top: 0, left: 0, arrow: 'left' });
  const [targetEl, setTargetEl] = useState(null);
  const [visible, setVisible] = useState(false); // whether popover/spotlight are shown
  const popoverRef = useRef(null);
  const pollRef = useRef(null);

  const stepData = TOUR_STEPS[currentTourStep - 1];
  const isLast = currentTourStep === TOTAL;

  // ─── Clean up spotlight classes ───────────────────────────────
  const clearSpotlights = useCallback(() => {
    document.querySelectorAll('.spotlit').forEach((el) => el.classList.remove('spotlit'));
  }, []);

  // ─── Try to find and spotlight the current target ─────────────
  const attemptSpotlight = useCallback(() => {
    if (!stepData) return false;

    clearSpotlights();

    const selector = `[data-tour-target="${stepData.target}"]`;
    const el = document.querySelector(selector);

    if (!el) return false;

    // Scroll into view
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Slight delay for scroll to settle
    setTimeout(() => {
      el.classList.add('spotlit');
      const rect = el.getBoundingClientRect();
      setPosition(computePosition(rect));
      setTargetEl(el);
      setVisible(true);
    }, 200);

    return true;
  }, [stepData, clearSpotlights]);

  // ─── Main effect: find target or poll silently ────────────────
  useEffect(() => {
    if (!showCoachTour || !stepData) return;

    // Clear previous state
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    clearSpotlights();
    setVisible(false);
    setTargetEl(null);

    // Try immediately
    const found = attemptSpotlight();

    if (!found) {
      // Target not in DOM — hide tour UI and poll silently
      // The tour is "paused" — no overlay, no popover
      pollRef.current = setInterval(() => {
        const selector = `[data-tour-target="${stepData.target}"]`;
        const el = document.querySelector(selector);
        if (el) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          attemptSpotlight();
        }
      }, 500);
    }

    return () => {
      clearSpotlights();
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [showCoachTour, currentTourStep, stepData, attemptSpotlight, clearSpotlights]);

  // ─── Reposition on resize / scroll ────────────────────────────
  useEffect(() => {
    if (!showCoachTour || !targetEl || !visible) return;

    const reposition = () => {
      const rect = targetEl.getBoundingClientRect();
      setPosition(computePosition(rect));
    };

    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true); // capture phase for inner scrolls

    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [showCoachTour, targetEl, visible]);

  // ─── ESC to skip ──────────────────────────────────────────────
  useEffect(() => {
    if (!showCoachTour) return;

    const handle = (e) => {
      if (e.key === 'Escape') handleSkip();
    };

    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [showCoachTour]);

  // ─── Handlers ─────────────────────────────────────────────────
  const handleNext = useCallback(() => {
    clearSpotlights();
    setVisible(false);
    setTargetEl(null);

    if (isLast) {
      completeTour();
    } else {
      advanceTourStep();
    }
  }, [isLast, completeTour, advanceTourStep, clearSpotlights]);

  const handleSkip = useCallback(() => {
    clearSpotlights();
    setVisible(false);
    setTargetEl(null);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    skipTour();
  }, [skipTour, clearSpotlights]);

  // ─── Render nothing when hidden (tour paused between form steps)
  if (!showCoachTour || !stepData || !visible) return null;

  return (
    <>
      {/* ─── Backdrop ─── */}
      <div className="coachBackdrop" aria-hidden="true" />

      {/* ─── Progress bar ─── */}
      <div className="coachProgressBar">
        {TOUR_STEPS.map((s, i) => (
          <div
            key={s.target}
            className={`coachProgressStep ${
              i + 1 < currentTourStep ? 'done' : ''
            } ${i + 1 === currentTourStep ? 'active' : ''}`}
          >
            <div className="coachProgressDot">
              {i + 1 < currentTourStep ? '✓' : i + 1}
            </div>
            <span className="coachProgressLabel">{s.label}</span>
          </div>
        ))}
      </div>

      {/* ─── Popover ─── */}
      <div
        ref={popoverRef}
        className="coachPopover"
        data-arrow={position.arrow}
        style={{ top: position.top, left: position.left }}
        role="tooltip"
        aria-live="polite"
      >
        <div className="coachEyebrow">
          FORM GUIDE &middot; {currentTourStep} OF {TOTAL}
        </div>
        <div className="coachTitle">{stepData.title}</div>
        <div className="coachBody">{stepData.body}</div>
        <div className="coachFooter">
          <button className="coachSkip" onClick={handleSkip}>
            Skip tour
          </button>
          <button className="coachNext" onClick={handleNext}>
            {isLast ? 'Finish tour ✓' : 'Got it →'}
          </button>
        </div>
      </div>
    </>
  );
};

export default CoachTour;
