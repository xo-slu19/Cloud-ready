import os from 'node:os';
import { Router } from 'express';

// Says which server instance answered. With several instances behind a load balancer,
// this is how we can show that requests are being shared between them.
const INSTANCE_ID = `${process.env.RENDER_INSTANCE_ID || os.hostname()}:${process.pid}`;

// The memory store has nothing to ping, so only stores that define ping() are checked.
async function pingStore(store) {
  if (typeof store.ping !== 'function') return true;
  try {
    return Boolean(await store.ping());
  } catch {
    return false;
  }
}

export function createHealthRouter({ bank, store }) {
  const router = Router();

  router.get('/health', async (req, res) => {
    const redisConfigured = store.redisConfigured === true;
    const redis = redisConfigured ? ((await pingStore(store)) ? 'up' : 'down') : 'not-configured';

    res.json({
      // The frontend only accepts status "ok", and a server on the memory fallback can still
      // serve quizzes, so status stays "ok". `degraded` and `redis` carry the warning instead.
      status: 'ok',
      degraded: redis === 'down',
      questions: bank.questionCount,
      uptimeSeconds: Math.round(process.uptime()),
      store: store.kind ?? 'memory',
      redis,
      instanceId: INSTANCE_ID,
    });
  });

  return router;
}
