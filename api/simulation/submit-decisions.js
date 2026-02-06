// api/simulation/submit-decisions.js - Solo mode: save decisions, auto-process quarter with AI
import { sql } from '@vercel/postgres';
import { requireAuth, cors } from '../../lib/auth.js';
import { GameDB, TeamDB, DecisionDB, ResultDB, SegmentDB, BrandDB, MarketResearchDB } from '../../lib/db.js';
import { processQuarter } from '../../lib/simulation-engine.js';
import { generateAIDecisions } from '../../lib/ai-competitors.js';

const FREE_DECISION_LIMIT = 3;

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const decoded = await requireAuth(req, res);
  if (!decoded) return;

  try {
    const { game_id, team_id, decisions, submit = false, quarter } = req.body;
    if (!game_id || !team_id) return res.status(400).json({ error: 'Game ID and Team ID are required' });

    // Verify ownership
    const game = await GameDB.findById(game_id);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (String(game.user_id) !== String(decoded.userId) && !decoded.isAdmin) {
      return res.status(403).json({ error: 'You do not have access to this simulation' });
    }
    if (game.status !== 'active') return res.status(400).json({ error: 'Simulation is not active' });

    const teams = await TeamDB.findByGame(game_id);
    const team = teams.find(t => String(t.id) === String(team_id));
    if (!team) return res.status(404).json({ error: 'Team not found' });

    // --- Paywall check on submit ---
    if (submit) {
      let userRow;
      try {
        const u = await sql`SELECT subscription_tier, subscription_status, decisions_used, is_admin FROM users WHERE id = ${decoded.userId}`;
        userRow = u.rows[0];
      } catch(e) { userRow = null; }

      const isPro = userRow && (
        userRow.is_admin ||
        (userRow.subscription_tier === 'pro' && userRow.subscription_status === 'active')
      );

      if (!isPro) {
        const used = parseInt(userRow?.decisions_used) || 0;
        if (used >= FREE_DECISION_LIMIT) {
          return res.status(402).json({
            error: 'Free plan limit reached',
            code: 'PAYWALL',
            decisionsUsed: used,
            limit: FREE_DECISION_LIMIT
          });
        }
      }
    }

    // Validate
    const errors = validateDecisions(decisions, team, game);
    if (errors.filter(e => e.severity === 'error').length > 0 && submit) {
      return res.status(400).json({ error: 'Validation failed', errors });
    }

    // Save player decisions
    const playerDecisions = {
      pricing: decisions.pricing || {},
      advertising: decisions.advertising || {},
      internet: decisions.internet_marketing || decisions.internet || {},
      salesforce: decisions.salesforce || {},
      distribution: decisions.distribution || {},
      rdBudget: decisions.rd_budget || 0,
      rdProjects: decisions.rd_projects || [],
      production: decisions.production || {},
      dividend: decisions.dividend || 0
    };
    await DecisionDB.upsert(team_id, game.current_quarter, playerDecisions);

    // If just saving draft, return early
    if (!submit) {
      return res.json({ success: true, saved: true, submitted: false, quarter: game.current_quarter });
    }

    // ===== SUBMIT: Process the quarter =====

    // Increment decisions_used counter
    try {
      await sql`UPDATE users SET decisions_used = COALESCE(decisions_used, 0) + 1 WHERE id = ${decoded.userId}`;
    } catch(e) { console.error('Could not increment decisions_used:', e); }

    // Get segments
    const segments = await SegmentDB.getForGame(game_id);

    // Build engine state for all teams
    const engineTeams = [];
    const decisionsMap = {};

    for (const t of teams) {
      const brands = await BrandDB.findByTeam(t.id);
      engineTeams.push({
        id: t.id, name: t.name, brands,
        cash_balance: t.cash_balance,
        total_investment: t.total_investment || t.cash_balance,
        cumulative_profit: t.cumulative_profit || 0
      });

      if (String(t.id) === String(team_id)) {
        // Player's decisions
        decisionsMap[t.id] = playerDecisions;
      } else if (t.is_ai) {
        // Generate AI decisions
        const aiDec = generateAIDecisions({
          quarter: game.current_quarter,
          scenario: game.market_scenario,
          teamIndex: teams.indexOf(t),
          brands, cashBalance: parseFloat(t.cash_balance),
          segments
        });
        decisionsMap[t.id] = aiDec;
        // Save AI decisions for record
        await DecisionDB.upsert(t.id, game.current_quarter, aiDec);
      }
    }

    // Process quarter
    const engineResult = processQuarter({
      quarter: game.current_quarter,
      teams: engineTeams,
      segments,
      decisions: decisionsMap
    });

    // Save results for all teams
    const playerResult = engineResult.results[team_id];
    for (const t of teams) {
      const tr = engineResult.results[t.id];
      if (!tr) continue;

      await ResultDB.create(t.id, game.current_quarter, tr);
      await TeamDB.updateFinancials(t.id, {
        cashBalance: tr.endingCash,
        cumulativeProfit: (parseFloat(t.cumulative_profit) || 0) + tr.netIncome
      });
    }

    // Save market research
    if (engineResult.marketResearch) {
      try { await MarketResearchDB.save(game_id, game.current_quarter, engineResult.marketResearch); } catch(e) {}
    }

    // Advance quarter
    await GameDB.advanceQuarter(game_id);
    const newQuarter = game.current_quarter + 1;

    // Complete game if Q8 done
    if (game.current_quarter >= 8) {
      await GameDB.updateStatus(game_id, 'completed');
    }

    // Build leaderboard
    const leaderboard = teams.map(t => {
      const r = engineResult.results[t.id];
      return {
        teamName: t.name, isPlayer: !t.is_ai,
        revenue: r?.revenue || 0,
        balancedScorecard: r?.balancedScorecard || 0,
        marketShare: r?.marketSharePrimary || 0
      };
    }).sort((a, b) => (b.balancedScorecard || 0) - (a.balancedScorecard || 0));

    res.json({
      success: true, saved: true, submitted: true,
      quarterProcessed: game.current_quarter,
      nextQuarter: newQuarter > 8 ? null : newQuarter,
      gameCompleted: game.current_quarter >= 8,
      results: playerResult ? {
        demand: playerResult.totalDemand,
        unitsSold: playerResult.unitsSold,
        revenue: playerResult.revenue,
        netIncome: playerResult.netIncome,
        endingCash: playerResult.endingCash,
        marketShare: playerResult.marketSharePrimary,
        balancedScorecard: playerResult.balancedScorecard,
        brandSatisfaction: playerResult.brandSatisfaction,
        overallSatisfaction: playerResult.overallSatisfaction
      } : null,
      leaderboard,
      warnings: errors.filter(e => e.severity === 'warning')
    });
  } catch (error) {
    console.error('Submit decisions error:', error);
    res.status(500).json({ error: 'Failed to process quarter: ' + error.message });
  }
}

function validateDecisions(decisions, team, game) {
  const errors = [];
  const cash = parseFloat(team.cash_balance);
  let totalExpenses = 0;

  if (decisions.advertising) {
    const adTotal = Object.values(decisions.advertising).reduce((s, v) => s + (parseFloat(v?.spend || v) || 0), 0);
    totalExpenses += adTotal;
    if (adTotal > cash * 0.5) errors.push({ field: 'advertising', message: 'Ad spending exceeds 50% of cash', severity: 'warning' });
  }
  if (decisions.internet_marketing || decisions.internet) {
    const inet = decisions.internet_marketing || decisions.internet;
    totalExpenses += Object.values(inet).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  }
  if (decisions.rd_budget) totalExpenses += parseFloat(decisions.rd_budget) || 0;
  if (decisions.salesforce) {
    Object.values(decisions.salesforce).forEach(r => {
      if (r && r.count && r.compensation) totalExpenses += r.count * r.compensation;
    });
  }
  if (decisions.dividend) {
    const div = parseFloat(decisions.dividend) || 0;
    totalExpenses += div;
    if (div > cash * 0.3) errors.push({ field: 'dividend', message: 'Dividend exceeds 30% of cash', severity: 'warning' });
  }
  if (totalExpenses > cash * 1.2) errors.push({ field: 'total', message: 'Expenses significantly exceed cash', severity: 'error' });

  return errors;
}
