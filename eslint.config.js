// eslint.config.js — flat config, type-aware via typescript-eslint's project service.
// Convention (AGENTS.md): no semicolons, descriptive names, comments explain why.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // Never lint build output, dependencies, or test coverage artifacts.
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,

  // projectService lets each file use its nearest tsconfig, so type-aware rules
  // cover src/ and test/ alike (tsconfig.json includes both).
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Type-aware rules need TS files; plain JS config files get the base set only.
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },

  {
    rules: {
      // Repo convention: no semicolons unless syntactically necessary.
      semi: ['error', 'never'],

      // Repo convention: descriptive bindings — no single-char throwaway names.
      // Underscores stay exempt for intentionally-unused parameters.
      'id-length': ['error', { min: 2, exceptions: ['_'] }],
    },
  },
)
