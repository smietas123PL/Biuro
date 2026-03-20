import {
  ONBOARDING_VERSION,
  type OnboardingAnalyticsEventName,
  type OnboardingStartSource,
} from './onboarding';
import { getAuthToken, getSelectedCompanyId } from './session';

type OnboardingAnalyticsPayload = {
  name: OnboardingAnalyticsEventName;
  stepId?: string;
  stepIndex?: number;
  totalSteps?: number;
  route?: string;
  source?: OnboardingStartSource;
  metadata?: Record<string, string | number | boolean | null>;
};

const ONBOARDING_ANALYTICS_EVENT = 'biuro:onboarding-analytics';

export async function sendOnboardingAnalyticsEvent(
  payload: OnboardingAnalyticsPayload
) {
  const token = getAuthToken();
  const companyId = getSelectedCompanyId();

  const body = {
    name: payload.name,
    tutorial_version: ONBOARDING_VERSION,
    step_id: payload.stepId,
    step_index: payload.stepIndex,
    total_steps: payload.totalSteps,
    route: payload.route,
    source: payload.source,
    occurred_at: new Date().toISOString(),
    metadata: payload.metadata,
  };

  window.dispatchEvent(
    new CustomEvent(ONBOARDING_ANALYTICS_EVENT, {
      detail: body,
    })
  );

  if (!token || !companyId) {
    return;
  }

  try {
    await fetch('/api/observability/client-events', {
      method: 'POST',
      keepalive: true,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-company-id': companyId,
      },
      body: JSON.stringify(body),
    });
  } catch {
    // Analytics should never block the user flow.
  }
}
