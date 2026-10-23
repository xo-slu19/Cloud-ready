// Builds data/questions.json, the file the backend loads, from two source files:
//
//   data/source/question-bank.json  questions, options, correct answers and explanations
//                                   (written by the Product / Learning lead)
//   data/source/enrichment.json     a topic per question, an explanation for every wrong
//                                   option and the misconception it represents
//
// Run `npm run build:questions` after editing either file, then `npm test`.
import { readFileSync, writeFileSync } from 'node:fs';
import { createQuestionBank } from '../src/questionBank.js';

// `sourceName` is how the domain is written in question-bank.json.
const DOMAINS = [
  {
    id: 'cloud-concepts',
    sourceName: 'Cloud Concepts',
    name: 'Describe cloud concepts',
    examWeight: { min: 25, max: 30 },
    learningPath: 'https://learn.microsoft.com/training/paths/microsoft-azure-fundamentals-describe-cloud-concepts/',
  },
  {
    id: 'architecture-services',
    sourceName: 'Azure Architecture and Services',
    name: 'Describe Azure architecture and services',
    examWeight: { min: 35, max: 40 },
    learningPath: 'https://learn.microsoft.com/training/paths/azure-fundamentals-describe-azure-architecture-services/',
  },
  {
    id: 'management-governance',
    sourceName: 'Azure Management and Governance',
    name: 'Describe Azure management and governance',
    examWeight: { min: 30, max: 35 },
    learningPath: 'https://learn.microsoft.com/training/paths/describe-azure-management-governance/',
  },
];

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const source = read('../data/source/question-bank.json');
const enrichment = read('../data/source/enrichment.json');

// The source uses capital option letters (A-D); the backend uses lowercase ids.
const toChoiceId = (letter) => letter.toLowerCase();

const problems = [];
const questions = source.questions.map((q) => {
  const extra = enrichment.questions[q.id];
  const domain = DOMAINS.find((d) => d.sourceName === q.domain);
  if (!extra) problems.push(`${q.id}: has no entry in enrichment.json`);
  if (!domain) problems.push(`${q.id}: unknown domain "${q.domain}"`);
  if (!extra || !domain) return null;

  return {
    id: q.id,
    domain: domain.id,
    topic: extra.topic,
    difficulty: q.difficulty,
    question: q.question,
    choices: Object.entries(q.options).map(([letter, text]) => ({ id: toChoiceId(letter), text })),
    correctChoiceId: toChoiceId(q.correctAnswer),
    explanation: q.explanation,
    wrongChoices: Object.fromEntries(
      Object.entries(extra.wrong).map(([letter, wrong]) => [toChoiceId(letter), wrong]),
    ),
  };
});

const sourceIds = new Set(source.questions.map((q) => q.id));
for (const id of Object.keys(enrichment.questions)) {
  if (!sourceIds.has(id)) problems.push(`${id}: is in enrichment.json but not in question-bank.json`);
}
if (problems.length) {
  console.error(`Cannot build the question bank:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

const bank = {
  domains: DOMAINS.map(({ sourceName, ...domain }) => domain),
  misconceptions: enrichment.misconceptions,
  questions,
};

try {
  createQuestionBank(bank); // same checks the server runs at startup
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

writeFileSync(new URL('../data/questions.json', import.meta.url), `${JSON.stringify(bank, null, 2)}\n`);
console.log(`Built data/questions.json with ${questions.length} questions.`);
