import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOnboarding } from '../../context/OnboardingContext';
import './DeepDiveDrawer.css';

const CASE_STATES = [
  'Received', 'CAD In Progress', 'CAD Review',
  'Print Queued', 'Printing', 'Post-Processing',
  'QA', 'Packaged', 'Dispatched',
];

const SECTIONS = [
  {
    id: 'dashboard',
    title: 'Your Dashboard',
    content: (
      <>
        <p>
          Live stats at the top: Active Cases, In QA, Dispatched, and your Wallet balance.
          They update the moment a case moves state — no refresh needed.
        </p>
        <p>
          Every case you've ever submitted is in Cases. Filter by state, date, SKU, or patient code.
        </p>
      </>
    ),
  },
  {
    id: 'states',
    title: 'The 9 Case States',
    content: (
      <>
        <p>
          Every case sits at one of nine clear states. The portal updates live — you don't have to ask where things stand.
        </p>
        <div className="stateGrid">
          {CASE_STATES.map((state) => (
            <div key={state} className="stateChip">{state}</div>
          ))}
        </div>
        <p>
          Cases never skip states. Cases never move backwards without an explicit reason logged.
        </p>
      </>
    ),
  },
  {
    id: 'payments',
    title: 'Payments & Wallet',
    content: (
      <>
        <p>
          Pay-on-Go sends a payment link when your case is ready for dispatch. Pay, dispatch goes out.
        </p>
        <p>
          Hesyra Wallet is a pre-paid balance. Each case auto-debits. Faster dispatch, cleaner accounting.
          Top up via UPI, card, or NEFT — all through Razorpay.
        </p>
        <p>
          Per-SKU prices are visible in the portal the moment you log in. Same prices for every dentist.
        </p>
      </>
    ),
  },
  {
    id: 'fairplay',
    title: 'Fair Play & Remakes',
    content: (
      <>
        <p>
          If we get something wrong: free remake, expedited turnaround, honest explanation.
        </p>
        <p>
          If a scan or Rx caused the issue: we share the evidence with you (annotated screenshots),
          then offer a paid remake. The first such incident in any 6-month window is at 50% off — most
          accounts never see a second.
        </p>
        <p>
          You always see the trust ledger on your account. No surprises.
        </p>
      </>
    ),
  },
  {
    id: 'support',
    title: 'Support & Visiting the Lab',
    content: (
      <>
        <p>
          Open a ticket from any case. Response within 2 working hours. Your account also gets
          a direct WhatsApp line for clinical conversations — that goes live with your first case.
        </p>
        <p>
          Want to visit the lab? We genuinely love this. Drop us a WhatsApp in advance and we'll
          set aside time for a proper walkthrough.
        </p>
      </>
    ),
  },
];

const DeepDiveDrawer = () => {
  const navigate = useNavigate();
  const { showDrawer, closeDrawer } = useOnboarding();

  // First section open by default
  const [openSections, setOpenSections] = useState({ dashboard: true });

  // ESC close
  useEffect(() => {
    if (!showDrawer) return;

    const handle = (e) => {
      if (e.key === 'Escape') closeDrawer();
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [showDrawer, closeDrawer]);

  const toggleSection = useCallback((id) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
    // analytics stub
    if (import.meta.env.DEV) {
      console.log('[onboarding] onboarding.drawer.section_expanded', { section: id });
    }
  }, []);

  const handleCta = useCallback(() => {
    closeDrawer();
    navigate('/new-case');
  }, [closeDrawer, navigate]);

  if (!showDrawer) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="drawerBackdrop onboarding"
        onClick={closeDrawer}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        className="drawer onboarding"
        role="complementary"
        aria-label="Portal walkthrough"
      >
        {/* Header */}
        <div className="drawerHeader">
          <h2 className="drawerTitle">The Hesyra Portal</h2>
          <button
            className="drawerClose"
            onClick={closeDrawer}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="drawerBody">
          {SECTIONS.map((section) => (
            <div key={section.id} className="section">
              <div
                className="sectionHeader"
                onClick={() => toggleSection(section.id)}
                role="button"
                tabIndex={0}
                aria-expanded={!!openSections[section.id]}
                onKeyDown={(e) => e.key === 'Enter' && toggleSection(section.id)}
              >
                <span className="sectionTitle">{section.title}</span>
                <span className={`sectionChevron ${openSections[section.id] ? 'open' : ''}`}>
                  ›
                </span>
              </div>
              {openSections[section.id] && (
                <div className="sectionBody">
                  {section.content}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="drawerFooter">
          <button className="drawerCta" onClick={handleCta}>
            Got it — let's submit a case
          </button>
        </div>
      </div>
    </>
  );
};

export default DeepDiveDrawer;
