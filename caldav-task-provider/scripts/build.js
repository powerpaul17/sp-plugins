#!/usr/bin/env node
const path = require('path');
const { buildPlugin } = require('../../shared/scripts/build');

buildPlugin(path.join(__dirname, '..')).catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
