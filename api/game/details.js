// api/game/details.js - Get solo simulation details
import { requireAuth, cors } from '../../lib/auth.js';
import { GameDB, TeamDB, SegmentDB, ResultDB, BrandDB } from '../../lib/db.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const decoded = await requireAuth(req, res);
  if (!decoded) return;

  try {
    const gameId = req.query.game_id || req.query.id;
    if (!gameId) return res.status(400).json({ error: 'Game ID is required' });

    const game = await GameDB.findById(gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    // Solo mode: check if user owns this game
    if (String(game.user_id) !== String(decoded.userId) && !decoded.isAdmin) {
      return res.status(403).json({ error: 'You do not have access to this simulation' });
    }

    // Get all teams
    const teams = await TeamDB.findByGame(gameId);
    const playerTeam = teams.find(t => !t.is_ai);
    const aiTeams = teams.filter(t => t.is_ai);

    if (!playerTeam) {
      return res.status(404).json({ error: 'Player team not found' });
    }

    // Get player brands
    let brands = [];
    try { brands = await BrandDB.findByTeam(playerTeam.id); } catch (e) {}

    // Get segments
    let segments = [];
    try { segments = await SegmentDB.getForGame(gameId); } catch (e) {}

    // Get latest results for player
    let latestResults = null;
    if (game.current_quarter > 1) {
      try {
        latestResults = await ResultDB.findByTeamAndQuarter(playerTeam.id, game.current_quarter - 1);
      } catch (e) {}
    }

    // Build competitor info (AI teams with limited visibility)
    const competitors = [];
    for (const aiTeam of aiTeams) {
      const comp = { id: aiTeam.id, name: aiTeam.name, logoEmoji: aiTeam.logo_emoji };
      // Show AI results after Q1 (market research)
      if (game.current_quarter > 1) {
        try {
          const aiResult = await ResultDB.findByTeamAndQuarter(aiTeam.id, game.current_quarter - 1);
          if (aiResult) {
            comp.marketShare = aiResult.market_share_primary;
            comp.revenue = parseFloat(aiResult.total_revenue || aiResult.revenue || 0);
            comp.balancedScorecard = aiResult.balanced_scorecard;
          }
        } catch (e) {}
      }
      competitors.push(comp);
    }

    // Leaderboard (player + AI)
    let leaderboard = [];
    if (game.current_quarter > 1) {
      for (const team of teams) {
        try {
          const result = await ResultDB.findByTeamAndQuarter(team.id, game.current_quarter - 1);
          if (result) {
            leaderboard.push({
              teamName: team.name, logoEmoji: team.logo_emoji,
              isPlayer: !team.is_ai,
              balancedScorecard: result.balanced_scorecard,
              revenue: parseFloat(result.total_revenue || result.revenue || 0),
              marketShare: result.market_share_primary
            });
          }
        } catch (e) {}
      }
      leaderboard.sort((a, b) => (b.balancedScorecard || 0) - (a.balancedScorecard || 0));
    }

    res.json({
      game: {
        id: game.id, name: game.name, status: game.status,
        current_quarter: game.current_quarter, market_scenario: game.market_scenario, settings: game.settings
      },
      team: {
        id: playerTeam.id, name: playerTeam.name,
        logo_emoji: playerTeam.logo_emoji,
        cash_balance: playerTeam.cash_balance,
        has_submitted: playerTeam.has_submitted
      },
      brands: brands.map(b => ({
        id: b.id, name: b.name, target_segment: b.target_segment,
        frame_quality: b.frame_quality, wheels_quality: b.wheels_quality,
        drivetrain_quality: b.drivetrain_quality, brakes_quality: b.brakes_quality,
        suspension_quality: b.suspension_quality, seat_quality: b.seat_quality,
        handlebars_quality: b.handlebars_quality, electronics_quality: b.electronics_quality,
        overall_quality: b.overall_quality, unit_cost: b.unit_cost
      })),
      segments, competitors, leaderboard,
      latestResults: latestResults ? {
        quarter: latestResults.quarter,
        demand: latestResults.total_demand, unitsSold: latestResults.units_sold || latestResults.total_units_sold,
        revenue: parseFloat(latestResults.total_revenue || latestResults.revenue || 0),
        netIncome: parseFloat(latestResults.net_income || 0),
        marketShare: latestResults.market_share_primary,
        balancedScorecard: latestResults.balanced_scorecard
      } : null
    });
  } catch (error) {
    console.error('Game details error:', error);
    res.status(500).json({ error: 'Failed to get game details' });
  }
}
