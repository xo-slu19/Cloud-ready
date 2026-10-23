import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { loadQuestionBank } from '../src/questionBank.js';
import { createMemoryStore } from '../src/store.js';

const bank = loadQuestionBank(new URL('../data/questions.json', import.meta.url));

// Starts a temporary server with the given store, calls /api/health and shuts it down.
async function getHealth(store) {
  const server = createApp({ bank, store }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

test('health with the memory store: ok, redis not configured', async () => {
  const { status, body } = await getHealth(createMemoryStore());
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.degraded, false);
  assert.equal(body.store, 'memory');
  assert.equal(body.redis, 'not-configured');
  assert.equal(body.questions, bank.questionCount);
  assert.equal(typeof body.uptimeSeconds, 'number');
  assert.equal(typeof body.instanceId, 'string');
});

test('health with a working Redis store: redis is up', async () => {
  const store = { ...createMemoryStore(), kind: 'redis', redisConfigured: true, ping: async () => true };
  const { body } = await getHealth(store);
  assert.equal(body.store, 'redis');
  assert.equal(body.redis, 'up');
  assert.equal(body.degraded, false);
});

test('health when Redis is configured but unreachable: still ok for the frontend, but degraded', async () => {
  const store = {
    ...createMemoryStore(),
    kind: 'memory',
    redisConfigured: true,
    ping: async () => {
      throw new Error('connection refused');
    },
  };
  const { status, body } = await getHealth(store);
  assert.equal(status, 200); // a 503 would make Render think the service is down
  assert.equal(body.status, 'ok'); // the frontend only accepts "ok"
  assert.equal(body.redis, 'down');
  assert.equal(body.degraded, true);
});