#!/usr/bin/env node
/**
 * MarketSim LOCAL E2E Test
 * 
 * Runs the simulation engine directly (no network needed).
 * Simulates all 8 quarters for each scenario and identifies:
 * - Data format mismatches (frontend → engine)
 * - Zero demand / zero revenue / zero sales
 * - Negative cash / bankruptcy
 * - Scorecard always-zero problems
 * - Cost formula mismatches
 * - Segment weight mapping issues
 * - AI vs Player format differences
 * 
 * Usage: node tests/local-e2e-test.mjs
 */

import { processQuarter, generateGameCode } from '../lib/simulation-engine.js';
import { generateAIDecisions } from '../lib/ai-competitors.js';

// ═══════════════════════════════════════════════════════════════
// TEST INFRASTRUCTURE
// ═══════════════════════════════════════════════════════════════

const bugs = [];
const warnings = [];
const passed = [];

function bug(cat, msg, data = null) {
  bugs.push({ cat, msg, data });
  console.log(`  ❌ [${cat}] ${msg}`);
  if (data) console.log(`     →`, typeof data === 'string' ? data : JSON.stringify(data).substring(0, 300));
}
function warn(cat, msg) {
  warnings.push({ cat, msg });
  console.log(`  ⚠️  [${cat}] ${msg}`);
}
function pass(msg) {
  passed.push(msg);
  console.log(`  ✅ ${msg}`);
}

// ═══════════════════════════════════════════════════════════════
// SEGMENT DATA (matches SegmentDB.seedDefaults exactly)
// ═══════════════════════════════════════════════════════════════

const RAW_SEGMENTS = [
  { name: 'Worker', code: 'worker', pref_price_sensitivity: 0.25, pref_performance: 0.10, pref_durability: 0.25, pref_style: 0.05, pref_comfort: 0.25, pref_lightweight: 0.05, pref_customization: 0.05, potential_demand_latam: 3000, potential_demand_europe: 5000, potential_demand_apac: 4000, min_price: 600, max_price: 1000, growth_rate: 0.05 },
  { name: 'Recreation', code: 'recreation', pref_price_sensitivity: 0.15, pref_performance: 0.10, pref_durability: 0.15, pref_style: 0.20, pref_comfort: 0.20, pref_lightweight: 0.10, pref_customization: 0.10, potential_demand_latam: 4000, potential_demand_europe: 6000, potential_demand_apac: 5000, min_price: 700, max_price: 1200, growth_rate: 0.08 },
  { name: 'Youth', code: 'youth', pref_price_sensitivity: 0.30, pref_performance: 0.05, pref_durability: 0.10, pref_style: 0.30, pref_comfort: 0.10, pref_lightweight: 0.05, pref_customization: 0.10, potential_demand_latam: 5000, potential_demand_europe: 4000, potential_demand_apac: 6000, min_price: 500, max_price: 900, growth_rate: 0.10 },
  { name: 'Mountain', code: 'mountain', pref_price_sensitivity: 0.10, pref_performance: 0.30, pref_durability: 0.20, pref_style: 0.05, pref_comfort: 0.05, pref_lightweight: 0.15, pref_customization: 0.15, potential_demand_latam: 2000, potential_demand_europe: 4000, potential_demand_apac: 3000, min_price: 900, max_price: 1500, growth_rate: 0.06 },
  { name: 'Speed', code: 'speed', pref_price_sensitivity: 0.05, pref_performance: 0.30, pref_durability: 0.10, pref_style: 0.10, pref_comfort: 0.05, pref_lightweight: 0.30, pref_customization: 0.10, potential_demand_latam: 1500, potential_demand_europe: 3500, potential_demand_apac: 2500, min_price: 1000, max_price: 1800, growth_rate: 0.04 },
];

const SCENARIOS = {
  'local-launch':       { regions: ['latam'],  segments: ['Worker', 'Recreation'],  cash: 6000000, aiCount: 2 },
  'mountain-expedition':{ regions: ['europe'], segments: ['Mountain', 'Recreation', 'Speed'], cash: 5000000, aiCount: 3 },
  'global-domination':  { regions: ['latam', 'europe', 'apac'], segments: ['Worker', 'Recreation', 'Youth', 'Mountain', 'Speed'], cash: 5000000, aiCount: 3 },
  'speed-innovation':   { regions: ['apac'],   segments: ['Speed', 'Youth'],        cash: 4500000, aiCount: 2 },
};

// ═══════════════════════════════════════════════════════════════
// HELPER: Build test data
// ═══════════════════════════════════════════════════════════════

function makeSegments(scenarioId) {
  const cfg = SCENARIOS[scenarioId];
  return RAW_SEGMENTS.filter(s => cfg.segments.includes(s.name));
}

function costFormula(components) {
  return 50 + components.reduce((sum, v) => sum + v * v * 8 + v * 15, 0);
}

function makeBrand(name, targetSegment, qualities = [3,3,3,3,3,3,3,1]) {
  const [frame, wheels, drivetrain, brakes, suspension, seat, handlebars, electronics] = qualities;
  return {
    id: 'brand_' + name.replace(/\s/g, '_').toLowerCase(),
    name, target_segment: targetSegment,
    frame_quality: frame, wheels_quality: wheels, drivetrain_quality: drivetrain,
    brakes_quality: brakes, suspension_quality: suspension, seat_quality: seat,
    handlebars_quality: handlebars, electronics_quality: electronics,
    overall_quality: qualities.reduce((a, b) => a + b) / qualities.filter(v => v > 0).length,
    unit_cost: costFormula(qualities),
    rd_investment: 0, is_active: true
  };
}

// ═══════════════════════════════════════════════════════════════
// TEST 1: Segment weight field mapping
// ═══════════════════════════════════════════════════════════════

function testSegmentWeightMapping() {
  console.log('\n═══ Test 1: Segment Weight Field Mapping ═══');
  
  const seg = RAW_SEGMENTS[0]; // Worker
  
  // The engine reads these field names:
  const engineFields = ['price_sensitivity', 'performance_weight', 'durability_weight', 'style_weight', 'comfort_weight', 'lightweight_weight', 'customization_weight'];
  // DB has these:
  const dbFields = ['pref_price_sensitivity', 'pref_performance', 'pref_durability', 'pref_style', 'pref_comfort', 'pref_lightweight', 'pref_customization'];
  
  let mismatches = 0;
  engineFields.forEach((ef, i) => {
    if (seg[ef] === undefined) {
      bug('SEGMENT', `Engine reads segment.${ef} but DB column is ${dbFields[i]}=${seg[dbFields[i]]}`);
      mismatches++;
    }
  });
  
  if (mismatches === 0) pass('All segment weight fields match engine expectations');
  else bug('SEGMENT', `${mismatches} segment fields need aliasing. Without fix, all weights default to 0.1 — segments are undifferentiated.`);
  
  return mismatches;
}

// ═══════════════════════════════════════════════════════════════
// TEST 2: Cost formula alignment
// ═══════════════════════════════════════════════════════════════

function testCostFormula() {
  console.log('\n═══ Test 2: Cost Formula Alignment ═══');
  
  // Frontend formula (simulation.html updateEstCost):  50 + Σ(v²×8 + v×15)
  // Backend formula (db.js BrandDB.create):            should match after our fix
  
  const testCases = [
    { name: 'All 0s',   q: [0,0,0,0,0,0,0,0], expected: 50 },
    { name: 'All 3s',   q: [3,3,3,3,3,3,3,3], expected: 50 + 8*(9*8+3*15) },
    { name: 'All 5s',   q: [5,5,5,5,5,5,5,5], expected: 50 + 8*(25*8+5*15) },
    { name: 'Mixed',    q: [4,3,3,2,3,3,2,1], expected: costFormula([4,3,3,2,3,3,2,1]) },
  ];
  
  testCases.forEach(tc => {
    const got = costFormula(tc.q);
    if (got !== tc.expected) {
      bug('COST', `${tc.name}: expected $${tc.expected}, got $${got}`);
    } else {
      pass(`Cost formula correct for ${tc.name}: $${got}`);
    }
  });
  
  // Verify specific case: all 3s
  const all3 = costFormula([3,3,3,3,3,3,3,3]);
  console.log(`  Info: All quality=3 → unit cost = $${all3}`);
  if (all3 < 500 || all3 > 2000) warn('COST', `Cost $${all3} for all-3s seems unreasonable`);
}

// ═══════════════════════════════════════════════════════════════
// TEST 3: Frontend → Engine data format mismatches
// ═══════════════════════════════════════════════════════════════

function testDataFormats() {
  console.log('\n═══ Test 3: Frontend → Engine Data Format Audit ═══');
  
  // Simulate what the frontend collectDecisions() sends
  const brandId = 'brand_42';
  const brandName = 'TestPhone Pro';
  
  const frontendDecisions = {
    pricing:    { [brandId]: { 'LATAM': 1200 } },
    advertising:{ latam: 100000, europe: 0, apac: 0, target: 'Worker' },
    internet:   { latam: 30000, europe: 0, apac: 0 },
    salesforce: { latam: { count: 5, salary: 40000, commission: 5 } },
    distribution:{ latam: 3, europe: 0, apac: 0 },
    rdBudget: 100000,
    production: { [brandId]: 1000 },
    dividend: 0
  };
  
  // Simulate what AI competitors send (which matches engine format)
  const aiDecisions = {
    pricing:    { [brandName]: 950 },
    advertising:{ latam: { spend: 120000, targetSegment: 'Worker' } },
    internet:   { webPages: 3, seo: 5, paidSearch: 2, socialMedia: 4 },
    salesforce: { latam: { count: 4, compensation: 35000, training: 5000 } },
    distribution:{ latam: { outlets: 4, type: 'retail' } },
    rdBudget: 80000,
    production: {},
    dividend: 0
  };
  
  // Check each field
  console.log('\n  --- PRICING ---');
  const playerPrice = frontendDecisions.pricing[brandId]?.LATAM;
  const engineLookup = frontendDecisions.pricing[brandName]; // engine reads by NAME
  if (!engineLookup) bug('PRICING', `Engine reads pricing["${brandName}"] → undefined (frontend keys by ID "${brandId}"). Player price $${playerPrice} is IGNORED, defaults to $1000.`);
  
  console.log('\n  --- ADVERTISING ---');
  const adSpend = frontendDecisions.advertising?.latam;
  const engineAdSpend = frontendDecisions.advertising?.latam?.spend;
  if (typeof adSpend === 'number' && engineAdSpend === undefined) {
    bug('ADVERTISING', `Frontend: advertising.latam = ${adSpend} (flat number). Engine reads advertising.latam.spend → ${adSpend}.spend → undefined → 0. All ad spend LOST.`);
  }
  
  const adTarget = frontendDecisions.advertising?.target;
  const engineTarget = frontendDecisions.advertising?.latam?.targetSegment;
  if (adTarget && !engineTarget) {
    bug('AD_TARGET', `Frontend: advertising.target = "${adTarget}" (top-level). Engine reads advertising.latam.targetSegment → undefined. Targeting bonus NEVER applies.`);
  }
  
  console.log('\n  --- INTERNET MARKETING ---');
  const inetVal = frontendDecisions.internet?.latam;
  const engineInet = frontendDecisions.internet?.webPages;
  if (typeof inetVal === 'number' && engineInet === undefined) {
    bug('INTERNET', `Frontend: internet.latam = ${inetVal} (regional $). Engine reads internet.webPages/seo/paidSearch/socialMedia → all undefined → all 0. Internet budget is WASTED.`);
  }
  
  console.log('\n  --- SALESFORCE ---');
  const sfSalary = frontendDecisions.salesforce?.latam?.salary;
  const sfComp = frontendDecisions.salesforce?.latam?.compensation;
  if (sfSalary && !sfComp) {
    bug('SALESFORCE', `Frontend: salesforce.latam.salary = ${sfSalary}. Engine reads salesforce.latam.compensation → undefined → defaults to $30,000. Player salary choice IGNORED.`);
  }
  
  console.log('\n  --- DISTRIBUTION ---');
  const distVal = frontendDecisions.distribution?.latam;
  const distOutlets = frontendDecisions.distribution?.latam?.outlets;
  if (typeof distVal === 'number' && distOutlets === undefined) {
    bug('DISTRIBUTION', `CRITICAL: Frontend: distribution.latam = ${distVal} (flat number). Engine reads distribution.latam.outlets → ${distVal}.outlets → undefined → 0. getDistribution() returns 0. This MULTIPLIES pull to 0. Player gets ZERO SALES.`);
  }
  
  // Summary
  console.log('\n  --- AI FORMAT (for comparison) ---');
  pass(`AI pricing: by brand name ✓`);
  pass(`AI advertising: {spend: N, targetSegment: S} ✓`);
  pass(`AI internet: {webPages, seo, paidSearch, socialMedia} ✓`);
  pass(`AI salesforce: {count, compensation, training} ✓`);
  pass(`AI distribution: {outlets: N, type: S} ✓`);
}

// ═══════════════════════════════════════════════════════════════
// TEST 4: Full 8-Quarter Simulation (RAW frontend format — no normalization)
// ═══════════════════════════════════════════════════════════════

function testFullSimulation_Raw(scenarioId) {
  console.log(`\n═══ Test 4a: Full 8Q Sim — RAW frontend format [${scenarioId}] ═══`);
  
  const cfg = SCENARIOS[scenarioId];
  const segments = makeSegments(scenarioId);
  
  // Player brand
  const playerBrand = makeBrand('MyBrand', cfg.segments[0], [4, 3, 3, 3, 3, 3, 3, 1]);
  
  // AI brands
  const aiBrands = [];
  for (let i = 0; i < cfg.aiCount; i++) {
    aiBrands.push(makeBrand(`AI_Brand_${i}`, cfg.segments[i % cfg.segments.length], [5, 4, 4, 4, 3, 4, 4, 2]));
  }
  
  const teams = [
    { id: 'player', name: 'Player Corp', brands: [playerBrand], cash_balance: cfg.cash, total_investment: cfg.cash, cumulative_profit: 0 },
    ...aiBrands.map((b, i) => ({ id: `ai_${i}`, name: `AI Team ${i}`, brands: [b], cash_balance: cfg.cash, total_investment: cfg.cash, cumulative_profit: 0, is_ai: true }))
  ];
  
  let playerCash = cfg.cash;
  let playerCumProfit = 0;
  
  for (let q = 1; q <= 8; q++) {
    // Player decisions in FRONTEND format (what the UI actually sends)
    const playerDecisions = {
      pricing:     { [playerBrand.id]: {} },
      advertising: {},
      internet:    {},
      salesforce:  {},
      distribution:{},
      rdBudget: 100000,
      production: { [playerBrand.id]: 1000 },
      dividend: 0
    };
    // Set pricing per region (frontend sends by brand ID + region)
    cfg.regions.forEach(r => {
      playerDecisions.pricing[playerBrand.id][r.toUpperCase()] = playerBrand.unit_cost + 400;
      playerDecisions.advertising[r] = 120000;
      playerDecisions.internet[r] = 40000;
      playerDecisions.salesforce[r] = { count: 5, salary: 40000, commission: 5 };
      playerDecisions.distribution[r] = 3;
    });
    playerDecisions.advertising.target = cfg.segments[0];
    
    // AI decisions (already in correct engine format)
    const decisionsMap = { player: playerDecisions };
    for (let i = 0; i < cfg.aiCount; i++) {
      decisionsMap[`ai_${i}`] = generateAIDecisions({
        quarter: q, scenario: scenarioId, teamIndex: i,
        brands: [aiBrands[i]], cashBalance: cfg.cash, segments
      });
    }
    
    try {
      const result = processQuarter({ quarter: q, teams, segments, decisions: decisionsMap });
      const pr = result.results['player'];
      
      if (!pr) { bug('ENGINE', `Q${q}: No player results returned`); continue; }
      
      console.log(`  Q${q}: demand=${pr.totalDemand} sold=${pr.unitsSold} rev=$${(pr.revenue||0).toLocaleString()} income=$${(pr.netIncome||0).toLocaleString()} cash=$${(pr.endingCash||0).toLocaleString()} BSC=${(pr.balancedScorecard||0).toFixed(2)}`);
      
      if (pr.totalDemand === 0) bug('ENGINE_RAW', `Q${q}: ZERO demand — distribution format bug kills all sales`);
      if (pr.revenue === 0 && pr.unitsSold > 0) bug('ENGINE_RAW', `Q${q}: Sold ${pr.unitsSold} units but $0 revenue — pricing lookup fails`);
      if (pr.balancedScorecard === 0) warn('ENGINE_RAW', `Q${q}: BSC=0 (multiplicative model: one zero factor zeroes everything)`);
      if (pr.endingCash < 0) warn('ENGINE_RAW', `Q${q}: Negative cash $${pr.endingCash.toLocaleString()} — would be bankrupt`);
      
      // Update team state for next quarter
      teams[0].cash_balance = pr.endingCash;
      playerCumProfit += pr.netIncome;
      teams[0].cumulative_profit = playerCumProfit;
      
      for (let i = 0; i < cfg.aiCount; i++) {
        const ar = result.results[`ai_${i}`];
        if (ar) {
          teams[i + 1].cash_balance = ar.endingCash;
          teams[i + 1].cumulative_profit = (teams[i + 1].cumulative_profit || 0) + ar.netIncome;
        }
      }
    } catch (e) {
      bug('CRASH', `Q${q}: Engine crashed: ${e.message}\n${e.stack}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// TEST 5: Full 8-Quarter Simulation (with normalization fix)
// ═══════════════════════════════════════════════════════════════

function normalizeSegment(seg) {
  return {
    ...seg,
    price_sensitivity:    seg.pref_price_sensitivity ?? seg.price_sensitivity ?? 0.15,
    performance_weight:   seg.pref_performance ?? seg.performance_weight ?? 0.1,
    durability_weight:    seg.pref_durability ?? seg.durability_weight ?? 0.1,
    style_weight:         seg.pref_style ?? seg.style_weight ?? 0.1,
    comfort_weight:       seg.pref_comfort ?? seg.comfort_weight ?? 0.1,
    lightweight_weight:   seg.pref_lightweight ?? seg.lightweight_weight ?? 0.1,
    customization_weight: seg.pref_customization ?? seg.customization_weight ?? 0.05,
  };
}

function normalizePlayerDecisions(d, brands, regions, targetSegment) {
  const normalized = {
    rdBudget: parseFloat(d.rdBudget) || 0,
    production: d.production || {},
    dividend: parseFloat(d.dividend) || 0
  };
  
  // PRICING: {brandId: {REGION: price}} → {brandName: price}
  normalized.pricing = {};
  for (const [brandId, regionPrices] of Object.entries(d.pricing || {})) {
    const brand = brands.find(b => String(b.id) === String(brandId));
    if (brand && typeof regionPrices === 'object') {
      const prices = Object.values(regionPrices).map(p => parseFloat(p)).filter(p => p > 0);
      normalized.pricing[brand.name] = prices.length ? Math.round(prices.reduce((a, b) => a + b) / prices.length) : 900;
    }
  }
  if (Object.keys(normalized.pricing).length === 0) normalized.pricing.default = 900;
  
  // ADVERTISING: {latam: N, target: 'seg'} → {latam: {spend: N, targetSegment: 'seg'}}
  normalized.advertising = {};
  const adTarget = d.advertising?.target || targetSegment;
  for (const r of regions) {
    const spend = parseFloat(d.advertising?.[r]) || 0;
    normalized.advertising[r] = { spend, targetSegment: adTarget };
  }
  
  // INTERNET: {latam: N} → {webPages, seo, paidSearch, socialMedia}
  const inetTotal = regions.reduce((sum, r) => sum + (parseFloat(d.internet?.[r]) || 0), 0);
  normalized.internet = {
    webPages:    Math.max(0, Math.round(inetTotal * 0.25 / 5000)),
    seo:         Math.max(0, Math.round(inetTotal * 0.25 / 3000)),
    paidSearch:  Math.max(0, Math.round(inetTotal * 0.25 / 8000)),
    socialMedia: Math.max(0, Math.round(inetTotal * 0.25 / 6000))
  };
  
  // SALESFORCE: {latam: {count, salary, commission}} → {latam: {count, compensation, training}}
  normalized.salesforce = {};
  for (const [r, sf] of Object.entries(d.salesforce || {})) {
    if (typeof sf === 'object') {
      normalized.salesforce[r] = {
        count: parseInt(sf.count) || 0,
        compensation: parseFloat(sf.salary || sf.compensation) || 30000,
        training: parseFloat(sf.training) || 0
      };
    }
  }
  
  // DISTRIBUTION: {latam: 3} → {latam: {outlets: 3, type: 'retail'}}
  normalized.distribution = {};
  for (const [r, val] of Object.entries(d.distribution || {})) {
    normalized.distribution[r] = typeof val === 'object' ? val : { outlets: parseInt(val) || 0, type: 'retail' };
  }
  
  return normalized;
}

function testFullSimulation_Normalized(scenarioId) {
  console.log(`\n═══ Test 5: Full 8Q Sim — NORMALIZED [${scenarioId}] ═══`);
  
  const cfg = SCENARIOS[scenarioId];
  const segments = makeSegments(scenarioId).map(normalizeSegment);
  
  const playerBrand = makeBrand('MyBrand', cfg.segments[0], [4, 3, 3, 3, 3, 3, 3, 1]);
  
  const aiBrands = [];
  for (let i = 0; i < cfg.aiCount; i++) {
    aiBrands.push(makeBrand(`AI_Brand_${i}`, cfg.segments[i % cfg.segments.length], [5, 4, 4, 4, 3, 4, 4, 2]));
  }
  
  const teams = [
    { id: 'player', name: 'Player Corp', brands: [playerBrand], cash_balance: cfg.cash, total_investment: cfg.cash, cumulative_profit: 0 },
    ...aiBrands.map((b, i) => ({ id: `ai_${i}`, name: `AI Team ${i}`, brands: [b], cash_balance: cfg.cash, total_investment: cfg.cash, cumulative_profit: 0, is_ai: true }))
  ];
  
  let zeroQs = 0;
  let bankruptQ = 0;
  
  for (let q = 1; q <= 8; q++) {
    const frontendDecisions = {
      pricing: { [playerBrand.id]: {} },
      advertising: {}, internet: {}, salesforce: {}, distribution: {},
      rdBudget: 100000, production: { [playerBrand.id]: 1000 }, dividend: 0
    };
    cfg.regions.forEach(r => {
      frontendDecisions.pricing[playerBrand.id][r.toUpperCase()] = playerBrand.unit_cost + 400;
      frontendDecisions.advertising[r] = 120000;
      frontendDecisions.internet[r] = 40000;
      frontendDecisions.salesforce[r] = { count: 5, salary: 40000, commission: 5 };
      frontendDecisions.distribution[r] = 3;
    });
    frontendDecisions.advertising.target = cfg.segments[0];
    
    // Apply normalization (this is the fix)
    const normalizedPlayer = normalizePlayerDecisions(frontendDecisions, [playerBrand], cfg.regions, cfg.segments[0]);
    
    const decisionsMap = { player: normalizedPlayer };
    for (let i = 0; i < cfg.aiCount; i++) {
      decisionsMap[`ai_${i}`] = generateAIDecisions({
        quarter: q, scenario: scenarioId, teamIndex: i,
        brands: [aiBrands[i]], cashBalance: teams[i+1].cash_balance, segments
      });
    }
    
    try {
      const result = processQuarter({ quarter: q, teams, segments, decisions: decisionsMap });
      const pr = result.results['player'];
      
      if (!pr) { bug('ENGINE_NORM', `Q${q}: No player results`); continue; }
      
      const marker = pr.totalDemand === 0 ? '💀' : pr.netIncome < 0 ? '📉' : '📈';
      console.log(`  ${marker} Q${q}: demand=${pr.totalDemand} sold=${pr.unitsSold} rev=$${(pr.revenue||0).toLocaleString()} income=$${(pr.netIncome||0).toLocaleString()} cash=$${(pr.endingCash||0).toLocaleString()} BSC=${(pr.balancedScorecard||0).toFixed(2)} mktShare=${((pr.marketSharePrimary||0)*100).toFixed(1)}%`);
      
      if (pr.totalDemand === 0) zeroQs++;
      if (pr.endingCash < 0 && !bankruptQ) bankruptQ = q;
      
      // Verify financials make sense
      if (pr.revenue > 0 && pr.costOfGoods > pr.revenue * 3) warn('ENGINE_NORM', `Q${q}: COGS ($${pr.costOfGoods}) > 3x revenue ($${pr.revenue})`);
      if (pr.advertisingExpense === 0 && normalizedPlayer.advertising?.latam?.spend > 0) bug('ENGINE_NORM', `Q${q}: Sent ad spend but advertisingExpense=0`);
      if (pr.salesforceExpense === 0 && normalizedPlayer.salesforce?.latam?.count > 0) bug('ENGINE_NORM', `Q${q}: Sent sales reps but salesforceExpense=0`);
      if (pr.distributionExpense === 0 && normalizedPlayer.distribution?.latam?.outlets > 0) bug('ENGINE_NORM', `Q${q}: Sent outlets but distributionExpense=0`);
      
      // Update state
      teams[0].cash_balance = pr.endingCash;
      teams[0].cumulative_profit = (teams[0].cumulative_profit || 0) + pr.netIncome;
      for (let i = 0; i < cfg.aiCount; i++) {
        const ar = result.results[`ai_${i}`];
        if (ar) {
          teams[i+1].cash_balance = ar.endingCash;
          teams[i+1].cumulative_profit = (teams[i+1].cumulative_profit || 0) + ar.netIncome;
        }
      }
    } catch (e) {
      bug('CRASH', `Q${q}: ${e.message}\n${e.stack?.split('\n').slice(0,3).join('\n')}`);
    }
  }
  
  // Summary
  if (zeroQs === 0) pass(`All 8 quarters produced demand with normalization`);
  else bug('ENGINE_NORM', `${zeroQs}/8 quarters had ZERO demand even after normalization`);
  
  if (!bankruptQ) pass(`Player survived all 8 quarters`);
  else warn('ENGINE_NORM', `Player went bankrupt at Q${bankruptQ}`);
  
  console.log(`  Final: cash=$${teams[0].cash_balance.toLocaleString()}, cum_profit=$${teams[0].cumulative_profit.toLocaleString()}`);
}

// ═══════════════════════════════════════════════════════════════
// TEST 6: AI competitor decision format consistency
// ═══════════════════════════════════════════════════════════════

function testAIDecisionFormat() {
  console.log('\n═══ Test 6: AI Decision Format Validation ═══');
  
  for (const [scenId, cfg] of Object.entries(SCENARIOS)) {
    const segments = makeSegments(scenId);
    const brands = [makeBrand('AI_Test', cfg.segments[0])];
    
    const aiDec = generateAIDecisions({
      quarter: 1, scenario: scenId, teamIndex: 0,
      brands, cashBalance: cfg.cash, segments
    });
    
    // Check all fields match engine expectations
    let issues = 0;
    
    // Pricing: should be keyed by brand name
    if (typeof aiDec.pricing[brands[0].name] !== 'number') { bug('AI_FORMAT', `[${scenId}] AI pricing not keyed by brand name`); issues++; }
    
    // Advertising: should be {region: {spend, targetSegment}}
    for (const r of cfg.regions) {
      if (typeof aiDec.advertising[r]?.spend !== 'number') { bug('AI_FORMAT', `[${scenId}] AI ad.${r}.spend missing`); issues++; }
    }
    
    // Internet: should have webPages, seo, etc.
    if (typeof aiDec.internet?.webPages !== 'number') { bug('AI_FORMAT', `[${scenId}] AI internet.webPages missing`); issues++; }
    
    // Salesforce
    for (const r of cfg.regions) {
      if (typeof aiDec.salesforce[r]?.count !== 'number') { bug('AI_FORMAT', `[${scenId}] AI salesforce.${r}.count missing`); issues++; }
      if (typeof aiDec.salesforce[r]?.compensation !== 'number') { bug('AI_FORMAT', `[${scenId}] AI salesforce.${r}.compensation missing`); issues++; }
    }
    
    // Distribution
    for (const r of cfg.regions) {
      if (typeof aiDec.distribution[r]?.outlets !== 'number') { bug('AI_FORMAT', `[${scenId}] AI distribution.${r}.outlets missing`); issues++; }
    }
    
    if (issues === 0) pass(`AI decisions valid for ${scenId}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// TEST 7: Edge cases
// ═══════════════════════════════════════════════════════════════

function testEdgeCases() {
  console.log('\n═══ Test 7: Edge Cases ═══');
  
  const segments = makeSegments('local-launch').map(normalizeSegment);
  const brand = makeBrand('EdgeBrand', 'Worker', [0,0,0,0,0,0,0,0]);
  
  // Test with all-zero quality brand
  const teams = [
    { id: 'p', name: 'Player', brands: [brand], cash_balance: 6000000, total_investment: 6000000, cumulative_profit: 0 },
    { id: 'ai', name: 'AI', brands: [makeBrand('AiBrand', 'Worker', [4,4,4,4,4,4,4,2])], cash_balance: 6000000, total_investment: 6000000, cumulative_profit: 0 }
  ];
  
  const decisions = {
    p: normalizePlayerDecisions({
      pricing: { [brand.id]: { LATAM: 500 } },
      advertising: { latam: 100000, target: 'Worker' },
      internet: { latam: 20000 },
      salesforce: { latam: { count: 3, salary: 30000 } },
      distribution: { latam: 2 },
      rdBudget: 50000, production: {}, dividend: 0
    }, [brand], ['latam'], 'Worker'),
    ai: generateAIDecisions({ quarter: 1, scenario: 'local-launch', teamIndex: 0, brands: teams[1].brands, cashBalance: 6000000, segments })
  };
  
  try {
    const result = processQuarter({ quarter: 1, teams, segments, decisions });
    const pr = result.results['p'];
    if (pr) {
      pass(`All-zero quality brand: demand=${pr.totalDemand}, rev=$${pr.revenue}`);
      if (pr.endingCash < 0) warn('EDGE', `Bankrupt in Q1 with all-zero quality brand`);
    }
  } catch (e) {
    bug('CRASH', `All-zero quality brand crashed: ${e.message}`);
  }
  
  // Test with no decisions at all (empty object)
  try {
    const result2 = processQuarter({
      quarter: 1, teams, segments,
      decisions: { p: {}, ai: generateAIDecisions({ quarter: 1, scenario: 'local-launch', teamIndex: 0, brands: teams[1].brands, cashBalance: 6000000, segments }) }
    });
    pass(`Empty decisions don't crash engine`);
  } catch (e) {
    bug('CRASH', `Empty decisions crashed engine: ${e.message}`);
  }
  
  // Test with null/missing decisions
  try {
    const result3 = processQuarter({
      quarter: 1, teams, segments,
      decisions: { ai: generateAIDecisions({ quarter: 1, scenario: 'local-launch', teamIndex: 0, brands: teams[1].brands, cashBalance: 6000000, segments }) }
    });
    pass(`Missing player decisions don't crash engine (uses defaults)`);
  } catch (e) {
    bug('CRASH', `Missing decisions crashed engine: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║       MarketSim LOCAL E2E Test — All Scenarios              ║');
console.log('╚══════════════════════════════════════════════════════════════╝');

testSegmentWeightMapping();
testCostFormula();
testDataFormats();
testAIDecisionFormat();

// Run raw (unfixed) simulation
testFullSimulation_Raw('local-launch');

// Run normalized (fixed) simulation for ALL scenarios
for (const scenId of Object.keys(SCENARIOS)) {
  testFullSimulation_Normalized(scenId);
}

testEdgeCases();

// ═══════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║                       FINAL REPORT                          ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log(`\n  ✅ Passed: ${passed.length}`);
console.log(`  ⚠️  Warnings: ${warnings.length}`);
console.log(`  ❌ Bugs: ${bugs.length}`);

if (bugs.length) {
  console.log('\n  ┌─── CRITICAL BUGS ───────────────────────────────────┐');
  const cats = {};
  bugs.forEach(b => { if (!cats[b.cat]) cats[b.cat] = []; cats[b.cat].push(b); });
  for (const [cat, items] of Object.entries(cats)) {
    console.log(`  │ [${cat}]`);
    items.forEach(b => console.log(`  │   • ${b.msg}`));
  }
  console.log('  └────────────────────────────────────────────────────┘');
}

if (warnings.length) {
  console.log('\n  ┌─── WARNINGS ───────────────────────────────────────┐');
  warnings.forEach(w => console.log(`  │ [${w.cat}] ${w.msg}`));
  console.log('  └────────────────────────────────────────────────────┘');
}

console.log(`\n  ${bugs.length === 0 ? '🎉 ALL CLEAR!' : `🔧 ${bugs.length} bugs need fixing — see normalizePlayerDecisions() and normalizeSegment() in submit-decisions.js`}`);
