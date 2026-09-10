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
    files: [
      "lib/providers.ts",
      "lib/narratives.ts",
      "app/desk.tsx",
      "app/lab/page.tsx",
    ],
    rules: {
      // These modules deserialize unvalidated third-party payloads (DEX Screener,
      // GeckoTerminal, X, TikTok oEmbed) and untyped D1 row shapes. Hand-written
      // interfaces here would assert a shape nobody checked at runtime, which is
      // worse than an honest `any`. Kept as a visible warning until the payloads
      // are parsed with zod (already a dependency) and narrowed from `unknown`.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
]);

export default eslintConfig;
