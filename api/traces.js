// Vercel Serverless Function: GET /api/traces
import fs from 'node:fs';
import path from 'node:path';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const possibleDirs = [
    path.join(process.cwd(), 'scenarios', 'traces'),
    path.resolve('scenarios/traces'),
    path.join(path.dirname(__filename || ''), '..', 'scenarios', 'traces')
  ];
  const tracesDir = possibleDirs.find(d => {
    try { return fs.existsSync(d) && fs.statSync(d).isDirectory(); } catch { return false; }
  });

  try {
    if (!tracesDir || !fs.existsSync(tracesDir)) {
      return res.status(200).json([]);
    }
    const files = fs.readdirSync(tracesDir).filter(f => f.endsWith('.jsonl'));
    const traces = files.map(f => {
      const full = path.join(tracesDir, f);
      const st = fs.statSync(full);
      return {
        filename: f,
        sizeBytes: st.size,
        modified: st.mtime
      };
    });
    res.status(200).json(traces);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
