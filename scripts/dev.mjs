// Starts both dev servers from the repository root:
//   backend  -> npm run dev --workspace backend   (API on http://localhost:3000/api)
//   frontend -> npm run dev --workspace frontend  (Vite on http://localhost:5173)
// Output lines are prefixed with [backend] / [frontend], and stopping one
// (Ctrl+C or a crash) stops the other.
import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'npm.cmd' : 'npm';

const apps = [
  { label: 'backend', args: ['run', 'dev', '--workspace', 'backend'] },
  { label: 'frontend', args: ['run', 'dev', '--workspace', 'frontend'] },
];

const children = [];
let shuttingDown = false;

function writeLine(label, line) {
  process.stdout.write(`[${label}] ${line}\n`);
}

function pipe(label, stream) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim() !== '') writeLine(label, line);
    }
  });
}

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (isWindows) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) killTree(child);
}

function start({ label, args }) {
  const child = spawn(npmCommand, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: !isWindows,
    shell: isWindows,
  });
  children.push(child);

  pipe(label, child.stdout);
  pipe(label, child.stderr);

  child.on('error', (error) => {
    writeLine(label, `failed to start: ${error.message}`);
    shutdown();
    process.exitCode = 1;
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    writeLine(label, `stopped (${signal ?? `code ${code}`}); stopping the other app`);
    shutdown();
    process.exitCode = code === 0 || code === null ? 1 : code;
  });
}

for (const app of apps) start(app);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shutdown();
    setTimeout(() => process.exit(130), 750);
  });
}
