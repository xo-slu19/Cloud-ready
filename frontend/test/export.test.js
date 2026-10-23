import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResultsExport } from '../src/export.js';

test('results export serializes the real review, filters and summary without learner identity', () => {
  const results = {
    sessionId: 'session-123',
    completedAt: '2026-10-22T10:00:00.000Z',
    totalQuestions: 1,
    answered: 1,
    correct: 0,
    percent: 0,
    mastered: 0,
    luckyGuesses: 0,
    readiness: { score: 0, level: 'not-yet' },
    byDomain: [{ domain: 'cloud-concepts', answered: 1, percent: 0 }],
    review: [{ questionId: 'cc-001', correct: false, explanation: 'Original educational explanation.' }],
    misconceptions: [],
    recommendations: { items: [] },
  };
  const quiz = { domains: ['cloud-concepts'], topics: ['Shared responsibility model'] };
  const exported = buildResultsExport(results, quiz, '2026-10-22T11:00:00.000Z');
  const parsed = JSON.parse(JSON.stringify(exported));

  assert.equal(parsed.sessionId, results.sessionId);
  assert.equal(parsed.summary.percent, 0);
  assert.deepEqual(parsed.domains, quiz.domains);
  assert.deepEqual(parsed.topics, quiz.topics);
  assert.deepEqual(parsed.answers, results.review);
  assert.equal(parsed.disclaimer.includes('not affiliated'), true);
  assert.equal('learnerId' in parsed, false);
});

test('history exports do not label covered domains and topics as learner-selected filters', () => {
  const historyExport = buildResultsExport(
    { sessionId: 'session-history', totalQuestions: 0, answered: 0, correct: 0, percent: null, review: [] },
    { domains: ['cloud-concepts'], topics: ['Shared responsibility model'], selectionAvailable: false },
  );
  assert.equal(historyExport.domains, null);
  assert.equal(historyExport.topics, null);
});
