// Vercel Serverless Function: GET /api/trace/[filename]
import fs from 'node:fs';
import path from 'node:path';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { filename } = req.query;
  const safeFilename = path.basename(filename || '');
  if (!safeFilename || !safeFilename.endsWith('.jsonl')) {
    return res.status(400).send('Invalid trace filename');
  }

  const possibleDirs = [
    path.join(process.cwd(), 'scenarios', 'traces'),
    path.resolve('scenarios/traces'),
    path.join(path.dirname(__filename || ''), '..', '..', 'scenarios', 'traces')
  ];
  const tracesDir = possibleDirs.find(d => {
    try { return fs.existsSync(d) && fs.statSync(d).isDirectory(); } catch { return false; }
  });

  if (!tracesDir) {
    return res.status(404).send('Trace directory not found in serverless environment');
  }

  const fullPath = path.join(tracesDir, safeFilename);

  if (!fs.existsSync(fullPath)) {
    return res.status(404).send('Trace not found');
  }

  try {
    const content = fs.readFileSync(fullPath, 'utf8');
    res.status(200).send(content);
  } catch (err) {
    res.status(500).send(`Error reading trace: ${err.message}`);
  }
}
