# CloudReady

An independent AZ-900 practice tool with original questions, answer explanations, study recommendations, and readiness estimates. It is not affiliated with or endorsed by Microsoft.

## Run locally

Requires Node.js 20 or later. Open two PowerShell terminals from the repository root.

Terminal 1 — start the backend:

```powershell
cd backend
npm.cmd install
npm.cmd start
```

The API listens at `http://localhost:3000/api`. Use `npm.cmd start` for a stable demo; the backend stores sessions and history in memory, so restarting it clears them. `npm.cmd run dev` is available for backend development with file watching, but a watcher restart also clears active sessions.

Terminal 2 — start the frontend:

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Open the Vite URL printed in the terminal (normally `http://localhost:5173`). In PowerShell, `npm.cmd` calls the Windows command shim and avoids changing the machine's script-execution policy.

## Configuration and deployment

- Frontend: set `VITE_API_BASE_URL` to the backend API base URL, such as `https://your-backend.onrender.com/api`. Configure it in the frontend hosting provider's build environment. The frontend has a local-development default; deployment should set the live URL.
- Backend: set `CORS_ORIGIN` to the deployed frontend origin, such as `https://your-frontend.example.com` (no `/api` path). Configure it in the backend hosting provider. `PORT` is supplied by many hosting platforms and defaults to `3000` locally.
- Do not put backend secrets in frontend environment variables.

For local frontend configuration, copy `frontend/.env.example` to `frontend/.env.local` and adjust `VITE_API_BASE_URL`. For backend configuration, see `backend/.env.example`.

## Checks

```powershell
cd frontend
npm.cmd test
npm.cmd run build
```

```powershell
cd backend
npm.cmd test
npm.cmd run check:questions
```

History and quiz sessions are held in backend memory: they do not survive a backend restart or persist across devices. No load test has established a supported concurrent-user capacity; do not interpret a visual preview as a scalability test.
