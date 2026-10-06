import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, statfsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { projectRoot } from "./sites-env.mjs";

const port = String(process.env.PORT || "8787");
const host = process.env.HOST || "0.0.0.0";
function hasUsableSpace(directory) {
  try {
    const stats = statfsSync(directory);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    return Number.isFinite(freeBytes) && freeBytes >= 64 * 1024 * 1024;
  } catch {
    return false;
  }
}
const requestedPersistDir = process.env.FRONT_PERSIST_DIR
  ? path.resolve(process.env.FRONT_PERSIST_DIR)
  : process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH)
    : path.join(projectRoot, ".wrangler/state");
if(process.env.RAILWAY_VOLUME_MOUNT_PATH){
  if(!hasUsableSpace(requestedPersistDir)){
    const report=spawnSync(process.execPath,[path.join(projectRoot,"scripts/report-front-storage.mjs"),requestedPersistDir],{
      cwd:projectRoot,stdio:"inherit",env:process.env
    });
    if(report.error)console.warn("[front] storage diagnostics failed:",report.error.message);
  }
  const prepare=spawnSync(process.execPath,[path.join(projectRoot,"scripts/prepare-front-persistence.mjs"),requestedPersistDir],{
    cwd:projectRoot,stdio:"inherit",env:process.env
  });
  if(prepare.error)console.warn("[front] persistence preparation failed:",prepare.error.message);
  else if((prepare.status??1)!==0)console.warn(`[front] persistence preparation exited with status ${prepare.status??1}`);
}
const persistDir = hasUsableSpace(requestedPersistDir)
  ? requestedPersistDir
  : path.join(tmpdir(), "front-wrangler-runtime");
if (persistDir !== requestedPersistDir) {
  console.warn("[front] persistence degraded: configured volume has insufficient free space; using ephemeral runtime storage");
}
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

if (process.env.FRONT_STANDALONE_USER_ID) {
  const cleanup = spawnSync(
    process.execPath,
    [path.join(projectRoot, "scripts/cleanup-intelligence.mjs")],
    {
      cwd: projectRoot,
      stdio: "inherit",
      env: { ...process.env, FRONT_PERSIST_DIR: persistDir },
    },
  );
  if (cleanup.error) throw cleanup.error;
  if ((cleanup.status ?? 1) !== 0) {
    console.error(`[front] intelligence cleanup failed with status ${cleanup.status ?? 1}`);
    process.exit(cleanup.status ?? 1);
  }
}

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
  "FRONT_COMMERCE_API_KEY",
  "FRONT_COMMERCE_OWNER_ID",
  "FRONT_BRIDGE_API_KEY",
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

let autoscan;
if (/^(1|true|yes|on)$/i.test(String(process.env.FRONT_SOCIAL_ARB_AUTOSCAN || ''))) {
  autoscan = spawn(process.execPath, [path.join(projectRoot, "scripts/social-arb-scheduler.mjs")], {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });
  autoscan.on("exit", (code, signal) => {
    if (code && !signal) console.warn(`[front] Social Arb autoscan scheduler exited with code ${code}`);
  });
} else {
  console.log("[front] Social Arb autoscan scheduler disabled.");
}

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
  try { autoscan?.kill(signal); } catch {}
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