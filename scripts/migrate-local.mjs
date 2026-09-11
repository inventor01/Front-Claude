// Apply drizzle/ migrations to the same local D1 state directory the server uses.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { projectRoot } from "./sites-env.mjs";

const hosting = JSON.parse(
  readFileSync(path.join(projectRoot, ".openai/hosting.json"), "utf8"),
);
if (!hosting.d1) {
  throw new Error(
    'No D1 binding configured. Set the `d1` field in .openai/hosting.json before running migrations.',
  );
}

const persistDir = process.env.FRONT_PERSIST_DIR
  ? path.resolve(process.env.FRONT_PERSIST_DIR)
  : path.join(projectRoot, ".wrangler/state");
mkdirSync(persistDir, { recursive: true });

const configDirectory = mkdtempSync(path.join(tmpdir(), "front-migrate-"));
const configPath = path.join(configDirectory, "wrangler.json");
writeFileSync(
  configPath,
  JSON.stringify({
    name: "front-local-migrate",
    compatibility_date: "2026-01-01",
    d1_databases: [
      {
        binding: hosting.d1,
        database_name: "site-creator-d1",
        database_id: "00000000-0000-4000-8000-000000000000",
        migrations_dir: path.join(projectRoot, "drizzle"),
      },
    ],
  }),
);

try {
  const result = spawnSync(
    process.execPath,
    [
      path.join(projectRoot, "node_modules/wrangler/bin/wrangler.js"),
      "d1", "migrations", "apply", hosting.d1,
      "--local",
      "--persist-to", persistDir,
      "--config", configPath,
    ],
    { stdio: "inherit", cwd: projectRoot },
  );
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
} finally {
  rmSync(configDirectory, { recursive: true, force: true });
}
