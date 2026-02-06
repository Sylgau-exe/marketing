// api/game/advance.js - Process quarter and advance game
import { requireInstructor, cors } from '../../lib/auth.js';
import { GameDB, TeamDB, DecisionDB, ResultDB, MarketResearchDB, SegmentDB, BrandDB, EventDB, TeamMemberDB } from '../../lib/db.js';
import { processQuarter } from '../../lib/simulation-engine.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const decoded = await requireInstructor(req, res);
  if (!decoded) return;

  try {
    const { game_id, gameId: gid, force = false } = req.body;
    const gameId = game_id || gid;
    if (!gameId) return res.status(400).json({ error: 'Game ID is required' });

    const game = await GameDB.findById(gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (game.instructor_id !== decoded.userId && !decoded.isAdmin) return res.status(403).json({ error: 'Not your game' });
    if (game.status === 'completed') return res.status(400).json({ error: 'Game is already completed' });
    if (game.current_quarter >= 8) return res.status(400).json({ error: 'All 8 quarters have been played' });

    if (game.status === 'setup') await GameDB.updateStatus(gameId, 'active');

    const teams = await TeamDB.findByGame(gameId);
    if (teams.length < 2) return res.status(400).json({ error: 'At least 2 teams needed' });

    if (!force && game.current_quarter > 0) {
      const unsubmitted = teams.filter(t => !t.has_submitted);
      if (unsubmitted.length > 0) return res.status(400).json({ error: 'Not all teams have submitted', unsubmitted: unsubmitted.map(t => ({ id: t.id, name: t.name })) });
    }

    const segments = await SegmentDB.getForGame(gameId);
    const currentQuarter = game.current_quarter;

    // Build game state for engine
    const engineTeams = [];
    const decisionsMap = {};

    for (const team of teams) {
      const brands = await BrandDB.findByTeam(team.id);
      const dec = await DecisionDB.findByTeamAndQuarter(team.id, currentQuarter);
      engineTeams.push({ id: team.id, name: team.name, brands, cash_balance: team.cash_balance, total_investment: team.total_investment, cumulative_profit: team.cumulative_profit });
      decisionsMap[team.id] = dec ? (dec.pricing_decisions ? { pricing: dec.pricing_decisions, advertising: dec.advertising_decisions, internet: dec.internet_marketing, salesforce: dec.salesforce_decisions, distribution: dec.distribution_decisions, rdBudget: dec.rd_budget, rdProjects: dec.rd_projects, production: dec.production_decisions, dividend: dec.dividend_payment } : dec.decisions || {}) : {};
    }

    const engineResult = processQuarter({ quarter: currentQuarter + 1, teams: engineTeams, segments, decisions: decisionsMap });

    // Save results
    const summary = [];
    for (const team of teams) {
      const tr = engineResult.results[team.id];
      if (!tr) continue;

      await ResultDB.create(team.id, currentQuarter + 1, tr);
      await TeamDB.updateFinancials(team.id, { cashBalance: tr.endingCash, cumulativeProfit: (parseFloat(team.cumulative_profit) || 0) + tr.netIncome });

      summary.push({ teamId: team.id, teamName: team.name, revenue: tr.revenue, netIncome: tr.netIncome, balancedScorecard: tr.balancedScorecard });
    }

    // Save market research
    if (engineResult.marketResearch) {
      await MarketResearchDB.save(gameId, currentQuarter + 1, engineResult.marketResearch);
    }

    await GameDB.advanceQuarter(gameId);
    await GameDB.resetTeamSubmissions(gameId);

    if (currentQuarter + 1 >= 8) await GameDB.updateStatus(gameId, 'completed');

    try { await EventDB.log(gameId, null, currentQuarter + 1, 'quarter_processed', { processedBy: decoded.userId }); } catch (e) {}

    res.json({ success: true, quarterProcessed: currentQuarter + 1, nextQuarter: currentQuarter + 2, gameStatus: currentQuarter + 1 >= 8 ? 'completed' : 'active', summary });
  } catch (error) {
    console.error('Advance quarter error:', error);
    res.status(500).json({ error: 'Failed to process quarter: ' + error.message });
  }
}
