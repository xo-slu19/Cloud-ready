export const DISCLAIMER = 'This is an unofficial AZ-900 practice tool. It is not affiliated with, endorsed by, or sponsored by Microsoft. All practice questions are original educational content.';

export function buildResultsExport(results, quiz, exportedAt = new Date().toISOString()) {
  return {
    application: 'AZ-900 Smart Quiz Builder',
    disclaimer: DISCLAIMER,
    sessionId: results.sessionId,
    exportedAt,
    completedAt: results.completedAt,
    summary: {
      totalQuestions: results.totalQuestions,
      answered: results.answered,
      correct: results.correct,
      percent: results.percent,
      mastered: results.mastered,
      luckyGuesses: results.luckyGuesses,
    },
    readiness: results.readiness,
    domains: quiz.domains,
    topics: quiz.topics,
    byDomain: results.byDomain,
    answers: results.review,
    misconceptions: results.misconceptions,
    recommendations: results.recommendations,
  };
}
