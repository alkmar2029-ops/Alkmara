'use client';

import { useState, useEffect, useCallback } from 'react';

export interface ClassSessionState {
  date?: string;        // YYYY-MM-DD
  gradeId?: number | null;
  sectionId?: number | null;
  periodId?: number | null;
}

const KEY = 'teacher.class_session.v1';
const TTL_MS = 45 * 60 * 1000;  // 45-minute window — matches a class period

interface StoredSession extends ClassSessionState {
  savedAt: number;
}

/**
 * Lightweight persistence for the teacher's "currently active class".
 * Keeps grade/section/period/date sticky across reloads and tab switches
 * for ~45 minutes. After expiry the picker resets so a teacher entering
 * the next class doesn't accidentally record into the previous one.
 *
 * Setter is debounced via useEffect so callers can drive it from any
 * combination of state without thinking about timing.
 */
export function useClassSession(): {
  session: ClassSessionState;
  setSession: (next: ClassSessionState) => void;
  patch: (next: Partial<ClassSessionState>) => void;
  clear: () => void;
  loaded: boolean;
} {
  const [session, setSessionState] = useState<ClassSessionState>({});
  const [loaded, setLoaded] = useState(false);

  // Hydrate from storage once on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) { setLoaded(true); return; }
      const parsed = JSON.parse(raw) as StoredSession;
      const age = Date.now() - (parsed.savedAt || 0);
      if (age >= 0 && age < TTL_MS) {
        const { savedAt: _ignored, ...rest } = parsed;
        setSessionState(rest);
      } else {
        // Expired — wipe so we don't keep fragments.
        localStorage.removeItem(KEY);
      }
    } catch { /* corrupt JSON — ignore */ }
    setLoaded(true);
  }, []);

  // Persist whenever state changes (after hydration).
  useEffect(() => {
    if (!loaded) return;
    if (typeof window === 'undefined') return;
    try {
      const hasAny = session.date || session.gradeId || session.sectionId || session.periodId;
      if (hasAny) {
        const payload: StoredSession = { ...session, savedAt: Date.now() };
        localStorage.setItem(KEY, JSON.stringify(payload));
      } else {
        localStorage.removeItem(KEY);
      }
    } catch { /* quota / SecurityError — ignore */ }
  }, [session, loaded]);

  const setSession = useCallback((next: ClassSessionState) => setSessionState(next), []);
  const patch = useCallback((next: Partial<ClassSessionState>) =>
    setSessionState((cur) => ({ ...cur, ...next })), []);
  const clear = useCallback(() => setSessionState({}), []);

  return { session, setSession, patch, clear, loaded };
}
