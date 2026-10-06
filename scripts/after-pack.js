'use strict';

// electron-builder afterPack hook. When building for macOS without a signing
// identity, ad-hoc sign the bundle: Apple Silicon refuses to launch unsigned
// apps, and macOS only remembers mic / screen-recording grants for signed apps.

const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin' || process.platform !== 'darwin') {
    return;
  }

  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY !== 'false') {
    return;
  }

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  console.log(`[after-pack] Ad-hoc signing ${appPath}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
