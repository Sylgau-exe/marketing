// lib/ai-competitors.js - Generate AI competitor decisions for solo play
// AI teams make reasonable but beatable decisions that adapt by quarter

/**
 * Generate decisions for an AI team for a given quarter
 * @param {object} params - { quarter, scenario, teamIndex, brands, cashBalance, segments }
 */
export function generateAIDecisions({ quarter, scenario, teamIndex = 0, brands = [], cashBalance = 5000000, segments = [] }) {
  // AI personality profiles - each team has a different strategy style
  const personalities = [
    { name: 'conservative', adMult: 0.7, priceMult: 1.05, rdMult: 0.6, sfMult: 0.8 },
    { name: 'aggressive', adMult: 1.2, priceMult: 0.92, rdMult: 1.1, sfMult: 1.1 },
    { name: 'balanced', adMult: 0.9, priceMult: 1.0, rdMult: 0.85, sfMult: 0.95 }
  ];
  const personality = personalities[teamIndex % personalities.length];

  // Quarter-based scaling: AI gets slightly better over time but stays beatable
  const quarterScale = 0.6 + (quarter / 8) * 0.3; // 0.6 to 0.9
  const budget = cashBalance * 0.35 * quarterScale; // AI spends 35% of cash, scaled

  const settings = getScenarioSettings(scenario);
  const regions = settings.regions;
  const availableSegments = settings.segments;

  // Pricing decisions
  const pricing = {};
  for (const brand of brands) {
    const seg = segments.find(s => s.name === brand.target_segment);
    const idealPrice = seg ? (parseFloat(seg.min_price) + parseFloat(seg.max_price)) / 2 : 1000;
    // AI prices near ideal with some variation
    const variation = (Math.random() - 0.5) * 0.15 * idealPrice;
    pricing[brand.name] = Math.round(idealPrice * personality.priceMult + variation);
  }
  if (brands.length === 0) pricing.default = 900;

  // Advertising decisions
  const advertising = {};
  const adBudget = budget * 0.25 * personality.adMult;
  for (const region of regions) {
    advertising[region] = {
      spend: Math.round(adBudget / regions.length),
      targetSegment: availableSegments[0] || 'Worker'
    };
  }

  // Internet marketing
  const inetBudget = budget * 0.08;
  const internet = {
    webPages: Math.max(1, Math.round(inetBudget * 0.25 / 5000)),
    seo: Math.max(1, Math.round(inetBudget * 0.25 / 3000)),
    paidSearch: Math.max(1, Math.round(inetBudget * 0.25 / 8000)),
    socialMedia: Math.max(1, Math.round(inetBudget * 0.25 / 6000))
  };

  // Sales force
  const salesforce = {};
  const sfBudget = budget * 0.2 * personality.sfMult;
  for (const region of regions) {
    const count = Math.max(1, Math.round(sfBudget / regions.length / 35000));
    salesforce[region] = {
      count,
      compensation: 30000 + Math.round(quarter * 1500),
      training: Math.round(count * 2000 * quarterScale)
    };
  }

  // Distribution
  const distribution = {};
  for (const region of regions) {
    distribution[region] = {
      outlets: Math.max(1, Math.round(3 + quarter * 0.8 * personality.sfMult)),
      type: quarter >= 5 ? 'showroom' : 'retail'
    };
  }

  // R&D
  const rdBudget = Math.round(budget * 0.15 * personality.rdMult);

  return {
    pricing,
    advertising,
    internet,
    salesforce,
    distribution,
    rdBudget,
    rdProjects: {},
    production: {},
    dividend: quarter >= 6 ? Math.round(budget * 0.05) : 0
  };
}

/**
 * Create initial brands for an AI team
 */
export function generateAIBrands(scenario, teamIndex) {
  const settings = getScenarioSettings(scenario);
  const segments = settings.segments;
  
  // Each AI team targets a primary segment
  const targetSegment = segments[teamIndex % segments.length];
  
  // Generate 1-2 brands
  const brandNames = [
    ['Nova X1', 'Nova Lite'],
    ['Zenith Pro', 'Zenith Core'],
    ['Pulse Max', 'Pulse Go']
  ];
  
  const names = brandNames[teamIndex % brandNames.length];
  const brands = [{
    name: names[0],
    target_segment: targetSegment,
    comp_frame: 4 + Math.floor(Math.random() * 3),
    comp_wheels: 4 + Math.floor(Math.random() * 3),
    comp_drivetrain: 4 + Math.floor(Math.random() * 3),
    comp_brakes: 4 + Math.floor(Math.random() * 3),
    comp_suspension: 3 + Math.floor(Math.random() * 3),
    comp_seat: 4 + Math.floor(Math.random() * 3),
    comp_handlebars: 4 + Math.floor(Math.random() * 3),
    comp_electronics: 2 + Math.floor(Math.random() * 3),
    unit_cost: 350 + Math.floor(Math.random() * 200)
  }];

  return brands;
}

function getScenarioSettings(scenario) {
  const configs = {
    'local-launch': { regions: ['latam'], segments: ['Worker', 'Recreation'] },
    'mountain-expedition': { regions: ['europe'], segments: ['Mountain', 'Recreation', 'Speed'] },
    'global-domination': { regions: ['latam', 'europe', 'apac'], segments: ['Worker', 'Recreation', 'Youth', 'Mountain', 'Speed'] },
    'speed-innovation': { regions: ['apac'], segments: ['Speed', 'Youth'] }
  };
  return configs[scenario] || configs['local-launch'];
}
