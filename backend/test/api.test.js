import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createQuestionBank, loadQuestionBank } from '../src/questionBank.js';
import { createMemoryStore } from '../src/store.js';

const bank = loadQuestionBank(new URL('../data/questions.json', import.meta.url));
const LEARNER = 'test-learner-0001';
let server;
let baseUrl;

before(async () => {
  const app = createApp({ bank, store: createMemoryStore() });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => server.close());

async function api(method, path, body, headers = {}) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const correctChoice = (questionId) => bank.getQuestion(questionId).correctChoiceId;
const wrongChoiceWithMisconception = (questionId) => {
  const q = bank.getQuestion(questionId);
  return Object.entries(q.wrongChoices).find(([, w]) => w.misconception)?.[0];
};

async function startQuiz(body = { count: 3 }, headers = {}) {
  const res = await api('POST', '/sessions', body, headers);
  assert.equal(res.status, 201);
  return res.body;
}

test('health check responds', async () => {
  const res = await api('GET', '/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.questions, bank.questionCount);
});

test('metrics endpoint returns API request statistics', async () => {
  const res = await api('GET', '/metrics');

  assert.equal(res.status, 200);
  assert.equal(typeof res.body.startedAt, 'string');
  assert.equal(typeof res.body.totalRequests, 'number');
  assert.equal(typeof res.body.totalResponseTimeMs, 'number');
  assert.equal(typeof res.body.averageResponseTimeMs, 'number');
  assert.equal(typeof res.body.byMethod, 'object');
  assert.equal(typeof res.body.byStatus, 'object');

  assert.ok(res.body.totalRequests >= 1);
});

test('topics lists the three AZ-900 domains with the unofficial notice', async () => {
  const res = await api('GET', '/topics');
  assert.equal(res.status, 200);
  assert.match(res.body.notice, /Unofficial/);
  assert.deepEqual(
    res.body.domains.map((d) => d.id),
    ['cloud-concepts', 'architecture-services', 'management-governance'],
  );
  assert.ok(res.body.domains.every((d) => d.questionCount > 0 && d.topics.length > 0));
});

test('questions never reveal the answer before the learner answers', async () => {
  const quiz = await startQuiz();
  for (const field of ['correctChoiceId', 'explanation', 'wrongChoices', 'learnMoreUrl']) {
    assert.equal(field in quiz.question, false, `${field} leaked to the client`);
  }
  const current = await api('GET', `/sessions/${quiz.sessionId}/question`);
  assert.equal('correctChoiceId' in current.body.question, false);
});

test('full quiz: feedback, lucky guesses, misconceptions, results and saved attempt', async () => {
  const learner = { 'x-learner-id': LEARNER };
  // Governance tools has exactly 3 questions, and every wrong option on them carries a misconception
  const quiz = await startQuiz({ count: 3, topics: ['Governance tools'] }, learner);
  let question = quiz.question;

  // 1: correct and sure
  let res = await api('POST', `/sessions/${quiz.sessionId}/answers`, {
    questionId: question.id,
    choiceId: correctChoice(question.id),
    confidence: 'sure',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.correct, true);
  assert.equal(res.body.luckyGuess, false);
  assert.ok(res.body.explanation);
  assert.ok(Object.keys(res.body.whyOthersAreWrong).length >= 1);
  question = res.body.nextQuestion;

  // 2: correct but guessing, which is a lucky guess
  res = await api('POST', `/sessions/${quiz.sessionId}/answers`, {
    questionId: question.id,
    choiceId: correctChoice(question.id),
    confidence: 'guessing',
  });
  assert.equal(res.body.correct, true);
  assert.equal(res.body.luckyGuess, true);
  assert.ok(res.body.note);
  question = res.body.nextQuestion;

  // 3: wrong, with a misconception attached
  const wrongId = wrongChoiceWithMisconception(question.id);
  res = await api('POST', `/sessions/${quiz.sessionId}/answers`, { questionId: question.id, choiceId: wrongId });
  assert.equal(res.body.correct, false);
  assert.ok(res.body.whyYourChoiceIsWrong);
  assert.ok(res.body.misconception.label);
  assert.equal(res.body.nextQuestion, null);
  assert.equal(res.body.progress.finished, true);

  const results = await api('GET', `/sessions/${quiz.sessionId}/results`);
  assert.equal(results.status, 200);
  assert.equal(results.body.finished, true);
  assert.equal(results.body.correct, 2);
  assert.equal(results.body.mastered, 1);
  assert.equal(results.body.luckyGuesses, 1);
  assert.equal(results.body.review.length, 3);
  assert.equal(results.body.misconceptions.length, 1);

  const governance = results.body.byDomain.find((d) => d.domain === 'management-governance');
  assert.equal(governance.percent, 67);
  assert.equal(governance.masteryPercent, 33);
  assert.equal(results.body.readiness.score, 33);
  assert.equal(results.body.readiness.level, 'not-yet');
  assert.equal(results.body.readiness.notCovered.length, 2);

  const recs = results.body.recommendations;
  assert.deepEqual(recs.items.map((i) => i.type), ['weak-domain', 'misconception', 'lucky-guess']);
  assert.deepEqual(recs.practiceSet.topics, ['Governance tools']);

  // The practice set can be posted straight back to start a new quiz
  const practice = await startQuiz(recs.practiceSet);
  assert.ok(recs.practiceSet.topics.includes(practice.question.topic));

  const wrongOnly = await api('GET', `/sessions/${quiz.sessionId}/results?review=wrong`);
  assert.equal(wrongOnly.body.review.length, 1);
  const luckyOnly = await api('GET', `/sessions/${quiz.sessionId}/results?review=lucky`);
  assert.equal(luckyOnly.body.review.length, 1);

  const history = await api('GET', `/learners/${LEARNER}/attempts`);
  assert.equal(history.status, 200);
  assert.equal(history.body.stats.attemptCount, 1);
  assert.equal(history.body.attempts[0].sessionId, quiz.sessionId);
  assert.equal(history.body.attempts[0].readinessScore, 33);
});

test('errors use one consistent shape and the right status codes', async () => {
  const quiz = await startQuiz({ count: 2 });
  const { sessionId, question } = quiz;
  const answer = (body) => api('POST', `/sessions/${sessionId}/answers`, body);

  let res = await api('GET', '/sessions/does-not-exist/question');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'SESSION_NOT_FOUND');

  res = await api('POST', '/sessions', { count: 0 });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  assert.equal(res.body.error.details[0].field, 'count');

  res = await api('POST', '/sessions', { domains: ['not-a-domain'] });
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');

  res = await api('POST', '/sessions', { topics: ['Underwater basket weaving'] });
  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'NO_QUESTIONS');

  res = await api('POST', '/sessions', {}, { 'x-learner-id': 'bad id!' });
  assert.equal(res.body.error.code, 'INVALID_LEARNER_ID');

  res = await api('POST', '/sessions', '{not json');
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_JSON');

  res = await answer({ questionId: question.id, choiceId: 'z' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_CHOICE');

  res = await answer({ questionId: question.id, choiceId: 'a', confidence: 'maybe' });
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');

  res = await answer({ questionId: question.id, choiceId: correctChoice(question.id) });
  assert.equal(res.status, 200);
  const nextId = res.body.nextQuestion.id;

  res = await answer({ questionId: question.id, choiceId: correctChoice(question.id) });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'ALREADY_ANSWERED');

  res = await answer({ questionId: 'not-a-question', choiceId: 'a' });
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'QUESTION_NOT_IN_SESSION');

  res = await api('GET', '/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'ROUTE_NOT_FOUND');

  assert.ok(nextId);
});

test('stray spaces around question and choice IDs are ignored', async () => {
  const quiz = await startQuiz({ count: 1 });
  const id = quiz.question.id;
  const res = await api('POST', `/sessions/${quiz.sessionId}/answers`, {
    questionId: ` ${id} `,
    choiceId: ` ${correctChoice(id)}`,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.correct, true);
});

test('answering out of order is rejected', async () => {
  const quiz = await startQuiz({ count: 3 });
  const results = await api('GET', `/sessions/${quiz.sessionId}/results`);
  assert.equal(results.body.answered, 0);
  assert.equal(results.body.readiness.level, 'not-enough-data');

  const first = await api('POST', `/sessions/${quiz.sessionId}/answers`, {
    questionId: quiz.question.id,
    choiceId: correctChoice(quiz.question.id),
  });
  const second = first.body.nextQuestion;
  const third = await findThirdQuestion(quiz.sessionId, second.id);
  const res = await api('POST', `/sessions/${quiz.sessionId}/answers`, {
    questionId: third,
    choiceId: 'a',
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'NOT_CURRENT_QUESTION');
  assert.equal(res.body.error.details.currentQuestionId, second.id);
});

// The third question isn't shown to the client yet, so try every question in the bank
// until one is rejected as "not current" rather than "not in session".
async function findThirdQuestion(sessionId, secondId) {
  for (const q of bank.pickQuestions({ count: bank.questionCount })) {
    if (q.id === secondId) continue;
    const res = await api('POST', `/sessions/${sessionId}/answers`, { questionId: q.id, choiceId: 'zzz' });
    if (res.body.error.code === 'NOT_CURRENT_QUESTION') return q.id;
  }
  throw new Error('third question not found');
}

test('the question bank rejects broken content at startup', () => {
  const raw = {
    domains: [{ id: 'd1', name: 'D1', examWeight: { min: 10, max: 20 }, learningPath: 'https://example.com' }],
    misconceptions: {},
    questions: [
      {
        id: 'q1',
        domain: 'd1',
        topic: 'T',
        question: 'Q?',
        choices: [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' },
          { id: 'c', text: 'C' },
        ],
        correctChoiceId: 'a',
        explanation: 'Because.',
        wrongChoices: { b: { why: 'No.', misconception: 'missing-tag' } },
        learnMoreUrl: 'https://example.com',
      },
    ],
  };
  assert.throws(() => createQuestionBank(raw), (err) => {
    assert.match(err.message, /wrong choice "c" needs an explanation/);
    assert.match(err.message, /unknown misconception "missing-tag"/);
    return true;
  });
});

test('links and difficulty are optional in the question bank', () => {
  const bankWithoutLinks = createQuestionBank({
    domains: [{ id: 'd1', name: 'D1', examWeight: { min: 10, max: 20 } }],
    misconceptions: {},
    questions: [
      {
        id: 'q1',
        domain: 'd1',
        topic: 'T',
        question: 'Q?',
        choices: [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' },
        ],
        correctChoiceId: 'a',
        explanation: 'Because.',
        wrongChoices: { b: { why: 'No.' } },
      },
    ],
  });
  assert.equal(bankWithoutLinks.questionCount, 1);
  assert.equal(bankWithoutLinks.getQuestion('q1').learnMoreUrl, undefined);
});

test('rate limiting blocks excessive requests but allows health and metrics', async () => {
  const app = createApp({
    bank,
    store: createMemoryStore(),
    rateLimitMax: 2,
    rateLimitWindowMs: 60_000,
  });

  const testServer = app.listen(0);
  await new Promise((resolve) => testServer.once('listening', resolve));

  const testBaseUrl = `http://127.0.0.1:${testServer.address().port}/api`;

  try {
    // The first two requests should be allowed.
    const first = await fetch(`${testBaseUrl}/topics`);
    assert.equal(first.status, 200);

    const second = await fetch(`${testBaseUrl}/topics`);
    assert.equal(second.status, 200);

    // The third request should be blocked.
    const third = await fetch(`${testBaseUrl}/topics`);
    assert.equal(third.status, 429);

    const thirdBody = await third.json();
    assert.equal(thirdBody.error.code, 'RATE_LIMIT_EXCEEDED');

    // Health and metrics endpoints should remain accessible.
    const health = await fetch(`${testBaseUrl}/health`);
    assert.equal(health.status, 200);

    const metrics = await fetch(`${testBaseUrl}/metrics`);
    assert.equal(metrics.status, 200);
  } finally {
    await new Promise((resolve, reject) => {
      testServer.close((err) => (err ? reject(err) : resolve()));
    });
  }
});
