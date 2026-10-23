import { readFileSync } from 'node:fs';
import { z } from 'zod';

const bankSchema = z.object({
  domains: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        examWeight: z.object({ min: z.number().positive(), max: z.number().positive() }),
        learningPath: z.string().url().optional(),
      }),
    )
    .min(1),
  misconceptions: z.record(z.string(), z.string().min(1)),
  questions: z
    .array(
      z.object({
        id: z.string().min(1),
        domain: z.string().min(1),
        topic: z.string().min(1),
        difficulty: z.enum(['Beginner', 'Intermediate', 'Advanced']).optional(),
        question: z.string().min(1),
        choices: z.array(z.object({ id: z.string().min(1), text: z.string().min(1) })).min(2),
        correctChoiceId: z.string().min(1),
        explanation: z.string().min(1),
        wrongChoices: z.record(
          z.string(),
          z.object({ why: z.string().min(1), misconception: z.string().optional() }),
        ),
        learnMoreUrl: z.string().url().optional(),
      }),
    )
    .min(1),
});

export function loadQuestionBank(path) {
  return createQuestionBank(JSON.parse(readFileSync(path, 'utf8')));
}

// Validates the whole bank up front so a broken question fails at startup,
// not halfway through someone's quiz.
export function createQuestionBank(raw) {
  const parsed = bankSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(formatProblems(problems));
  }
  const data = parsed.data;
  const problems = findContentProblems(data);
  if (problems.length) throw new Error(formatProblems(problems));

  const questionsById = new Map(data.questions.map((q) => [q.id, q]));
  const domainsById = new Map(data.domains.map((d) => [d.id, d]));

  return {
    domains: data.domains,
    questionCount: data.questions.length,
    getDomain: (id) => domainsById.get(id),
    getQuestion: (id) => questionsById.get(id),
    misconceptionLabel: (tag) => data.misconceptions[tag],

    listTopics() {
      return data.domains.map((domain) => {
        const inDomain = data.questions.filter((q) => q.domain === domain.id);
        const topics = [...new Set(inDomain.map((q) => q.topic))].map((name) => ({
          name,
          questionCount: inDomain.filter((q) => q.topic === name).length,
        }));
        return { ...domain, questionCount: inDomain.length, topics };
      });
    },

    // Picks questions for a new quiz. With `topics`, those topics come first and the
    // rest of the quiz is filled from the same domains, so a practice set on one weak
    // topic still has enough questions.
    pickQuestions({ domains, topics, count }) {
      let pool = data.questions;
      if (domains) pool = pool.filter((q) => domains.includes(q.domain));
      if (!topics) return shuffle(pool).slice(0, count);

      const focus = pool.filter((q) => topics.includes(q.topic));
      const focusDomains = new Set(focus.map((q) => q.domain));
      const fill = pool.filter((q) => !topics.includes(q.topic) && focusDomains.has(q.domain));
      return [...shuffle(focus), ...shuffle(fill)].slice(0, count);
    },
  };
}

// What the browser is allowed to see before the learner answers: no correct answer, no explanations.
export function toPublicQuestion(question) {
  const { id, domain, topic, difficulty, question: text, choices } = question;
  return { id, domain, topic, difficulty, question: text, choices };
}

function findContentProblems(data) {
  const problems = [];
  const domainIds = new Set(data.domains.map((d) => d.id));
  const seenIds = new Set();

  for (const q of data.questions) {
    if (seenIds.has(q.id)) problems.push(`${q.id}: duplicate question id`);
    seenIds.add(q.id);
    if (!domainIds.has(q.domain)) problems.push(`${q.id}: unknown domain "${q.domain}"`);

    const choiceIds = q.choices.map((c) => c.id);
    if (new Set(choiceIds).size !== choiceIds.length) problems.push(`${q.id}: two choices share the same id`);
    if (!choiceIds.includes(q.correctChoiceId)) {
      problems.push(`${q.id}: correctChoiceId "${q.correctChoiceId}" is not one of the choices`);
    }

    for (const id of choiceIds) {
      if (id === q.correctChoiceId) continue;
      const wrong = q.wrongChoices[id];
      if (!wrong) {
        problems.push(`${q.id}: wrong choice "${id}" needs an explanation in wrongChoices`);
      } else if (wrong.misconception && !(wrong.misconception in data.misconceptions)) {
        problems.push(`${q.id}: choice "${id}" uses unknown misconception "${wrong.misconception}"`);
      }
    }
    for (const id of Object.keys(q.wrongChoices)) {
      if (id === q.correctChoiceId) problems.push(`${q.id}: the correct choice "${id}" should not be in wrongChoices`);
      else if (!choiceIds.includes(id)) problems.push(`${q.id}: wrongChoices has "${id}", which is not a choice`);
    }
  }
  return problems;
}

function formatProblems(problems) {
  return `Question bank has ${problems.length} problem(s):\n- ${problems.join('\n- ')}`;
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
