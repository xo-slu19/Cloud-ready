# CloudReady

An independent AZ-900 practice tool with original questions, answer explanations, study recommendations, and readiness estimates. It is not affiliated with or endorsed by Microsoft.

The repository is one npm workspace: the Express API lives in `backend/`, the Vite + React interface in `frontend/`. Everything installs, runs, tests and builds from the repository root — no `cd` into subfolders.

## Run locally

Requires Node.js 20 or later. One terminal, from the repository root:

```powershell
npm.cmd install
npm.cmd run dev
```

- API: `http://localhost:3000/api` (health check: `http://localhost:3000/api/health`)
- Interface: `http://localhost:5173`

Output lines are prefixed `[backend]` and `[frontend]`, and Ctrl+C stops both. `npm run dev` runs the backend with file watching; a watcher restart clears active sessions because sessions and history are held in memory. For the stable backend used in demos and production, run `npm start` in a second terminal.

In PowerShell, `npm.cmd` calls the Windows command shim and avoids changing the machine's script-execution policy.

| Command                   | What it does                                                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install`             | Install dependencies for both workspaces at the repository root                                                                                          |
| `npm run dev`             | Backend (watching) + frontend together                                                                                                                   |
| `npm run dev:backend`     | Backend API only, with file watching                                                                                                                     |
| `npm run dev:frontend`    | Vite dev server only                                                                                                                                     |
| `npm start`               | Backend API only, stable mode (used in production / Render)                                                                                              |
| `npm test`                | Backend API tests + frontend export-shape tests                                                                                                          |
| `npm run build`           | Production bundle of the frontend into `frontend/dist/`                                                                                                  |
| `npm run preview`         | Serve the built frontend locally                                                                                                                         |
| `npm run check:questions` | Validate `backend/data/questions.json` and list question counts per topic                                                                                |
| `npm run build:questions` | Rebuild `backend/data/questions.json` from the files in `backend/data/source/`                                                                           |
| `npm run smoke`           | Play one full quiz against a running server and report each step. Add a URL to check a deployed server: `npm run smoke -- https://your-app.onrender.com` |

If port 3000 is already occupied on your machine, start the backend on another port, for example `PORT=3100 npm run dev`.

## Repository structure

```text
backend/               Express API (workspace)
  data/questions.json  Question bank the server loads (generated, do not edit by hand)
  data/source/         Question bank sources: question-bank.json and enrichment.json
  scripts/             build-question-bank.js, check-questions.js, smoke.js
  src/server.js        Starts the server
  src/app.js           Express setup: CORS, JSON parsing, routes, error handling
  src/routes.js        All API endpoints
  src/scoring.js       Feedback, scores, mastery, readiness, misconceptions, review list
  src/recommendations.js  Study advice and practice sets
  src/questionBank.js  Loads and validates questions; picks questions for a quiz
  src/store.js         Session and attempt storage (in memory; swap for Redis)
  src/errors.js        Consistent error responses and request validation
  test/api.test.js     End-to-end API tests
frontend/              Vite + React interface (workspace)
  src/                 App.jsx, api.js, export.js, helpers.js, main.jsx, styles.css
  test/                export.test.js, helpers.test.js
  index.html, vite.config.js, public/
```

## What makes it smart

- **Answers stay on the server.** The browser never receives the correct answer until the learner has answered, so scores can't be faked from DevTools.
- **Lucky-guess detection.** Learners mark each answer as "sure" or "guessing". A correct guess counts as _not yet learned_.
- **Misconception tracking.** Every wrong option is tagged with the misunderstanding behind it, so results can say "you keep confusing Azure Policy with RBAC" instead of just "6/10".
- **Exam-weighted readiness.** Readiness weights each domain by its share of the real exam (25-30%, 35-40%, 30-35%) and names the biggest risk.
- **Study recommendations and practice sets.** Results include specific advice, Microsoft Learn links and a ready-made practice set targeting weak topics.
- **History for the dashboard.** Finished quizzes are saved per learner, without logins.

## Checks

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run check:questions
```

## Configuration and deployment

- Frontend: set `VITE_API_BASE_URL` to the backend API base URL, such as `https://your-backend.onrender.com/api`. Configure it in the frontend hosting provider's build environment. The frontend has a local-development default; deployment should set the live URL.
- Backend: set `CORS_ORIGIN` to the deployed frontend origin, such as `https://your-frontend.example.com` (no `/api` path). Configure it in the backend hosting provider. `PORT` is supplied by many hosting platforms and defaults to `3000` locally.
- Do not put backend secrets in frontend environment variables.

For local frontend configuration, copy `frontend/.env.example` to `frontend/.env.local` and adjust `VITE_API_BASE_URL`. For backend configuration, see `backend/.env.example`:

| Variable      | Default | Purpose                                               |
| ------------- | ------- | ----------------------------------------------------- |
| `PORT`        | `3000`  | Port to listen on (Render sets this automatically)    |
| `CORS_ORIGIN` | `*`     | Comma-separated frontend URLs allowed to call the API |

## API reference

Base URL: `/api`. All request and response bodies are JSON.

### Learner ID (for saved history)

There are no logins. The frontend creates a random ID once, keeps it in the browser, and sends it as a header:

```js
let learnerId = localStorage.getItem("learnerId");
if (!learnerId) {
  learnerId = crypto.randomUUID();
  localStorage.setItem("learnerId", learnerId);
}
// send with POST /api/sessions:  headers: { 'X-Learner-Id': learnerId }
```

The header is optional. Without it, quizzes still work, but they are not saved to history.

### `GET /health`

```json
{ "status": "ok", "questions": 100, "uptimeSeconds": 42 }
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
{
  "domains": ["management-governance"],
  "topics": ["Azure Policy"],
  "count": 10
}
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
  "stats": {
    "attemptCount": 4,
    "bestPercent": 90,
    "latestReadiness": 74,
    "readinessChange": 12
  },
  "attempts": [
    {
      "sessionId": "...",
      "completedAt": "2026-10-22T10:15:00.000Z",
      "totalQuestions": 10,
      "correct": 8,
      "percent": 80,
      "luckyGuesses": 1,
      "readinessScore": 74,
      "readinessLevel": "almost",
      "byDomain": [
        {
          "domain": "...",
          "name": "...",
          "answered": 3,
          "percent": 67,
          "masteryPercent": 67
        }
      ],
      "topMisconceptions": [{ "tag": "...", "label": "...", "count": 1 }]
    }
  ]
}
```

### Errors

Every error has the same shape:

```json
{
  "error": {
    "code": "SESSION_NOT_FOUND",
    "message": "That quiz session does not exist or has expired. Start a new quiz."
  }
}
```

| Status | Code                      | When                                                                          |
| ------ | ------------------------- | ----------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`        | Missing or invalid fields. `details` lists each field and problem.            |
| 400    | `INVALID_JSON`            | Body is not valid JSON                                                        |
| 400    | `INVALID_CHOICE`          | `choiceId` is not one of the question's choices                               |
| 400    | `INVALID_LEARNER_ID`      | Learner ID is not 8-64 letters, numbers, `-` or `_`                           |
| 404    | `SESSION_NOT_FOUND`       | Unknown or expired session (sessions expire after 2 hours)                    |
| 404    | `QUESTION_NOT_IN_SESSION` | The question is not part of this quiz                                         |
| 404    | `ROUTE_NOT_FOUND`         | No such endpoint                                                              |
| 409    | `ALREADY_ANSWERED`        | The question was already answered                                             |
| 409    | `NOT_CURRENT_QUESTION`    | Answered out of order. `details.currentQuestionId` says which one is current. |
| 413    | `PAYLOAD_TOO_LARGE`       | Request body over 10 KB                                                       |
| 422    | `NO_QUESTIONS`            | No questions match the requested domains or topics                            |
| 500    | `INTERNAL_ERROR`          | Unexpected server error (details are logged, never sent)                      |

## Adding questions (Product / Learning lead)

The backend loads `backend/data/questions.json`, but **don't edit that file by hand**. It is generated from two source files:

| File                                     | Contains                                                                                                                                   | Edited by                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `backend/data/source/question-bank.json` | Questions, options (A-D), correct answer, explanation, domain, difficulty                                                                  | Product / Learning lead                              |
| `backend/data/source/enrichment.json`    | For each question: its topic, and for every wrong option a `why` and an optional `misconception` tag. Also the list of misconception tags. | Product / Learning lead (drafts provided by Backend) |

After editing either file, rebuild and check:

```powershell
npm.cmd run build:questions
npm.cmd test
```

An entry in `enrichment.json` looks like this, using the same option letters as `question-bank.json`:

```json
"AZ075": { "topic": "Governance tools", "wrong": {
  "A": { "why": "Azure DNS resolves domain names. It cannot restrict where resources are created.",
    "misconception": "service-purpose" }
} }
```

Rules (checked by `npm run build:questions`, when the server starts, and by `npm run check:questions`):

- Every question in `question-bank.json` needs an entry in `enrichment.json`.
- Every wrong option needs a `why`. This is the core promise of the app.
- `misconception` is optional, but must be one of the tags in the `misconceptions` list in `enrichment.json`.
- `topic` names are free text; questions with the same topic name are grouped together and used for practice sets.
- Questions may also have an optional `learnMoreUrl`.
- Write original questions. Never copy real exam questions or dumps.

## Frontend integration notes

- Endpoints used: `GET /health`, `GET /topics`, `POST /sessions`, `GET /sessions/:id/question`, `POST /sessions/:id/answers`, `GET /sessions/:id/results`, and `GET /learners/:learnerId/attempts`.
- The backend only accepts answers in order and does not allow changing a submitted answer. The UI retains prior questions and feedback so learners can revisit them without resubmitting.
- A session is complete after its final answer; there is no separate finish endpoint.
- Learner ID and appearance preferences use `localStorage`; active quiz and completed-result restoration use `sessionStorage` in the same browser tab. The backend keeps session and history data in memory, so a backend restart can expire sessions and clear history. Browser storage does not make history durable or synchronize it across devices.
- The backend does not provide `/metrics`; no platform metrics or simulation view is shown.
- Results/readiness labels are displayed from the backend response and include its practice-estimate disclaimer.
- History summaries are available only while the backend's in-memory store remains alive; history does not survive backend restarts or synchronize across devices.
- The current question-bank implementation does not include a `difficulty` field. The UI displays a difficulty badge only if a future API response supplies a recognized value.
- No load test has verified support of any particular concurrent-user number. Responsive preview controls are visual-only and are not a capacity demonstration.

## Notes for the team

- **Platform lead (Redis, rate limits):** `backend/src/store.js` has four async methods (`getSession`, `saveSession`, `addAttempt`, `listAttempts`). A Redis version with the same methods can be passed to `createApp` in `backend/src/server.js`. Rate-limit middleware goes in `backend/src/app.js` where marked. `trust proxy` is already set for Render.
- **DevOps lead (Render):** build command `npm install`, start command `npm start`, health check path `/api/health`. Set `CORS_ORIGIN` to the frontend URL.
- **Load test flow:** `POST /sessions` → repeat `POST /sessions/:id/answers` for each question (use `nextQuestion.id` from each response) → `GET /sessions/:id/results`. Send an `X-Learner-Id` header to also exercise saved history.
- **Current limitation:** the in-memory store loses sessions and history when the server restarts, and doesn't share data between multiple instances. Redis fixes both.

History and quiz sessions are held in backend memory: they do not survive a backend restart or persist across devices. No load test has established a supported concurrent-user capacity; do not interpret a visual preview as a scalability test.
