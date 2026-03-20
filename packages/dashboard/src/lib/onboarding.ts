export const ONBOARDING_VERSION = 'v2';

export type OnboardingStatus = 'idle' | 'active' | 'completed';

export type OnboardingPlacement =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'center';

export type OnboardingStep = {
  id: string;
  title: string;
  description: string;
  target?: string;
  placement?: OnboardingPlacement;
  route?: string;
  spotlightPadding?: number;
};

export type OnboardingAnalyticsEventName =
  | 'onboarding_started'
  | 'onboarding_replayed'
  | 'onboarding_step_viewed'
  | 'onboarding_completed'
  | 'onboarding_skipped';

export type OnboardingStartSource =
  | 'first_run'
  | 'manual_start'
  | 'manual_replay';

export function getOnboardingStorageKey(userId: string) {
  return `biuro.onboarding.completed.${ONBOARDING_VERSION}.${userId}`;
}

export function getOnboardingSeenVersionKey(userId: string) {
  return `biuro.onboarding.seen-version.${userId}`;
}

export function getChecklistDismissedKey(userId: string, companyId: string) {
  return `biuro.onboarding.checklist.dismissed.${ONBOARDING_VERSION}.${userId}.${companyId}`;
}
