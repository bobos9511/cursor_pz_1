'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, '.git'))) {
    process.exit(0);
}
try {
    execSync('git config core.hooksPath .githooks', { cwd: root, stdio: 'inherit' });
} catch {
    process.exit(0);
}
