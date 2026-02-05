const { requireAuth, handleCors } = require('../../lib/auth');
const { GameDB, TeamMemberDB } = require('../../lib/db');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  
  try {
    const user = await requireAuth(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    
    // Get games where user is instructor
    const instructorGames = user.is_instructor ? await GameDB.findByInstructor(user.id) : [];
    
    // Get games where user is a player
    const playerGames = await TeamMemberDB.getUserGames(user.id);
    
    res.json({
      instructorGames: instructorGames.map(g => ({
        id: g.id,
        code: g.code,
        name: g.name,
        status: g.status,
        currentQuarter: g.current_quarter,
        maxTeams: g.max_teams,
        teamCount: parseInt(g.team_count || 0),
        createdAt: g.created_at
      })),
      playerGames: playerGames.map(g => ({
        id: g.game_id,
        code: g.code,
        name: g.game_name || g.name,
        status: g.status,
        currentQuarter: g.current_quarter,
        teamId: g.team_id,
        teamName: g.team_name,
        role: g.role,
        cashBalance: g.cash_balance
      }))
    });
  } catch (error) {
    console.error('List games error:', error);
    res.status(500).json({ error: 'Failed to list games' });
  }
};
