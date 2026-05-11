#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { build } = require('esbuild');

const ROOT_DIR = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

async function buildPlugin() {
  console.log('Building caldav-task-provider...');

  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
  }
  fs.mkdirSync(DIST_DIR);

  await build({
    entryPoints: [path.join(SRC_DIR, 'plugin.ts')],
    bundle: true,
    outfile: path.join(DIST_DIR, 'plugin.js'),
    platform: 'browser',
    target: 'es2020',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'info',
    minify: true,
    sourcemap: false,
  });

  fs.copyFileSync(
    path.join(SRC_DIR, 'manifest.json'),
    path.join(DIST_DIR, 'manifest.json'),
  );

  const iconSrc = path.join(ROOT_DIR, 'icon.svg');
  if (fs.existsSync(iconSrc)) {
    fs.copyFileSync(iconSrc, path.join(DIST_DIR, 'icon.svg'));
  }

  if (fs.existsSync(path.join(ROOT_DIR, 'i18n'))) {
    const dest = path.join(DIST_DIR, 'i18n');
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(path.join(ROOT_DIR, 'i18n'))) {
      if (f.endsWith('.json')) {
        fs.copyFileSync(path.join(ROOT_DIR, 'i18n', f), path.join(dest, f));
      }
    }
  }

  console.log('Build complete → dist/');
}

buildPlugin().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
