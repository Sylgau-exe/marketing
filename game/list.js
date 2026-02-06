// api/game/list.js - List user's games
import { sql } from '@vercel/postgres';
import { requireAuth } from '../../lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const result = await sql`
      SELECT 
        g.id, g.code, g.name, g.status, g.current_quarter, g.max_teams,
        g.market_scenario,
        t.id as team_id, t.name as team_name, t.cash_balance,
        tm.role,
        (SELECT COUNT(*) FROM teams WHERE game_id = g.id) as team_count
      FROM team_members tm
      JOIN teams t ON tm.team_id = t.id
      JOIN games g ON t.game_id = g.id
      WHERE tm.user_id = ${user.id}
      ORDER BY g.created_at DESC
    `;

    res.json({
      games: result.rows.map(g => ({
        id: g.id,
        code: g.code,
        name: g.name,
        status: g.status,
        current_quarter: g.current_quarter,
        max_teams: g.max_teams,
        market_scenario: g.market_scenario,
        team_id: g.team_id,
        team_name: g.team_name,
        cash_balance: g.cash_balance,
        role: g.role,
        team_count: parseInt(g.team_count || 0)
      }))
    });
  } catch (error) {
    console.error('List games error:', error);
    res.status(500).json({ error: 'Failed to list games' });
  }
}
