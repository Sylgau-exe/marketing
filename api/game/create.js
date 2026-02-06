// api/game/create.js - Create a new game
import { requireInstructor, cors } from '../../lib/auth.js';
import { GameDB, SegmentDB } from '../../lib/db.js';
import { generateGameCode } from '../../lib/simulation-engine.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const decoded = await requireInstructor(req, res);
  if (!decoded) return;

  try {
    const { name, maxTeams = 6, quarterDuration = 7, marketScenario = 'bikes', autoAdvance = false } = req.body;
    if (!name || name.length < 3) return res.status(400).json({ error: 'Game name must be at least 3 characters' });

    const code = generateGameCode();
    const settings = { quarterDuration, marketScenario, autoAdvance, seasonality: true, startingCash: 5000000, maxBrandsPerTeam: 5, regionsAvailable: ['LATAM', 'EUROPE', 'APAC'], segmentsAvailable: ['Worker', 'Recreation', 'Youth', 'Mountain', 'Speed'] };

    const game = await GameDB.create({ code, name, instructorId: decoded.userId, marketScenario, maxTeams: Math.min(Math.max(parseInt(maxTeams), 2), 8), settings });

    try { await SegmentDB.seedDefaults(game.id); } catch (e) { console.error('Seed segments error:', e); }

    res.status(201).json({
      success: true,
      game: { id: game.id, code: game.code, name: game.name, status: game.status, currentQuarter: game.current_quarter, maxTeams: game.max_teams, settings: game.settings }
    });
  } catch (error) {
    console.error('Create game error:', error);
    res.status(500).json({ error: 'Failed to create game' });
  }
}
