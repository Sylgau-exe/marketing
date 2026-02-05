const { requireInstructor, handleCors } = require('../../lib/auth');
const { GameDB, TeamDB, DecisionDB, ResultDB, MarketResearchDB, SegmentDB, BrandDB, EventDB } = require('../../lib/db');
const { processQuarter } = require('../../lib/simulation-engine');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  
  try {
    const user = await requireInstructor(req);
    if (!user) return res.status(401).json({ error: 'Instructor access required' });
    
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    const { gameId, force = false } = req.body;
    if (!gameId) return res.status(400).json({ error: 'Game ID is required' });
    
    const game = await GameDB.getWithTeams(gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (game.instructor_id !== user.id) return res.status(403).json({ error: 'Not your game' });
    
    if (game.status === 'completed') {
      return res.status(400).json({ error: 'Game is already completed' });
    }
    
    const currentQuarter = game.current_quarter;
    
    if (currentQuarter >= 8) {
      return res.status(400).json({ error: 'All 8 quarters have been played' });
    }
    
    // Start game if in setup
    if (game.status === 'setup') {
      await GameDB.updateStatus(gameId, 'active');
    }
    
    const teams = await TeamDB.findByGame(gameId);
    if (teams.length < 2) {
      return res.status(400).json({ error: 'At least 2 teams are needed to play' });
    }
    
    // Check all teams submitted (unless forced)
    if (!force) {
      const unsubmitted = teams.filter(t => !t.has_submitted);
      if (unsubmitted.length > 0 && currentQuarter > 0) {
        return res.status(400).json({ 
          error: 'Not all teams have submitted decisions',
          unsubmitted: unsubmitted.map(t => ({ id: t.id, name: t.name }))
        });
      }
    }
    
    // Gather all data for simulation
    const segments = await SegmentDB.getForGame(gameId);
    const allDecisions = [];
    const allBrands = [];
    
    for (const team of teams) {
      const decisions = await DecisionDB.findByTeamAndQuarter(team.id, currentQuarter);
      const brands = await BrandDB.findByTeam(team.id);
      
      allDecisions.push({
        teamId: team.id,
        teamName: team.name,
        cashBalance: parseFloat(team.cash_balance),
        decisions: decisions ? decisions.decisions : getDefaultDecisions(),
        brands: brands.filter(b => b.is_active)
      });
      
      allBrands.push(...brands.filter(b => b.is_active).map(b => ({
        ...b,
        teamId: team.id,
        teamName: team.name
      })));
    }
    
    // Run simulation engine
    const results = processQuarter({
      quarter: currentQuarter,
      teams: allDecisions,
      segments,
      allBrands,
      gameSettings: game.settings || {}
    });
    
    // Save results for each team
    for (const teamResult of results.teamResults) {
      // Get previous cumulative scorecard
      let prevCumulative = 0;
      let quartersPlayed = 0;
      if (currentQuarter > 0) {
        const prevResult = await ResultDB.findByTeamAndQuarter(teamResult.teamId, currentQuarter - 1);
        if (prevResult) {
          prevCumulative = parseFloat(prevResult.cumulative_scorecard || 0);
          quartersPlayed = currentQuarter;
        }
      }
      
      // Calculate cumulative balanced scorecard (average of last 4 quarters or all if < 4)
      const cumulativeScorecard = quartersPlayed > 0 
        ? ((prevCumulative * quartersPlayed) + teamResult.balancedScorecard) / (quartersPlayed + 1)
        : teamResult.balancedScorecard;
      
      await ResultDB.create({
        teamId: teamResult.teamId,
        quarter: currentQuarter,
        demandGenerated: teamResult.totalDemand,
        unitsSold: teamResult.unitsSold,
        stockouts: teamResult.stockouts,
        marketShare: JSON.stringify(teamResult.marketShare),
        revenue: teamResult.revenue,
        cogs: teamResult.cogs,
        marketingExpenses: teamResult.marketingExpenses,
        operatingExpenses: teamResult.operatingExpenses,
        netIncome: teamResult.netIncome,
        cashFlow: teamResult.cashFlow,
        endingCash: teamResult.endingCash,
        retainedEarnings: teamResult.retainedEarnings,
        brandSatisfaction: teamResult.brandSatisfaction,
        adSatisfaction: teamResult.adSatisfaction,
        priceSatisfaction: teamResult.priceSatisfaction,
        overallSatisfaction: teamResult.overallSatisfaction,
        financialPerformance: teamResult.scorecard.financial,
        marketPerformance: teamResult.scorecard.market,
        marketingEffectiveness: teamResult.scorecard.marketing,
        investmentFuture: teamResult.scorecard.investment,
        wealthCreation: teamResult.scorecard.wealth,
        balancedScorecard: teamResult.balancedScorecard,
        cumulativeScorecard: cumulativeScorecard,
        details: teamResult.details || {}
      });
      
      // Update team financials
      await TeamDB.updateFinancials(teamResult.teamId, {
        cashBalance: teamResult.endingCash,
        cumulativeProfit: teamResult.retainedEarnings
      });
    }
    
    // Save market research
    await MarketResearchDB.save({
      gameId,
      quarter: currentQuarter,
      segmentDemands: results.marketResearch.segmentDemands,
      competitorPrices: results.marketResearch.competitorPrices,
      brandJudgments: results.marketResearch.brandJudgments,
      marketTrends: results.marketResearch.marketTrends
    });
    
    // Advance quarter
    await GameDB.advanceQuarter(gameId);
    await GameDB.resetTeamSubmissions(gameId);
    
    // Check if game is complete
    if (currentQuarter >= 7) {
      await GameDB.updateStatus(gameId, 'completed');
    }
    
    // Log event
    await EventDB.log({
      gameId,
      eventType: 'quarter_processed',
      description: `Quarter ${currentQuarter} processed successfully`,
      data: {
        quarter: currentQuarter,
        teamCount: teams.length,
        processedBy: user.id
      }
    });
    
    res.json({
      success: true,
      quarterProcessed: currentQuarter,
      nextQuarter: currentQuarter + 1,
      gameStatus: currentQuarter >= 7 ? 'completed' : 'active',
      summary: results.teamResults.map(r => ({
        teamId: r.teamId,
        teamName: r.teamName,
        revenue: r.revenue,
        netIncome: r.netIncome,
        balancedScorecard: r.balancedScorecard
      }))
    });
  } catch (error) {
    console.error('Advance quarter error:', error);
    res.status(500).json({ error: 'Failed to process quarter: ' + error.message });
  }
};

function getDefaultDecisions() {
  return {
    pricing: {},
    advertising: { LATAM: 50000, EUROPE: 50000, APAC: 50000 },
    internet_marketing: { seo: 10000, sem: 10000, social: 10000 },
    salesforce: { LATAM: { count: 2, salary: 40000 }, EUROPE: { count: 2, salary: 45000 }, APAC: { count: 2, salary: 35000 } },
    distribution: { LATAM: { outlets: 1 }, EUROPE: { outlets: 1 }, APAC: { outlets: 1 } },
    rd_budget: 100000,
    rd_projects: [],
    production: {},
    dividend: 0
  };
}
