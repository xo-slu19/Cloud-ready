# CloudReady — Frontend

An original, unofficial AZ-900 practice interface. It uses the sibling `backend/` API and does not contain official exam questions or Microsoft branding.

## Run locally

1. From the repository root, open one PowerShell window and start the API:

   ```powershell
   cd backend
   npm.cmd install
   npm.cmd start
   ```

   `npm.cmd start` runs the stable backend script. The development watcher (`npm.cmd run dev`) is useful while editing backend files, but any restart clears active sessions because the store is in memory.

2. Open a second PowerShell window from the repository root and start the frontend:

   ```powershell
   cd frontend
   npm.cmd install
   npm.cmd run dev
   ```

3. Open the local URL printed by Vite (normally `http://localhost:5173`).

In PowerShell, `npm.cmd` uses the Windows command shim and avoids changing the machine's script-execution policy. The backend API defaults to `http://localhost:3000/api`. To use another API, copy `.env.example` to `.env.local`, set `VITE_API_BASE_URL` to the API base URL, and restart Vite. For deployment, set `VITE_API_BASE_URL` in the frontend host's build environment (for example `https://your-backend.onrender.com/api`) and configure backend `CORS_ORIGIN` to the deployed frontend origin. Never put backend secrets in frontend variables.

Run `npm test` to validate the JSON results export shape and `npm run build` to create the production bundle in `dist/`.

## API integration notes

- Endpoints used: `GET /health`, `GET /topics`, `POST /sessions`, `GET /sessions/:id/question`, `POST /sessions/:id/answers`, `GET /sessions/:id/results`, and `GET /learners/:learnerId/attempts`.
- The backend only accepts answers in order and does not allow changing a submitted answer. The UI retains prior questions and feedback so learners can revisit them without resubmitting.
- A session is complete after its final answer; there is no separate finish endpoint.
- Learner ID and appearance preferences use `localStorage`; active quiz and completed-result restoration use `sessionStorage` in the same browser tab. The backend keeps session and history data in memory, so a backend restart can expire sessions and clear history. Browser storage does not make history durable or synchronize it across devices.
- The backend does not provide `/metrics`; no platform metrics or simulation view is shown.
- Results/readiness labels are displayed from the backend response and include its practice-estimate disclaimer.
- History summaries are available only while the backend's in-memory store remains alive; history does not survive backend restarts or synchronize across devices.
- The current question-bank implementation does not include a `difficulty` field. The UI displays a difficulty badge only if a future API response supplies a recognized value.
- No load test has verified support for 10,000 concurrent users. Responsive preview controls are visual-only and are not a capacity demonstration.
