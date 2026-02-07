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

    // Get segments and normalize field names for engine
    const rawSegments = await SegmentDB.getForGame(game_id);
    const segments = rawSegments.map(normalizeSegment);

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
        // Player's decisions — normalize from frontend format to engine format
        decisionsMap[t.id] = normalizePlayerDecisions(playerDecisions, brands, game.market_scenario);
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
    const normalizedPlayerDec = decisionsMap[team_id];
    const engineResult = processQuarter({
      quarter: game.current_quarter,
      teams: engineTeams,
      segments,
      decisions: decisionsMap
    });

    // Save results for all teams
    const playerResult = engineResult.results[team_id];
    
    // Debug: capture what the engine saw
    const debugInfo = {
      playerTeamId: team_id,
      rawDecisionKeys: Object.keys(playerDecisions),
      normalizedDecisionKeys: normalizedPlayerDec ? Object.keys(normalizedPlayerDec) : 'MISSING',
      normalizedPricing: normalizedPlayerDec?.pricing,
      normalizedDistribution: normalizedPlayerDec?.distribution,
      normalizedAdvertising: normalizedPlayerDec?.advertising,
      normalizedSalesforce: normalizedPlayerDec?.salesforce,
      normalizedInternet: normalizedPlayerDec?.internet,
      brandsCount: engineTeams.find(t => String(t.id) === String(team_id))?.brands?.length || 0,
      brandNames: engineTeams.find(t => String(t.id) === String(team_id))?.brands?.map(b => b.name) || [],
      brandTargets: engineTeams.find(t => String(t.id) === String(team_id))?.brands?.map(b => b.target_segment) || [],
      segmentNames: segments.map(s => s.name),
      segmentHasWeights: segments[0] ? { price_sensitivity: segments[0].price_sensitivity, performance_weight: segments[0].performance_weight } : 'NO_SEGMENTS',
      engineTeamIds: Object.keys(decisionsMap),
      resultTeamIds: Object.keys(engineResult.results || {}),
      playerResultExists: !!playerResult,
      playerDemand: playerResult?.totalDemand,
      playerRevenue: playerResult?.revenue,
      engineFactors: engineResult._engineDebug?.slice(0, 20) || 'none',
    };
    console.log('ENGINE DEBUG:', JSON.stringify(debugInfo, null, 2));
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
      warnings: errors.filter(e => e.severity === 'warning'),
      _debug: debugInfo
    });
  } catch (error) {
    console.error('Submit decisions error:', error);
    res.status(500).json({ error: 'Failed to process quarter: ' + error.message });
  }
}

/**
 * Normalize frontend decision format → engine format.
 * The frontend sends a different data shape than the simulation engine expects.
 * This bridges the gap without changing either side.
 */
function normalizePlayerDecisions(d, brands, scenario) {
  console.log('[NORMALIZE] Input keys:', Object.keys(d));
  console.log('[NORMALIZE] Input pricing:', JSON.stringify(d.pricing));
  console.log('[NORMALIZE] Input distribution:', JSON.stringify(d.distribution));
  console.log('[NORMALIZE] Brands:', brands.map(b => `${b.name}(${b.target_segment})`));
  
  const normalized = {
    rdBudget: parseFloat(d.rdBudget) || 0,
    rdProjects: d.rdProjects || {},
    production: d.production || {},
    dividend: parseFloat(d.dividend) || 0
  };

  // 1. PRICING: Frontend sends {brandId: {REGION: price}}, engine reads {brandName: price}
  normalized.pricing = {};
  if (d.pricing) {
    for (const [brandId, regionPrices] of Object.entries(d.pricing)) {
      const brand = brands.find(b => String(b.id) === String(brandId));
      if (brand && typeof regionPrices === 'object') {
        // Engine uses single price per brand (take first region or average)
        const prices = Object.values(regionPrices).map(p => parseFloat(p)).filter(p => p > 0);
        normalized.pricing[brand.name] = prices.length ? Math.round(prices.reduce((a, b) => a + b) / prices.length) : 900;
      } else if (brand && typeof regionPrices === 'number') {
        normalized.pricing[brand.name] = regionPrices;
      }
    }
  }
  if (Object.keys(normalized.pricing).length === 0) normalized.pricing.default = 900;

  // 2. ADVERTISING: Frontend sends {latam: 100000, target: 'seg'}, engine expects {latam: {spend: N, targetSegment: 'seg'}}
  normalized.advertising = {};
  const adTarget = d.advertising?.target || '';
  const regions = ['latam', 'europe', 'apac'];
  for (const region of regions) {
    const spend = parseFloat(d.advertising?.[region]) || 0;
    if (spend > 0 || d.advertising?.[region] !== undefined) {
      normalized.advertising[region] = {
        spend,
        targetSegment: adTarget
      };
    }
  }

  // 3. INTERNET: Frontend sends {latam: N}, engine expects {webPages, seo, paidSearch, socialMedia}
  // Split total internet budget across categories proportionally
  const inetTotal = regions.reduce((sum, r) => sum + (parseFloat(d.internet_marketing?.[r] || d.internet?.[r]) || 0), 0);
  normalized.internet = {
    webPages: Math.max(0, Math.round(inetTotal * 0.25 / 5000)),
    seo: Math.max(0, Math.round(inetTotal * 0.25 / 3000)),
    paidSearch: Math.max(0, Math.round(inetTotal * 0.25 / 8000)),
    socialMedia: Math.max(0, Math.round(inetTotal * 0.25 / 6000))
  };

  // 4. SALESFORCE: Frontend sends {latam: {count, salary, commission}}, engine expects {count, compensation, training}
  normalized.salesforce = {};
  if (d.salesforce) {
    for (const [region, sf] of Object.entries(d.salesforce)) {
      if (typeof sf === 'object' && sf !== null) {
        normalized.salesforce[region] = {
          count: parseInt(sf.count) || 0,
          compensation: parseFloat(sf.salary || sf.compensation) || 30000,
          training: parseFloat(sf.training) || 0
        };
      }
    }
  }

  // 5. DISTRIBUTION: Frontend sends {latam: 2}, engine expects {latam: {outlets: 2, type: 'retail'}}
  normalized.distribution = {};
  if (d.distribution) {
    for (const [region, val] of Object.entries(d.distribution)) {
      if (typeof val === 'object' && val !== null) {
        // Already in engine format
        normalized.distribution[region] = val;
      } else {
        // Flat number → convert to engine format
        normalized.distribution[region] = {
          outlets: parseInt(val) || 0,
          type: 'retail'
        };
      }
    }
  }

  console.log('[NORMALIZE] Output pricing:', JSON.stringify(normalized.pricing));
  console.log('[NORMALIZE] Output distribution:', JSON.stringify(normalized.distribution));
  console.log('[NORMALIZE] Output advertising:', JSON.stringify(normalized.advertising));
  console.log('[NORMALIZE] Output salesforce:', JSON.stringify(normalized.salesforce));
  
  return normalized;
}

/**
 * Normalize segment field names from DB columns (pref_*) to engine expectations (*_weight).
 * DB uses: pref_price_sensitivity, pref_performance, pref_durability, etc.
 * Engine reads: price_sensitivity, performance_weight, durability_weight, etc.
 */
function normalizeSegment(seg) {
  const s = { ...seg };
  // Map pref_* columns to engine field names
  s.price_sensitivity = parseFloat(s.pref_price_sensitivity ?? s.price_sensitivity ?? 0.15);
  s.performance_weight = parseFloat(s.pref_performance ?? s.performance_weight ?? 0.1);
  s.durability_weight = parseFloat(s.pref_durability ?? s.durability_weight ?? 0.1);
  s.style_weight = parseFloat(s.pref_style ?? s.style_weight ?? 0.1);
  s.comfort_weight = parseFloat(s.pref_comfort ?? s.comfort_weight ?? 0.1);
  s.lightweight_weight = parseFloat(s.pref_lightweight ?? s.lightweight_weight ?? 0.1);
  s.customization_weight = parseFloat(s.pref_customization ?? s.customization_weight ?? 0.05);
  return s;
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
