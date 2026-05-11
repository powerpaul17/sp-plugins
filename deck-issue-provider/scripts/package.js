#!/usr/bin/env node
const path = require('path');
const { packagePlugin } = require('../../shared/scripts/package');

packagePlugin(path.join(__dirname, '..'));
