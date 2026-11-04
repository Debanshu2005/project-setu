// Project Setu: Shared simulator executable resolver.
// Locates setu_sim across Linux, macOS, and Windows environments.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '..');

export function findSimulator(customRootDir) {
  if (process.env.SETU_SIM_PATH && fs.existsSync(process.env.SETU_SIM_PATH)) {
    return path.resolve(process.env.SETU_SIM_PATH);
  }
  const rootDir = customRootDir ? path.resolve(customRootDir) : DEFAULT_ROOT;
  const candidates = [
    path.join(rootDir, 'build', 'Release', 'setu_sim.exe'),
    path.join(rootDir, 'build', 'setu_sim.exe'),
    path.join(rootDir, 'setu_sim.exe'),
    path.join(rootDir, 'build', 'setu_sim'),
    path.join(rootDir, 'build', 'Release', 'setu_sim'),
    path.join(rootDir, 'build-native', 'setu_sim'),
    path.join(rootDir, 'build-native', 'Release', 'setu_sim'),
    path.join(rootDir, 'setu_sim')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

