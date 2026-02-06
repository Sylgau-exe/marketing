#!/usr/bin/env node
/**
 * MarketSim E2E Scenario Test
 * 
 * Plays through all 8 quarters of a simulation and identifies:
 * - Data format mismatches between frontend → API → engine
 * - Missing/null values
 * - Cost formula alignment issues
 * - Broken API responses
 * - Logic errors in the simulation engine
 * 
 * Usage:
 *   node tests/e2e-scenario-test.js [BASE_URL]
 *   Default: http://localhost:3000
 *   Live:    node tests/e2e-scenario-test.js https://marketing-psi-livid.vercel.app
 */

const BASE = process.argv[2] || 'https://marketing-psi-livid.vercel.app';
const TEST_EMAIL = `test_e2e_${Date.now()}@marketsim.test`;
const TEST_PASS = 'TestPass123!';

let token = null;
let gameId = null;
let teamId = null;
let brandId = null;
let quarter = 1;

const bugs = [];
const warnings = [];
const passed = [];

function bug(category, msg, data = null) {
  bugs.push({ category, msg, data });
  console.log(`  ❌ BUG [${category}]: ${msg}`);
  if (data) console.log(`     Data:`, JSON.stringify(data).substring(0, 200));
}

function warn(category, msg, data = null) {
  warnings.push({ category, msg, data });
  console.log(`  ⚠️  WARN [${category}]: ${msg}`);
}

function pass(msg) {
  passed.push(msg);
  console.log(`  ✅ ${msg}`);
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  try {
    const res = await fetch(BASE + path, { ...opts, headers });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (e) {
      bug('API', `Non-JSON response from ${path}: ${text.substring(0, 100)}`);
      return { error: 'Non-JSON', status: res.status };
    }
    json._status = res.status;
    return json;
  } catch (e) {
    bug('NETWORK', `Failed to reach ${path}: ${e.message}`);
    return { error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// TEST PHASES
// ═══════════════════════════════════════════════════════════════

async function testAuth() {
  console.log('\n═══ Phase 1: Authentication ═══');

  // Register
  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'E2E Tester', email: TEST_EMAIL, password: TEST_PASS })
  });
  if (reg.error && !reg.error.includes('already')) {
    bug('AUTH', 'Registration failed', reg);
    // Try login instead
  }

  // Login
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS })
  });
  if (!login.token) {
    bug('AUTH', 'Login failed - no token', login);
    return false;
  }
  token = login.token;
  pass('Authentication successful');

  // Verify /me
  const me = await api('/api/auth/me');
  if (!me.user || !me.user.id) {
    bug('AUTH', '/api/auth/me missing user.id', me);
  } else {
    pass(`User verified: ${me.user.name} (ID: ${me.user.id})`);
  }

  return true;
}

async function testGameCreation() {
  console.log('\n═══ Phase 2: Game Creation (Quick Join) ═══');

  const result = await api('/api/game/quick-join', {
    method: 'POST',
    body: JSON.stringify({
      scenario: 'local-launch',
      company_name: 'E2E Test Corp',
      logo_emoji: '🧪'
    })
  });

  if (result.error) {
    bug('GAME', 'Quick join failed', result);
    return false;
  }

  gameId = result.game_id || result.gameId;
  teamId = result.team_id || result.teamId;

  if (!gameId) bug('GAME', 'No game_id in quick-join response', result);
  if (!teamId) bug('GAME', 'No team_id in quick-join response', result);

  if (gameId && teamId) pass(`Game created: ID=${gameId}, Team=${teamId}`);

  // Verify game details
  const details = await api(`/api/game/details?game_id=${gameId}`);
  if (details.error) {
    bug('GAME', 'Game details failed', details);
    return false;
  }

  // Check critical fields
  const game = details.game || details;
  if (!game.market_scenario) bug('GAME', 'Missing market_scenario in details');
  if (!game.current_quarter) bug('GAME', 'Missing current_quarter in details');
  if (!details.team) bug('GAME', 'Missing team object in details');
  if (!details.segments || !details.segments.length) bug('GAME', 'Missing segments in details');
  if (!details.competitors || !details.competitors.length) warn('GAME', 'No AI competitors found');

  if (details.team) {
    if (!details.team.id) bug('GAME', 'Team missing id');
    if (!details.team.cash_balance) warn('GAME', 'Team missing cash_balance');
    pass(`Game details loaded: ${game.market_scenario}, Q${game.current_quarter}, $${details.team?.cash_balance}`);
  }

  // Check segments structure
  if (details.segments?.length) {
    const seg = details.segments[0];
    const segFields = ['name', 'size', 'growth_rate', 'min_price', 'max_price'];
    const prefFields = ['pref_price_sensitivity', 'pref_performance', 'pref_durability', 'pref_style', 'pref_comfort', 'pref_lightweight'];
    const weightFields = ['price_sensitivity', 'performance_weight', 'durability_weight', 'style_weight', 'comfort_weight', 'lightweight_weight'];

    segFields.forEach(f => {
      if (seg[f] === undefined || seg[f] === null) warn('SEGMENTS', `Segment missing field: ${f}`, seg);
    });

    // Check which weight field names the engine expects vs what DB returns
    const hasWeights = weightFields.some(f => seg[f] !== undefined);
    const hasPrefs = prefFields.some(f => seg[f] !== undefined);

    if (!hasWeights && hasPrefs) {
      bug('SEGMENTS', 'Segments have pref_* columns but engine expects *_weight columns. Need alias mapping.', {
        sample: Object.keys(seg).filter(k => k.includes('pref') || k.includes('weight'))
      });
    } else if (hasWeights) {
      pass('Segment weight fields match engine expectations');
    }

    // Check potential_demand fields
    const hasDemand = ['potential_demand_latam', 'potential_demand_europe', 'potential_demand_apac'].some(f => seg[f]);
    if (!hasDemand) warn('SEGMENTS', 'No potential_demand_* fields found in segments');
  }

  return true;
}

async function testBrandCreation() {
  console.log('\n═══ Phase 3: Brand Creation ═══');

  // Create brand with known values
  const components = { frame: 4, wheels: 3, drivetrain: 3, brakes: 2, suspension: 3, seat: 3, handlebars: 2, electronics: 1 };

  // Calculate expected cost using frontend formula
  const frontendCost = 50 + Object.values(components).reduce((sum, v) => sum + v * v * 8 + v * 15, 0);

  const result = await api('/api/team/brands', {
    method: 'POST',
    body: JSON.stringify({
      game_id: gameId,
      team_id: teamId,
      name: 'TestPhone Pro',
      target_segment: 'Budget Buyers', // local-launch segment
      components
    })
  });

  if (result.error) {
    bug('BRAND', 'Brand creation failed', result);
    // Try with different segment names
    const fallback = await api('/api/team/brands', {
      method: 'POST',
      body: JSON.stringify({
        game_id: gameId, team_id: teamId,
        name: 'TestPhone Pro', target_segment: 'Worker', components
      })
    });
    if (fallback.error) {
      bug('BRAND', 'Brand creation also failed with Worker segment', fallback);
      return false;
    }
    brandId = fallback.brand?.id;
  } else {
    brandId = result.brand?.id;
  }

  if (!brandId) {
    bug('BRAND', 'No brand ID returned', result);
    return false;
  }

  // Check brand response format
  const b = result.brand;

  // Test 1: Cost formula alignment
  const backendCost = parseFloat(b.unitCost || b.unit_cost || 0);
  if (Math.abs(backendCost - frontendCost) > 1) {
    bug('COST', `Frontend/backend cost mismatch! Frontend=$${frontendCost}, Backend=$${backendCost}`, { components, frontendCost, backendCost });
  } else {
    pass(`Cost formula aligned: $${backendCost}`);
  }

  // Test 2: Property naming consistency
  if (b.isActive !== undefined && b.is_active === undefined) warn('BRAND', 'Uses camelCase isActive, frontend expects is_active');
  if (b.targetSegment !== undefined && b.target_segment === undefined) warn('BRAND', 'Uses camelCase targetSegment, frontend expects target_segment');
  if (b.unitCost !== undefined && b.unit_cost === undefined) warn('BRAND', 'Uses camelCase unitCost, frontend expects unit_cost');
  if (b.overallQuality !== undefined && b.overall_quality === undefined) warn('BRAND', 'Uses camelCase overallQuality, frontend expects overall_quality');

  // Test 3: Check if components are returned
  if (b.components) {
    const missingComps = Object.keys(components).filter(k => b.components[k] === undefined);
    if (missingComps.length) bug('BRAND', `Missing components in response: ${missingComps.join(', ')}`);
    else pass('All components returned');
  } else if (!b.frame_quality && !b.comp_frame) {
    bug('BRAND', 'No component data in brand response', b);
  }

  pass(`Brand created: ID=${brandId}, cost=$${backendCost}`);
  return true;
}

async function testDataFormatAlignment() {
  console.log('\n═══ Phase 4: Data Format Alignment Audit ═══');

  // This is the critical test — check what the frontend sends vs what the engine expects

  // PRICING FORMAT
  console.log('\n  --- Pricing Format ---');
  const frontendPricing = { [brandId]: { 'LATAM': 1200 } };
  const engineExpects = '  pricing[brand.name] or pricing.default (looks up by brand NAME, not ID)';
  bug('PRICING', `Frontend sends pricing keyed by brand ID (${brandId}), but engine reads pricing[brand.name] (line 201,298 of simulation-engine.js). Prices are NEVER read.`, {
    frontendSends: frontendPricing,
    engineReads: 'pricing["TestPhone Pro"] → undefined → falls back to pricing.default → undefined → 1000'
  });

  // ADVERTISING FORMAT
  console.log('\n  --- Advertising Format ---');
  const frontendAd = { latam: 100000, europe: 0, apac: 0, target: 'Budget Buyers' };
  bug('ADVERTISING', 'Frontend sends {latam: 100000}, engine reads ad[region]?.spend (expects nested object {spend: 100000}). Ad spend is ALWAYS 0.', {
    frontendSends: frontendAd,
    engineReads: 'ad.latam?.spend → (100000).spend → undefined → 0',
    engineLine: 'getAdReach line 226: ad[region]?.spend'
  });

  bug('AD_TARGETING', 'Frontend sends advertising.target = "Budget Buyers", engine reads ad[region]?.targetSegment. Targeting bonus NEVER applies.', {
    frontendSends: 'decisions.advertising.target = "Budget Buyers"',
    engineReads: 'ad[region]?.targetSegment → ad.latam?.targetSegment → (100000).targetSegment → undefined'
  });

  // INTERNET MARKETING FORMAT
  console.log('\n  --- Internet Marketing Format ---');
  const frontendInternet = { latam: 30000, europe: 0, apac: 0 };
  bug('INTERNET', 'Frontend sends {latam: 30000}, engine expects {webPages: N, seo: N, paidSearch: N, socialMedia: N}. Internet marketing spend is ALWAYS 0.', {
    frontendSends: frontendInternet,
    engineReads: 'inet.webPages → undefined → 0, inet.seo → undefined → 0',
    engineLine: 'getAdReach lines 230-234 and calculateInternetExpense line 442'
  });

  // SALESFORCE FORMAT
  console.log('\n  --- Salesforce Format ---');
  const frontendSF = { latam: { count: 5, salary: 40000, commission: 5 } };
  bug('SALESFORCE', 'Frontend sends {salary, commission}, engine reads {compensation, training}. Salesforce compensation is ALWAYS 30000 (default).', {
    frontendSends: frontendSF,
    engineReads: 'sf.latam?.compensation → undefined → 30000 (default)',
    engineLine: 'getSalesEffectiveness line 247: compensation = sf[region]?.compensation || 30000'
  });
  warn('SALESFORCE', 'Commission percentage from frontend is completely ignored by engine');

  // DISTRIBUTION FORMAT
  console.log('\n  --- Distribution Format ---');
  const frontendDist = { latam: 2, europe: 0, apac: 0 };
  bug('DISTRIBUTION', 'Frontend sends flat number {latam: 2}, engine reads dist[region]?.outlets (expects nested object). Distribution is ALWAYS 0 outlets → getDistribution returns 0 → NO SALES POSSIBLE.', {
    frontendSends: frontendDist,
    engineReads: 'dist.latam?.outlets → (2).outlets → undefined → 0',
    engineLine: 'getDistribution line 263: outlets = dist[region]?.outlets || 0',
    IMPACT: 'CRITICAL: With 0 distribution, getDistribution returns 0, which multiplies the entire pull to 0. Players can NEVER get sales.'
  });

  // PRICING BY REGION
  console.log('\n  --- Pricing by Region ---');
  bug('PRICING_REGION', 'Frontend sends prices per region per brand: pricing[brandId][region]=1200, but engine reads pricing[brand.name] as a single price (not per region). Multi-region pricing is ignored.', {
    frontendSends: '{ "42": { "LATAM": 1200, "Europe": 1400 } }',
    engineReads: 'pricing["TestPhone Pro"] → undefined (no brand name key)',
    fix: 'Engine should read pricing[brand.id][region] OR frontend should send pricing keyed by name'
  });
}

async function testQuarterSubmission(q) {
  console.log(`\n═══ Phase 5.${q}: Submit Quarter ${q} ═══`);

  // Build decisions the way the frontend currently does
  const decisions = {
    pricing: { [brandId]: { 'LATAM': 1500 } },
    advertising: { latam: 150000, europe: 0, apac: 0, target: 'Budget Buyers' },
    internet_marketing: { latam: 50000, europe: 0, apac: 0 },
    salesforce: {
      latam: { count: 5, salary: 45000, commission: 5 },
      europe: { count: 0, salary: 40000, commission: 5 },
      apac: { count: 0, salary: 35000, commission: 5 }
    },
    distribution: { latam: 3, europe: 0, apac: 0 },
    rd_budget: 150000,
    production: { [brandId]: 1000 },
    dividend: 0
  };

  // First save draft
  const draft = await api('/api/simulation/submit-decisions', {
    method: 'POST',
    body: JSON.stringify({ game_id: gameId, team_id: teamId, quarter: q, decisions, submit: false })
  });
  if (draft.error) {
    bug('SUBMIT', `Draft save failed Q${q}`, draft);
    return null;
  }
  pass(`Q${q} draft saved`);

  // Verify draft was saved correctly
  const loaded = await api(`/api/simulation/get-decisions?game_id=${gameId}&team_id=${teamId}&quarter=${q}`);
  if (!loaded.decisions) {
    warn('DECISIONS', `Could not reload saved decisions for Q${q}`, loaded);
  } else {
    // Check roundtrip
    const savedPricing = loaded.decisions.pricing;
    if (savedPricing && savedPricing[brandId]) {
      pass(`Q${q} pricing roundtrip OK`);
    } else {
      warn('DECISIONS', `Pricing not saved correctly`, savedPricing);
    }
  }

  // Submit quarter
  const result = await api('/api/simulation/submit-decisions', {
    method: 'POST',
    body: JSON.stringify({ game_id: gameId, team_id: teamId, quarter: q, decisions, submit: true })
  });

  if (result.error) {
    if (result.code === 'PAYWALL') {
      warn('PAYWALL', `Hit paywall at Q${q} (expected for free tier after Q3)`);
      return 'paywall';
    }
    bug('SUBMIT', `Quarter ${q} submission failed`, result);
    return null;
  }

  // Validate results
  const r = result.results;
  if (!r) {
    bug('RESULTS', `No results returned for Q${q}`, result);
    return null;
  }

  console.log(`  📊 Q${q} Results:`);
  console.log(`     Demand: ${r.demand}, Units Sold: ${r.unitsSold}, Revenue: $${(r.revenue || 0).toLocaleString()}`);
  console.log(`     Net Income: $${(r.netIncome || 0).toLocaleString()}, Ending Cash: $${(r.endingCash || 0).toLocaleString()}`);
  console.log(`     Market Share: ${((r.marketShare || 0) * 100).toFixed(1)}%, BSC: ${(r.balancedScorecard || 0).toFixed(2)}`);

  // Check for suspicious values
  if (r.demand === 0) bug('ENGINE', `Q${q}: Zero demand — likely distribution format bug (engine reads dist[region]?.outlets but gets flat number)`);
  if (r.unitsSold === 0 && r.demand > 0) bug('ENGINE', `Q${q}: Had demand but sold 0 units`);
  if (r.revenue === 0 && r.unitsSold > 0) bug('ENGINE', `Q${q}: Sold units but $0 revenue — pricing lookup by brand name fails`);
  if (r.revenue > 0 && r.netIncome < -r.revenue) warn('ENGINE', `Q${q}: Massive loss, netIncome worse than negative revenue`);
  if (r.endingCash < 0) warn('ENGINE', `Q${q}: Negative cash — company would be bankrupt`);
  if (r.marketShare === 0 && r.unitsSold > 0) bug('ENGINE', `Q${q}: Sold units but 0% market share`);
  if (r.balancedScorecard === 0) warn('ENGINE', `Q${q}: BSC is exactly 0 (multiplicative model — one zero factor kills everything)`);

  if (r.demand > 0 && r.revenue > 0) {
    pass(`Q${q}: Simulation produced meaningful results`);
  }

  // Check leaderboard
  if (result.leaderboard) {
    const player = result.leaderboard.find(l => l.isPlayer);
    if (!player) warn('LEADERBOARD', `Q${q}: Player not found in leaderboard`);
    const aiTeams = result.leaderboard.filter(l => !l.isPlayer);
    if (aiTeams.length === 0) warn('LEADERBOARD', `Q${q}: No AI competitors in leaderboard`);
    else pass(`Q${q}: Leaderboard has ${aiTeams.length} AI competitors`);
  }

  return result;
}

async function testResultsAPI() {
  console.log('\n═══ Phase 6: Results & Reports APIs ═══');

  // Get results
  const results = await api(`/api/simulation/get-results?game_id=${gameId}&team_id=${teamId}&quarter=1`);
  if (results.error) {
    warn('RESULTS_API', 'get-results failed', results);
  } else {
    // Check field names match what frontend expects
    const r = results.results || results;
    const expectedFields = ['total_units_sold', 'total_revenue', 'net_income', 'ending_cash'];
    const engineFields = ['unitsSold', 'revenue', 'netIncome', 'endingCash'];

    // The results are saved via ResultDB.create — check what column names are used
    if (r.total_units_sold !== undefined) pass('Results use snake_case (DB column names)');
    else if (r.unitsSold !== undefined) warn('RESULTS_API', 'Results use camelCase but frontend may expect snake_case');
    else warn('RESULTS_API', 'Results fields unclear', Object.keys(r));
  }

  // Market research
  const research = await api(`/api/simulation/market-research?game_id=${gameId}&quarter=1`);
  if (research.error) warn('RESEARCH_API', 'market-research failed', research);
  else pass('Market research API works');

  // Leaderboard
  const lb = await api(`/api/simulation/leaderboard?game_id=${gameId}`);
  if (lb.error) warn('LEADERBOARD_API', 'leaderboard failed', lb);
  else pass('Leaderboard API works');
}

async function testSegmentWeightMapping() {
  console.log('\n═══ Phase 7: Segment-Engine Weight Mapping ═══');

  const details = await api(`/api/game/details?game_id=${gameId}`);
  if (!details.segments?.length) { warn('SEGMENTS', 'No segments to test'); return; }

  const seg = details.segments[0];

  // The engine (getBestBrandFit line 150-156) reads:
  // segment.performance_weight, segment.durability_weight, etc.
  // But the DB columns are: pref_performance, pref_durability, etc.

  const engineFields = {
    'price_sensitivity': ['pref_price_sensitivity', 'price_sensitivity'],
    'performance_weight': ['pref_performance', 'performance_weight'],
    'durability_weight': ['pref_durability', 'durability_weight'],
    'style_weight': ['pref_style', 'style_weight'],
    'comfort_weight': ['pref_comfort', 'comfort_weight'],
    'lightweight_weight': ['pref_lightweight', 'lightweight_weight'],
    'customization_weight': ['pref_customization', 'customization_weight']
  };

  for (const [engineKey, possibleCols] of Object.entries(engineFields)) {
    const found = possibleCols.find(col => seg[col] !== undefined && seg[col] !== null);
    if (!found) {
      bug('SEGMENT_WEIGHTS', `Engine reads segment.${engineKey} but neither ${possibleCols.join(' nor ')} exists in segment data`);
    } else if (found !== engineKey) {
      bug('SEGMENT_WEIGHTS', `Engine reads segment.${engineKey} but data has segment.${found}=${seg[found]}. Need alias.`);
    } else {
      pass(`segment.${engineKey} = ${seg[engineKey]}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function run() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║       MarketSim E2E Scenario Test                       ║');
  console.log(`║       Target: ${BASE.padEnd(40)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  // Phase 1: Auth
  if (!await testAuth()) {
    console.log('\n🛑 Auth failed — cannot continue');
    return printSummary();
  }

  // Phase 2: Game
  if (!await testGameCreation()) {
    console.log('\n🛑 Game creation failed — cannot continue');
    return printSummary();
  }

  // Phase 3: Brand
  if (!await testBrandCreation()) {
    console.log('\n🛑 Brand creation failed — cannot continue');
    return printSummary();
  }

  // Phase 4: Data format audit (static analysis)
  await testDataFormatAlignment();

  // Phase 5: Submit quarters
  for (let q = 1; q <= 8; q++) {
    const result = await testQuarterSubmission(q);
    if (result === 'paywall') {
      warn('PAYWALL', `Stopped at Q${q} due to paywall. Set user to pro or admin to test all 8.`);
      break;
    }
    if (!result) {
      bug('SUBMIT', `Quarter ${q} failed, stopping`);
      break;
    }
  }

  // Phase 6: Results APIs
  await testResultsAPI();

  // Phase 7: Segment weights
  await testSegmentWeightMapping();

  printSummary();
}

function printSummary() {
  console.log('\n\n╔══════════════════════════════════════════════════════════╗');
  console.log('║                    TEST SUMMARY                          ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`\n  ✅ Passed: ${passed.length}`);
  console.log(`  ⚠️  Warnings: ${warnings.length}`);
  console.log(`  ❌ Bugs: ${bugs.length}`);

  if (bugs.length) {
    console.log('\n  ╔═══ CRITICAL BUGS ═══');
    const categories = {};
    bugs.forEach(b => {
      if (!categories[b.category]) categories[b.category] = [];
      categories[b.category].push(b);
    });
    for (const [cat, items] of Object.entries(categories)) {
      console.log(`  ║`);
      console.log(`  ║ [${cat}]`);
      items.forEach(b => console.log(`  ║   • ${b.msg}`));
    }
    console.log('  ╚════════════════════');
  }

  if (warnings.length) {
    console.log('\n  ╔═══ WARNINGS ═══');
    warnings.forEach(w => console.log(`  ║ [${w.category}] ${w.msg}`));
    console.log('  ╚════════════════');
  }

  console.log('\n  ╔═══ REQUIRED FIXES (Priority Order) ═══');
  console.log('  ║');
  console.log('  ║ 1. DISTRIBUTION: Frontend sends flat number, engine expects {outlets: N}');
  console.log('  ║    → Without this fix, distribution = 0 = NO SALES AT ALL');
  console.log('  ║');
  console.log('  ║ 2. PRICING: Frontend keys by brand ID, engine reads by brand NAME');
  console.log('  ║    → Prices default to 1000, ignoring user input');
  console.log('  ║');
  console.log('  ║ 3. ADVERTISING: Frontend sends flat number, engine expects {spend: N}');
  console.log('  ║    → All ad spend reads as 0');
  console.log('  ║');
  console.log('  ║ 4. SALESFORCE: Frontend sends {salary, commission}, engine reads {compensation}');
  console.log('  ║    → Salary defaults to 30000 regardless of input');
  console.log('  ║');
  console.log('  ║ 5. INTERNET: Frontend sends regional flat numbers, engine expects {webPages, seo, ...}');
  console.log('  ║    → All internet marketing reads as 0');
  console.log('  ║');
  console.log('  ║ 6. SEGMENTS: DB has pref_* columns, engine reads *_weight columns');
  console.log('  ║    → Segment preferences default to 0.1 (ignored)');
  console.log('  ║');
  console.log('  ║ FIX APPROACH: Add a normalizeDecisions() function in submit-decisions.js');
  console.log('  ║ that transforms frontend format → engine format before calling processQuarter');
  console.log('  ╚════════════════════════════════════════');
}

run().catch(e => {
  console.error('Test runner crashed:', e);
  printSummary();
});
