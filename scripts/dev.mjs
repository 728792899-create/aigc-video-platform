import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const isDemo = process.argv.includes("--demo");

const children = [];

function portHasListener(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(350);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

async function findAvailablePort(start = 3000, host = "127.0.0.1") {
  const explicit = process.env.PORT;
  if (explicit) return String(explicit);
  for (let port = start; port < start + 40; port++) {
    if (!(await portHasListener(port, host))) return String(port);
  }
  return String(start + 40);
}

function run(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (signal) return;
    if (code && !shuttingDown) {
      console.error(`[${name}] exited with code ${code}`);
      shutdown(code);
    }
  });
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 800).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const serverPort = await findAvailablePort(3000);
const serverEnv = {
  HOST: "127.0.0.1",
  PORT: serverPort,
  CORS_ORIGIN: process.env.CORS_ORIGIN || "http://127.0.0.1:5173,http://localhost:5173",
  ...(isDemo ? { DEMO_MODE: "1" } : {}),
};

console.log(isDemo ? "Starting AIGC demo mode..." : "Starting AIGC dev mode...");
console.log(`Backend target: http://127.0.0.1:${serverPort}`);
run("server", "npm", ["--prefix", "server", "start"], { cwd: ROOT, env: serverEnv });
run("client", "npm", ["--prefix", "client", "run", "dev", "--", "--host", "127.0.0.1"], {
  cwd: ROOT,
  env: { VITE_PROXY_TARGET: `http://127.0.0.1:${serverPort}` },
});
