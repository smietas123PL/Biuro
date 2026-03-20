import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { useOnboarding } from '../context/OnboardingContext';

type RectShape = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const PANEL_WIDTH = 360;
const VIEWPORT_GUTTER = 16;
const TOOLTIP_GAP = 18;

export function OnboardingTour() {
  const {
    status,
    currentStep,
    currentStepIndex,
    totalSteps,
    nextStep,
    previousStep,
    skipTutorial,
    completeTutorial,
  } = useOnboarding();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocusedElementRef = useRef<HTMLElement | null>(null);
  const isActive = status === 'active' && currentStep;
  const [targetRect, setTargetRect] = useState<RectShape | null>(null);
  const [panelRect, setPanelRect] = useState({ width: PANEL_WIDTH, height: 0 });

  useEffect(() => {
    if (!isActive) {
      setTargetRect(null);
      return;
    }

    const updateLayout = () => {
      const targetElement = currentStep.target
        ? document.querySelector<HTMLElement>(currentStep.target)
        : null;

      if (targetElement) {
        const nextRect = targetElement.getBoundingClientRect();
        setTargetRect(
          nextRect.width > 0 && nextRect.height > 0
            ? {
                top: nextRect.top,
                left: nextRect.left,
                width: nextRect.width,
                height: nextRect.height,
              }
            : null
        );
      } else {
        setTargetRect(null);
      }

      if (panelRef.current) {
        const nextPanelRect = panelRef.current.getBoundingClientRect();
        setPanelRect({
          width: nextPanelRect.width || PANEL_WIDTH,
          height: nextPanelRect.height || 0,
        });
      }
    };

    const scheduleLayoutUpdate = () => {
      window.requestAnimationFrame(updateLayout);
    };

    updateLayout();

    window.addEventListener('resize', scheduleLayoutUpdate);
    window.addEventListener('scroll', scheduleLayoutUpdate, true);
    const intervalId = window.setInterval(updateLayout, 300);

    return () => {
      window.removeEventListener('resize', scheduleLayoutUpdate);
      window.removeEventListener('scroll', scheduleLayoutUpdate, true);
      window.clearInterval(intervalId);
    };
  }, [currentStep, isActive]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    previousFocusedElementRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const targetElement = currentStep.target
      ? document.querySelector<HTMLElement>(currentStep.target)
      : null;
    targetElement?.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: 'smooth',
    });

    const focusTimeout = window.setTimeout(() => {
      const focusableElements = getFocusableElements(panelRef.current);
      focusableElements[0]?.focus();
      if (focusableElements.length === 0) {
        panelRef.current?.focus();
      }
    }, 50);

    return () => {
      window.clearTimeout(focusTimeout);
      previousFocusedElementRef.current?.focus();
    };
  }, [currentStep, isActive]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        skipTutorial();
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        nextStep();
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        previousStep();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const panel = panelRef.current;
      if (!panel) {
        return;
      }

      const focusableElements = getFocusableElements(panel);
      if (focusableElements.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const activeElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey) {
        if (activeElement === firstElement || activeElement === panel) {
          event.preventDefault();
          lastElement?.focus();
        }
        return;
      }

      if (activeElement === lastElement) {
        event.preventDefault();
        firstElement?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, nextStep, previousStep, skipTutorial]);

  const spotlightRect = useMemo(() => {
    if (!targetRect || !currentStep) {
      return null;
    }

    const padding = currentStep.spotlightPadding ?? 12;
    return {
      top: Math.max(targetRect.top - padding, VIEWPORT_GUTTER),
      left: Math.max(targetRect.left - padding, VIEWPORT_GUTTER),
      width: Math.max(targetRect.width + padding * 2, 0),
      height: Math.max(targetRect.height + padding * 2, 0),
    };
  }, [currentStep, targetRect]);

  const panelPosition = useMemo(() => {
    if (!currentStep) {
      return {
        left: VIEWPORT_GUTTER,
        top: VIEWPORT_GUTTER,
        maxWidth: `calc(100vw - ${VIEWPORT_GUTTER * 2}px)`,
      };
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(panelRect.width || PANEL_WIDTH, viewportWidth - 32);
    const height = panelRect.height || 260;
    const placement = currentStep.placement ?? 'bottom';

    if (!spotlightRect || placement === 'center') {
      return {
        left: Math.max((viewportWidth - width) / 2, VIEWPORT_GUTTER),
        top: Math.max((viewportHeight - height) / 2, VIEWPORT_GUTTER),
        maxWidth: `calc(100vw - ${VIEWPORT_GUTTER * 2}px)`,
      };
    }

    const centeredLeft =
      spotlightRect.left + spotlightRect.width / 2 - width / 2;
    const centeredTop =
      spotlightRect.top + spotlightRect.height / 2 - height / 2;

    let left = centeredLeft;
    let top = centeredTop;

    if (placement === 'bottom') {
      top = spotlightRect.top + spotlightRect.height + TOOLTIP_GAP;
    }
    if (placement === 'top') {
      top = spotlightRect.top - height - TOOLTIP_GAP;
    }
    if (placement === 'left') {
      left = spotlightRect.left - width - TOOLTIP_GAP;
    }
    if (placement === 'right') {
      left = spotlightRect.left + spotlightRect.width + TOOLTIP_GAP;
    }

    const clampedLeft = clamp(
      left,
      VIEWPORT_GUTTER,
      viewportWidth - width - VIEWPORT_GUTTER
    );
    const clampedTop = clamp(
      top,
      VIEWPORT_GUTTER,
      viewportHeight - height - VIEWPORT_GUTTER
    );

    return {
      left: clampedLeft,
      top: clampedTop,
      maxWidth: `calc(100vw - ${VIEWPORT_GUTTER * 2}px)`,
    };
  }, [currentStep, panelRect.height, panelRect.width, spotlightRect]);

  if (!isActive || !currentStep) {
    return null;
  }

  const isLastStep = currentStepIndex === totalSteps - 1;

  return (
    <div className="pointer-events-none fixed inset-0 z-[80]">
      <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-[2px]" />

      {spotlightRect ? (
        <div
          aria-hidden="true"
          className="onboarding-spotlight-enter pointer-events-none absolute rounded-[28px] border border-white/70 shadow-[0_0_0_9999px_rgba(15,23,42,0.4)] transition-all duration-200"
          style={{
            top: spotlightRect.top,
            left: spotlightRect.left,
            width: spotlightRect.width,
            height: spotlightRect.height,
          }}
        />
      ) : null}

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`onboarding-step-title-${currentStep.id}`}
        aria-describedby={`onboarding-step-description-${currentStep.id}`}
        tabIndex={-1}
        className="onboarding-panel-enter pointer-events-auto absolute w-[min(360px,calc(100vw-2rem))] rounded-[28px] border border-white/15 bg-slate-950/95 p-5 text-white shadow-2xl outline-none"
        style={panelPosition}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-200/90">
              Krok {currentStepIndex + 1} z {totalSteps}
            </div>
            <h2
              id={`onboarding-step-title-${currentStep.id}`}
              className="mt-2 text-xl font-semibold tracking-tight"
            >
              {currentStep.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={skipTutorial}
            className="rounded-full border border-white/15 px-3 py-1 text-xs font-medium text-white/80 transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white"
          >
            Pomiń
          </button>
        </div>

        <p
          id={`onboarding-step-description-${currentStep.id}`}
          className="mt-4 text-sm leading-6 text-slate-200"
        >
          {currentStep.description}
        </p>

        {!spotlightRect ? (
          <div className="mt-4 rounded-2xl border border-sky-300/20 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">
            Ten krok nie wymaga wskazania konkretnego elementu. Możesz przejść
            dalej albo wrócić do niego później przez przycisk tutorialu.
          </div>
        ) : null}

        <div className="mt-5 flex items-center gap-2">
          {Array.from({ length: totalSteps }, (_, index) => (
            <span
              key={index}
              className={clsx(
                'h-1.5 rounded-full transition-all',
                index === currentStepIndex ? 'w-8 bg-sky-300' : 'w-1.5 bg-white/25'
              )}
            />
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={previousStep}
            disabled={currentStepIndex === 0}
            className="rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-white transition-colors hover:border-white/30 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Wstecz
          </button>

          <button
            type="button"
            onClick={isLastStep ? completeTutorial : nextStep}
            className="rounded-full bg-sky-300 px-4 py-2 text-sm font-semibold text-slate-950 transition-transform hover:scale-[1.01]"
          >
            {isLastStep ? 'Zakończ' : 'Dalej'}
          </button>
        </div>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  if (max <= min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function getFocusableElements(container: HTMLElement | null) {
  if (!container) {
    return [] as HTMLElement[];
  }

  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute('disabled'));
}
