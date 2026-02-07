// api/simulation/get-results.js
import { requireAuth, cors } from '../../lib/auth.js';
import { ResultDB, GameDB } from '../../lib/db.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const decoded = await requireAuth(req, res);
  if (!decoded) return;

  try {
    const { game_id, team_id, quarter } = req.query;
    if (!team_id) return res.status(400).json({ error: 'Team ID required' });

    // Verify ownership through game
    if (game_id) {
      const game = await GameDB.findById(game_id);
      if (game && String(game.user_id) !== String(decoded.userId) && !decoded.isAdmin) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    if (quarter !== undefined) {
      const result = await ResultDB.findByTeamAndQuarter(team_id, parseInt(quarter));
      return res.json({ result: result ? formatResult(result) : null });
    }

    const allResults = await ResultDB.findAllByTeam(team_id);
    res.json({ results: allResults.map(formatResult), cumulativeScorecard: allResults.length > 0 ? allResults[allResults.length - 1].cumulative_scorecard : 0 });
  } catch (error) {
    console.error('Get results error:', error);
    res.status(500).json({ error: 'Failed to get results' });
  }
}

function formatResult(r) {
  return {
    quarter: r.quarter,
    demand: parseInt(r.total_demand) || 0,
    unitsSold: parseInt(r.total_units_sold) || 0,
    stockouts: parseInt(r.stockouts) || 0,
    marketShare: parseFloat(r.market_share_primary) || 0,
    marketShareSecondary: parseFloat(r.market_share_secondary) || 0,
    revenue: parseFloat(r.total_revenue) || 0,
    cogs: parseFloat(r.cost_of_goods) || 0,
    grossProfit: parseFloat(r.gross_profit) || 0,
    advertisingExpense: parseFloat(r.advertising_expense) || 0,
    salesforceExpense: parseFloat(r.salesforce_expense) || 0,
    distributionExpense: parseFloat(r.distribution_expense) || 0,
    internetExpense: parseFloat(r.internet_marketing_expense) || 0,
    rdExpense: parseFloat(r.rd_expense) || 0,
    adminExpense: parseFloat(r.admin_expense) || 0,
    totalExpenses: parseFloat(r.total_expenses) || 0,
    operatingProfit: parseFloat(r.operating_profit) || 0,
    netIncome: parseFloat(r.net_income) || 0,
    beginningCash: parseFloat(r.beginning_cash) || 0,
    cashFlow: parseFloat(r.net_income) || 0,
    endingCash: parseFloat(r.ending_cash) || 0,
    satisfaction: {
      brand: parseFloat(r.brand_satisfaction) || 0,
      ad: parseFloat(r.ad_satisfaction) || 0,
      price: parseFloat(r.price_satisfaction) || 0,
      overall: parseFloat(r.overall_satisfaction) || 0
    },
    scorecard: {
      financial: parseFloat(r.financial_performance) || 0,
      market: parseFloat(r.market_performance) || 0,
      marketing: parseFloat(r.marketing_effectiveness) || 0,
      investment: parseFloat(r.investment_in_future) || 0,
      wealth: parseFloat(r.creation_of_wealth) || 0,
      balanced: parseFloat(r.balanced_scorecard) || 0,
      cumulative: parseFloat(r.cumulative_scorecard || r.balanced_scorecard) || 0
    }
  };
}
