import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "web/**"] }, // web lints via its own Next build
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // Design principle 4 / hardest-to-reverse #7: the LLM gateway is the sole
      // path to model providers. Only the gateway module may import provider
      // SDKs; everything else must go through gatewayCall(). (Production adds
      // network policy; this is the code-level enforcement in CI.)
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@anthropic-ai/sdk",
              message: "Model calls must go through src/gateway/llmGateway.ts — the single enforcement point (Block 3).",
            },
            { name: "openai", message: "Model calls must go through src/gateway/llmGateway.ts." },
          ],
        },
      ],
    },
  },
  {
    // The gateway itself is the one sanctioned importer of provider SDKs.
    files: ["src/gateway/**"],
    rules: { "no-restricted-imports": "off" },
  },
);
