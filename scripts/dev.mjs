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

async function findAvailablePort(start = 3000, host = "127.0.0.1", useExplicitPort = true) {
  const explicit = useExplicitPort ? process.env.PORT : "";
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
// Vite 默认会在 5173 被占用时自动漂移端口。先在编排器中确定端口，
// 再把同一个精确 Origin 交给后端，既避免 CORS 失配，也不需要放宽为任意本地端口。
const clientPort = await findAvailablePort(5173, "127.0.0.1", false);
const serverEnv = {
  HOST: "127.0.0.1",
  PORT: serverPort,
  CORS_ORIGIN: process.env.CORS_ORIGIN || `http://127.0.0.1:${clientPort},http://localhost:${clientPort}`,
  ...(isDemo ? { DEMO_MODE: "1" } : {}),
};

console.log(isDemo ? "Starting AIGC demo mode..." : "Starting AIGC dev mode...");
console.log(`Backend target: http://127.0.0.1:${serverPort}`);
console.log(`Client target: http://127.0.0.1:${clientPort}`);
run("server", "npm", ["--prefix", "server", "start"], { cwd: ROOT, env: serverEnv });
run("client", "npm", ["--prefix", "client", "run", "dev", "--", "--host", "127.0.0.1", "--port", clientPort, "--strictPort"], {
  cwd: ROOT,
  env: { VITE_PROXY_TARGET: `http://127.0.0.1:${serverPort}` },
});
