import { resolve } from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

const __dirname = import.meta.dirname;

export default defineConfig({
  plugins: [
    dts({ rollupTypes: true }), // .d.tsファイルを生成するプラグイン
  ],
  build: {
    // ライブラリモードでのビルド設定
    lib: {
      entry: resolve(__dirname, 'src/index.ts'), // エントリーポイント
      formats: ['es', 'cjs'], // 出力するJSのフォーマット
      fileName: (format) => `index.${format === 'es' ? 'mjs' : 'cjs'}`, // 出力するJSのファイル名
      cssFileName: 'style', // 出力するCSSのファイル名
    },
  },
});
