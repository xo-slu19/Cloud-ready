const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_ATTEMPTS_PER_LEARNER = 50;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

// In-memory storage for quiz sessions and finished attempts.
//
// Everything is async and copied in and out (like a real database) so it can be replaced by
// a Redis-backed store with the same four methods. With Redis, data survives restarts and
// several server instances can share it, which is what the load test needs.
export function createMemoryStore({ sessionTtlMs = SESSION_TTL_MS, now = Date.now } = {}) {
  const sessions = new Map();
  const attempts = new Map();

  const sweep = setInterval(() => {
    for (const [id, entry] of sessions) {
      if (entry.expiresAt <= now()) sessions.delete(id);
    }
  }, SWEEP_INTERVAL_MS);
  sweep.unref(); // don't keep the process alive just for this timer

  return {
    async getSession(id) {
      const entry = sessions.get(id);
      if (!entry) return null;
      if (entry.expiresAt <= now()) {
        sessions.delete(id);
        return null;
      }
      return structuredClone(entry.session);
    },

    async saveSession(session) {
      sessions.set(session.id, { session: structuredClone(session), expiresAt: now() + sessionTtlMs });
    },

    async addAttempt(learnerId, attempt) {
      const list = attempts.get(learnerId) ?? [];
      list.unshift(structuredClone(attempt)); // newest first
      attempts.set(learnerId, list.slice(0, MAX_ATTEMPTS_PER_LEARNER));
    },

    async listAttempts(learnerId, limit) {
      return structuredClone((attempts.get(learnerId) ?? []).slice(0, limit));
    },
  };
}
