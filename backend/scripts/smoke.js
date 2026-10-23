// Plays one complete quiz against a running server and reports each step.
//
//   npm run smoke                                   (checks http://localhost:3000)
//   npm run smoke -- https://your-app.onrender.com  (checks a deployed server)
//
// Unlike `npm test`, this talks to a real running server, so it also proves the
// server is up, reachable and configured correctly.
import { randomUUID } from 'node:crypto';

const baseUrl = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '') + '/api';
const learnerId = `smoke-${randomUUID()}`;
let failures = 0;

async function call(method, path, body, headers = {}) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
}

async function main() {
  console.log(`Checking ${baseUrl}\n`);

  const health = await call('GET', '/health');
  check('Server is healthy', health.body.status === 'ok', `${health.body.questions} questions loaded`);

  const topics = await call('GET', '/topics');
  check('Topics list the AZ-900 domains', topics.body.domains?.length === 3);

  const quiz = await call('POST', '/sessions', { count: 5 }, { 'x-learner-id': learnerId });
  check('Quiz starts', quiz.status === 201, `session ${quiz.body.sessionId}`);
  check('Question does not reveal the answer', !('correctChoiceId' in quiz.body.question));

  // Answer every question with choice "a", alternating sure / guessing
  let question = quiz.body.question;
  let answered = 0;
  while (question) {
    const confidence = answered % 2 === 0 ? 'sure' : 'guessing';
    const res = await call('POST', `/sessions/${quiz.body.sessionId}/answers`, {
      questionId: question.id,
      choiceId: question.choices[0].id,
      confidence,
    });
    const ok = res.status === 200 && typeof res.body.explanation === 'string';
    check(`Answer ${question.id} gives feedback`, ok, res.body.correct ? 'correct' : 'wrong');
    if (!ok) break;
    answered += 1;
    question = res.body.nextQuestion;
  }

  const repeat = await call('POST', `/sessions/${quiz.body.sessionId}/answers`, {
    questionId: quiz.body.question.id,
    choiceId: 'a',
  });
  check('Answering twice is rejected', repeat.body.error?.code === 'ALREADY_ANSWERED');

  const results = await call('GET', `/sessions/${quiz.body.sessionId}/results`);
  const r = results.body;
  check('Results are ready', r.finished === true, `score ${r.percent}%, mastery ${r.mastered}/${r.answered}`);
  check('Readiness is estimated', r.readiness?.level !== undefined, `${r.readiness?.score}% (${r.readiness?.level})`);
  check('Recommendations are given', typeof r.recommendations?.headline === 'string', r.recommendations?.headline);

  const wrongOnly = await call('GET', `/sessions/${quiz.body.sessionId}/results?review=wrong`);
  check('Review filter works', wrongOnly.body.review.every((item) => !item.correct));

  const history = await call('GET', `/learners/${learnerId}/attempts`);
  check('Attempt saved to history', history.body.stats?.attemptCount === 1);

  const missing = await call('GET', '/sessions/does-not-exist/question');
  check('Unknown session gives a clear error', missing.body.error?.code === 'SESSION_NOT_FOUND');

  console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed. The backend is working.');
  process.exitCode = failures ? 1 : 0;
}

main().catch((err) => {
  console.error(`\nCould not reach ${baseUrl}. Is the server running?\n${err.message}`);
  process.exitCode = 1;
});
