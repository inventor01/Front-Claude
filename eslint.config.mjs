import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next, minus `build/**`: this project builds
    // through Vite into `dist/`, and `build/` holds the vendored Sites plugin source.
    ".next/**",
    "out/**",
    "dist/**",
    "next-env.d.ts",
  ]),
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["build/sites-vite-plugin.ts"],
    rules: {
      // Vendored verbatim from @openai/sites-vite-plugin 0.2.0; see the adjacent
      // LICENSE. Linted for real breakage, not restyled against upstream.
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    files: ["app/settings/settings-client.tsx"],
    rules: {
      // The deployed vinext client router can leave the Settings -> Front Link
      // as a no-op. This single control intentionally performs a document-level
      // navigation so it remains reliable in the production runtime.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  {
    files: ["lib/narratives.ts", "lib/narratives-base.ts", "app/desk.tsx", "app/lab/page.tsx"],
    rules: {
      // narratives-base.ts is an immutable snapshot of the pre-v12 narrative
      // engine retained so the typed v12 facade can override coin matching
      // without silently changing the legacy evidence/lifecycle behavior.
      // The same untyped D1 row debt already existed in lib/narratives.ts;
      // keep it visible as warnings while holding new v12 code to strict lint.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
]);

export default eslintConfig;
