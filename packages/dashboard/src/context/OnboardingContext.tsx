import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useCompany } from './CompanyContext';
import {
  ONBOARDING_VERSION,
  getOnboardingSeenVersionKey,
  getOnboardingStorageKey,
  type OnboardingStartSource,
  type OnboardingStatus,
  type OnboardingStep,
} from '../lib/onboarding';
import { sendOnboardingAnalyticsEvent } from '../lib/onboardingAnalytics';

type OnboardingContextValue = {
  status: OnboardingStatus;
  hasCompleted: boolean;
  currentStep: OnboardingStep | null;
  currentStepIndex: number;
  totalSteps: number;
  startTutorial: () => void;
  nextStep: () => void;
  previousStep: () => void;
  skipTutorial: () => void;
  completeTutorial: () => void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

type TutorialScenario = {
  hasSelectedCompany: boolean;
};

function buildTutorialSteps({
  hasSelectedCompany,
}: TutorialScenario): OnboardingStep[] {
  const sharedSteps: OnboardingStep[] = [
    {
      id: 'welcome',
      title: 'Poznaj Biuro w 2 minuty',
      description:
        'Przejdziemy razem przez najważniejsze miejsca w aplikacji, żeby pierwszy start był szybki i intuicyjny.',
      placement: 'center',
      route: '/',
    },
    {
      id: 'sidebar',
      title: 'Główna nawigacja',
      description:
        'Tutaj przechodzisz między dashboardem, agentami, taskami, approvals i pozostałymi widokami operacyjnymi.',
      target: '[data-onboarding-target="main-sidebar"]',
      placement: 'right',
      route: '/',
      spotlightPadding: 16,
    },
    {
      id: 'company-context',
      title: 'Kontekst firmy',
      description:
        'W tym miejscu wybierasz aktywną firmę albo tworzysz nową, zanim zaczniesz pracę z agentami i zadaniami.',
      target: '[data-onboarding-target="company-controls"]',
      placement: 'bottom',
      route: '/',
    },
    {
      id: 'command-search',
      title: 'Szybkie wyszukiwanie',
      description:
        'Search i skrót Ctrl+K pomagają błyskawicznie przeskakiwać do ekranów i akcji bez ręcznego klikania po menu.',
      target: '[data-onboarding-target="command-search"]',
      placement: 'bottom',
      route: '/',
    },
  ];

  if (!hasSelectedCompany) {
    return [
      ...sharedSteps,
      {
        id: 'company-empty-state',
        title: 'Pierwszy krok',
        description:
          'Zanim zobaczysz live metrics, wybierz istniejącą firmę albo utwórz nową z przycisku New Company.',
        target: '[data-onboarding-target="company-empty-state"]',
        placement: 'top',
        route: '/',
      },
      {
        id: 'tutorial-replay',
        title: 'Tutorial zawsze pod ręką',
        description:
          'Do walkthrough możesz wrócić w dowolnym momencie z przycisku Start tutorial albo z ustawień.',
        target: '[data-onboarding-target="tutorial-trigger"]',
        placement: 'bottom',
        route: '/',
      },
    ];
  }

  return [
    ...sharedSteps,
    {
      id: 'dashboard-metrics',
      title: 'Live dashboard',
      description:
        'To jest Twój szybki podgląd operacji: aktywni agenci, pending tasks, koszty i approvals w jednym miejscu.',
      target: '[data-onboarding-target="dashboard-metrics"]',
      placement: 'bottom',
      route: '/',
      spotlightPadding: 14,
    },
    {
      id: 'thought-stream',
      title: 'Live Thought Stream',
      description:
        'Tutaj śledzisz najnowsze myśli i heartbeat agentów, żeby szybko zrozumieć, nad czym teraz pracują.',
      target: '[data-onboarding-target="thought-stream"]',
      placement: 'top',
      route: '/',
      spotlightPadding: 14,
    },
    {
      id: 'activity-feed',
      title: 'Live Activity Feed',
      description:
        'Feed pokazuje bieżące zdarzenia operacyjne, więc łatwo wyłapiesz postęp, błędy i świeże działania zespołu.',
      target: '[data-onboarding-target="activity-feed"]',
      placement: 'top',
      route: '/',
      spotlightPadding: 14,
    },
    {
      id: 'agents-workspace',
      title: 'Agents',
      description: 'Tutaj budujesz i obsługujesz zespół agentów.',
      target: '[data-onboarding-target="agents-primary-actions"]',
      placement: 'bottom',
      route: '/agents',
    },
    {
      id: 'agents-hire-modal',
      title: 'Hire Agent',
      description: 'Nowego agenta dodajesz z tego formularza.',
      target: '[data-onboarding-target="agents-hire-modal"]',
      placement: 'right',
      route: '/agents',
      spotlightPadding: 18,
    },
    {
      id: 'agents-structure',
      title: 'Organization View',
      description: 'Organizacja pokazuje relacje między agentami.',
      target: '[data-onboarding-target="agents-organization-view"]',
      placement: 'top',
      route: '/agents',
      spotlightPadding: 14,
    },
    {
      id: 'tasks-workspace',
      title: 'Tasks',
      description: 'Backlog i wykonanie zbierasz w Tasks.',
      target: '[data-onboarding-target="tasks-primary-actions"]',
      placement: 'bottom',
      route: '/tasks',
    },
    {
      id: 'tasks-create-modal',
      title: 'Create Task',
      description: 'Nowe zadanie uruchamiasz z prostego formularza.',
      target: '[data-onboarding-target="tasks-create-modal"]',
      placement: 'right',
      route: '/tasks',
      spotlightPadding: 18,
    },
    {
      id: 'tasks-list',
      title: 'Lista zadań',
      description: 'Lista zadań pokazuje priorytety i przypisania.',
      target: '[data-onboarding-target="tasks-list"]',
      placement: 'top',
      route: '/tasks',
      spotlightPadding: 14,
    },
    {
      id: 'approvals-queue',
      title: 'Approvals',
      description: 'Krytyczne decyzje trafiają do approvals, zanim pójdą dalej.',
      target: '[data-onboarding-target="approvals-queue"]',
      placement: 'top',
      route: '/approvals',
      spotlightPadding: 14,
    },
    {
      id: 'tutorial-replay',
      title: 'Start tutorial',
      description:
        'Ten przycisk pozwala wrócić do tutorialu zawsze wtedy, gdy chcesz odświeżyć sobie układ produktu.',
      target: '[data-onboarding-target="tutorial-trigger"]',
      placement: 'bottom',
      route: '/',
    },
  ];
}

function persistCompletion(userId: string) {
  localStorage.setItem(getOnboardingStorageKey(userId), 'completed');
  localStorage.setItem(getOnboardingSeenVersionKey(userId), ONBOARDING_VERSION);
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { loading: companyLoading, selectedCompany } = useCompany();
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState<OnboardingStatus>('idle');
  const [hasCompleted, setHasCompleted] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [activeSteps, setActiveSteps] = useState<OnboardingStep[]>([]);
  const [startSource, setStartSource] =
    useState<OnboardingStartSource>('manual_start');
  const autoStartedRef = useRef(false);
  const viewedStepKeyRef = useRef<string | null>(null);

  const scenario = useMemo<TutorialScenario>(
    () => ({
      hasSelectedCompany: !!selectedCompany,
    }),
    [selectedCompany]
  );

  const currentStep =
    status === 'active' ? (activeSteps[currentStepIndex] ?? null) : null;
  const totalSteps = activeSteps.length;

  useEffect(() => {
    if (!user?.id) {
      setStatus('idle');
      setHasCompleted(false);
      setCurrentStepIndex(0);
      setActiveSteps([]);
      autoStartedRef.current = false;
      viewedStepKeyRef.current = null;
      return;
    }

    const seenVersion = localStorage.getItem(
      getOnboardingSeenVersionKey(user.id)
    );
    setHasCompleted(seenVersion === ONBOARDING_VERSION);
    autoStartedRef.current = false;
    viewedStepKeyRef.current = null;
  }, [user?.id]);

  const startTutorial = useCallback(
    (source?: OnboardingStartSource) => {
      if (!user?.id) {
        return;
      }

      const steps = buildTutorialSteps(scenario);
      const nextSource =
        source ?? (hasCompleted ? 'manual_replay' : 'manual_start');
      const firstStep = steps[0] ?? null;
      const firstRoute = firstStep?.route ?? '/';

      setActiveSteps(steps);
      setCurrentStepIndex(0);
      setStatus('active');
      setStartSource(nextSource);
      viewedStepKeyRef.current = null;
      autoStartedRef.current = true;

      if (firstRoute && location.pathname !== firstRoute) {
        navigate(firstRoute);
      }

      void sendOnboardingAnalyticsEvent({
        name:
          nextSource === 'manual_replay'
            ? 'onboarding_replayed'
            : 'onboarding_started',
        source: nextSource,
        stepId: firstStep?.id,
        stepIndex: 0,
        totalSteps: steps.length,
        route: firstRoute,
      });
    },
    [hasCompleted, location.pathname, navigate, scenario, user?.id]
  );

  useEffect(() => {
    if (
      !user?.id ||
      companyLoading ||
      status !== 'idle' ||
      autoStartedRef.current
    ) {
      return;
    }

    const seenVersion = localStorage.getItem(
      getOnboardingSeenVersionKey(user.id)
    );
    if (seenVersion === ONBOARDING_VERSION) {
      autoStartedRef.current = true;
      return;
    }

    startTutorial('first_run');
  }, [companyLoading, startTutorial, status, user?.id]);

  useEffect(() => {
    if (status !== 'active' || !currentStep?.route) {
      return;
    }

    if (location.pathname !== currentStep.route) {
      navigate(currentStep.route);
    }
  }, [currentStep?.route, location.pathname, navigate, status]);

  useEffect(() => {
    if (status !== 'active' || !currentStep) {
      return;
    }

    if (currentStep.route && location.pathname !== currentStep.route) {
      return;
    }

    const stepKey = `${currentStep.id}:${currentStepIndex}`;
    if (viewedStepKeyRef.current === stepKey) {
      return;
    }

    viewedStepKeyRef.current = stepKey;
    void sendOnboardingAnalyticsEvent({
      name: 'onboarding_step_viewed',
      source: startSource,
      stepId: currentStep.id,
      stepIndex: currentStepIndex,
      totalSteps,
      route: currentStep.route ?? location.pathname,
    });
  }, [
    currentStep,
    currentStepIndex,
    location.pathname,
    startSource,
    status,
    totalSteps,
  ]);

  const nextStep = useCallback(() => {
    setCurrentStepIndex((currentIndex) => {
      if (currentIndex >= activeSteps.length - 1) {
        return currentIndex;
      }

      return currentIndex + 1;
    });
  }, [activeSteps.length]);

  const previousStep = useCallback(() => {
    setCurrentStepIndex((currentIndex) => Math.max(currentIndex - 1, 0));
  }, []);

  const skipTutorial = useCallback(() => {
    if (user?.id) {
      persistCompletion(user.id);
    }

    void sendOnboardingAnalyticsEvent({
      name: 'onboarding_skipped',
      source: startSource,
      stepId: currentStep?.id,
      stepIndex: currentStepIndex,
      totalSteps,
      route: currentStep?.route ?? location.pathname,
    });

    setStatus('completed');
    setHasCompleted(true);
    setCurrentStepIndex(0);
    setActiveSteps([]);
    viewedStepKeyRef.current = null;
  }, [
    currentStep?.id,
    currentStep?.route,
    currentStepIndex,
    location.pathname,
    startSource,
    totalSteps,
    user?.id,
  ]);

  const completeTutorial = useCallback(() => {
    if (user?.id) {
      persistCompletion(user.id);
    }

    void sendOnboardingAnalyticsEvent({
      name: 'onboarding_completed',
      source: startSource,
      stepId: currentStep?.id,
      stepIndex: currentStepIndex,
      totalSteps,
      route: currentStep?.route ?? location.pathname,
    });

    setStatus('completed');
    setHasCompleted(true);
    setCurrentStepIndex(0);
    setActiveSteps([]);
    viewedStepKeyRef.current = null;
  }, [
    currentStep?.id,
    currentStep?.route,
    currentStepIndex,
    location.pathname,
    startSource,
    totalSteps,
    user?.id,
  ]);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      status,
      hasCompleted,
      currentStep,
      currentStepIndex,
      totalSteps,
      startTutorial: () => startTutorial(),
      nextStep,
      previousStep,
      skipTutorial,
      completeTutorial,
    }),
    [
      completeTutorial,
      currentStep,
      currentStepIndex,
      hasCompleted,
      nextStep,
      previousStep,
      skipTutorial,
      startTutorial,
      status,
      totalSteps,
    ]
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return context;
}
