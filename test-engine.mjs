// Test the simulation engine for Q7 zero-demand bug
import { processQuarter } from './lib/simulation-engine.js';

// Simulate the exact conditions of a local-launch game at Q7
const segments = [
  { name: 'Worker', code: 'worker', price_sensitivity: 0.25, performance_weight: 0.10, durability_weight: 0.25, style_weight: 0.05, comfort_weight: 0.25, lightweight_weight: 0.05, customization_weight: 0.05, potential_demand_latam: 3000, potential_demand_europe: 5000, potential_demand_apac: 4000, min_price: 600, max_price: 1000, growth_rate: 0.05 },
  { name: 'Recreation', code: 'recreation', price_sensitivity: 0.15, performance_weight: 0.10, durability_weight: 0.15, style_weight: 0.20, comfort_weight: 0.20, lightweight_weight: 0.10, customization_weight: 0.10, potential_demand_latam: 4000, potential_demand_europe: 6000, potential_demand_apac: 5000, min_price: 700, max_price: 1200, growth_rate: 0.08 },
  { name: 'Youth', code: 'youth', price_sensitivity: 0.30, performance_weight: 0.05, durability_weight: 0.10, style_weight: 0.30, comfort_weight: 0.10, lightweight_weight: 0.05, customization_weight: 0.10, potential_demand_latam: 5000, potential_demand_europe: 4000, potential_demand_apac: 6000, min_price: 500, max_price: 900, growth_rate: 0.10 },
  { name: 'Mountain', code: 'mountain', price_sensitivity: 0.10, performance_weight: 0.30, durability_weight: 0.20, style_weight: 0.05, comfort_weight: 0.05, lightweight_weight: 0.15, customization_weight: 0.15, potential_demand_latam: 2000, potential_demand_europe: 4000, potential_demand_apac: 3000, min_price: 900, max_price: 1500, growth_rate: 0.06 },
  { name: 'Speed', code: 'speed', price_sensitivity: 0.05, performance_weight: 0.30, durability_weight: 0.10, style_weight: 0.10, comfort_weight: 0.05, lightweight_weight: 0.30, customization_weight: 0.10, potential_demand_latam: 1500, potential_demand_europe: 3500, potential_demand_apac: 2500, min_price: 1000, max_price: 1800, growth_rate: 0.04 }
];

// Player team - brands Bono and Sissi
const playerBrands = [
  { name: 'Bono', target_segment: 'Recreation', frame_quality: 5, wheels_quality: 5, drivetrain_quality: 5, brakes_quality: 5, suspension_quality: 3, seat_quality: 5, handlebars_quality: 5, electronics_quality: 0, unit_cost: 450 },
  { name: 'Sissi', target_segment: 'Worker', frame_quality: 4, wheels_quality: 4, drivetrain_quality: 4, brakes_quality: 4, suspension_quality: 3, seat_quality: 4, handlebars_quality: 4, electronics_quality: 0, unit_cost: 350 }
];

// AI team 1 - NovaTech
const ai1Brands = [
  { name: 'Nova X1', target_segment: 'Worker', frame_quality: 5, wheels_quality: 6, drivetrain_quality: 5, brakes_quality: 4, suspension_quality: 4, seat_quality: 5, handlebars_quality: 6, electronics_quality: 3, unit_cost: 400 }
];

// AI team 2 - Zenith
const ai2Brands = [
  { name: 'Zenith Pro', target_segment: 'Recreation', frame_quality: 6, wheels_quality: 5, drivetrain_quality: 4, brakes_quality: 5, suspension_quality: 3, seat_quality: 6, handlebars_quality: 5, electronics_quality: 4, unit_cost: 420 }
];

const teams = [
  { id: 1, name: "Sylvain's Company", brands: playerBrands, cash_balance: 4277593, total_investment: 5000000, cumulative_profit: -722407 },
  { id: 2, name: 'NovaTech Industries', brands: ai1Brands, cash_balance: 4800000, total_investment: 5000000, cumulative_profit: -200000 },
  { id: 3, name: 'Zenith Electronics', brands: ai2Brands, cash_balance: 4600000, total_investment: 5000000, cumulative_profit: -400000 }
];

// Player decisions (local-launch = LATAM only)
const playerDecisions = {
  pricing: { Bono: 1730, Sissi: 1710 },
  advertising: { latam: { spend: 500000, targetSegment: 'Recreation' } },
  internet: { webPages: 2, seo: 3, paidSearch: 1, socialMedia: 2 },
  salesforce: { latam: { count: 2, compensation: 40000, training: 5000 } },
  distribution: { latam: { outlets: 6, type: 'retail' }, europe: { outlets: 0, type: 'retail' }, apac: { outlets: 0, type: 'retail' } },
  rdBudget: 100000,
  rdProjects: {},
  production: {},
  dividend: 0
};

// AI decisions (generated similar to ai-competitors.js for Q7)
function makeAIDecisions(teamIndex, cashBalance) {
  const personalities = [
    { adMult: 0.7, priceMult: 1.05, rdMult: 0.6, sfMult: 0.8 },
    { adMult: 1.2, priceMult: 0.92, rdMult: 1.1, sfMult: 1.1 }
  ];
  const p = personalities[teamIndex % 2];
  const quarterScale = 0.6 + (7 / 8) * 0.3;
  const budget = cashBalance * 0.35 * quarterScale;
  
  return {
    pricing: teamIndex === 0 ? { 'Nova X1': 827 } : { 'Zenith Pro': 911 },
    advertising: { latam: { spend: Math.round(budget * 0.25 * p.adMult), targetSegment: 'Worker' } },
    internet: { webPages: 2, seo: 2, paidSearch: 1, socialMedia: 2 },
    salesforce: { latam: { count: 3, compensation: 40500, training: 5000 } },
    distribution: { latam: { outlets: 9, type: 'showroom' } },
    rdBudget: Math.round(budget * 0.15 * p.rdMult),
    rdProjects: {},
    production: {},
    dividend: Math.round(budget * 0.05)
  };
}

const decisions = {
  1: playerDecisions,
  2: makeAIDecisions(0, 4800000),
  3: makeAIDecisions(1, 4600000)
};

// Run for quarters 1-8
for (let q = 1; q <= 8; q++) {
  const result = processQuarter({
    quarter: q,
    teams,
    segments,
    decisions
  });
  
  const pr = result.results[1];
  const debug = result._engineDebug || [];
  
  console.log(`\n=== Q${q} ===`);
  console.log(`Player: demand=${pr.totalDemand}, revenue=$${pr.revenue}, netIncome=$${pr.netIncome}, endingCash=$${pr.endingCash}, scorecard=${pr.balancedScorecard}`);
  console.log(`Market shares: player=${(pr.marketSharePrimary*100).toFixed(1)}%`);
  
  // Check all teams
  for (const [tid, tr] of Object.entries(result.results)) {
    if (tr.totalDemand === 0 && q > 1) {
      console.log(`⚠️ ZERO DEMAND for team ${tid}!`);
      // Show debug for this team
      const teamDebug = debug.filter(d => String(d.team) === String(tid)).slice(0, 3);
      teamDebug.forEach(d => console.log(`  ${d.segment}/${d.region}: targeting=${d.targeting}, skip=${d.skip}, dist=${d.distRaw}, pull=${d.pull}`));
    }
  }
  
  // Show market research demand
  const mr = result.marketResearch;
  if (mr?.segmentDemands) {
    const latamTotal = Object.values(mr.segmentDemands).reduce((s, r) => s + (r.latam || 0), 0);
    console.log(`LATAM total demand: ${latamTotal}`);
  }
}
