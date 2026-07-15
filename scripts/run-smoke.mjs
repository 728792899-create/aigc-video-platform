import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aigc-video-smoke-"));
const serverEntry = path.join(ROOT, "server", "dist", "app.js");

async function reservePort() {
  if (process.env.SMOKE_PORT) return Number(process.env.SMOKE_PORT);
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.once("error", reject).listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  if (!port) throw new Error("Unable to reserve an isolated smoke-test port");
  return port;
}

const port = await reservePort();
const baseUrl = `http://127.0.0.1:${port}`;

function spawnProcess(command, args, options = {}) {
  return spawn(command, args, {
    cwd: options.cwd || ROOT,
    env: { ...process.env, ...options.env },
    stdio: options.stdio || "inherit",
    shell: process.platform === "win32",
  });
}

async function waitForHealth(server, timeoutMs = 20000) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < timeoutMs) {
    if (server.exitCode !== null) throw new Error(`Backend exited before health check (code ${server.exitCode})`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Backend did not become healthy at ${baseUrl}: ${lastError}`);
}

function waitForExit(child, label) {
  return new Promise((resolve, reject) => {
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed with ${signal || `exit code ${code}`}`));
    });
  });
}

const build = spawnProcess("npm", ["--prefix", "server", "run", "build"]);
await waitForExit(build, "Server build");
if (!fs.existsSync(serverEntry)) throw new Error("Server build did not produce server/dist/app.js");

function runTests() {
  return runAllSmoke();
}

async function runAllSmoke() {
  await runPublicSmoke();
  await runServerSmoke();
}

function runServerSmoke() {
  return new Promise((resolve, reject) => {
    const child = spawnProcess("npm", ["--prefix", "server", "run", "test:against-running"], {
      env: {
        BASE_URL: baseUrl,
        UPLOAD_DIR: path.join(tempRoot, "uploads"),
        DEMO_MODE: "1",
      },
    });
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Server smoke tests failed with ${signal || `exit code ${code}`}`));
      }
    });
  });
}

async function request(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: HTTP ${response.status} ${JSON.stringify(payload).slice(0, 200)}`);
  }
  return payload;
}

async function runPublicSmoke() {
  const health = await request("GET", "/api/health");
  if (!health.checks && !health.data?.checks) throw new Error("Health response should include checks");

  const project = await request("POST", "/api/projects", {
    name: "GitHub demo smoke",
    theme: "用 30 秒介绍 AIGC 视频工作流",
    style: "写实",
  });
  const projectId = project.data?.id;
  if (!projectId) throw new Error("Project creation did not return id");

  const script = await request("POST", "/api/ai/generate-script", {
    theme: "用 30 秒介绍 AIGC 视频工作流",
    duration: "30-45",
    style: "写实",
  });
  const storyboards = script.data?.storyboards || [];
  if (storyboards.length < 3) throw new Error("Demo script should return at least 3 storyboards");

  await request("POST", "/api/storyboards/batch", {
    project_id: projectId,
    storyboards,
  });
  const saved = await request("GET", `/api/storyboards/project/${projectId}`);
  if ((saved.data || []).length !== storyboards.length) throw new Error("Saved storyboards count mismatch");

  console.log(`Public smoke passed: project #${projectId}, storyboards=${storyboards.length}`);
}

const server = spawnProcess(process.execPath, [serverEntry], {
  env: {
    DEMO_MODE: "1",
    HOST: "127.0.0.1",
    PORT: port,
    DB_PATH: path.join(tempRoot, "database.sqlite"),
    SETTINGS_FILE: path.join(tempRoot, "settings.json"),
    UPLOAD_DIR: path.join(tempRoot, "uploads"),
    CORS_ORIGIN: "http://127.0.0.1:5173,http://localhost:5173",
  },
});

try {
  await waitForHealth(server);
  await runTests();
} finally {
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
