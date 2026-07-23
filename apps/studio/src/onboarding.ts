export type OnboardingStatus = 'not_started' | 'in_progress' | 'completed' | 'dismissed'

export type OnboardingState = {
  guideVersion: string
  status: OnboardingStatus
  completedStepIds: string[]
  lastStepId?: string
  dismissedHintIds: string[]
}

export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const ONBOARDING_GUIDE_VERSION = 'director-studio-preview-v2'
export const ONBOARDING_STORAGE_KEY = 'aigc-director:onboarding'

export function createOnboardingState(): OnboardingState {
  return {
    guideVersion: ONBOARDING_GUIDE_VERSION,
    status: 'not_started',
    completedStepIds: [],
    dismissedHintIds: [],
  }
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))]
}

export function normalizeOnboardingState(value: unknown): OnboardingState {
  if (!value || typeof value !== 'object') return createOnboardingState()
  const candidate = value as Partial<OnboardingState>
  if (candidate.guideVersion !== ONBOARDING_GUIDE_VERSION) return createOnboardingState()
  const status: OnboardingStatus = ['not_started', 'in_progress', 'completed', 'dismissed'].includes(candidate.status ?? '')
    ? candidate.status as OnboardingStatus
    : 'not_started'
  return {
    guideVersion: ONBOARDING_GUIDE_VERSION,
    status,
    completedStepIds: uniqueStrings(candidate.completedStepIds),
    ...(typeof candidate.lastStepId === 'string' && candidate.lastStepId ? { lastStepId: candidate.lastStepId } : {}),
    dismissedHintIds: uniqueStrings(candidate.dismissedHintIds),
  }
}

export function loadOnboardingState(storage?: PreferenceStorage): OnboardingState {
  if (!storage) return createOnboardingState()
  try {
    const raw = storage.getItem(ONBOARDING_STORAGE_KEY)
    return raw ? normalizeOnboardingState(JSON.parse(raw)) : createOnboardingState()
  } catch {
    return createOnboardingState()
  }
}

export function saveOnboardingState(storage: PreferenceStorage | undefined, state: OnboardingState): OnboardingState {
  const normalized = normalizeOnboardingState(state)
  try { storage?.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(normalized)) } catch { /* 本地偏好不可用时不阻断创作 */ }
  return normalized
}

export function startOnboarding(state: OnboardingState, firstStepId: string): OnboardingState {
  return { ...normalizeOnboardingState(state), status: 'in_progress', lastStepId: firstStepId }
}

export function completeOnboardingStep(state: OnboardingState, stepId: string, nextStepId?: string): OnboardingState {
  const current = normalizeOnboardingState(state)
  return {
    ...current,
    status: nextStepId ? 'in_progress' : 'completed',
    completedStepIds: [...new Set([...current.completedStepIds, stepId])],
    ...(nextStepId ? { lastStepId: nextStepId } : { lastStepId: stepId }),
  }
}

export function pauseOnboarding(state: OnboardingState): OnboardingState {
  const current = normalizeOnboardingState(state)
  return { ...current, status: current.status === 'completed' ? 'completed' : 'dismissed' }
}

export function restartOnboarding(): OnboardingState {
  return createOnboardingState()
}

export function dismissOnboardingHint(state: OnboardingState, hintId: string): OnboardingState {
  const current = normalizeOnboardingState(state)
  return { ...current, dismissedHintIds: [...new Set([...current.dismissedHintIds, hintId])] }
}
