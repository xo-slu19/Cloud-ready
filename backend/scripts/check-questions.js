// Run with `npm run check:questions` after editing data/questions.json.
// Lists every problem in the question bank, or prints a summary if it is valid.
import { loadQuestionBank } from '../src/questionBank.js';

try {
  const bank = loadQuestionBank(new URL('../data/questions.json', import.meta.url));
  console.log(`Question bank OK: ${bank.questionCount} questions.\n`);
  for (const domain of bank.listTopics()) {
    console.log(`${domain.name} (${domain.examWeight.min}-${domain.examWeight.max}% of exam): ${domain.questionCount} questions`);
    for (const topic of domain.topics) console.log(`  - ${topic.name}: ${topic.questionCount}`);
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
