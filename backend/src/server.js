import { createApp } from './app.js';
import { loadQuestionBank } from './questionBank.js';
import { createMemoryStore } from './store.js';

const port = Number(process.env.PORT) || 3000;

const bank = loadQuestionBank(new URL('../data/questions.json', import.meta.url));
const store = createMemoryStore();
const app = createApp({ bank, store, corsOrigin: process.env.CORS_ORIGIN ?? '*' });

const server = app.listen(port, () => {
  console.log(`Smart Quiz Builder API listening on http://localhost:${port} (${bank.questionCount} questions loaded)`);
});

// Render sends SIGTERM when redeploying; finish in-flight requests before exiting.
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
