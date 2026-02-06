// api/team/members.js - Solo mode: simplified
import { requireAuth, cors } from '../../lib/auth.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const decoded = await requireAuth(req, res);
  if (!decoded) return;

  // In solo mode, the player is the only member
  res.json({ members: [{ userId: decoded.userId, name: decoded.name || 'Player', role: 'ceo' }] });
}
