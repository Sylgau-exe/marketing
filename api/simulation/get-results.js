const { requireAuth, handleCors } = require('../../lib/auth');
const { TeamMemberDB, ResultDB, GameDB } = require('../../lib/db');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  
  try {
    const user = await requireAuth(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    
    const { gameId, teamId, quarter } = req.query;
    if (!teamId) return res.status(400).json({ error: 'Team ID required' });
    
    // Verify access
    const members = await TeamMemberDB.findByTeam(teamId);
    const isTeamMember = members.some(m => m.user_id === user.id);
    
    // Also allow instructor access
    let isInstructor = false;
    if (gameId) {
      const game = await GameDB.getWithTeams(gameId);
      if (game && game.instructor_id === user.id) isInstructor = true;
    }
    
    if (!isTeamMember && !isInstructor) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (quarter !== undefined) {
      const result = await ResultDB.findByTeamAndQuarter(teamId, parseInt(quarter));
      if (!result) return res.json({ result: null });
      
      return res.json({ result: formatResult(result) });
    }
    
    // Get all results
    const allResults = await ResultDB.findAllByTeam(teamId);
    res.json({
      results: allResults.map(formatResult),
      cumulativeScorecard: allResults.length > 0 ? allResults[allResults.length - 1].cumulative_scorecard : 0
    });
  } catch (error) {
    console.error('Get results error:', error);
    res.status(500).json({ error: 'Failed to get results' });
  }
};

function formatResult(r) {
  return {
    quarter: r.quarter,
    demand: r.demand_generated,
    unitsSold: r.units_sold,
    stockouts: r.stockouts,
    marketShare: r.market_share,
    revenue: parseFloat(r.revenue),
    cogs: parseFloat(r.cogs),
    marketingExpenses: parseFloat(r.marketing_expenses),
    operatingExpenses: parseFloat(r.operating_expenses),
    netIncome: parseFloat(r.net_income),
    cashFlow: parseFloat(r.cash_flow),
    endingCash: parseFloat(r.ending_cash),
    retainedEarnings: parseFloat(r.retained_earnings),
    satisfaction: {
      brand: r.brand_satisfaction,
      ad: r.ad_satisfaction,
      price: r.price_satisfaction,
      overall: r.overall_satisfaction
    },
    scorecard: {
      financial: r.financial_performance,
      market: r.market_performance,
      marketing: r.marketing_effectiveness,
      investment: r.investment_future,
      wealth: r.wealth_creation,
      balanced: r.balanced_scorecard,
      cumulative: r.cumulative_scorecard
    },
    details: r.details
  };
}
