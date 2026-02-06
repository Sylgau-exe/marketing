// api/game/join.js - Join a game
import { requireAuth, cors } from '../../lib/auth.js';
import { GameDB, TeamDB, TeamMemberDB } from '../../lib/db.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const decoded = await requireAuth(req, res);
  if (!decoded) return;

  try {
    const { code, gameCode, team_name, teamName, team_id, teamId, role = 'member', logoEmoji = '🚴' } = req.body;
    const gc = (code || gameCode || '').toUpperCase().trim();
    if (!gc) return res.status(400).json({ error: 'Game code is required' });

    const game = await GameDB.findByCode(gc);
    if (!game) return res.status(404).json({ error: 'Game not found. Check the code and try again.' });
    if (game.status === 'completed') return res.status(400).json({ error: 'This game has already ended' });

    // Check if user is already in this game
    const existingTeams = await TeamDB.findByGame(game.id);
    for (const t of existingTeams) {
      const members = await TeamMemberDB.findByTeam(t.id);
      if (members.some(m => m.user_id === decoded.userId)) {
        return res.status(400).json({ error: 'You are already in this game', team: { id: t.id, name: t.name } });
      }
    }

    let team;
    const tid = team_id || teamId;
    const tname = team_name || teamName;

    if (tid) {
      team = existingTeams.find(t => t.id === parseInt(tid));
      if (!team) return res.status(404).json({ error: 'Team not found in this game' });
      const members = await TeamMemberDB.findByTeam(team.id);
      if (members.length >= 5) return res.status(400).json({ error: 'This team is full (max 5 members)' });
    } else if (tname) {
      if (existingTeams.length >= game.max_teams) return res.status(400).json({ error: `Maximum ${game.max_teams} teams allowed` });
      if (tname.length < 2 || tname.length > 40) return res.status(400).json({ error: 'Team name must be 2-40 characters' });
      if (existingTeams.some(t => t.name.toLowerCase() === tname.toLowerCase())) return res.status(400).json({ error: 'Team name already exists' });
      team = await TeamDB.create({ gameId: game.id, name: tname, logoEmoji });
    } else {
      // Auto-assign to smallest team or create new
      let smallestTeam = null;
      let minSize = Infinity;
      for (const t of existingTeams) {
        const members = await TeamMemberDB.findByTeam(t.id);
        if (members.length < 5 && members.length < minSize) { smallestTeam = t; minSize = members.length; }
      }
      if (smallestTeam) { team = smallestTeam; }
      else if (existingTeams.length < game.max_teams) {
        team = await TeamDB.create({ gameId: game.id, name: `Team ${existingTeams.length + 1}`, logoEmoji: '🚴' });
      } else {
        return res.status(400).json({ error: 'All teams are full' });
      }
    }

    const memberRole = (!tid && tname) ? 'president' : role;
    await TeamMemberDB.add(team.id, decoded.userId, memberRole);
    const members = await TeamMemberDB.findByTeam(team.id);

    res.json({
      success: true,
      game: { id: game.id, code: game.code, name: game.name, status: game.status, currentQuarter: game.current_quarter },
      team: { id: team.id, name: team.name, logoEmoji: team.logo_emoji, members: members.map(m => ({ userId: m.user_id, name: m.name || 'Unknown', email: m.email, role: m.role })) }
    });
  } catch (error) {
    console.error('Join game error:', error);
    res.status(500).json({ error: 'Failed to join game' });
  }
}
