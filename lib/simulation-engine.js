// lib/simulation-engine.js - Core simulation logic for MarketSim Live
// Inspired by Marketplace Simulations: Advanced Strategic Marketing — Bikes

/**
 * Process a complete quarter for all teams in a game.
 * This is the heart of the simulation.
 */
export function processQuarter(gameState) {
  const { quarter, teams, segments, decisions, previousResults } = gameState;
  const results = {};

  // Phase 1: Calculate brand quality scores for each team's brands
  const allBrands = {};
  for (const team of teams) {
    allBrands[team.id] = calculateBrandScores(team.brands, segments);
  }

  // Phase 2: Calculate marketing effectiveness per team per segment per region
  const marketingEfforts = {};
  for (const team of teams) {
    const d = decisions[team.id] || getDefaultDecisions();
    marketingEfforts[team.id] = calculateMarketingEffort(d, team.brands, segments, quarter);
  }

  // Phase 3: Compute demand and market share for each segment/region
  const regions = ['latam', 'europe', 'apac'];
  const demandResults = {};

  for (const segment of segments) {
    demandResults[segment.name] = {};
    for (const region of regions) {
      const potentialKey = `potential_demand_${region}`;
      const basePotential = segment[potentialKey] || 1000;
      // Demand grows each quarter
      const growthMultiplier = 1 + (segment.growth_rate || 0.05) * (quarter - 1);
      // Seasonal adjustment: Q1/Q3 are peak (spring/fall)
      const seasonality = [1.0, 1.2, 0.8, 1.1, 1.3, 0.9, 1.15, 1.25][quarter - 1] || 1.0;
      const adjustedPotential = Math.round(basePotential * growthMultiplier * seasonality);

      // Calculate each team's pull on this segment/region
      const teamPulls = {};
      let totalPull = 0;

      for (const team of teams) {
        const d = decisions[team.id] || getDefaultDecisions();
        const effort = marketingEfforts[team.id];
        const brands = allBrands[team.id];

        // Does this team target this segment/region?
        const targeting = getTargetingStrength(d, segment.name, region, brands);
        if (targeting <= 0) continue;

        // Brand-segment fit
        const brandFit = getBestBrandFit(brands, segment);

        // Price attractiveness
        const priceAttractiveness = getPriceAttractiveness(d.pricing, brandFit?.brand, segment);

        // Advertising reach
        const adReach = getAdReach(d.advertising, d.internet, segment.name, region, quarter);

        // Sales force effectiveness
        const salesEffectiveness = getSalesEffectiveness(d.salesforce, region);

        // Distribution coverage
        const distributionCoverage = getDistribution(d.distribution, region);

        // Combined pull = product of factors (multiplicative model like balanced scorecard)
        const pull = targeting * (brandFit?.score || 0.5) * priceAttractiveness * adReach * salesEffectiveness * distributionCoverage;

        teamPulls[team.id] = {
          pull,
          brandFit,
          priceAttractiveness,
          adReach,
          salesEffectiveness,
          distributionCoverage
        };
        totalPull += pull;
      }

      // Demand creation: total pull determines how much of potential is realized
      const demandCreation = Math.min(1.5, totalPull / Math.max(1, teams.length * 0.3));
      const totalDemand = Math.round(adjustedPotential * demandCreation);

      // Distribute demand by market share
      const shares = {};
      for (const team of teams) {
        if (teamPulls[team.id]) {
          shares[team.id] = totalPull > 0 ? teamPulls[team.id].pull / totalPull : 0;
        }
      }

      demandResults[segment.name][region] = { totalDemand, shares, teamPulls };
    }
  }

  // Phase 4: Aggregate results per team
  for (const team of teams) {
    const d = decisions[team.id] || getDefaultDecisions();
    const prev = previousResults?.[team.id];
    const teamResult = computeTeamResults(team, d, allBrands[team.id], demandResults, segments, regions, quarter, prev);
    results[team.id] = teamResult;
  }

  // Phase 5: Generate market research data
  const marketResearch = generateMarketResearch(teams, results, demandResults, segments, decisions, quarter);

  return { results, marketResearch, demandResults };
}

function getDefaultDecisions() {
  return { pricing: {}, advertising: {}, internet: {}, salesforce: {}, distribution: {}, rdBudget: 0, rdProjects: {}, production: {}, dividend: 0 };
}

function calculateBrandScores(brands, segments) {
  return (brands || []).map(brand => {
    const qualities = {
      frame: brand.frame_quality || 3,
      wheels: brand.wheels_quality || 3,
      drivetrain: brand.drivetrain_quality || 3,
      brakes: brand.brakes_quality || 3,
      suspension: brand.suspension_quality || 3,
      seat: brand.seat_quality || 3,
      handlebars: brand.handlebars_quality || 3,
      electronics: brand.electronics_quality || 0
    };

    // Map component qualities to segment benefit dimensions
    const performance = (qualities.drivetrain * 0.4 + qualities.frame * 0.3 + qualities.wheels * 0.3) / 5;
    const durability = (qualities.frame * 0.4 + qualities.brakes * 0.3 + qualities.wheels * 0.3) / 5;
    const style = (qualities.frame * 0.3 + qualities.handlebars * 0.3 + qualities.seat * 0.2 + (qualities.electronics > 0 ? 0.2 : 0)) / 5;
    const comfort = (qualities.seat * 0.4 + qualities.suspension * 0.3 + qualities.handlebars * 0.3) / 5;
    const lightweight = (qualities.frame * 0.5 + qualities.wheels * 0.3 + qualities.drivetrain * 0.2) / 5;
    const customization = (qualities.electronics * 0.3 + (brand.rd_investment > 500000 ? 0.3 : 0.1)) / 5;

    return { brand, qualities, scores: { performance, durability, style, comfort, lightweight, customization } };
  });
}

function getBestBrandFit(brandScores, segment) {
  if (!brandScores || brandScores.length === 0) return null;

  let best = null;
  let bestScore = -1;

  for (const bs of brandScores) {
    if (bs.brand.target_segment && bs.brand.target_segment !== segment.name) continue;

    const fit =
      (bs.scores.performance || 0) * (segment.performance_weight || 0.1) +
      (bs.scores.durability || 0) * (segment.durability_weight || 0.1) +
      (bs.scores.style || 0) * (segment.style_weight || 0.1) +
      (bs.scores.comfort || 0) * (segment.comfort_weight || 0.1) +
      (bs.scores.lightweight || 0) * (segment.lightweight_weight || 0.1) +
      (bs.scores.customization || 0) * (segment.customization_weight || 0.1);

    if (fit > bestScore) {
      bestScore = fit;
      best = { ...bs, score: fit };
    }
  }

  // Also check non-targeted brands with a penalty
  if (!best) {
    for (const bs of brandScores) {
      const fit = (
        (bs.scores.performance || 0) * (segment.performance_weight || 0.1) +
        (bs.scores.durability || 0) * (segment.durability_weight || 0.1) +
        (bs.scores.style || 0) * (segment.style_weight || 0.1) +
        (bs.scores.comfort || 0) * (segment.comfort_weight || 0.1) +
        (bs.scores.lightweight || 0) * (segment.lightweight_weight || 0.1) +
        (bs.scores.customization || 0) * (segment.customization_weight || 0.1)
      ) * 0.6; // 40% penalty for non-targeted brand

      if (fit > bestScore) {
        bestScore = fit;
        best = { ...bs, score: fit };
      }
    }
  }

  return best;
}

function getTargetingStrength(decisions, segmentName, region, brandScores) {
  // Check if any brand targets this segment
  const hasTargetedBrand = brandScores?.some(bs => bs.brand.target_segment === segmentName);
  if (!hasTargetedBrand) return 0.3; // Small spillover

  // Check if distribution exists in this region
  const dist = decisions.distribution || {};
  if (!dist[region] || dist[region] <= 0) return 0;

  return 1.0;
}

function getPriceAttractiveness(pricing, brand, segment) {
  if (!brand || !pricing) return 0.5;

  const price = pricing[brand.name] || pricing.default || 1000;
  const minPrice = segment.min_price || 500;
  const maxPrice = segment.max_price || 1500;
  const idealPrice = (minPrice + maxPrice) / 2;
  const priceSensitivity = segment.price_sensitivity || 0.15;

  // Price within range gets base score; further from ideal = lower score
  if (price < minPrice * 0.7 || price > maxPrice * 1.5) return 0.1;

  const deviation = Math.abs(price - idealPrice) / idealPrice;
  const attractiveness = Math.max(0.1, 1 - deviation * priceSensitivity * 3);

  // Bonus for being slightly below ideal (value perception)
  if (price < idealPrice && price >= minPrice) {
    return Math.min(1.0, attractiveness * 1.1);
  }

  return Math.min(1.0, attractiveness);
}

function getAdReach(advertising, internet, segmentName, region, quarter) {
  const ad = advertising || {};
  const inet = internet || {};

  // Regional media spending
  const regionalSpend = ad[region]?.spend || 0;
  const targetedAds = ad[region]?.targetSegment === segmentName ? 1.3 : 1.0;

  // Internet marketing
  const webPages = inet.webPages || 0;
  const seo = inet.seo || 0;
  const paidSearch = inet.paidSearch || 0;
  const socialMedia = inet.socialMedia || 0;
  const internetTotal = webPages * 200 + seo * 150 + paidSearch * 300 + socialMedia * 250;

  // Diminishing returns on ad spend
  const totalSpend = regionalSpend + internetTotal / 3; // Internet spread across regions
  const adEffectiveness = Math.min(1.0, Math.sqrt(totalSpend / 500000)) * targetedAds;

  // Minimum baseline even without ads (word of mouth)
  return Math.max(0.15, Math.min(1.2, adEffectiveness));
}

function getSalesEffectiveness(salesforce, region) {
  const sf = salesforce || {};
  const headcount = sf[region]?.count || 0;
  const compensation = sf[region]?.compensation || 30000;
  const training = sf[region]?.training || 0;

  if (headcount === 0) return 0.1; // Minimal organic sales

  // More salespeople = better, with diminishing returns
  const coverageScore = Math.min(1.0, Math.sqrt(headcount / 10));

  // Better compensation and training = more effective
  const qualityMultiplier = 0.7 + (compensation / 60000) * 0.2 + (training / 10000) * 0.1;

  return Math.min(1.2, coverageScore * qualityMultiplier);
}

function getDistribution(distribution, region) {
  const dist = distribution || {};
  const outlets = dist[region]?.outlets || 0;
  const type = dist[region]?.type || 'retail';

  if (outlets === 0) return 0;

  // More outlets = better coverage, diminishing returns
  const coverage = Math.min(1.0, Math.sqrt(outlets / 20));

  // Premium showrooms are more effective per outlet
  const typeMultiplier = type === 'showroom' ? 1.3 : type === 'online' ? 0.9 : 1.0;

  return Math.min(1.2, coverage * typeMultiplier);
}

function computeTeamResults(team, decisions, brandScores, demandResults, segments, regions, quarter, prevResults) {
  let totalDemand = 0;
  let totalUnitsSold = 0;
  let totalRevenue = 0;
  let totalCOGS = 0;
  const demandBySegment = {};

  // Aggregate demand across segments and regions
  for (const segment of segments) {
    demandBySegment[segment.name] = 0;
    for (const region of regions) {
      const dr = demandResults[segment.name]?.[region];
      if (!dr) continue;

      const share = dr.shares?.[team.id] || 0;
      const demand = Math.round(dr.totalDemand * share);
      totalDemand += demand;
      demandBySegment[segment.name] += demand;

      // Revenue from this segment/region
      const brandFit = dr.teamPulls?.[team.id]?.brandFit;
      const price = brandFit ? (decisions.pricing?.[brandFit.brand.name] || decisions.pricing?.default || 900) : 900;
      const unitCost = brandFit ? (brandFit.brand.unit_cost || 400) : 400;

      totalUnitsSold += demand;
      totalRevenue += demand * price;
      totalCOGS += demand * unitCost;
    }
  }

  // Calculate expenses
  const advertisingExpense = calculateTotalAdSpend(decisions.advertising, decisions.internet);
  const salesforceExpense = calculateSalesforceExpense(decisions.salesforce);
  const distributionExpense = calculateDistributionExpense(decisions.distribution);
  const internetExpense = calculateInternetExpense(decisions.internet);
  const rdExpense = decisions.rdBudget || 0;
  const adminExpense = Math.round(totalRevenue * 0.08 + 50000); // 8% of revenue + fixed

  const grossProfit = totalRevenue - totalCOGS;
  const totalExpenses = advertisingExpense + salesforceExpense + distributionExpense + internetExpense + rdExpense + adminExpense;
  const operatingProfit = grossProfit - totalExpenses;
  const netIncome = Math.round(operatingProfit * 0.75); // 25% tax rate

  // Cash flow
  const prevCash = prevResults?.endingCash || team.cash_balance || 5000000;
  const dividend = decisions.dividend || 0;
  const cashFlow = netIncome - dividend;
  const endingCash = prevCash + cashFlow;

  // Satisfaction scores (0-1 scale)
  const brandSatisfaction = calculateBrandSatisfaction(brandScores, segments);
  const adSatisfaction = calculateAdSatisfaction(decisions.advertising, decisions.internet, totalRevenue);
  const priceSatisfaction = calculatePriceSatisfaction(decisions.pricing, segments, brandScores);
  const overallSatisfaction = (brandSatisfaction * 0.4 + adSatisfaction * 0.2 + priceSatisfaction * 0.4);

  // Market share calculations
  const primarySegments = [...new Set((team.brands || []).map(b => b.target_segment).filter(Boolean))];
  let marketSharePrimary = 0;
  let marketShareSecondary = 0;

  for (const segment of segments) {
    let totalSegDemand = 0;
    let teamSegDemand = demandBySegment[segment.name] || 0;
    for (const region of regions) {
      totalSegDemand += demandResults[segment.name]?.[region]?.totalDemand || 0;
    }
    const segShare = totalSegDemand > 0 ? teamSegDemand / totalSegDemand : 0;

    if (primarySegments.includes(segment.name)) {
      marketSharePrimary = Math.max(marketSharePrimary, segShare);
    } else {
      marketShareSecondary = Math.max(marketShareSecondary, segShare);
    }
  }

  // Balanced Scorecard (multiplicative model)
  const financialPerformance = totalRevenue > 0 ? Math.max(0, operatingProfit / totalRevenue) * 100 : 0;
  const marketPerformance = (marketSharePrimary * 0.7 + marketShareSecondary * 0.3);
  const marketingEffectiveness = overallSatisfaction;
  const investmentInFuture = totalRevenue > 0 ? Math.min(10, (rdExpense + distributionExpense) / totalRevenue * 100) : 0;
  const cumulativeInvestment = (team.total_investment || 5000000) + (prevResults?.totalInvestment || 0);
  const cumulativeProfit = (team.cumulative_profit || 0) + netIncome;
  const creationOfWealth = cumulativeInvestment > 0 ? (cumulativeProfit + cumulativeInvestment) / cumulativeInvestment : 0;

  // Normalized balanced scorecard (each component on 0-1 scale, then multiplied)
  const normFinancial = Math.min(1, Math.max(0, financialPerformance / 30)); // 30% profit margin = 1.0
  const normMarket = Math.min(1, marketPerformance);
  const normMarketing = Math.min(1, marketingEffectiveness);
  const normInvestment = Math.min(1, investmentInFuture / 5); // 5% of revenue = 1.0
  const normWealth = Math.min(1.5, Math.max(0, creationOfWealth));

  const balancedScorecard = (normFinancial * normMarket * normMarketing * normInvestment * normWealth) * 100;

  return {
    totalDemand,
    unitsSold: totalUnitsSold,
    unitsProduced: totalUnitsSold, // Simplified: produce to demand
    stockouts: 0,
    marketSharePrimary,
    marketShareSecondary,
    revenue: Math.round(totalRevenue),
    costOfGoods: Math.round(totalCOGS),
    grossProfit: Math.round(grossProfit),
    advertisingExpense: Math.round(advertisingExpense),
    salesforceExpense: Math.round(salesforceExpense),
    distributionExpense: Math.round(distributionExpense),
    internetExpense: Math.round(internetExpense),
    rdExpense: Math.round(rdExpense),
    adminExpense: Math.round(adminExpense),
    operatingProfit: Math.round(operatingProfit),
    netIncome: Math.round(netIncome),
    cashFlow: Math.round(cashFlow),
    endingCash: Math.round(endingCash),
    brandSatisfaction: Math.round(brandSatisfaction * 1000) / 1000,
    adSatisfaction: Math.round(adSatisfaction * 1000) / 1000,
    priceSatisfaction: Math.round(priceSatisfaction * 1000) / 1000,
    overallSatisfaction: Math.round(overallSatisfaction * 1000) / 1000,
    financialPerformance: Math.round(financialPerformance * 100) / 100,
    marketPerformance: Math.round(marketPerformance * 1000) / 1000,
    marketingEffectiveness: Math.round(marketingEffectiveness * 1000) / 1000,
    investmentInFuture: Math.round(investmentInFuture * 100) / 100,
    creationOfWealth: Math.round(creationOfWealth * 1000) / 1000,
    balancedScorecard: Math.round(balancedScorecard * 1000) / 1000,
    demandBySegment
  };
}

function calculateTotalAdSpend(advertising, internet) {
  let total = 0;
  if (advertising) {
    for (const region of Object.values(advertising)) {
      total += region?.spend || 0;
    }
  }
  return total;
}

function calculateSalesforceExpense(salesforce) {
  let total = 0;
  if (salesforce) {
    for (const region of Object.values(salesforce)) {
      const count = region?.count || 0;
      const comp = region?.compensation || 30000;
      const training = region?.training || 0;
      total += count * comp + training;
    }
  }
  return total;
}

function calculateDistributionExpense(distribution) {
  let total = 0;
  if (distribution) {
    for (const region of Object.values(distribution)) {
      const outlets = region?.outlets || 0;
      const type = region?.type || 'retail';
      const costPerOutlet = type === 'showroom' ? 75000 : type === 'online' ? 25000 : 50000;
      total += outlets * costPerOutlet;
    }
  }
  return total;
}

function calculateInternetExpense(internet) {
  if (!internet) return 0;
  return (internet.webPages || 0) * 5000 + (internet.seo || 0) * 3000 + (internet.paidSearch || 0) * 8000 + (internet.socialMedia || 0) * 6000;
}

function calculateBrandSatisfaction(brandScores, segments) {
  if (!brandScores || brandScores.length === 0) return 0.3;
  let totalFit = 0;
  let count = 0;
  for (const bs of brandScores) {
    const targetSeg = segments.find(s => s.name === bs.brand.target_segment);
    if (targetSeg) {
      const fit = getBestBrandFit([bs], targetSeg);
      totalFit += fit?.score || 0;
      count++;
    }
  }
  return count > 0 ? Math.min(1, totalFit / count * 2) : 0.3;
}

function calculateAdSatisfaction(advertising, internet, revenue) {
  const totalSpend = calculateTotalAdSpend(advertising, internet) + calculateInternetExpense(internet);
  if (revenue <= 0) return 0.3;
  const ratio = totalSpend / revenue;
  // Ideal ad spend is 10-20% of revenue
  if (ratio >= 0.10 && ratio <= 0.20) return 0.9;
  if (ratio >= 0.05 && ratio <= 0.30) return 0.7;
  return 0.4;
}

function calculatePriceSatisfaction(pricing, segments, brandScores) {
  if (!brandScores || brandScores.length === 0) return 0.5;
  let totalSat = 0;
  let count = 0;
  for (const bs of brandScores) {
    const targetSeg = segments.find(s => s.name === bs.brand.target_segment);
    if (targetSeg) {
      totalSat += getPriceAttractiveness(pricing, bs.brand, targetSeg);
      count++;
    }
  }
  return count > 0 ? totalSat / count : 0.5;
}

function generateMarketResearch(teams, results, demandResults, segments, decisions, quarter) {
  const segmentDemands = {};
  const competitorPrices = {};
  const brandJudgments = {};

  for (const segment of segments) {
    segmentDemands[segment.name] = {};
    for (const region of ['latam', 'europe', 'apac']) {
      segmentDemands[segment.name][region] = demandResults[segment.name]?.[region]?.totalDemand || 0;
    }
  }

  for (const team of teams) {
    const d = decisions[team.id] || {};
    competitorPrices[team.name] = d.pricing || {};
    brandJudgments[team.name] = {
      brandSatisfaction: results[team.id]?.brandSatisfaction || 0,
      overallSatisfaction: results[team.id]?.overallSatisfaction || 0
    };
  }

  return {
    segmentDemands,
    competitorPrices,
    brandJudgments,
    adJudgments: {},
    marketTrends: {
      quarter,
      totalIndustryDemand: Object.values(results).reduce((s, r) => s + (r.totalDemand || 0), 0),
      averagePrice: Object.values(results).reduce((s, r) => s + (r.revenue || 0), 0) / Math.max(1, Object.values(results).reduce((s, r) => s + (r.unitsSold || 0), 0)),
      growthRate: segments.reduce((s, seg) => s + (seg.growth_rate || 0.05), 0) / segments.length
    }
  };
}

export function generateGameCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
