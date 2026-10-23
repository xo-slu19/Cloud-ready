import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { ApiError, parseBody } from './errors.js';
import { toPublicQuestion } from './questionBank.js';
import { buildFeedback, summarize } from './scoring.js';
import { buildRecommendations } from './recommendations.js';

const MAX_QUESTIONS_PER_QUIZ = 50;
const LEARNER_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

const UNOFFICIAL_NOTICE =
  'Unofficial practice tool. Not affiliated with or endorsed by Microsoft. Questions are original and based on the public AZ-900 skills outline.';

export function createRouter({ bank, store }) {
  const router = Router();
  const domainIds = bank.domains.map((d) => d.id);

  const createSessionSchema = z.object({
    domains: z.array(z.enum(domainIds)).min(1).optional(),
    topics: z.array(z.string().trim().min(1)).min(1).optional(),
    count: z.number().int().min(1).max(MAX_QUESTIONS_PER_QUIZ).default(10),
  });
  // .trim() ignores stray spaces, so " mg-004" is treated as "mg-004"
  const answerSchema = z.object({
    questionId: z.string().trim().min(1),
    choiceId: z.string().trim().min(1),
    confidence: z.enum(['sure', 'guessing']).default('sure'),
  });
  const resultsQuerySchema = z.object({ review: z.enum(['all', 'wrong', 'lucky']).default('all') });
  const attemptsQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

  async function loadSession(id) {
    const session = await store.getSession(id);
    if (!session) {
      throw new ApiError(404, 'SESSION_NOT_FOUND', 'That quiz session does not exist or has expired. Start a new quiz.');
    }
    return session;
  }

  router.get('/health', (req, res) => {
    res.json({ status: 'ok', questions: bank.questionCount, uptimeSeconds: Math.round(process.uptime()) });
  });

  router.get('/topics', (req, res) => {
    res.json({ notice: UNOFFICIAL_NOTICE, domains: bank.listTopics() });
  });

  // Start a quiz. Send nothing for a mixed quiz, or filter by domains and/or topics.
  router.post('/sessions', async (req, res) => {
    const options = parseBody(createSessionSchema, req.body);
    const learnerId = readLearnerId(req.get('x-learner-id'));
    const questions = bank.pickQuestions(options);
    if (!questions.length) {
      throw new ApiError(422, 'NO_QUESTIONS', 'No questions match those domains or topics yet.');
    }

    const session = {
      id: randomUUID(),
      learnerId,
      questionIds: questions.map((q) => q.id),
      answers: [],
      startedAt: new Date().toISOString(),
      completedAt: null,
    };
    await store.saveSession(session);

    res.status(201).json({
      sessionId: session.id,
      notice: UNOFFICIAL_NOTICE,
      progress: progressOf(session),
      question: toPublicQuestion(questions[0]),
    });
  });

  router.get('/sessions/:id/question', async (req, res) => {
    const session = await loadSession(req.params.id);
    const current = currentQuestion(session, bank);
    res.json({ finished: !current, progress: progressOf(session), question: current && toPublicQuestion(current) });
  });

  router.post('/sessions/:id/answers', async (req, res) => {
    const session = await loadSession(req.params.id);
    const { questionId, choiceId, confidence } = parseBody(answerSchema, req.body);

    if (!session.questionIds.includes(questionId)) {
      throw new ApiError(404, 'QUESTION_NOT_IN_SESSION', 'That question is not part of this quiz.');
    }
    if (session.answers.some((a) => a.questionId === questionId)) {
      throw new ApiError(409, 'ALREADY_ANSWERED', 'You have already answered this question.');
    }
    const current = currentQuestion(session, bank);
    if (current.id !== questionId) {
      throw new ApiError(409, 'NOT_CURRENT_QUESTION', 'Please answer the questions in order.', {
        currentQuestionId: current.id,
      });
    }
    if (!current.choices.some((c) => c.id === choiceId)) {
      throw new ApiError(400, 'INVALID_CHOICE', `"${choiceId}" is not one of the choices for this question.`);
    }

    const answer = {
      questionId,
      choiceId,
      confidence,
      correct: choiceId === current.correctChoiceId,
      answeredAt: new Date().toISOString(),
    };
    session.answers.push(answer);
    const next = currentQuestion(session, bank);
    if (!next) session.completedAt = answer.answeredAt;
    await store.saveSession(session);

    if (!next && session.learnerId) {
      await store.addAttempt(session.learnerId, toAttempt(session, summarize(session, bank)));
    }

    res.json({
      ...buildFeedback(current, answer, bank),
      progress: progressOf(session),
      nextQuestion: next && toPublicQuestion(next),
    });
  });

  // Works mid-quiz too (partial results). `?review=wrong` or `?review=lucky` filters the review list.
  router.get('/sessions/:id/results', async (req, res) => {
    const session = await loadSession(req.params.id);
    const { review } = parseBody(resultsQuerySchema, req.query);
    const summary = summarize(session, bank);

    let reviewItems = summary.review;
    if (review === 'wrong') reviewItems = reviewItems.filter((r) => !r.correct);
    if (review === 'lucky') reviewItems = reviewItems.filter((r) => r.luckyGuess);

    res.json({
      sessionId: session.id,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      ...summary,
      review: reviewItems,
      recommendations: buildRecommendations(summary, bank),
    });
  });

  // Past attempts for the dashboard, newest first.
  router.get('/learners/:learnerId/attempts', async (req, res) => {
    const learnerId = readLearnerId(req.params.learnerId);
    const { limit } = parseBody(attemptsQuerySchema, req.query);
    const attempts = await store.listAttempts(learnerId, limit);

    const scores = attempts.map((a) => a.readinessScore).filter((s) => s !== null);
    res.json({
      learnerId,
      stats: {
        attemptCount: attempts.length,
        bestPercent: attempts.length ? Math.max(...attempts.map((a) => a.percent)) : null,
        latestReadiness: scores[0] ?? null,
        readinessChange: scores.length >= 2 ? scores[0] - scores[1] : null,
      },
      attempts,
    });
  });

  return router;
}

function readLearnerId(value) {
  if (value === undefined) return null;
  if (!LEARNER_ID_PATTERN.test(value)) {
    throw new ApiError(
      400,
      'INVALID_LEARNER_ID',
      'Learner IDs must be 8-64 characters using letters, numbers, "-" or "_". crypto.randomUUID() works well.',
    );
  }
  return value;
}

function currentQuestion(session, bank) {
  const nextId = session.questionIds[session.answers.length];
  return nextId ? bank.getQuestion(nextId) : null;
}

function progressOf(session) {
  const answered = session.answers.length;
  const total = session.questionIds.length;
  return { answered, total, finished: answered === total };
}

// The compact record kept for the dashboard after a quiz is finished.
function toAttempt(session, summary) {
  return {
    sessionId: session.id,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    totalQuestions: summary.totalQuestions,
    correct: summary.correct,
    percent: summary.percent,
    luckyGuesses: summary.luckyGuesses,
    readinessScore: summary.readiness.score,
    readinessLevel: summary.readiness.level,
    byDomain: summary.byDomain.map(({ domain, name, answered, percent, masteryPercent }) => ({
      domain,
      name,
      answered,
      percent,
      masteryPercent,
    })),
    topMisconceptions: summary.misconceptions.slice(0, 3).map(({ tag, label, count }) => ({ tag, label, count })),
  };
}
