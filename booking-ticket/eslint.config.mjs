import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored third-party skill packages. Not our source, not shipped, and
    // they carry lint configuration of their own that this project cannot
    // resolve — linting them only produces noise about rules that do not exist
    // here.
    ".agents/**",
    ".claude/**",
    ".gstack/**",
  ]),
]);

export default eslintConfig;
