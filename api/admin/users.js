// api/admin/users.js - List all users
import { sql } from '@vercel/postgres';
import { getUserFromRequest, cors } from '../../lib/auth.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const decoded = getUserFromRequest(req);
  if (!decoded) return res.status(401).json({ error: 'Authentication required' });

  const adminCheck = await sql`SELECT is_admin FROM users WHERE id = ${decoded.userId}`;
  if (!adminCheck.rows[0]?.is_admin) return res.status(403).json({ error: 'Admin access required' });

  try {
    const result = await sql`
      SELECT 
        u.id, u.name, u.email, u.organization, u.job_title,
        u.auth_provider, u.is_admin, u.email_verified, u.created_at,
        u.subscription_tier, u.subscription_status, u.subscription_type, u.decisions_used,
        COALESCE(g.game_count, 0) as games
      FROM users u
      LEFT JOIN (
        SELECT user_id, COUNT(*) as game_count
        FROM games GROUP BY user_id
      ) g ON u.id = g.user_id
      ORDER BY u.created_at DESC
    `;

    const users = result.rows.map(r => ({
      id: r.id, name: r.name, email: r.email,
      organization: r.organization || '-', jobTitle: r.job_title || '-',
      authProvider: r.auth_provider || 'email',
      isAdmin: r.is_admin || false,
      plan: r.subscription_tier || 'free',
      planStatus: r.subscription_status || 'inactive',
      planType: r.subscription_type || null,
      decisionsUsed: r.decisions_used || 0,
      games: parseInt(r.games),
      joined: new Date(r.created_at).toLocaleDateString()
    }));

    return res.json({ users, total: users.length });
  } catch (error) {
    console.error('Admin users error:', error);
    return res.status(500).json({ error: 'Failed to fetch users' });
  }
}
