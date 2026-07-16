import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname);
const distDir = path.join(root, 'dist');
const zipPath = path.join(root, 'formpilot-extension.zip');

// Remove old zip if exists
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
  console.log('Removed old zip.');
}

// BUG-AUDIT-10 fix: Delete stray uncompiled popup.html from dist root
const strayPopup = path.join(distDir, 'popup.html');
if (fs.existsSync(strayPopup)) {
  fs.unlinkSync(strayPopup);
  console.log('Removed stray uncompiled dist/popup.html');
}

// Use PowerShell to create the zip
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${distDir}\\*' -DestinationPath '${zipPath}' -Force"`,
  { stdio: 'inherit' }
);

const stats = fs.statSync(zipPath);
console.log(`Created formpilot-extension.zip (${(stats.size / 1024).toFixed(1)} KB)`);
