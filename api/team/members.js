// api/team/members.js - Team member management
import { sql } from '@vercel/postgres';
import { requireAuth, cors } from '../../lib/auth.js';
import { TeamMemberDB } from '../../lib/db.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const decoded = await requireAuth(req, res);
  if (!decoded) return;

  try {
    if (req.method === 'GET') {
      const teamId = req.query.team_id || req.query.teamId;
      if (!teamId) return res.status(400).json({ error: 'Team ID required' });
      const members = await TeamMemberDB.findByTeam(teamId);
      return res.json({ members: members.map(m => ({ userId: m.user_id, name: m.name || 'Unknown', email: m.email, role: m.role, joinedAt: m.created_at })) });
    }

    if (req.method === 'PUT') {
      const { team_id, teamId: tid, user_id, userId: uid, role } = req.body;
      const teamId = team_id || tid;
      const userId = user_id || uid;
      if (!teamId || !userId || !role) return res.status(400).json({ error: 'Team ID, user ID, and role required' });

      const validRoles = ['president', 'vp_marketing', 'vp_sales', 'vp_finance', 'member'];
      if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });

      const members = await TeamMemberDB.findByTeam(teamId);
      const requester = members.find(m => m.user_id === decoded.userId);
      if (!requester || requester.role !== 'president') return res.status(403).json({ error: 'Only team president can change roles' });

      await sql`UPDATE team_members SET role = ${role} WHERE team_id = ${teamId} AND user_id = ${userId}`;
      return res.json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Team members error:', error);
    res.status(500).json({ error: 'Failed to manage team members' });
  }
}
