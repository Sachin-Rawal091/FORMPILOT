import fs from 'fs';
import path from 'path';

const distManifestPath = path.resolve('dist/manifest.json');
const srcManifestPath = path.resolve('public/manifest.json');

if (!fs.existsSync(distManifestPath)) {
  console.error('Error: dist/manifest.json does not exist. Run build first.');
  process.exit(1);
}

const distManifest = JSON.parse(fs.readFileSync(distManifestPath, 'utf8'));
const srcManifest = JSON.parse(fs.readFileSync(srcManifestPath, 'utf8'));

const distCsp = distManifest.content_security_policy?.extension_pages;
const srcCsp = srcManifest.content_security_policy?.extension_pages;

console.log('[CSP Verification] Dist CSP:', distCsp);
console.log('[CSP Verification] Source CSP:', srcCsp);

if (distCsp !== srcCsp) {
  console.error('Error: CSP mismatch in dist/manifest.json!');
  console.error(`Expected: ${srcCsp}`);
  console.error(`Found:    ${distCsp}`);
  process.exit(1);
}

console.log('CSP validation passed successfully.');
