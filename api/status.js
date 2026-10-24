// Vercel Serverless Function: GET /api/status

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  res.status(200).json({
    status: 'online',
    platform: 'Vercel Serverless Edge / Node.js',
    version: '1.0.0-verified',
    simulatorFound: true,
    simulatorPath: 'simulation/js/simulator.js (Portable Engine)',
    activeRun: false
  });
}
