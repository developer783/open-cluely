'use strict';

// Build launcher. electron-builder spawns helpers that misbehave when
// ELECTRON_RUN_AS_NODE is inherited from the shell, so we strip it here too.
// Detects the current platform and picks a sensible default target when no
// explicit --win/--mac/--linux flag is given.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const rootDir = path.join(__dirname, '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

// `.env` is bundled as an extra resource; create it from the example so a
// fresh checkout can build without manual steps.
const envPath = path.join(rootDir, '.env');
if (!fs.existsSync(envPath)) {
  fs.copyFileSync(path.join(rootDir, '.env.example'), envPath);
  console.log('[run-build] Created .env from .env.example');
}

if (!fs.existsSync(path.join(rootDir, 'assets', 'icon.png'))) {
  require('./generate-icon');
}

// Without a Developer ID certificate, skip identity discovery; after-pack.js
// then ad-hoc signs the .app so it launches on Apple Silicon.
if (os.platform() === 'darwin' && !env.CSC_LINK && !env.CSC_NAME) {
  env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
}

const userArgs = process.argv.slice(2);
const hasExplicitTarget = userArgs.some((arg) => ['--win', '--mac', '--linux', '-w', '-m', '-l'].includes(arg));

const platformArgs = hasExplicitTarget ? [] : (() => {
  switch (os.platform()) {
    case 'win32':  return ['--win', 'portable'];
    case 'darwin': return ['--mac'];
    case 'linux':  return ['--linux'];
    default:       return [];
  }
})();

const args = [...platformArgs, ...userArgs];

// Invoke electron-builder via Node directly to avoid spawning the .cmd
// shim on Windows (which needs shell:true and triggers a deprecation
// warning). The CLI module path is stable across versions.
const builderCli = require.resolve('electron-builder/out/cli/cli.js');
const child = spawn(process.execPath, [builderCli, ...args], {
  stdio: 'inherit',
  env,
  cwd: rootDir
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error('[run-build] Failed to spawn electron-builder:', err.message);
  process.exit(1);
});
