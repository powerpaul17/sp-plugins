#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, '..', 'dist');

if (!fs.existsSync(path.join(DIST_DIR, 'plugin.js'))) {
  console.log('No build found — running build first...');
  execSync('node scripts/build.js', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
  });
}

const cwd = process.cwd();
process.chdir(DIST_DIR);
const files = fs.readdirSync(DIST_DIR).filter((f) => f !== 'plugin.zip');
execSync('zip -r plugin.zip ' + files.join(' '), { stdio: 'inherit' });
process.chdir(cwd);

console.log('Package: ' + path.join(DIST_DIR, 'plugin.zip'));
