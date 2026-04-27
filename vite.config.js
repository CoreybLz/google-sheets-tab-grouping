import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, readdirSync, existsSync, writeFileSync, rmSync } from 'fs';

const SIDEPANEL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tab Groups</title>
  <script type="module" src="./assets/sidepanel.js"></script>
  <link rel="stylesheet" href="./assets/sidepanel.css">
</head>
<body class="m-0 p-0 h-screen overflow-hidden bg-white">
  <div id="root"></div>
</body>
</html>`;

/**
 * Write dist/sidepanel.html (with ./assets/ paths) and clean up the
 * dist/src/ sub-folder that Vite emits when the HTML input lives in src/.
 */
function writeSidepanel() {
  return {
    name: 'write-sidepanel',
    closeBundle() {
      writeFileSync('dist/sidepanel.html', SIDEPANEL_HTML);
      // Remove the redundant dist/src/ folder Vite creates for the HTML input
      if (existsSync('dist/src')) rmSync('dist/src', { recursive: true, force: true });
    },
  };
}

/** Copy non-bundled extension files into dist/ so it is a complete, loadable package. */
function copyExtensionFiles() {
  return {
    name: 'copy-extension-files',
    closeBundle() {
      for (const file of ['manifest.json', 'background.js', 'content.js', 'content.css']) {
        if (existsSync(file)) copyFileSync(file, `dist/${file}`);
      }
      if (existsSync('icons')) {
        mkdirSync('dist/icons', { recursive: true });
        for (const f of readdirSync('icons')) copyFileSync(`icons/${f}`, `dist/icons/${f}`);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), writeSidepanel(), copyExtensionFiles()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'src/sidepanel.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});
