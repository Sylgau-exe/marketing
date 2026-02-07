// lib/simulation-engine.js - Core simulation logic for MarketSim Live
// Inspired by Marketplace Simulations: Advanced Strategic Marketing — Bikes

/**
 * Process a complete quarter for all teams in a game.
 * This is the heart of the simulation.
 */
export function processQuarter(gameState) {
  const { quarter, teams, segments, decisions, previousResults } = gameState;
  const results = {};
  const _engineDebug = [];

  for (const team of teams) {
    const d = decisions[team.id];
    const dk = decisions[String(team.id)];
  }

  // Phase 1: Calculate brand quality scores for each team's brands
  const allBrands = {};
  for (const team of teams) {
    allBrands[team.id] = calculateBrandScores(team.brands, segments);
  }

  // Phase 2: (individual marketing factors calculated inline in Phase 3)

  // Phase 3: Compute demand and market share for each segment/region
  const regions = ['latam', 'europe', 'apac'];
  const demandResults = {};

  for (const segment of segments) {
    demandResults[segment.name] = {};
    for (const region of regions) {
      const potentialKey = `potential_demand_${region}`;
      const basePotential = parseFloat(segment[potentialKey] || 1000);
      // Demand grows each quarter
      const growthMultiplier = 1 + parseFloat(segment.growth_rate || 0.05) * (quarter - 1);
      // Seasonal adjustment: Q1/Q3 are peak (spring/fall)
      const seasonality = [1.0, 1.2, 0.8, 1.1, 1.3, 0.9, 1.15, 1.25][quarter - 1] || 1.0;
      const adjustedPotential = Math.round(basePotential * growthMultiplier * seasonality);

      // Calculate each team's pull on this segment/region
      const teamPulls = {};
      let totalPull = 0;

      for (const team of teams) {
        const d = decisions[team.id] || decisions[String(team.id)] || getDefaultDecisions();
        const brands = allBrands[team.id] || allBrands[String(team.id)] || [];

        // Does this team target this segment/region?
        const targeting = getTargetingStrength(d, segment.name, region, brands);
        
        // Capture debug for first segment/region combo
        const debugEntry = {
          team: team.id, teamIdType: typeof team.id,
          segment: segment.name, region,
          decFound: !!decisions[team.id], decFoundStr: !!decisions[String(team.id)],
          decIsDefault: !decisions[team.id] && !decisions[String(team.id)],
          brandsCount: brands.length,
          brandTargets: brands.map(b => b.brand?.target_segment || 'none'),
          distForRegion: JSON.stringify(d.distribution?.[region]),
          distKeys: Object.keys(d.distribution || {}),
          targeting
        };

        if (targeting <= 0) {
          debugEntry.skip = true;
          debugEntry.distRaw = JSON.stringify(d.distribution?.[region]);
          _engineDebug.push(debugEntry);
          continue;
        }

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
        const rawPull = targeting * (brandFit?.score || 0.5) * priceAttractiveness * adReach * salesEffectiveness * distributionCoverage;
        const pull = isNaN(rawPull) ? 0 : rawPull;

        debugEntry.brandFitScore = brandFit?.score || 0;
        debugEntry.brandFitName = brandFit?.brand?.name || 'none';
        debugEntry.priceAttractiveness = priceAttractiveness;
        debugEntry.priceUsed = brandFit?.brand?.name ? (d.pricing?.[brandFit.brand.name] || 'missing') : 'noBrand';
        debugEntry.segMinPrice = segment.min_price;
        debugEntry.segMaxPrice = segment.max_price;
        debugEntry.adReach = adReach;
        debugEntry.salesEffectiveness = salesEffectiveness;
        debugEntry.distributionCoverage = distributionCoverage;
        debugEntry.pull = pull;
        _engineDebug.push(debugEntry);

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
      const demandCreation = Math.min(1.5, (isNaN(totalPull) ? 0 : totalPull) / Math.max(1, teams.length * 0.3));
      const totalDemand = Math.round((isNaN(adjustedPotential) ? 0 : adjustedPotential) * demandCreation);
      

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

  // Phase 3 summary log
  const demandSummary = {};
  for (const seg of segments) {
    demandSummary[seg.name] = {};
    for (const r of regions) {
      demandSummary[seg.name][r] = demandResults[seg.name]?.[r]?.totalDemand || 0;
    }
  }
  console.log('Phase 3 demand summary:', JSON.stringify(demandSummary));

  // Phase 4: Aggregate results per team
  for (const team of teams) {
    const d = decisions[team.id] || decisions[String(team.id)] || getDefaultDecisions();
    const prev = previousResults?.[team.id];
    const teamResult = computeTeamResults(team, d, allBrands[team.id] || allBrands[String(team.id)] || [], demandResults, segments, regions, quarter, prev);
    results[team.id] = teamResult;
  }

  // Phase 5: Generate market research data
  const marketResearch = generateMarketResearch(teams, results, demandResults, segments, decisions, quarter);

  return { results, marketResearch, demandResults, _engineDebug };
}

function getDefaultDecisions() {
  return { pricing: {}, advertising: {}, internet: {}, salesforce: {}, distribution: {}, rdBudget: 0, rdProjects: {}, production: {}, dividend: 0 };
}

function calculateBrandScores(brands, segments) {
  return (brands || []).map(brand => {
    const qualities = {
      frame: parseFloat(brand.frame_quality || 3),
      wheels: parseFloat(brand.wheels_quality || 3),
      drivetrain: parseFloat(brand.drivetrain_quality || 3),
      brakes: parseFloat(brand.brakes_quality || 3),
      suspension: parseFloat(brand.suspension_quality || 3),
      seat: parseFloat(brand.seat_quality || 3),
      handlebars: parseFloat(brand.handlebars_quality || 3),
      electronics: parseFloat(brand.electronics_quality || 0)
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
      (bs.scores.performance || 0) * parseFloat(segment.performance_weight || 0.1) +
      (bs.scores.durability || 0) * parseFloat(segment.durability_weight || 0.1) +
      (bs.scores.style || 0) * parseFloat(segment.style_weight || 0.1) +
      (bs.scores.comfort || 0) * parseFloat(segment.comfort_weight || 0.1) +
      (bs.scores.lightweight || 0) * parseFloat(segment.lightweight_weight || 0.1) +
      (bs.scores.customization || 0) * parseFloat(segment.customization_weight || 0.1);

    if (fit > bestScore) {
      bestScore = fit;
      best = { ...bs, score: fit };
    }
  }

  // Also check non-targeted brands with a penalty
  if (!best) {
    for (const bs of brandScores) {
      const fit = (
        (bs.scores.performance || 0) * parseFloat(segment.performance_weight || 0.1) +
        (bs.scores.durability || 0) * parseFloat(segment.durability_weight || 0.1) +
        (bs.scores.style || 0) * parseFloat(segment.style_weight || 0.1) +
        (bs.scores.comfort || 0) * parseFloat(segment.comfort_weight || 0.1) +
        (bs.scores.lightweight || 0) * parseFloat(segment.lightweight_weight || 0.1) +
        (bs.scores.customization || 0) * parseFloat(segment.customization_weight || 0.1)
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

  const price = parseFloat(pricing[brand.name] || pricing.default || 1000);
  const minPrice = parseFloat(segment.min_price || 500);
  const maxPrice = parseFloat(segment.max_price || 1500);
  const idealPrice = (minPrice + maxPrice) / 2;
  const priceSensitivity = parseFloat(segment.price_sensitivity || 0.15);


  // Price within range gets base score; further from ideal = lower score
  if (price < minPrice * 0.7 || price > maxPrice * 1.5) {
    return 0.1;
  }

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
  const regionalSpend = parseFloat(ad[region]?.spend || 0);
  const targetedAds = ad[region]?.targetSegment === segmentName ? 1.3 : 1.0;

  // Internet marketing
  const webPages = parseFloat(inet.webPages || 0);
  const seo = parseFloat(inet.seo || 0);
  const paidSearch = parseFloat(inet.paidSearch || 0);
  const socialMedia = parseFloat(inet.socialMedia || 0);
  const internetTotal = webPages * 200 + seo * 150 + paidSearch * 300 + socialMedia * 250;

  // Diminishing returns on ad spend
  const totalSpend = regionalSpend + internetTotal / 3; // Internet spread across regions
  const adEffectiveness = Math.min(1.0, Math.sqrt(totalSpend / 500000)) * targetedAds;

  // Minimum baseline even without ads (word of mouth)
  return Math.max(0.15, Math.min(1.2, adEffectiveness));
}

function getSalesEffectiveness(salesforce, region) {
  const sf = salesforce || {};
  const headcount = parseInt(sf[region]?.count || 0);
  const compensation = parseFloat(sf[region]?.compensation || 30000);
  const training = parseFloat(sf[region]?.training || 0);

  if (headcount === 0) return 0.1; // Minimal organic sales

  // More salespeople = better, with diminishing returns
  const coverageScore = Math.min(1.0, Math.sqrt(headcount / 10));

  // Better compensation and training = more effective
  const qualityMultiplier = 0.7 + (compensation / 60000) * 0.2 + (training / 10000) * 0.1;

  return Math.min(1.2, coverageScore * qualityMultiplier);
}

function getDistribution(distribution, region) {
  const dist = distribution || {};
  const outlets = parseInt(dist[region]?.outlets || 0);
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
      const demand = Math.round((dr.totalDemand || 0) * (isNaN(share) ? 0 : share));
      totalDemand += isNaN(demand) ? 0 : demand;
      demandBySegment[segment.name] += isNaN(demand) ? 0 : demand;

      // Revenue from this segment/region
      const brandFit = dr.teamPulls?.[team.id]?.brandFit;
      const price = parseFloat(brandFit ? (decisions.pricing?.[brandFit.brand.name] || decisions.pricing?.default || 900) : 900) || 900;
      const unitCost = parseFloat(brandFit ? (brandFit.brand.unit_cost || 400) : 400) || 400;
      const safeDemand = isNaN(demand) ? 0 : demand;

      totalUnitsSold += safeDemand;
      totalRevenue += safeDemand * price;
      totalCOGS += safeDemand * unitCost;
    }
  }

  // Calculate expenses (with NaN guards on every value)
  const _safe = v => (isNaN(v) || !isFinite(v)) ? 0 : v;
  const advertisingExpense = _safe(calculateTotalAdSpend(decisions.advertising, decisions.internet));
  const salesforceExpense = _safe(calculateSalesforceExpense(decisions.salesforce));
  const distributionExpense = _safe(calculateDistributionExpense(decisions.distribution));
  const internetExpense = _safe(calculateInternetExpense(decisions.internet));
  const rdExpense = _safe(parseFloat(decisions.rdBudget || 0));
  const adminExpense = _safe(Math.round(_safe(totalRevenue) * 0.05 + 15000)); // 5% of revenue + fixed quarterly overhead

  const grossProfit = _safe(totalRevenue) - _safe(totalCOGS);
  const totalExpenses = _safe(advertisingExpense + salesforceExpense + distributionExpense + internetExpense + rdExpense + adminExpense);
  const operatingProfit = _safe(grossProfit - totalExpenses);
  const netIncome = _safe(Math.round(operatingProfit * 0.75)); // 25% tax rate

  // Cash flow (with NaN guards — parseFloat for Postgres DECIMAL strings)
  const prevCash = _safe(parseFloat(prevResults?.endingCash)) || _safe(parseFloat(team.cash_balance)) || 5000000;
  const dividend = _safe(parseFloat(decisions.dividend) || 0);
  const cashFlow = _safe(netIncome - dividend);
  const endingCash = _safe(prevCash + cashFlow);

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

  // Balanced Scorecard (weighted additive model — more forgiving and educational)
  const financialPerformance = totalRevenue > 0 ? operatingProfit / totalRevenue * 100 : -10;
  const marketPerformance = (marketSharePrimary * 0.7 + marketShareSecondary * 0.3);
  const marketingEffectiveness = overallSatisfaction;
  const investmentInFuture = totalRevenue > 0 ? Math.min(10, (rdExpense + distributionExpense) / totalRevenue * 100) : (rdExpense + distributionExpense > 0 ? 2 : 0);
  const cumulativeInvestment = parseFloat(team.total_investment || 5000000) + parseFloat(prevResults?.totalInvestment || 0);
  const cumulativeProfit = parseFloat(team.cumulative_profit || 0) + netIncome;
  const creationOfWealth = cumulativeInvestment > 0 ? (cumulativeProfit + cumulativeInvestment) / cumulativeInvestment : 0;

  // Normalized components (0-1 scale, but financial allows negative for losses)
  const normFinancial = Math.min(1, Math.max(-0.5, financialPerformance / 30)); // 30% margin = 1.0, losses go negative
  const normMarket = Math.min(1, Math.max(0, marketPerformance));
  const normMarketing = Math.min(1, Math.max(0, marketingEffectiveness));
  const normInvestment = Math.min(1, Math.max(0, investmentInFuture / 5)); // 5% of revenue = 1.0
  const normWealth = Math.min(1.5, Math.max(-0.5, creationOfWealth));

  // Weighted additive scorecard: financial 30%, market 25%, marketing 20%, investment 10%, wealth 15%
  const rawScore = (normFinancial * 30 + normMarket * 25 + normMarketing * 20 + normInvestment * 10 + normWealth * 15);
  const balancedScorecard = Math.max(0, Math.min(100, isNaN(rawScore) ? 0 : rawScore));

  // Helper to sanitize NaN
  const safe = v => isNaN(v) || !isFinite(v) ? 0 : v;

  return {
    totalDemand: safe(totalDemand),
    unitsSold: safe(totalUnitsSold),
    unitsProduced: safe(totalUnitsSold),
    stockouts: 0,
    marketSharePrimary: safe(marketSharePrimary),
    marketShareSecondary: safe(marketShareSecondary),
    revenue: safe(Math.round(totalRevenue)),
    costOfGoods: safe(Math.round(totalCOGS)),
    grossProfit: safe(Math.round(grossProfit)),
    advertisingExpense: safe(Math.round(advertisingExpense)),
    salesforceExpense: safe(Math.round(salesforceExpense)),
    distributionExpense: safe(Math.round(distributionExpense)),
    internetExpense: safe(Math.round(internetExpense)),
    rdExpense: safe(Math.round(rdExpense)),
    adminExpense: safe(Math.round(adminExpense)),
    totalExpenses: safe(Math.round(totalExpenses)),
    operatingProfit: safe(Math.round(operatingProfit)),
    netIncome: safe(Math.round(netIncome)),
    beginningCash: safe(Math.round(prevCash)),
    cashFlow: safe(Math.round(cashFlow)),
    endingCash: safe(Math.round(endingCash)),
    brandSatisfaction: safe(Math.round(brandSatisfaction * 1000) / 1000),
    adSatisfaction: safe(Math.round(adSatisfaction * 1000) / 1000),
    priceSatisfaction: safe(Math.round(priceSatisfaction * 1000) / 1000),
    overallSatisfaction: safe(Math.round(overallSatisfaction * 1000) / 1000),
    financialPerformance: safe(Math.round(financialPerformance * 100) / 100),
    marketPerformance: safe(Math.round(marketPerformance * 1000) / 1000),
    marketingEffectiveness: safe(Math.round(marketingEffectiveness * 1000) / 1000),
    investmentInFuture: safe(Math.round(investmentInFuture * 100) / 100),
    creationOfWealth: safe(Math.round(creationOfWealth * 1000) / 1000),
    balancedScorecard: safe(Math.round(balancedScorecard * 1000) / 1000),
    demandBySegment
  };
}

function calculateTotalAdSpend(advertising, internet) {
  let total = 0;
  if (advertising) {
    for (const region of Object.values(advertising)) {
      total += parseFloat(region?.spend || 0);
    }
  }
  return total;
}

function calculateSalesforceExpense(salesforce) {
  let total = 0;
  if (salesforce) {
    for (const region of Object.values(salesforce)) {
      const count = parseInt(region?.count || 0);
      const annualComp = parseFloat(region?.compensation || 30000);
      const training = parseFloat(region?.training || 0);
      // Quarterly cost: annual compensation / 4
      total += count * (annualComp / 4) + training;
    }
  }
  return total;
}

function calculateDistributionExpense(distribution) {
  let total = 0;
  if (distribution) {
    for (const region of Object.values(distribution)) {
      const outlets = parseInt(region?.outlets || 0);
      const type = region?.type || 'retail';
      // Annual cost per outlet, divided by 4 for quarterly
      const annualCostPerOutlet = type === 'showroom' ? 75000 : type === 'online' ? 25000 : 50000;
      total += outlets * (annualCostPerOutlet / 4);
    }
  }
  return total;
}

function calculateInternetExpense(internet) {
  if (!internet) return 0;
  return parseFloat(internet.webPages || 0) * 5000 + parseFloat(internet.seo || 0) * 3000 + parseFloat(internet.paidSearch || 0) * 8000 + parseFloat(internet.socialMedia || 0) * 6000;
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
