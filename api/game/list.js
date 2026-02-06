// api/game/list.js - List user's solo simulations
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

    // Find games owned by this user with their player team
    const result = await sql`
      SELECT 
        g.id, g.name, g.status, g.current_quarter, g.market_scenario, g.created_at,
        t.id as team_id, t.name as team_name, t.cash_balance
      FROM games g
      JOIN teams t ON t.game_id = g.id AND t.is_ai = false
      WHERE g.user_id = ${user.id}
      ORDER BY g.updated_at DESC
    `;

    res.json({
      games: result.rows.map(g => ({
        id: g.id,
        name: g.name,
        status: g.status,
        current_quarter: g.current_quarter,
        market_scenario: g.market_scenario,
        team_id: g.team_id,
        team_name: g.team_name,
        cash_balance: g.cash_balance,
        created_at: g.created_at
      }))
    });
  } catch (error) {
    console.error('List games error:', error);
    res.status(500).json({ error: 'Failed to list games' });
  }
}
