import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {includeIgnoreFile} from "@eslint/compat";
import {fixupPluginRules} from "@eslint/compat";
import globals from "globals";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gitignorePath = path.resolve(__dirname, ".gitignore");

export default [
    includeIgnoreFile(gitignorePath),
    eslint.configs.recommended,
    reactPlugin.configs.flat["jsx-runtime"],
    eslintPluginPrettierRecommended,
    ...tseslint.configs.strict,
    ...tseslint.configs.stylistic,
    {
        ...reactPlugin.configs.flat.recommended,
        settings: {
            ...reactPlugin.configs.flat.recommended.settings,
            react: {version: "detect"},
        },
    },
    {
        files: ["**/*.ts", "**/*.tsx", "**/*.js"],
        languageOptions: {
            globals: {
                ...globals.node,
            },
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },
        plugins: {
            "react-hooks": fixupPluginRules(reactHooks),
        },
        rules: {
            // We don't consider those rules helpful
            "@typescript-eslint/no-empty-function": "off",
            "@typescript-eslint/no-non-null-assertion": "off",
            "@typescript-eslint/no-unused-vars": ["error", {vars: "all", argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_"}],
            // We use `react-jsx` and there `React` does not need to be in scope
            "react/react-in-jsx-scope": "off",
            // The following rules should be enabled, but aren't yet due to legacy code which still needs
            // to be adapted
            "@typescript-eslint/explicit-module-boundary-types": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "no-prototype-builtins": "off",
            "react-hooks/rules-of-hooks": "error",
            "react-hooks/exhaustive-deps": "error",
        },
    },
    {
        files: ["**/*.js"],

        rules: {
            "@typescript-eslint/no-require-imports": 0,
        },
    },
];
