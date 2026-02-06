// api/game/join.js - Not used in solo mode
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.status(400).json({ error: 'Solo mode — use the dashboard to start a simulation' });
}
