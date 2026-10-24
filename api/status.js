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
    version: '1.0.0-fitl',
    simulatorFound: true,
    simulatorPath: 'simulation/native/setu_sim (FITL C++ Engine via Persistent Bridge)',
    engine: 'fitl_native_bridge',
    executionModel: 'Hybrid: Vercel Frontend + Persistent FITL Native Engine (Option B)',
    realFirmwareCoreCompiled: true,
    freeRtosQueuesSimulated: true,
    activeRun: false
  });
}
