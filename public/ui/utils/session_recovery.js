export const SESSION_RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function sessionTimestamp(session) {
  const value = session?.updated_at || session?.started_at || session?.saved_at;
  const timestamp = value ? Date.parse(value) : Number(session?.saved_at);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isActive(session) {
  return Boolean(session?.session_id || session?.external_id)
    && ['active', 'in_progress', 'paused'].includes(session.status || 'active');
}

export function decideSessionRecovery({
  practice = null,
  exam = null,
  now = Date.now(),
  maxAgeMs = SESSION_RECOVERY_MAX_AGE_MS
} = {}) {
  const candidates = [
    { type: 'practice', session: practice },
    { type: 'exam', session: exam }
  ].filter(({ session }) => isActive(session));

  if (candidates.length === 0) return { action: 'none' };

  const fresh = candidates.filter(({ session }) => {
    const timestamp = sessionTimestamp(session);
    return !timestamp || now - timestamp <= maxAgeMs;
  });
  if (fresh.length === 0) {
    const stale = candidates.sort((a, b) => sessionTimestamp(b.session) - sessionTimestamp(a.session))[0];
    return { action: 'ignore_stale', type: stale.type, session: stale.session };
  }
  const current = fresh.sort((a, b) => sessionTimestamp(b.session) - sessionTimestamp(a.session))[0];
  return { action: 'offer', type: current.type, session: current.session };
}

export function readStoredSession(key) {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage?.getItem(key) : null;
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn('[SessionRecovery] Invalid stored session:', err);
    return null;
  }
}

export function writeStoredSession(key, session) {
  if (typeof window === 'undefined') return;
  window.localStorage?.setItem(key, JSON.stringify({
    ...session,
    saved_at: new Date().toISOString()
  }));
}

export function clearStoredSession(key) {
  if (typeof window !== 'undefined') window.localStorage?.removeItem(key);
}
