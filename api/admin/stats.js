// api/admin/stats.js - Admin dashboard statistics
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
    const userCount = await sql`SELECT COUNT(*) as count FROM users`;
    
    let assessmentCount = { rows: [{ count: 0 }] };
    let avgScores = { rows: [{ avg_overall: 0, avg_gaps: 0 }] };
    let leadCount = { rows: [{ count: 0 }] };
    let newUsers7d = { rows: [{ count: 0 }] };
    let assessments7d = { rows: [{ count: 0 }] };
    let goalDist = { rows: [] };

    try { assessmentCount = await sql`SELECT COUNT(*) as count FROM assessment_results`; } catch(e) {}
    try { leadCount = await sql`SELECT COUNT(*) as count FROM partner_leads`; } catch(e) {}
    try { newUsers7d = await sql`SELECT COUNT(*) as count FROM users WHERE created_at > NOW() - INTERVAL '7 days'`; } catch(e) {}
    try { assessments7d = await sql`SELECT COUNT(*) as count FROM assessment_results WHERE completed_at > NOW() - INTERVAL '7 days'`; } catch(e) {}
    try { avgScores = await sql`SELECT ROUND(AVG(overall_score)::numeric, 1) as avg_overall, ROUND(AVG(gap_count)::numeric, 1) as avg_gaps FROM assessment_results`; } catch(e) {}
    try { goalDist = await sql`SELECT goal, COUNT(*) as count FROM assessment_results WHERE goal IS NOT NULL GROUP BY goal ORDER BY count DESC`; } catch(e) {}

    return res.status(200).json({
      overview: {
        totalUsers: parseInt(userCount.rows[0].count) || 0,
        totalAssessments: parseInt(assessmentCount.rows[0].count) || 0,
        totalLeads: parseInt(leadCount.rows[0].count) || 0,
        avgOverallScore: parseFloat(avgScores.rows[0]?.avg_overall) || 0,
        avgGapCount: parseFloat(avgScores.rows[0]?.avg_gaps) || 0
      },
      last7Days: {
        newUsers: parseInt(newUsers7d.rows[0].count) || 0,
        assessments: parseInt(assessments7d.rows[0].count) || 0
      },
      goalDistribution: goalDist.rows
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    return res.status(500).json({ error: 'Failed to fetch stats', details: error.message });
  }
}
