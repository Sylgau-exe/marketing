const { requireAuth, handleCors } = require('../../lib/auth');
const { TeamMemberDB, TeamDB, GameDB } = require('../../lib/db');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  
  try {
    const user = await requireAuth(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    
    if (req.method === 'GET') {
      const { teamId } = req.query;
      if (!teamId) return res.status(400).json({ error: 'Team ID required' });
      
      const members = await TeamMemberDB.findByTeam(teamId);
      return res.json({
        members: members.map(m => ({
          userId: m.user_id,
          name: m.first_name + ' ' + m.last_name,
          email: m.email,
          role: m.role,
          joinedAt: m.joined_at
        }))
      });
    }
    
    if (req.method === 'PUT') {
      // Update role
      const { teamId, userId, role } = req.body;
      if (!teamId || !userId || !role) {
        return res.status(400).json({ error: 'Team ID, user ID, and role are required' });
      }
      
      const validRoles = ['president', 'vp_marketing', 'vp_sales', 'vp_finance', 'member'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
      
      // Verify requester is president or instructor
      const members = await TeamMemberDB.findByTeam(teamId);
      const requester = members.find(m => m.user_id === user.id);
      if (!requester || requester.role !== 'president') {
        return res.status(403).json({ error: 'Only the team president can change roles' });
      }
      
      await TeamMemberDB.updateRole(teamId, userId, role);
      return res.json({ success: true });
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Team members error:', error);
    res.status(500).json({ error: 'Failed to manage team members' });
  }
};
