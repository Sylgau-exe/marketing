const { requireAuth, handleCors } = require('../../lib/auth');
const { GameDB, TeamMemberDB, DecisionDB } = require('../../lib/db');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  
  try {
    const user = await requireAuth(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    
    const { gameId, teamId, quarter } = req.query;
    if (!gameId || !teamId) return res.status(400).json({ error: 'Game ID and Team ID required' });
    
    // Verify access
    const members = await TeamMemberDB.findByTeam(teamId);
    if (!members.some(m => m.user_id === user.id)) {
      return res.status(403).json({ error: 'You are not on this team' });
    }
    
    const game = await GameDB.getWithTeams(gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    
    const q = quarter !== undefined ? parseInt(quarter) : game.current_quarter;
    const decisions = await DecisionDB.findByTeamAndQuarter(teamId, q);
    
    res.json({
      quarter: q,
      currentQuarter: game.current_quarter,
      decisions: decisions ? decisions.decisions : null,
      lastModified: decisions ? decisions.updated_at : null
    });
  } catch (error) {
    console.error('Get decisions error:', error);
    res.status(500).json({ error: 'Failed to get decisions' });
  }
};
