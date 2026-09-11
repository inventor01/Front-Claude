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
    files: ["lib/narratives.ts", "app/desk.tsx", "app/lab/page.tsx"],
    rules: {
      // Third-party payloads are now parsed through lib/schemas.ts, so
      // lib/providers.ts is held to the rule. What remains here is a different
      // kind of debt: untyped D1 row shapes, the collector state blob this code
      // writes itself, and browser-side `response.json()`. Those want generated
      // row types and a typed API client, not runtime validation. Kept visible as
      // warnings rather than silenced.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
]);

export default eslintConfig;
