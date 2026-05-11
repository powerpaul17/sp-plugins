#!/usr/bin/env node
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function packagePlugin(rootDir) {
  const distDir = path.join(rootDir, 'dist');

  if (!fs.existsSync(path.join(distDir, 'plugin.js'))) {
    console.log('No build found — running build first...');
    const { buildPlugin } = require('./build');
    buildPlugin(rootDir);
  }

  const files = fs.readdirSync(distDir).filter((f) => f !== 'plugin.zip');
  execFileSync('zip', ['-r', 'plugin.zip', ...files], { cwd: distDir, stdio: 'inherit' });

  console.log('Package: ' + path.join(distDir, 'plugin.zip'));
}

module.exports = { packagePlugin };
