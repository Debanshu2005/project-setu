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

  const tracesDir = path.join(process.cwd(), 'scenarios', 'traces');
  try {
    if (!fs.existsSync(tracesDir)) {
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
