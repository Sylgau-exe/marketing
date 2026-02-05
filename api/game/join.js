const { requireAuth, handleCors } = require('../../lib/auth');
const { GameDB, TeamDB, TeamMemberDB } = require('../../lib/db');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  
  try {
    const user = await requireAuth(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    const { gameCode, teamName, teamId, role = 'member', logoEmoji = '🚴' } = req.body;
    
    if (!gameCode) return res.status(400).json({ error: 'Game code is required' });
    
    // Find game by code
    const game = await GameDB.findByCode(gameCode.toUpperCase().trim());
    if (!game) return res.status(404).json({ error: 'Game not found. Check the code and try again.' });
    
    if (game.status === 'completed') {
      return res.status(400).json({ error: 'This game has already ended' });
    }
    
    // Check if user is already in this game
    const existingTeams = await TeamDB.findByGame(game.id);
    for (const team of existingTeams) {
      const members = await TeamMemberDB.findByTeam(team.id);
      if (members.some(m => m.user_id === user.id)) {
        return res.status(400).json({ 
          error: 'You are already in this game',
          team: { id: team.id, name: team.name }
        });
      }
    }
    
    let team;
    
    if (teamId) {
      // Join existing team
      team = existingTeams.find(t => t.id === teamId);
      if (!team) return res.status(404).json({ error: 'Team not found in this game' });
      
      const members = await TeamMemberDB.findByTeam(team.id);
      if (members.length >= 5) {
        return res.status(400).json({ error: 'This team is full (max 5 members)' });
      }
    } else if (teamName) {
      // Create new team
      if (existingTeams.length >= game.max_teams) {
        return res.status(400).json({ error: `Maximum ${game.max_teams} teams allowed in this game` });
      }
      
      if (teamName.length < 2 || teamName.length > 40) {
        return res.status(400).json({ error: 'Team name must be 2-40 characters' });
      }
      
      if (existingTeams.some(t => t.name.toLowerCase() === teamName.toLowerCase())) {
        return res.status(400).json({ error: 'A team with this name already exists' });
      }
      
      team = await TeamDB.create({
        gameId: game.id,
        name: teamName,
        logoEmoji: logoEmoji || '🚴'
      });
    } else {
      return res.status(400).json({ error: 'Provide either teamName (to create) or teamId (to join)' });
    }
    
    // Add member
    const memberRole = teamId ? role : 'president'; // Creator becomes president
    await TeamMemberDB.add(team.id, user.id, memberRole);
    
    const members = await TeamMemberDB.findByTeam(team.id);
    
    res.json({
      success: true,
      game: {
        id: game.id,
        code: game.code,
        name: game.name,
        status: game.status,
        currentQuarter: game.current_quarter
      },
      team: {
        id: team.id,
        name: team.name,
        logoEmoji: team.logo_emoji,
        members: members.map(m => ({
          userId: m.user_id,
          name: m.first_name + ' ' + m.last_name,
          email: m.email,
          role: m.role
        }))
      }
    });
  } catch (error) {
    console.error('Join game error:', error);
    res.status(500).json({ error: 'Failed to join game' });
  }
};
