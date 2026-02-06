// api/simulation/leaderboard.js
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
        teamId: team.id, teamName: team.name, logoEmoji: team.logo_emoji,
        quarters: allResults.map(r => ({ quarter: r.quarter, revenue: parseFloat(r.revenue), netIncome: parseFloat(r.net_income), balancedScorecard: r.balanced_scorecard })),
        currentScorecard: latest ? latest.balanced_scorecard : 0,
        cumulativeScorecard: latest ? (latest.cumulative_scorecard || latest.balanced_scorecard) : 0,
        totalRevenue: allResults.reduce((s, r) => s + parseFloat(r.revenue), 0),
        totalProfit: allResults.reduce((s, r) => s + parseFloat(r.net_income), 0)
      });
    }

    leaderboard.sort((a, b) => (b.cumulativeScorecard || 0) - (a.cumulativeScorecard || 0));
    res.json({ gameId: game_id, currentQuarter: game.current_quarter, leaderboard: leaderboard.map((t, i) => ({ ...t, rank: i + 1 })) });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
}
