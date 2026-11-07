// Project Setu - Zero Dependency CSS Bundler
// Concatenates core application stylesheets into a single production bundle.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const STYLES_DIR = path.join(ROOT_DIR, 'dashboard', 'styles');
const OUTPUT_FILE = path.join(STYLES_DIR, 'bundle.css');

const CSS_FILES = [
  'main.css',
  'topology.css',
  'controls.css',
  'inspector.css'
];

export function buildCss() {
  const chunks = [];
  chunks.push('/* Project Setu Combined Application Stylesheet */\n');

  for (const filename of CSS_FILES) {
    const filePath = path.join(STYLES_DIR, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Stylesheet not found: ${filePath}`);
    }
    const content = fs.readFileSync(filePath, 'utf8');
    chunks.push(`/* File: ${filename} */\n${content}\n`);
  }

  const bundled = chunks.join('\n');
  fs.writeFileSync(OUTPUT_FILE, bundled, 'utf8');
  console.log(`Successfully bundled ${CSS_FILES.length} stylesheets into ${OUTPUT_FILE} (${bundled.length} bytes)`);
  return OUTPUT_FILE;
}

if (process.argv[1] === __filename) {
  buildCss();
}

