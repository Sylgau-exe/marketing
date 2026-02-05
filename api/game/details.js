const { requireAuth, handleCors } = require('../../lib/auth');
const { GameDB, TeamDB, TeamMemberDB, SegmentDB, ResultDB } = require('../../lib/db');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  
  try {
    const user = await requireAuth(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Game ID is required' });
    
    const game = await GameDB.getWithTeams(id);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    
    // Check user has access (instructor or player)
    const isInstructor = game.instructor_id === user.id;
    let userTeam = null;
    
    const teams = await TeamDB.findByGame(id);
    const teamsWithMembers = [];
    
    for (const team of teams) {
      const members = await TeamMemberDB.findByTeam(team.id);
      const isMember = members.some(m => m.user_id === user.id);
      if (isMember) userTeam = { ...team, role: members.find(m => m.user_id === user.id).role };
      
      teamsWithMembers.push({
        id: team.id,
        name: team.name,
        logoEmoji: team.logo_emoji,
        cashBalance: isInstructor || isMember ? team.cash_balance : undefined,
        hasSubmitted: team.has_submitted,
        memberCount: members.length,
        members: members.map(m => ({
          userId: m.user_id,
          name: m.first_name + ' ' + m.last_name,
          role: m.role
        }))
      });
    }
    
    if (!isInstructor && !userTeam) {
      return res.status(403).json({ error: 'You do not have access to this game' });
    }
    
    // Get segments
    const segments = await SegmentDB.getForGame(id);
    
    // Get latest results if quarter > 0
    let latestResults = null;
    if (game.current_quarter > 0 && userTeam) {
      latestResults = await ResultDB.findByTeamAndQuarter(userTeam.id, game.current_quarter - 1);
    }
    
    // Get leaderboard (balanced scorecards) - visible to all
    let leaderboard = [];
    if (game.current_quarter > 1) {
      for (const team of teams) {
        const result = await ResultDB.findByTeamAndQuarter(team.id, game.current_quarter - 1);
        if (result) {
          leaderboard.push({
            teamId: team.id,
            teamName: team.name,
            logoEmoji: team.logo_emoji,
            balancedScorecard: result.balanced_scorecard,
            cumulativeScorecard: result.cumulative_scorecard || result.balanced_scorecard
          });
        }
      }
      leaderboard.sort((a, b) => (b.cumulativeScorecard || 0) - (a.cumulativeScorecard || 0));
    }
    
    res.json({
      game: {
        id: game.id,
        code: game.code,
        name: game.name,
        status: game.status,
        currentQuarter: game.current_quarter,
        maxTeams: game.max_teams,
        quarterDeadline: game.quarter_deadline,
        settings: game.settings,
        isInstructor
      },
      teams: teamsWithMembers,
      userTeam: userTeam ? {
        id: userTeam.id,
        name: userTeam.name,
        role: userTeam.role,
        cashBalance: userTeam.cash_balance,
        hasSubmitted: userTeam.has_submitted
      } : null,
      segments: segments.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        preferences: s.preference_weights,
        potentialDemand: s.potential_demand,
        priceRange: { min: s.price_range_min, max: s.price_range_max },
        growthRate: s.growth_rate
      })),
      leaderboard,
      latestResults: latestResults ? {
        quarter: latestResults.quarter,
        demand: latestResults.demand_generated,
        unitsSold: latestResults.units_sold,
        revenue: latestResults.revenue,
        netIncome: latestResults.net_income,
        marketShare: latestResults.market_share,
        balancedScorecard: latestResults.balanced_scorecard
      } : null
    });
  } catch (error) {
    console.error('Game details error:', error);
    res.status(500).json({ error: 'Failed to get game details' });
  }
};
