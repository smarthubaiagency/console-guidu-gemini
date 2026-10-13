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
  {
    // Feedback of the dashboard goes through the SmartStatusBanner
    // (useStatus / confirmStatus, ADR 0016), never the browser dialogs.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...["alert", "confirm", "prompt"].map((name) => ({
          name,
          message: "Use useStatus() ou confirmStatus() (ADR 0016).",
        })),
      ],
      "no-restricted-properties": [
        "error",
        ...["alert", "confirm", "prompt"].map((property) => ({
          object: "window",
          property,
          message: "Use useStatus() ou confirmStatus() (ADR 0016).",
        })),
      ],
    },
  },
  {
    // AI SDK (ADR 0017, A2b): only the engine in src/core/ai talks to
    // models; everything else uses its services.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/core/ai/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(ai|ai/.*|@ai-sdk/.*|@openrouter/.*)$",
              message: "Só src/core/ai importa o SDK de IA (ADR 0017).",
            },
          ],
        },
      ],
    },
  },
  {
    // UI standard (ADR 0014, U3e): screens use the shadcn components in
    // src/components/ui, never the raw HTML controls. Hidden inputs carry
    // form data only and stay raw.
    files: ["src/**/*.tsx"],
    ignores: ["src/components/ui/**", "src/**/*.test.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...[
          ["button", "Button"],
          ["select", "NativeSelect (formulários) ou Select"],
          ["textarea", "Textarea"],
          ["table", "Table"],
        ].map(([tag, component]) => ({
          selector: `JSXOpeningElement[name.name="${tag}"]`,
          message: `<${tag}> cru fora de src/components/ui: use ${component} de @/components/ui (ADR 0014).`,
        })),
        {
          selector:
            'JSXOpeningElement[name.name="input"]:not(:has(JSXAttribute[name.name="type"][value.value="hidden"]))',
          message:
            '<input> cru fora de src/components/ui: use Input, Checkbox, Switch ou RadioGroup de @/components/ui (ADR 0014). Só type="hidden" fica cru.',
        },
      ],
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
