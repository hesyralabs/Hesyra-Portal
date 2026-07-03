import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import { authAPI } from '../utils/api';

const OnboardingContext = createContext(null);

// ─── Analytics stub — replace with real provider later ────────
const emit = (event, data = {}) => {
  if (import.meta.env.DEV) {
    console.log(`[onboarding] ${event}`, data);
  }
};

export const OnboardingProvider = ({ children }) => {
  const { user } = useAuth();

  // ─── Welcome Modal state ─────────────────────────────────────
  const [showWelcome, setShowWelcome] = useState(false);
  const [currentWelcomeStep, setCurrentWelcomeStep] = useState(1);
  const welcomeStartTime = useRef(null);

  // ─── Coach Tour state ────────────────────────────────────────
  const [showCoachTour, setShowCoachTour] = useState(false);
  const [currentTourStep, setCurrentTourStep] = useState(1);
  const [tourPending, setTourPending] = useState(false); // flag so NewCase knows to start tour
  const tourStartTime = useRef(null);

  // ─── Deep-Dive Drawer state ──────────────────────────────────
  const [showDrawer, setShowDrawer] = useState(false);

  // ─── Confetti ────────────────────────────────────────────────
  const [showConfetti, setShowConfetti] = useState(false);

  // ─── Fire-and-forget API update ──────────────────────────────
  const persistState = useCallback((data) => {
    authAPI.updateOnboardingState(data).catch(() => {
      /* Swallow — never block UI */
    });
  }, []);

  // ─── On mount: decide if welcome should show ─────────────────
  useEffect(() => {
    if (user && user.role === 'dentist' && user.onboardingComplete === true) {
      if (user.welcomeCompleted === false) {
        const resumeStep = user.welcomeLastStep || 1;
        setCurrentWelcomeStep(resumeStep);
        setShowWelcome(true);
        welcomeStartTime.current = Date.now();
        emit('onboarding.welcome.opened', { stepStartedAt: resumeStep });
      }
      // If welcome is done but tour isn't, mark pending for first New Case click
      if (user.welcomeCompleted === true && user.newCaseTourCompleted === false) {
        setTourPending(true);
      }
    }
  }, [user]);

  // ─── Welcome Modal actions ───────────────────────────────────
  const advanceWelcomeStep = useCallback(() => {
    setCurrentWelcomeStep((prev) => {
      const next = Math.min(prev + 1, 4);
      emit('onboarding.welcome.step_advanced', { from: prev, to: next });
      persistState({ welcomeLastStep: next });
      return next;
    });
  }, [persistState]);

  const goBackWelcomeStep = useCallback(() => {
    setCurrentWelcomeStep((prev) => {
      const next = Math.max(prev - 1, 1);
      emit('onboarding.welcome.step_back', { from: prev, to: next });
      return next;
    });
  }, []);

  const completeWelcome = useCallback((action) => {
    // action: "submit" | "tour" | "skip"
    const totalTimeMs = welcomeStartTime.current ? Date.now() - welcomeStartTime.current : 0;
    emit('onboarding.welcome.completed', { totalTimeMs, action });
    persistState({ welcomeCompleted: true });
    setShowWelcome(false);

    if (action === 'tour') {
      setShowDrawer(true);
      persistState({ deepDiveOpenedCount: (user?.deepDiveOpenedCount || 0) + 1 });
      emit('onboarding.drawer.opened', { trigger: 'welcomeFlow' });
    } else if (action === 'submit') {
      // Tour will start when they reach NewCase
      setTourPending(true);
    }
    // 'skip' → just close
  }, [persistState, user]);

  const skipWelcome = useCallback(() => {
    emit('onboarding.welcome.skipped', { atStep: currentWelcomeStep });
    completeWelcome('skip');
  }, [currentWelcomeStep, completeWelcome]);

  // ─── Coach Tour actions ──────────────────────────────────────
  const startCoachTour = useCallback(() => {
    setShowCoachTour(true);
    setCurrentTourStep(1);
    setTourPending(false);
    tourStartTime.current = Date.now();
    emit('onboarding.tour.opened', { trigger: 'auto' });
  }, []);

  const advanceTourStep = useCallback(() => {
    setCurrentTourStep((prev) => {
      const next = prev + 1;
      if (next > 6) {
        // Tour complete
        const totalTimeMs = tourStartTime.current ? Date.now() - tourStartTime.current : 0;
        emit('onboarding.tour.completed', { totalTimeMs });
        persistState({ newCaseTourCompleted: true });
        setShowCoachTour(false);
        setTourPending(false);
        return prev;
      }
      emit('onboarding.tour.step_advanced', { from: prev, to: next });
      return next;
    });
  }, [persistState]);

  const skipTour = useCallback(() => {
    emit('onboarding.tour.skipped', { atStep: currentTourStep });
    persistState({ newCaseTourCompleted: true });
    setShowCoachTour(false);
    setTourPending(false);
  }, [currentTourStep, persistState]);

  const completeTour = useCallback(() => {
    const totalTimeMs = tourStartTime.current ? Date.now() - tourStartTime.current : 0;
    emit('onboarding.tour.completed', { totalTimeMs });
    persistState({ newCaseTourCompleted: true });
    setShowCoachTour(false);
    setTourPending(false);
  }, [persistState]);

  const endTourSilently = useCallback(() => {
    persistState({ newCaseTourCompleted: true });
    setShowCoachTour(false);
    setTourPending(false);
  }, [persistState]);

  // ─── Deep-Dive Drawer actions ────────────────────────────────
  const openDrawer = useCallback((trigger = 'nav') => {
    setShowDrawer(true);
    persistState({ deepDiveOpenedCount: (user?.deepDiveOpenedCount || 0) + 1 });
    emit('onboarding.drawer.opened', { trigger });
  }, [persistState, user]);

  const closeDrawer = useCallback(() => {
    setShowDrawer(false);
  }, []);

  // ─── Confetti ────────────────────────────────────────────────
  const fireConfetti = useCallback(() => {
    setShowConfetti(true);
  }, []);

  const clearConfetti = useCallback(() => {
    setShowConfetti(false);
  }, []);

  return (
    <OnboardingContext.Provider
      value={{
        // Welcome
        showWelcome,
        currentWelcomeStep,
        advanceWelcomeStep,
        goBackWelcomeStep,
        completeWelcome,
        skipWelcome,

        // Coach Tour
        showCoachTour,
        currentTourStep,
        tourPending,
        startCoachTour,
        advanceTourStep,
        skipTour,
        completeTour,
        endTourSilently,

        // Drawer
        showDrawer,
        openDrawer,
        closeDrawer,

        // Confetti
        showConfetti,
        fireConfetti,
        clearConfetti,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
};

export const useOnboarding = () => {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be used within OnboardingProvider');
  return ctx;
};
