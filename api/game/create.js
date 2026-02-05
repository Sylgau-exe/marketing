const { requireInstructor, handleCors } = require('../../lib/auth');
const { GameDB, SegmentDB } = require('../../lib/db');
const { generateGameCode } = require('../../lib/simulation-engine');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  
  try {
    const user = await requireInstructor(req);
    if (!user) return res.status(401).json({ error: 'Instructor access required' });
    
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    const { name, maxTeams = 6, quarterDuration = 7, marketScenario = 'bikes', autoAdvance = false } = req.body;
    
    if (!name || name.length < 3) {
      return res.status(400).json({ error: 'Game name must be at least 3 characters' });
    }
    
    const code = generateGameCode();
    
    const settings = {
      quarterDuration,
      marketScenario,
      autoAdvance,
      seasonality: true,
      startingCash: 5000000,
      maxBrandsPerTeam: 5,
      regionsAvailable: ['LATAM', 'EUROPE', 'APAC'],
      segmentsAvailable: ['Worker', 'Recreation', 'Youth', 'Mountain', 'Speed']
    };
    
    const game = await GameDB.create({
      code,
      name,
      instructorId: user.id,
      marketScenario,
      maxTeams: Math.min(Math.max(parseInt(maxTeams), 2), 8),
      settings
    });
    
    // Seed default market segments
    await SegmentDB.seedDefaults(game.id);
    
    res.status(201).json({
      success: true,
      game: {
        id: game.id,
        code: game.code,
        name: game.name,
        status: game.status,
        currentQuarter: game.current_quarter,
        maxTeams: game.max_teams,
        settings: game.settings
      }
    });
  } catch (error) {
    console.error('Create game error:', error);
    res.status(500).json({ error: 'Failed to create game' });
  }
};
