// api/simulation/leaderboard.js - Solo mode: player vs AI rankings
import { requireAuth, cors } from '../../lib/auth.js';
import { GameDB, TeamDB, ResultDB } from '../../lib/db.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const decoded = await requireAuth(req, res);
  if (!decoded) return;

  try {
    const { game_id } = req.query;
    if (!game_id) return res.status(400).json({ error: 'Game ID required' });

    const game = await GameDB.findById(game_id);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    const teams = await TeamDB.findByGame(game_id);
    const leaderboard = [];

    for (const team of teams) {
      const allResults = await ResultDB.findAllByTeam(team.id);
      const latest = allResults.length > 0 ? allResults[allResults.length - 1] : null;
      leaderboard.push({
        teamId: team.id,
        name: team.name,
        logo_emoji: team.logo_emoji,
        isPlayer: !team.is_ai,
        isAi: !!team.is_ai,
        quarters: allResults.map(r => ({
          quarter: r.quarter,
          revenue: parseFloat(r.total_revenue || r.revenue || 0),
          netIncome: parseFloat(r.net_income || 0),
          balancedScorecard: parseFloat(r.balanced_scorecard || 0)
        })),
        currentScorecard: latest ? parseFloat(latest.balanced_scorecard || 0) : 0,
        cumulative_scorecard: latest ? parseFloat(latest.cumulative_scorecard || latest.balanced_scorecard || 0) : 0,
        balanced_scorecard: latest ? parseFloat(latest.balanced_scorecard || 0) : 0,
        totalRevenue: allResults.reduce((s, r) => s + parseFloat(r.total_revenue || r.revenue || 0), 0),
        totalProfit: allResults.reduce((s, r) => s + parseFloat(r.net_income || 0), 0)
      });
    }

    leaderboard.sort((a, b) => (b.cumulative_scorecard || 0) - (a.cumulative_scorecard || 0));
    res.json({
      gameId: game_id,
      currentQuarter: game.current_quarter,
      leaderboard: leaderboard.map((t, i) => ({ ...t, rank: i + 1 }))
    });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
}
