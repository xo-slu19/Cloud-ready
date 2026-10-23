// Scoring and learning insights.
//
// Key idea: a correct answer only counts as "mastered" when the learner was sure.
// A correct answer marked "guessing" is a lucky guess and is treated as not yet learned.

export const MASTERY_TARGET = 70; // percent mastery we consider "strong" in a domain

const READINESS_DISCLAIMER =
  'Unofficial estimate based on your practice answers and the published AZ-900 domain weights. It is not a prediction of your real exam score.';

export const isLuckyGuess = (answer) => answer.correct && answer.confidence === 'guessing';
const isMastered = (answer) => answer.correct && answer.confidence === 'sure';
const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : null);
const weightOf = (examWeight) => (examWeight.min + examWeight.max) / 2;
export const riskOf = (domain) => weightOf(domain.examWeight) * (100 - domain.masteryPercent);

// Instant feedback for one answer. Sent only after the learner has answered.
export function buildFeedback(question, answer, bank) {
  const wrong = answer.correct ? null : question.wrongChoices[answer.choiceId];
  return {
    correct: answer.correct,
    luckyGuess: isLuckyGuess(answer),
    note: isLuckyGuess(answer)
      ? 'Correct, but you were guessing. We will count this topic as one to review.'
      : null,
    correctChoiceId: question.correctChoiceId,
    explanation: question.explanation,
    whyYourChoiceIsWrong: wrong?.why ?? null,
    misconception: wrong?.misconception
      ? { tag: wrong.misconception, label: bank.misconceptionLabel(wrong.misconception) }
      : null,
    whyOthersAreWrong: Object.fromEntries(Object.entries(question.wrongChoices).map(([id, w]) => [id, w.why])),
    learnMoreUrl: question.learnMoreUrl ?? null,
  };
}

export function summarize(session, bank) {
  const graded = session.answers
    .map((answer) => ({ answer, question: bank.getQuestion(answer.questionId) }))
    .filter(({ question }) => question); // skip questions removed from the bank since the quiz started

  const correct = graded.filter((g) => g.answer.correct).length;

  const byDomain = bank.domains.map((domain) => {
    const inDomain = graded.filter((g) => g.question.domain === domain.id);
    const domainCorrect = inDomain.filter((g) => g.answer.correct).length;
    const mastered = inDomain.filter((g) => isMastered(g.answer)).length;
    return {
      domain: domain.id,
      name: domain.name,
      examWeight: domain.examWeight,
      answered: inDomain.length,
      correct: domainCorrect,
      mastered,
      percent: percent(domainCorrect, inDomain.length),
      masteryPercent: percent(mastered, inDomain.length),
    };
  });

  return {
    finished: session.answers.length === session.questionIds.length,
    totalQuestions: session.questionIds.length,
    answered: graded.length,
    correct,
    percent: percent(correct, graded.length),
    mastered: graded.filter((g) => isMastered(g.answer)).length,
    luckyGuesses: graded.filter((g) => isLuckyGuess(g.answer)).length,
    byDomain,
    readiness: estimateReadiness(byDomain),
    misconceptions: findMisconceptions(graded, bank),
    review: graded.map(toReviewItem),
  };
}

// Readiness = mastery in each domain, weighted by how much of the real exam that domain covers.
function estimateReadiness(byDomain) {
  const covered = byDomain.filter((d) => d.answered > 0);
  const notCovered = byDomain.filter((d) => d.answered === 0).map((d) => d.name);

  if (!covered.length) {
    return {
      score: null,
      level: 'not-enough-data',
      message: 'Answer some questions to get a readiness estimate.',
      biggestRisk: null,
      notCovered,
      disclaimer: READINESS_DISCLAIMER,
    };
  }

  const totalWeight = covered.reduce((sum, d) => sum + weightOf(d.examWeight), 0);
  const score = Math.round(
    covered.reduce((sum, d) => sum + weightOf(d.examWeight) * d.masteryPercent, 0) / totalWeight,
  );
  const risk = covered.filter((d) => d.masteryPercent < 100).sort((a, b) => riskOf(b) - riskOf(a))[0];
  const level = score >= 80 ? 'ready' : score >= 60 ? 'almost' : 'not-yet';

  let message;
  if (level === 'ready') message = 'Looking ready. Keep practising to stay sharp.';
  else if (level === 'almost') message = `Almost there. Focus on "${risk.name}" next.`;
  else message = `Not ready yet. Build up "${risk.name}" first, it carries a lot of the exam.`;
  if (notCovered.length) {
    message += ` This quiz did not cover "${notCovered.join('" or "')}", so the estimate is incomplete.`;
  }

  return {
    score,
    level,
    message,
    biggestRisk: risk ? { domain: risk.domain, name: risk.name, examWeight: risk.examWeight } : null,
    notCovered,
    disclaimer: READINESS_DISCLAIMER,
  };
}

// Groups wrong answers by the misunderstanding behind them, most frequent first.
function findMisconceptions(graded, bank) {
  const found = new Map();
  for (const { answer, question } of graded) {
    if (answer.correct) continue;
    const tag = question.wrongChoices[answer.choiceId]?.misconception;
    if (!tag) continue;
    const entry = found.get(tag) ?? {
      tag,
      label: bank.misconceptionLabel(tag),
      count: 0,
      questionIds: [],
      learnMoreUrl: question.learnMoreUrl ?? null,
    };
    entry.count += 1;
    entry.questionIds.push(question.id);
    found.set(tag, entry);
  }
  return [...found.values()].sort((a, b) => b.count - a.count);
}

function toReviewItem({ answer, question }) {
  return {
    questionId: question.id,
    domain: question.domain,
    topic: question.topic,
    question: question.question,
    choices: question.choices,
    yourChoiceId: answer.choiceId,
    correctChoiceId: question.correctChoiceId,
    correct: answer.correct,
    confidence: answer.confidence,
    luckyGuess: isLuckyGuess(answer),
    explanation: question.explanation,
    whyYourChoiceIsWrong: answer.correct ? null : question.wrongChoices[answer.choiceId].why,
    learnMoreUrl: question.learnMoreUrl ?? null,
  };
}
