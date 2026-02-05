// api/admin/users.js - List all users (adapted from BizSimHub)
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
        COALESCE(a.assessment_count, 0) as assessments,
        a.last_assessment, a.avg_score
      FROM users u
      LEFT JOIN (
        SELECT user_id, COUNT(*) as assessment_count, 
               MAX(completed_at) as last_assessment,
               ROUND(AVG(overall_score)::numeric, 0) as avg_score
        FROM assessment_results GROUP BY user_id
      ) a ON u.id = a.user_id
      ORDER BY u.created_at DESC
    `;

    const users = result.rows.map(r => ({
      id: r.id, name: r.name, email: r.email,
      organization: r.organization || '-', jobTitle: r.job_title || '-',
      authProvider: r.auth_provider || 'email',
      isAdmin: r.is_admin || false,
      assessments: parseInt(r.assessments),
      avgScore: parseInt(r.avg_score) || 0,
      lastAssessment: r.last_assessment ? new Date(r.last_assessment).toLocaleDateString() : 'Never',
      joined: new Date(r.created_at).toLocaleDateString()
    }));

    return res.json({ users, total: users.length });
  } catch (error) {
    console.error('Admin users error:', error);
    return res.status(500).json({ error: 'Failed to fetch users' });
  }
}
