// api/game/details.js - Get full game details for simulation page
import { requireAuth, cors } from '../../lib/auth.js';
import { GameDB, TeamDB, TeamMemberDB, SegmentDB, ResultDB, BrandDB } from '../../lib/db.js';

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

    const isInstructor = game.instructor_id === decoded.userId;
    const teams = await TeamDB.findByGame(gameId);
    const teamsWithMembers = [];
    let userTeam = null;

    for (const team of teams) {
      const members = await TeamMemberDB.findByTeam(team.id);
      const isMember = members.some(m => m.user_id === decoded.userId);
      if (isMember) {
        const memberRecord = members.find(m => m.user_id === decoded.userId);
        userTeam = { ...team, role: memberRecord.role };
      }
      teamsWithMembers.push({
        id: team.id, name: team.name, logoEmoji: team.logo_emoji,
        cashBalance: (isInstructor || isMember) ? team.cash_balance : undefined,
        hasSubmitted: team.has_submitted, memberCount: members.length,
        members: members.map(m => ({ userId: m.user_id, name: m.name || 'Unknown', role: m.role }))
      });
    }

    if (!isInstructor && !userTeam) {
      return res.status(403).json({ error: 'You do not have access to this game' });
    }

    let brands = [];
    if (userTeam) { try { brands = await BrandDB.findByTeam(userTeam.id); } catch (e) {} }

    let segments = [];
    try { segments = await SegmentDB.getForGame(gameId); } catch (e) {}

    let latestResults = null;
    if (game.current_quarter > 0 && userTeam) {
      try { latestResults = await ResultDB.findByTeamAndQuarter(userTeam.id, game.current_quarter - 1); } catch (e) {}
    }

    let leaderboard = [];
    if (game.current_quarter > 1) {
      for (const team of teams) {
        try {
          const result = await ResultDB.findByTeamAndQuarter(team.id, game.current_quarter - 1);
          if (result) leaderboard.push({ teamId: team.id, teamName: team.name, logoEmoji: team.logo_emoji, balancedScorecard: result.balanced_scorecard, cumulativeScorecard: result.cumulative_scorecard || result.balanced_scorecard });
        } catch (e) {}
      }
      leaderboard.sort((a, b) => (b.cumulativeScorecard || 0) - (a.cumulativeScorecard || 0));
    }

    res.json({
      game: { id: game.id, code: game.code, name: game.name, status: game.status, current_quarter: game.current_quarter, instructor_id: game.instructor_id, max_teams: game.max_teams, quarter_deadline: game.quarter_deadline, settings: game.settings },
      team: userTeam ? { id: userTeam.id, name: userTeam.name, logo_emoji: userTeam.logo_emoji, role: userTeam.role, cash_balance: userTeam.cash_balance, has_submitted: userTeam.has_submitted } : null,
      brands: brands.map(b => ({ id: b.id, name: b.name, target_segment: b.target_segment, frame_quality: b.frame_quality, wheels_quality: b.wheels_quality, drivetrain_quality: b.drivetrain_quality, brakes_quality: b.brakes_quality, suspension_quality: b.suspension_quality, seat_quality: b.seat_quality, handlebars_quality: b.handlebars_quality, electronics_quality: b.electronics_quality, overall_quality: b.overall_quality, unit_cost: b.unit_cost })),
      teams: teamsWithMembers, segments, leaderboard,
      latestResults: latestResults ? { quarter: latestResults.quarter, demand: latestResults.total_demand, unitsSold: latestResults.units_sold, revenue: parseFloat(latestResults.revenue), netIncome: parseFloat(latestResults.net_income), marketShare: latestResults.market_share_primary, balancedScorecard: latestResults.balanced_scorecard } : null
    });
  } catch (error) {
    console.error('Game details error:', error);
    res.status(500).json({ error: 'Failed to get game details' });
  }
}
