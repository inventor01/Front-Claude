import { spawnSync } from "node:child_process";
import path from "node:path";
import { projectRoot } from "./sites-env.mjs";

const port = String(process.env.PORT || "8787");
const host = process.env.HOST || "0.0.0.0";

// Railway/standalone containers do not get the ChatGPT Sites control-plane
// migration step, so make the local D1 schema ready before serving requests.
const migrate = spawnSync(
  process.execPath,
  [path.join(projectRoot, "scripts/migrate-local.mjs")],
  {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
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
  path.join(projectRoot, ".wrangler/state"),
  "--ip",
  host,
  "--port",
  port,
  "--inspector-port",
  "0",
];

// Wrangler dev does not automatically expose the parent Node process environment
// to Worker code. Railway variables exist in process.env, but without explicit
// Worker bindings code that reads `cloudflare:workers` env sees only bindings
// declared in wrangler.json (for example DB). Forward only the variables Front's
// Worker runtime actually needs; never print their values.
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

const server = spawnSync(process.execPath, args, {
  cwd: projectRoot,
  stdio: "inherit",
  env: process.env,
});
if (server.error) throw server.error;
process.exit(server.status ?? 1);
