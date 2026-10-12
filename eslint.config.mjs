import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";

const P0 = "P0 do design system:";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    // Design system P0: only tokens, no inline CSS.
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "better-tailwindcss": betterTailwindcss },
    settings: {
      "better-tailwindcss": { entryPoint: "src/app/globals.css" },
    },
    rules: {
      // Classes must exist in globals.css: the Tailwind palette (neutral-*,
      // red-*…) is reset there, so only design-system tokens resolve.
      "better-tailwindcss/no-unknown-classes": "error",
      "better-tailwindcss/no-restricted-classes": [
        "error",
        {
          restrict: [
            {
              pattern: "\\[.*\\]",
              message: `${P0} valor arbitrário ("$0"). Use um token do globals.css.`,
            },
            {
              pattern: "\\(--.*\\)",
              message: `${P0} variável CSS solta ("$0"). Use a classe do token.`,
            },
          ],
        },
      ],
      "react/forbid-dom-props": [
        "error",
        {
          forbid: [
            {
              propName: "style",
              message: `${P0} CSS inline é proibido. Use classes com tokens.`,
            },
          ],
        },
      ],
      "react/forbid-component-props": [
        "error",
        {
          forbid: [
            {
              propName: "style",
              message: `${P0} CSS inline é proibido. Use classes com tokens.`,
            },
          ],
        },
      ],
    },
  },
  {
    // shadcn/ui code copied from the official registry and the sidebar-08
    // block adapted in layout/shell (ADR 0014). It keeps the upstream
    // arbitrary values, CSS variables and the provider's inline CSS variables
    // so it can follow shadcn updates; classes must still exist in
    // globals.css. The feedback banner (ADR 0016) sets its countdown length
    // through a CSS variable. Everything else in src/ stays under P0.
    files: [
      "src/components/ui/**/*.tsx",
      "src/components/layout/shell/**/*.tsx",
      "src/components/feedback/**/*.tsx",
      "src/hooks/**/*.ts",
    ],
    rules: {
      "better-tailwindcss/no-restricted-classes": "off",
      "react/forbid-dom-props": "off",
      "react/forbid-component-props": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "coverage/**",
    "module-templates/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
