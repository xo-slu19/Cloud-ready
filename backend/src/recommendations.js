import { MASTERY_TARGET, riskOf } from './scoring.js';

const PRACTICE_SET_SIZE = 5;

// Turns a quiz summary into concrete study advice plus a ready-made practice set.
// The frontend can POST `practiceSet` straight to /api/sessions to start it.
export function buildRecommendations(summary, bank) {
  const items = [];

  const weakDomains = summary.byDomain
    .filter((d) => d.answered > 0 && d.masteryPercent < MASTERY_TARGET)
    .sort((a, b) => riskOf(b) - riskOf(a));

  for (const d of weakDomains) {
    items.push({
      type: 'weak-domain',
      title: `Strengthen "${d.name}"`,
      message: `You mastered ${d.masteryPercent}% of these questions (target: ${MASTERY_TARGET}%). This area is ${d.examWeight.min}-${d.examWeight.max}% of the exam.`,
      learnMoreUrl: bank.getDomain(d.domain).learningPath,
    });
  }

  for (const m of summary.misconceptions) {
    items.push({
      type: 'misconception',
      title: `Watch out: ${m.label}`,
      message: `This tripped you up ${m.count === 1 ? 'once' : `${m.count} times`}. Re-read the explanation, then try the practice set.`,
      learnMoreUrl: m.learnMoreUrl,
      questionIds: m.questionIds,
    });
  }

  const lucky = summary.review.filter((r) => r.luckyGuess);
  if (lucky.length) {
    const topics = unique(lucky.map((r) => r.topic));
    items.push({
      type: 'lucky-guess',
      title: 'Turn your guesses into knowledge',
      message: `You got ${lucky.length} ${lucky.length === 1 ? 'question' : 'questions'} right while guessing (${topics.join(', ')}). We count these as not yet learned.`,
      questionIds: lucky.map((r) => r.questionId),
    });
  }

  const focusTopics = unique(summary.review.filter((r) => !r.correct || r.luckyGuess).map((r) => r.topic));
  let practiceSet = null;
  if (focusTopics.length) practiceSet = { topics: focusTopics, count: PRACTICE_SET_SIZE };
  else if (weakDomains.length) practiceSet = { domains: weakDomains.map((d) => d.domain), count: PRACTICE_SET_SIZE };

  let headline;
  if (!summary.answered) headline = 'Answer some questions to get study recommendations.';
  else if (!items.length) headline = 'No weak spots in this quiz. Try a longer mixed quiz to confirm.';
  else headline = `${items.length} ${items.length === 1 ? 'thing' : 'things'} to work on before exam day.`;

  return { headline, items, practiceSet };
}

const unique = (values) => [...new Set(values)];
