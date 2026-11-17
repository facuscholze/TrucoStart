import type { UserSettings } from '@truco/shared';

const PREFS_STORAGE_KEY = 'truco.client.preferences.v1';
const ONBOARDING_SEEN_KEY = 'truco.client.onboardingSeen.v1';

export interface ClientPreferences extends UserSettings {
  highContrast: boolean;
  largeText: boolean;
}

export const DEFAULT_CLIENT_PREFERENCES: ClientPreferences = {
  soundEnabled: true,
  animationsReduced: false,
  confirmCalls: false,
  highContrast: false,
  largeText: false,
};

export function loadClientPreferences(): ClientPreferences {
  if (typeof window === 'undefined') return { ...DEFAULT_CLIENT_PREFERENCES };
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CLIENT_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<ClientPreferences>;
    return {
      soundEnabled:
        typeof parsed.soundEnabled === 'boolean'
          ? parsed.soundEnabled
          : DEFAULT_CLIENT_PREFERENCES.soundEnabled,
      animationsReduced:
        typeof parsed.animationsReduced === 'boolean'
          ? parsed.animationsReduced
          : DEFAULT_CLIENT_PREFERENCES.animationsReduced,
      confirmCalls:
        typeof parsed.confirmCalls === 'boolean'
          ? parsed.confirmCalls
          : DEFAULT_CLIENT_PREFERENCES.confirmCalls,
      highContrast:
        typeof parsed.highContrast === 'boolean'
          ? parsed.highContrast
          : DEFAULT_CLIENT_PREFERENCES.highContrast,
      largeText:
        typeof parsed.largeText === 'boolean'
          ? parsed.largeText
          : DEFAULT_CLIENT_PREFERENCES.largeText,
    };
  } catch {
    return { ...DEFAULT_CLIENT_PREFERENCES };
  }
}

export function applyPreferencesToDocument(prefs: ClientPreferences): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset['reducedMotion'] = prefs.animationsReduced ? 'true' : 'false';
  root.dataset['highContrast'] = prefs.highContrast ? 'true' : 'false';
  root.dataset['largeText'] = prefs.largeText ? 'true' : 'false';
}

export function saveClientPreferences(next: ClientPreferences): ClientPreferences {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignorar cuota llena en modo privado
    }
  }
  applyPreferencesToDocument(next);
  return next;
}

export function mergeServerSettingsIntoPreferences(
  serverSettings: UserSettings,
): ClientPreferences {
  const current = loadClientPreferences();
  return saveClientPreferences({
    ...current,
    soundEnabled: serverSettings.soundEnabled,
    animationsReduced: serverSettings.animationsReduced,
    confirmCalls: serverSettings.confirmCalls,
  });
}

export function hasSeenOnboarding(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(ONBOARDING_SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

export function markOnboardingSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ONBOARDING_SEEN_KEY, '1');
  } catch {
    // Ignorar errores de almacenamiento
  }
}
