#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { build } = require('esbuild');

async function buildPlugin(rootDir) {
  const srcDir = path.join(rootDir, 'src');
  const distDir = path.join(rootDir, 'dist');
  const name = path.basename(rootDir);

  console.log(`Building ${name}...`);

  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true });
  }
  fs.mkdirSync(distDir);

  await build({
    entryPoints: [path.join(srcDir, 'plugin.ts')],
    bundle: true,
    outfile: path.join(distDir, 'plugin.js'),
    platform: 'browser',
    target: 'es2020',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'info',
    minify: true,
    sourcemap: false,
  });

  fs.copyFileSync(
    path.join(srcDir, 'manifest.json'),
    path.join(distDir, 'manifest.json'),
  );

  const iconSrc = path.join(rootDir, 'icon.svg');
  if (fs.existsSync(iconSrc)) {
    fs.copyFileSync(iconSrc, path.join(distDir, 'icon.svg'));
  }

  if (fs.existsSync(path.join(rootDir, 'i18n'))) {
    const dest = path.join(distDir, 'i18n');
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(path.join(rootDir, 'i18n'))) {
      if (f.endsWith('.json')) {
        fs.copyFileSync(path.join(rootDir, 'i18n', f), path.join(dest, f));
      }
    }
  }

  console.log('Build complete → dist/');
}

module.exports = { buildPlugin };
