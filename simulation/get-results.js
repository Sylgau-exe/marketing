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
    quarter: r.quarter, demand: r.total_demand, unitsSold: r.units_sold, stockouts: r.stockouts,
    marketShare: r.market_share_primary, revenue: parseFloat(r.revenue), cogs: parseFloat(r.cost_of_goods),
    grossProfit: parseFloat(r.gross_profit), advertisingExpense: parseFloat(r.advertising_expense),
    salesforceExpense: parseFloat(r.salesforce_expense), distributionExpense: parseFloat(r.distribution_expense),
    internetExpense: parseFloat(r.internet_expense), rdExpense: parseFloat(r.rd_expense),
    operatingProfit: parseFloat(r.operating_profit), netIncome: parseFloat(r.net_income),
    cashFlow: parseFloat(r.cash_flow), endingCash: parseFloat(r.ending_cash),
    satisfaction: { brand: r.brand_satisfaction, ad: r.ad_satisfaction, price: r.price_satisfaction, overall: r.overall_satisfaction },
    scorecard: { financial: r.financial_performance, market: r.market_performance, marketing: r.marketing_effectiveness, investment: r.investment_in_future, wealth: r.creation_of_wealth, balanced: r.balanced_scorecard, cumulative: r.cumulative_scorecard }
  };
}
