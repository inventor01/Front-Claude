import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "./sites-env.mjs";

const port = String(process.env.PORT || "8787");
const host = process.env.HOST || "0.0.0.0";
const persistDir = process.env.FRONT_PERSIST_DIR
  ? path.resolve(process.env.FRONT_PERSIST_DIR)
  : path.join(projectRoot, ".wrangler/state");
mkdirSync(persistDir, { recursive: true });

const migrate = spawnSync(
  process.execPath,
  [path.join(projectRoot, "scripts/migrate-local.mjs")],
  {
    cwd: projectRoot,
    stdio: "inherit",
    env: { ...process.env, FRONT_PERSIST_DIR: persistDir },
  },
);
if (migrate.error) throw migrate.error;
if ((migrate.status ?? 1) !== 0) process.exit(migrate.status ?? 1);

const wrangler = path.join(projectRoot, "node_modules/wrangler/bin/wrangler.js");
const args = [
  "--import",
  path.join(projectRoot, "scripts/sites-env.mjs"),
  wrangler,
  "dev",
  "--config",
  path.join(projectRoot, "dist/server/wrangler.json"),
  "--local",
  "--persist-to",
  persistDir,
  "--ip",
  host,
  "--port",
  port,
  "--inspector-port",
  "0",
];

const workerVariableNames = [
  "FRONT_SETTINGS_KEY",
  "FRONT_STANDALONE_USER_ID",
  "FRONT_STANDALONE_USER_EMAIL",
  "FRONT_STANDALONE_USER_NAME",
];
const forwardedWorkerVariableNames = [];
for (const name of workerVariableNames) {
  const value = process.env[name];
  if (!value) continue;
  args.push("--var", `${name}:${value}`);
  forwardedWorkerVariableNames.push(name);
}

if (process.env.RAILWAY_ENVIRONMENT && !process.env.FRONT_STANDALONE_USER_ID) {
  console.error(
    "[front] FRONT_STANDALONE_USER_ID is required for the standalone Railway runtime.",
  );
  process.exit(1);
}

if (forwardedWorkerVariableNames.length) {
  console.log(
    `[front] Forwarding Worker bindings: ${forwardedWorkerVariableNames.join(", ")}`,
  );
}
console.log(`[front] D1 persistence directory: ${persistDir}`);

const server = spawn(process.execPath, args, {
  cwd: projectRoot,
  stdio: "inherit",
  env: process.env,
});

let watcher;
if (process.env.FRONT_SETTINGS_KEY && process.env.FRONT_STANDALONE_USER_ID) {
  watcher = spawn(process.execPath, [path.join(projectRoot, "scripts/pumpportal-watcher.mjs")], {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });
  watcher.on("exit", (code, signal) => {
    if (code && !signal) console.warn(`[front] launch watcher exited with code ${code}`);
  });
} else {
  console.log('[front] background PumpPortal watcher disabled outside configured standalone runtime.');
}

let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  try { watcher?.kill(signal); } catch {}
  try { server.kill(signal); } catch {}
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));
server.on("error", (error) => { console.error(error); stop(); });
server.on("exit", (code, signal) => {
  if (!stopping) {
    try { watcher?.kill("SIGTERM"); } catch {}
    process.exit(code ?? (signal ? 1 : 0));
  }
});
