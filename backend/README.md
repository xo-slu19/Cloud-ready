# Smart Quiz Builder: Backend API

Backend for **Smart Quiz Builder**, an unofficial AZ-900 (Microsoft Azure Fundamentals) practice tool.
It serves quiz questions, checks answers on the server, gives instant explanations for every option,
and turns results into readiness scores and study recommendations.

> Unofficial practice tool. Not affiliated with or endorsed by Microsoft. All questions are original and
> based on the public AZ-900 skills outline on Microsoft Learn.

## What makes it smart

- **Answers stay on the server.** The browser never receives the correct answer until the learner has answered, so scores can't be faked from DevTools.
- **Lucky-guess detection.** Learners mark each answer as "sure" or "guessing". A correct guess counts as *not yet learned*.
- **Misconception tracking.** Every wrong option is tagged with the misunderstanding behind it, so results can say "you keep confusing Azure Policy with RBAC" instead of just "6/10".
- **Exam-weighted readiness.** Readiness weights each domain by its share of the real exam (25-30%, 35-40%, 30-35%) and names the biggest risk.
- **Study recommendations and practice sets.** Results include specific advice, Microsoft Learn links and a ready-made practice set targeting weak topics.
- **History for the dashboard.** Finished quizzes are saved per learner, without logins.

## Run it locally

Requires Node.js 20 or later.

```bash
npm install
npm run dev
```

The API runs at `http://localhost:3000/api`. Check it with `http://localhost:3000/api/health`.

| Command | What it does |
|---|---|
| `npm start` | Start the server (used in production / Render) |
| `npm run dev` | Start with auto-restart on file changes, reading `.env` if present |
| `npm test` | Run the automated API tests (starts its own temporary server) |
| `npm run smoke` | Play one full quiz against the running server and report each step. Add a URL to check a deployed server: `npm run smoke -- https://your-app.onrender.com` |
| `npm run check:questions` | Validate `data/questions.json` and list question counts per topic |

On Windows PowerShell, if `npm` is blocked with "running scripts is disabled", use `npm.cmd` instead (for example `npm.cmd test`), or use Git Bash.

Environment variables (see `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port to listen on (Render sets this automatically) |
| `CORS_ORIGIN` | `*` | Comma-separated frontend URLs allowed to call the API |

## Project structure

```
data/questions.json     Question bank (domains, misconception labels, questions)
scripts/                check-questions.js: validates the question bank
src/server.js           Starts the server
src/app.js              Express setup: CORS, JSON parsing, routes, error handling
src/routes.js           All API endpoints
src/scoring.js          Feedback, scores, mastery, readiness, misconceptions, review list
src/recommendations.js  Study advice and practice sets
src/questionBank.js     Loads and validates questions; picks questions for a quiz
src/store.js            Session and attempt storage (in memory; swap for Redis)
src/errors.js           Consistent error responses and request validation
test/api.test.js        End-to-end API tests
```

## API reference

Base URL: `/api`. All request and response bodies are JSON.

### Learner ID (for saved history)

There are no logins. The frontend creates a random ID once, keeps it in the browser, and sends it as a header:

```js
let learnerId = localStorage.getItem('learnerId');
if (!learnerId) {
  learnerId = crypto.randomUUID();
  localStorage.setItem('learnerId', learnerId);
}
// send with POST /api/sessions:  headers: { 'X-Learner-Id': learnerId }
```

The header is optional. Without it, quizzes still work, but they are not saved to history.

### `GET /health`

```json
{ "status": "ok", "questions": 12, "uptimeSeconds": 42 }
```

### `GET /topics`

Domains, their exam weight, Microsoft Learn path and topics with question counts.

```json
{
  "notice": "Unofficial practice tool. ...",
  "domains": [
    {
      "id": "cloud-concepts",
      "name": "Describe cloud concepts",
      "examWeight": { "min": 25, "max": 30 },
      "learningPath": "https://learn.microsoft.com/...",
      "questionCount": 4,
      "topics": [{ "name": "Shared responsibility model", "questionCount": 1 }]
    }
  ]
}
```

### `POST /sessions`: start a quiz

All fields are optional. An empty body `{}` starts a mixed 10-question quiz.

```json
{ "domains": ["management-governance"], "topics": ["Azure Policy"], "count": 10 }
```

- `domains`: any of `cloud-concepts`, `architecture-services`, `management-governance`
- `topics`: topic names from `/topics`. These come first, and the quiz is filled up from the same domains.
- `count`: 1-50, default 10. If fewer questions match, the quiz is shorter.

Response `201`:

```json
{
  "sessionId": "68f632fc-...",
  "notice": "Unofficial practice tool. ...",
  "progress": { "answered": 0, "total": 10, "finished": false },
  "question": {
    "id": "mg-001",
    "domain": "management-governance",
    "topic": "Azure Policy",
    "question": "Your organisation wants to make sure ...",
    "choices": [{ "id": "a", "text": "Azure role-based access control (RBAC)" }]
  }
}
```

### `GET /sessions/:id/question`

The current question (useful after a page refresh).

```json
{ "finished": false, "progress": { ... }, "question": { ... } }
```

When every question is answered: `{ "finished": true, "question": null, ... }`.

### `POST /sessions/:id/answers`: submit an answer

```json
{ "questionId": "mg-001", "choiceId": "a", "confidence": "guessing" }
```

`confidence` is `"sure"` (default) or `"guessing"`. Questions must be answered in order.

Response `200`:

```json
{
  "correct": false,
  "luckyGuess": false,
  "note": null,
  "correctChoiceId": "b",
  "explanation": "Azure Policy enforces rules on the resources themselves ...",
  "whyYourChoiceIsWrong": "RBAC controls who can do what. ...",
  "misconception": { "tag": "policy-vs-rbac", "label": "Confusing Azure Policy with role-based access control (RBAC)" },
  "whyOthersAreWrong": { "a": "...", "c": "...", "d": "..." },
  "learnMoreUrl": "https://learn.microsoft.com/azure/governance/policy/overview",
  "progress": { "answered": 1, "total": 10, "finished": false },
  "nextQuestion": { "id": "...", "question": "...", "choices": [ ... ] }
}
```

For a correct answer marked `"guessing"`, `luckyGuess` is `true` and `note` explains it will be reviewed.
On the last question, `nextQuestion` is `null` and `progress.finished` is `true`.

### `GET /sessions/:id/results`: results, review and recommendations

Works mid-quiz too (partial results). Optional filter for the review tab: `?review=all` (default), `?review=wrong`, `?review=lucky`.

```json
{
  "finished": true,
  "totalQuestions": 10, "answered": 10, "correct": 7, "percent": 70,
  "mastered": 5, "luckyGuesses": 2,
  "byDomain": [
    { "domain": "cloud-concepts", "name": "Describe cloud concepts", "examWeight": { "min": 25, "max": 30 },
      "answered": 3, "correct": 3, "mastered": 3, "percent": 100, "masteryPercent": 100 }
  ],
  "readiness": {
    "score": 58,
    "level": "not-yet",
    "message": "Not ready yet. Build up \"Describe Azure architecture and services\" first, ...",
    "biggestRisk": { "domain": "architecture-services", "name": "...", "examWeight": { "min": 35, "max": 40 } },
    "notCovered": [],
    "disclaimer": "Unofficial estimate ..."
  },
  "misconceptions": [
    { "tag": "regions-and-zones", "label": "Mixing up regions, region pairs, ...", "count": 2, "questionIds": ["as-001"], "learnMoreUrl": "..." }
  ],
  "review": [
    { "questionId": "as-001", "topic": "...", "question": "...", "choices": [ ... ],
      "yourChoiceId": "a", "correctChoiceId": "b", "correct": false, "confidence": "sure", "luckyGuess": false,
      "explanation": "...", "whyYourChoiceIsWrong": "...", "learnMoreUrl": "..." }
  ],
  "recommendations": {
    "headline": "3 things to work on before exam day.",
    "items": [
      { "type": "weak-domain", "title": "...", "message": "...", "learnMoreUrl": "..." },
      { "type": "misconception", "title": "...", "message": "...", "learnMoreUrl": "...", "questionIds": ["..."] },
      { "type": "lucky-guess", "title": "...", "message": "...", "questionIds": ["..."] }
    ],
    "practiceSet": { "topics": ["Regions and availability zones"], "count": 5 }
  }
}
```

`readiness.level` is one of `ready` (80+), `almost` (60-79), `not-yet` (under 60) or `not-enough-data`.
To start the practice set, `POST /sessions` with `recommendations.practiceSet` as the body.

### `GET /learners/:learnerId/attempts`: history for the dashboard

Newest first. Optional `?limit=` (1-50, default 20).

```json
{
  "learnerId": "...",
  "stats": { "attemptCount": 4, "bestPercent": 90, "latestReadiness": 74, "readinessChange": 12 },
  "attempts": [
    { "sessionId": "...", "completedAt": "2026-10-22T10:15:00.000Z", "totalQuestions": 10, "correct": 8,
      "percent": 80, "luckyGuesses": 1, "readinessScore": 74, "readinessLevel": "almost",
      "byDomain": [{ "domain": "...", "name": "...", "answered": 3, "percent": 67, "masteryPercent": 67 }],
      "topMisconceptions": [{ "tag": "...", "label": "...", "count": 1 }] }
  ]
}
```

### Errors

Every error has the same shape:

```json
{ "error": { "code": "SESSION_NOT_FOUND", "message": "That quiz session does not exist or has expired. Start a new quiz." } }
```

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing or invalid fields. `details` lists each field and problem. |
| 400 | `INVALID_JSON` | Body is not valid JSON |
| 400 | `INVALID_CHOICE` | `choiceId` is not one of the question's choices |
| 400 | `INVALID_LEARNER_ID` | Learner ID is not 8-64 letters, numbers, `-` or `_` |
| 404 | `SESSION_NOT_FOUND` | Unknown or expired session (sessions expire after 2 hours) |
| 404 | `QUESTION_NOT_IN_SESSION` | The question is not part of this quiz |
| 404 | `ROUTE_NOT_FOUND` | No such endpoint |
| 409 | `ALREADY_ANSWERED` | The question was already answered |
| 409 | `NOT_CURRENT_QUESTION` | Answered out of order. `details.currentQuestionId` says which one is current. |
| 413 | `PAYLOAD_TOO_LARGE` | Request body over 10 KB |
| 422 | `NO_QUESTIONS` | No questions match the requested domains or topics |
| 500 | `INTERNAL_ERROR` | Unexpected server error (details are logged, never sent) |

## Adding questions (Product / Learning lead)

Questions live in `data/questions.json`. Each question looks like this:

```json
{
  "id": "mg-001",
  "domain": "management-governance",
  "topic": "Azure Policy",
  "question": "...",
  "choices": [{ "id": "a", "text": "..." }, { "id": "b", "text": "..." }],
  "correctChoiceId": "b",
  "explanation": "Why the correct answer is right.",
  "wrongChoices": {
    "a": { "why": "Why this option is wrong.", "misconception": "policy-vs-rbac" }
  },
  "learnMoreUrl": "https://learn.microsoft.com/..."
}
```

Rules (checked automatically when the server starts and by `npm run check:questions`):

- Every wrong option needs a `why`. This is the core promise of the app.
- `misconception` is optional, but must be a key in the `misconceptions` list at the top of the file.
- `topic` names are free text; questions with the same topic name are grouped together.
- Write original questions. Never copy real exam questions or dumps.

## Notes for the team

- **Platform lead (Redis, rate limits):** `src/store.js` has four async methods (`getSession`, `saveSession`, `addAttempt`, `listAttempts`). A Redis version with the same methods can be passed to `createApp` in `src/server.js`. Rate-limit middleware goes in `src/app.js` where marked. `trust proxy` is already set for Render.
- **DevOps lead (Render):** build command `npm install`, start command `npm start`, health check path `/api/health`. Set `CORS_ORIGIN` to the frontend URL.
- **Load test flow:** `POST /sessions` → repeat `POST /sessions/:id/answers` for each question (use `nextQuestion.id` from each response) → `GET /sessions/:id/results`. Send an `X-Learner-Id` header to also exercise saved history.
- **Current limitation:** the in-memory store loses sessions and history when the server restarts, and doesn't share data between multiple instances. Redis fixes both.
