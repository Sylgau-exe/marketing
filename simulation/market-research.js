// api/simulation/market-research.js
import { requireAuth, cors } from '../../lib/auth.js';
import { MarketResearchDB, GameDB } from '../../lib/db.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const decoded = await requireAuth(req, res);
  if (!decoded) return;

  try {
    const { game_id, quarter } = req.query;
    if (!game_id) return res.status(400).json({ error: 'Game ID required' });

    const game = await GameDB.findById(game_id);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    const q = quarter !== undefined ? parseInt(quarter) : Math.max(0, game.current_quarter - 1);
    const research = await MarketResearchDB.findByQuarter(game_id, q);

    res.json({
      quarter: q,
      research: research ? { segmentDemands: research.segment_demands, competitorPrices: research.competitor_prices, brandJudgments: research.brand_judgments, marketTrends: research.market_trends } : null
    });
  } catch (error) {
    console.error('Market research error:', error);
    res.status(500).json({ error: 'Failed to get market research' });
  }
}
