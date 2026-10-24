// Vercel Serverless Function: GET /api/scenarios
import fs from 'node:fs';
import path from 'node:path';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const scenariosDir = path.join(process.cwd(), 'scenarios');
  try {
    const files = fs.readdirSync(scenariosDir).filter(f => f.endsWith('.json'));
    const list = files.map(file => {
      try {
        const raw = fs.readFileSync(path.join(scenariosDir, file), 'utf8');
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }).filter(Boolean);

    res.status(200).json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
