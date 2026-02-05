const { requireAuth, handleCors } = require('../../lib/auth');
const { TeamMemberDB, MarketResearchDB, GameDB } = require('../../lib/db');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  
  try {
    const user = await requireAuth(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    
    const { gameId, quarter } = req.query;
    if (!gameId) return res.status(400).json({ error: 'Game ID required' });
    
    const game = await GameDB.getWithTeams(gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    
    const q = quarter !== undefined ? parseInt(quarter) : Math.max(0, game.current_quarter - 1);
    const research = await MarketResearchDB.findByQuarter(gameId, q);
    
    res.json({
      quarter: q,
      research: research ? {
        segmentDemands: research.segment_demands,
        competitorPrices: research.competitor_prices,
        brandJudgments: research.brand_judgments,
        marketTrends: research.market_trends
      } : null
    });
  } catch (error) {
    console.error('Market research error:', error);
    res.status(500).json({ error: 'Failed to get market research' });
  }
};
