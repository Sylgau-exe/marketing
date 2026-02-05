const { requireAuth, handleCors } = require('../../lib/auth');
const { GameDB, TeamDB, ResultDB } = require('../../lib/db');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  
  try {
    const user = await requireAuth(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    
    const { gameId } = req.query;
    if (!gameId) return res.status(400).json({ error: 'Game ID required' });
    
    const game = await GameDB.getWithTeams(gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    
    const teams = await TeamDB.findByGame(gameId);
    const leaderboard = [];
    
    for (const team of teams) {
      const allResults = await ResultDB.findAllByTeam(team.id);
      const latest = allResults.length > 0 ? allResults[allResults.length - 1] : null;
      
      leaderboard.push({
        teamId: team.id,
        teamName: team.name,
        logoEmoji: team.logo_emoji,
        quarters: allResults.map(r => ({
          quarter: r.quarter,
          revenue: parseFloat(r.revenue),
          netIncome: parseFloat(r.net_income),
          balancedScorecard: r.balanced_scorecard
        })),
        currentScorecard: latest ? latest.balanced_scorecard : 0,
        cumulativeScorecard: latest ? latest.cumulative_scorecard : 0,
        totalRevenue: allResults.reduce((s, r) => s + parseFloat(r.revenue), 0),
        totalProfit: allResults.reduce((s, r) => s + parseFloat(r.net_income), 0)
      });
    }
    
    leaderboard.sort((a, b) => (b.cumulativeScorecard || 0) - (a.cumulativeScorecard || 0));
    
    res.json({
      gameId,
      currentQuarter: game.current_quarter,
      leaderboard: leaderboard.map((t, i) => ({ ...t, rank: i + 1 }))
    });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
};
