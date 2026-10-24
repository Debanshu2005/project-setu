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
  const tracesDir = path.join(process.cwd(), 'scenarios', 'traces');
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
