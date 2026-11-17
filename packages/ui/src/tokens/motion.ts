import { useEffect, useState } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function getInitialPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function usePrefersReducedMotion(forceReduced?: boolean): boolean {
  const [prefersReduced, setPrefersReduced] = useState<boolean>(() =>
    forceReduced !== undefined ? forceReduced : getInitialPrefersReducedMotion(),
  );

  useEffect(() => {
    if (forceReduced !== undefined) {
      setPrefersReduced(forceReduced);
      return;
    }
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    setPrefersReduced(mediaQuery.matches);

    const onChange = (event: MediaQueryListEvent) => {
      setPrefersReduced(event.matches);
    };
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }, [forceReduced]);

  return prefersReduced;
}
