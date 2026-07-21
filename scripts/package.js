import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const OUTPUT_FILE = path.join(ROOT_DIR, 'formpilot-release.zip');

function createZip() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error('Error: dist/ directory not found. Please run npm run build first.');
    process.exit(1);
  }

  const zip = new AdmZip();
  
  // Add all files from dist directory to the root of the zip
  zip.addLocalFolder(DIST_DIR);
  
  // Write the zip file
  zip.writeZip(OUTPUT_FILE);
  
  console.log(`Successfully created deployment package at: ${OUTPUT_FILE}`);
}

createZip();
