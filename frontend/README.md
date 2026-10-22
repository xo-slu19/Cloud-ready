# AZ-900 Smart Quiz Builder — Frontend

An original, unofficial AZ-900 practice interface. It uses the sibling `backend/` API and does not contain official exam questions or Microsoft branding.

## Run locally

1. In one PowerShell window, start the API:

   ```powershell
   cd C:\Users\AKOTH\hackathon-project\backend
   npm install
   npm run dev
   ```

2. In another PowerShell window, install and start this frontend:

   ```powershell
   cd C:\Users\AKOTH\hackathon-project\frontend
   npm install
   npm run dev
   ```

3. Open the local URL printed by Vite (normally `http://localhost:5173`).

The backend API defaults to `http://localhost:3000/api`. To use another API, copy `.env.example` to `.env.local`, set `VITE_API_BASE_URL` to the API base URL, and restart Vite. Do not place credentials or secrets in frontend environment variables.

Run `npm test` to validate the JSON results export shape and `npm run build` to create the production bundle in `dist/`.

## API integration notes

- Endpoints used: `GET /health`, `GET /topics`, `POST /sessions`, `GET /sessions/:id/question`, `POST /sessions/:id/answers`, `GET /sessions/:id/results`, and `GET /learners/:learnerId/attempts`.
- The backend only accepts answers in order and does not allow changing a submitted answer. The UI retains prior questions and feedback so learners can revisit them without resubmitting.
- A session is complete after its final answer; there is no separate finish endpoint.
- Learner history and active quiz restoration use browser storage. The backend currently keeps session and history data in memory, so a backend restart can expire an active session.
- The backend does not provide `/metrics`; no platform metrics or simulation view is shown.
- Results/readiness labels are displayed from the backend response and include its practice-estimate disclaimer.
