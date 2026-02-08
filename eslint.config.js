import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  // 基本的なJavaScript推奨ルール
  eslint.configs.recommended,

  // TypeScript推奨ルール
  tseslint.configs.recommended,

  // 除外設定
  {
    ignores: ['dist/**', 'node_modules/**', 'storybook-static/**', 'vendor/**'],
  },
);
