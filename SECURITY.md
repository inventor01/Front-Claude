# Front Security Notes

## Dependency hardening — September 15, 2026

Front's v26 production dependency tree was audited after release. The audit identified a critical direct Next.js advisory plus high-severity runtime/transitive advisories and high-severity build-tool advisories.

### Remediation

The hardening release upgrades the affected compatible dependency set without using `npm audit fix --force` or `--legacy-peer-deps`:

- `next` → `16.3.5`
- `react` / `react-dom` → `19.2.8`
- `react-server-dom-webpack` → `19.2.8`
- `@cloudflare/vite-plugin` → `1.54.9`
- `@cloudflare/workers-types` → `5.20260915.1`
- `@vitejs/plugin-rsc` → `0.5.34`
- `vite` → `8.3.0`
- `vinext` → `1.0.0-beta.10`
- `wrangler` → `4.131.2`
- compatible transitive packages are refreshed through the lockfile.

The resulting `npm audit --omit=dev` report is **0 vulnerabilities**.

### Known dev-only moderate advisory

The full development dependency audit still reports four moderate entries from one dependency chain:

`drizzle-kit@0.31.10` → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → vulnerable legacy `esbuild <=0.24.2`.

This chain is development-only and is not present in the production dependency audit. npm currently offers only `npm audit fix --force`, which would replace the current Drizzle Kit with `drizzle-kit@0.18.1`, a breaking downgrade. Front deliberately does not take that downgrade or override the nested esbuild version without upstream compatibility evidence.

Revisit this exception when Drizzle Kit removes the deprecated `@esbuild-kit` loader chain or provides a compatible patched release. Until then, do not expose the Drizzle development server to untrusted networks.

### CI enforcement

CI now runs both:

- `npm audit --omit=dev --audit-level=high` for production dependencies.
- `npm audit --audit-level=high` for the complete dependency tree.

Any future high or critical dependency advisory therefore blocks the release pipeline. The documented Drizzle development-only moderate chain does not weaken that gate.
