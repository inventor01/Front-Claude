import { spawnSync } from "node:child_process";
import path from "node:path";
import { projectRoot } from "./sites-env.mjs";

const port = String(process.env.PORT || "8787");
const host = process.env.HOST || "0.0.0.0";

// Railway/standalone containers do not get the ChatGPT Sites control-plane
// migration step, so make the local D1 schema ready before serving requests.
const migrate = spawnSync(process.execPath, [path.join(projectRoot, "scripts/migrate-local.mjs")], {
  cwd: projectRoot,
  stdio: "inherit",
  env: process.env,
});
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

const server = spawnSync(process.execPath, args, {
  cwd: projectRoot,
  stdio: "inherit",
  env: process.env,
});
if (server.error) throw server.error;
process.exit(server.status ?? 1);
