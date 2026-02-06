// api/admin/stats.js - Admin dashboard statistics for MarketSim
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

    let gameStats = { rows: [{ total: 0, active: 0, completed: 0, lobby: 0 }] };
    let teamCount = { rows: [{ count: 0 }] };
    let decisionCount = { rows: [{ count: 0 }] };
    let newUsers7d = { rows: [{ count: 0 }] };
    let newUsers30d = { rows: [{ count: 0 }] };
    let activeUsers30d = { rows: [{ count: 0 }] };
    let recentGames = { rows: [] };
    let scenarioDist = { rows: [] };
    let avgQuarter = { rows: [{ avg: 0 }] };

    try {
      gameStats = await sql`
        SELECT COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'active') as active,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE status = 'lobby') as lobby
        FROM games`;
    } catch(e) {}

    try { teamCount = await sql`SELECT COUNT(*) as count FROM teams`; } catch(e) {}
    try { decisionCount = await sql`SELECT COUNT(*) as count FROM decisions`; } catch(e) {}
    try { newUsers7d = await sql`SELECT COUNT(*) as count FROM users WHERE created_at > NOW() - INTERVAL '7 days'`; } catch(e) {}
    try { newUsers30d = await sql`SELECT COUNT(*) as count FROM users WHERE created_at > NOW() - INTERVAL '30 days'`; } catch(e) {}

    try {
      activeUsers30d = await sql`
        SELECT COUNT(DISTINCT g.user_id) as count
        FROM games g
        WHERE g.status IN ('active') AND g.updated_at > NOW() - INTERVAL '30 days'`;
    } catch(e) {}

    try {
      recentGames = await sql`
        SELECT g.id, g.name, g.market_scenario, g.status, g.current_quarter, g.created_at,
               COUNT(DISTINCT t.id) as team_count
        FROM games g LEFT JOIN teams t ON t.game_id = g.id
        GROUP BY g.id ORDER BY g.created_at DESC LIMIT 10`;
    } catch(e) {}

    try {
      scenarioDist = await sql`
        SELECT market_scenario, COUNT(*) as count FROM games
        WHERE market_scenario IS NOT NULL GROUP BY market_scenario ORDER BY count DESC`;
    } catch(e) {}

    try {
      avgQuarter = await sql`SELECT ROUND(AVG(current_quarter)::numeric, 1) as avg FROM games WHERE status = 'active'`;
    } catch(e) {}

    // Build recent activity
    let activityItems = [];
    try {
      const ru = await sql`SELECT name, email, created_at FROM users ORDER BY created_at DESC LIMIT 5`;
      ru.rows.forEach(u => activityItems.push({
        type: 'registration', icon: '👤',
        text: (u.name || 'New user') + ' registered (' + u.email + ')',
        time: u.created_at
      }));
    } catch(e) {}
    try {
      const rg = await sql`
        SELECT g.name, g.market_scenario, g.created_at, u.name as creator
        FROM games g LEFT JOIN users u ON u.id = g.user_id
        ORDER BY g.created_at DESC LIMIT 5`;
      rg.rows.forEach(g => activityItems.push({
        type: 'game', icon: '🎮',
        text: (g.creator || 'Player') + ' started ' + (g.name || g.market_scenario),
        time: g.created_at
      }));
    } catch(e) {}
    activityItems.sort((a, b) => new Date(b.time) - new Date(a.time));
    activityItems = activityItems.slice(0, 8);

    const totalUsers = parseInt(userCount.rows[0].count) || 0;
    const gs = gameStats.rows[0];

    return res.json({
      stats: {
        total_users: totalUsers,
        total_games: parseInt(gs.total) || 0,
        active_games: parseInt(gs.active) || 0,
        lobby_games: parseInt(gs.lobby) || 0,
        completed_games: parseInt(gs.completed) || 0,
        total_teams: parseInt(teamCount.rows[0].count) || 0,
        total_decisions: parseInt(decisionCount.rows[0].count) || 0,
        avg_quarter: parseFloat(avgQuarter.rows[0]?.avg) || 0
      },
      last7Days: { newUsers: parseInt(newUsers7d.rows[0].count) || 0 },
      last30Days: {
        newUsers: parseInt(newUsers30d.rows[0].count) || 0,
        activeUsers: parseInt(activeUsers30d.rows[0].count) || 0
      },
      recentGames: recentGames.rows.map(g => ({
        id: g.id, name: g.name, scenario: g.market_scenario,
        status: g.status, quarter: g.current_quarter,
        teams: parseInt(g.team_count), created: g.created_at
      })),
      scenarioDistribution: scenarioDist.rows,
      recentActivity: activityItems
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
}
