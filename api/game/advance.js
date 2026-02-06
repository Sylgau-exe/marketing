// api/game/advance.js - Not needed in solo mode (auto-processes on submit)
// Kept as a no-op to prevent 404s
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.status(400).json({ error: 'Quarters auto-process when you submit decisions. No manual advance needed.' });
}
