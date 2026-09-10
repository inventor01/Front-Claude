// Apply drizzle/ migrations to the local D1 that `npm run dev` serves.
//
// The control plane applies migrations to the real database on deploy, and the
// application never creates schema at runtime, so nothing was applying them to
// the Miniflare database used locally: a fresh checkout ran `npm run dev` and hit
// "D1_ERROR: no such table: watchlist" on the first request.
//
// The binding name comes from .openai/hosting.json so it cannot drift from the
// one vite.config.ts binds. Wrangler records what it has applied, so re-running
// this is a no-op.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { projectRoot } from "./sites-env.mjs";

const hosting = JSON.parse(
  readFileSync(path.join(projectRoot, ".openai/hosting.json"), "utf8"),
);
if (!hosting.d1) {
  throw new Error(
    'No D1 binding configured. Set the `d1` field in .openai/hosting.json (for example "DB") before running migrations.',
  );
}

// `migrations_dir` resolves relative to the config file, so keep it absolute.
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
  // --persist-to must match the dev server's state directory or this migrates a
  // different database than the one `npm run dev` reads.
  const result = spawnSync(
    process.execPath,
    [
      path.join(projectRoot, "node_modules/wrangler/bin/wrangler.js"),
      "d1", "migrations", "apply", hosting.d1,
      "--local",
      "--persist-to", path.join(projectRoot, ".wrangler/state"),
      "--config", configPath,
    ],
    { stdio: "inherit", cwd: projectRoot },
  );
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
} finally {
  rmSync(configDirectory, { recursive: true, force: true });
}
