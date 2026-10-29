import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnnaRuntime } from '../anna/types';

const STORAGE_KEY = 'mini-notes:onboarding:v1';
const STORAGE_TIMEOUT_MS = 2_000;
const SEEN_MARKER = { schemaVersion: 1, seenGuideVersion: 1 } as const;

type Outcome<T> = { ok: true; value: T } | { ok: false };
type GuideSession = {
  active: boolean;
  runtime: AnnaRuntime | undefined;
  marker: 'unknown' | 'missing' | 'seen' | 'protected';
  interacted: boolean;
  dismissed: boolean;
  writeAttempted: boolean;
  cancelRequests: Array<() => void>;
};

// Host promises are not cancellable. Bound our waiting time and discard late results.
function requestPreference<T>(request: () => Promise<T>, complete: (outcome: Outcome<T>) => void) {
  let settled = false;
  const finish = (outcome: Outcome<T>) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    complete(outcome);
  };
  const timer = setTimeout(() => finish({ ok: false }), STORAGE_TIMEOUT_MS);
  try {
    Promise.resolve(request()).then(value => finish({ ok: true, value }), () => finish({ ok: false }));
  } catch {
    finish({ ok: false });
  }
  return () => { settled = true; clearTimeout(timer); };
}

function saveDismissal(session: GuideSession, reportFailure: (failed: boolean) => void) {
  if (!session.active || !session.runtime || session.marker !== 'missing' || !session.dismissed || session.writeAttempted) return;
  session.writeAttempted = true;
  const runtime = session.runtime;
  session.cancelRequests.push(requestPreference(
    () => runtime.storage.set({ key: STORAGE_KEY, value: SEEN_MARKER }),
    outcome => { if (session.active) reportFailure(!outcome.ok); },
  ));
}

function isSeenMarker(value: unknown) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const marker = value as Record<string, unknown>;
  return marker.schemaVersion === 1 && marker.seenGuideVersion === 1;
}

export function useUsageGuide(runtime?: AnnaRuntime) {
  const [isOpen, setIsOpen] = useState(false);
  const [preferenceFailed, setPreferenceFailed] = useState(false);
  const current = useRef<GuideSession | null>(null);
  const hasInteracted = useRef(false);

  useEffect(() => {
    const session: GuideSession = {
      active: true, runtime, marker: 'unknown', interacted: hasInteracted.current,
      dismissed: false, writeAttempted: false, cancelRequests: [],
    };
    current.current = session;
    setIsOpen(false);
    setPreferenceFailed(false);
    if (runtime) {
      session.cancelRequests.push(requestPreference(
        () => runtime.storage.get({ key: STORAGE_KEY }),
        outcome => {
          if (!session.active) return;
          if (!outcome.ok) {
            session.marker = 'protected';
            setPreferenceFailed(true);
            return;
          }
          const result = outcome.value;
          const value = result && typeof result === 'object' ? result.value : undefined;
          if (value === null) {
            session.marker = 'missing';
            if (!session.interacted) setIsOpen(true);
            saveDismissal(session, setPreferenceFailed);
          } else {
            session.marker = isSeenMarker(value) ? 'seen' : 'protected';
          }
        },
      ));
    }
    return () => {
      session.active = false;
      for (const cancel of session.cancelRequests) cancel();
      if (current.current === session) current.current = null;
    };
  }, [runtime]);

  const open = useCallback(() => {
    hasInteracted.current = true;
    if (current.current) current.current.interacted = true;
    setIsOpen(true);
  }, []);

  const dismiss = useCallback(() => {
    setIsOpen(false);
    hasInteracted.current = true;
    const session = current.current;
    if (!session?.active) return;
    session.interacted = true;
    session.dismissed = true;
    saveDismissal(session, setPreferenceFailed);
  }, []);

  return { isOpen, preferenceFailed, open, dismiss };
}
