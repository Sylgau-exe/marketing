// api/game/quick-join.js - Start solo simulation with AI competitors
import { sql } from '@vercel/postgres';
import { requireAuth } from '../../lib/auth.js';
import { TeamDB, SegmentDB, BrandDB } from '../../lib/db.js';
import { generateGameCode } from '../../lib/simulation-engine.js';

const SCENARIOS = {
  'local-launch': {
    id: 'local-launch', name: 'Phone First',
    tagline: 'Launch a smartphone brand in emerging markets',
    description: 'Build an affordable smartphone brand for Latin America. Target budget-conscious first-time buyers and social media enthusiasts. A great first scenario to learn the fundamentals.',
    difficulty: 'Beginner', difficultyColor: '#10b981', icon: '📱', aiCompetitors: 2,
    settings: { marketScenario: 'local-launch', startingCash: 6000000, maxBrandsPerTeam: 3, regionsAvailable: ['LATAM'], segmentsAvailable: ['Worker', 'Recreation'] }
  },
  'mountain-expedition': {
    id: 'mountain-expedition', name: 'Wearable Edge',
    tagline: 'Smart wearables for the European health & fitness market',
    description: 'Build smart wearables for European athletes, health-conscious buyers, and tech enthusiasts. Balance performance, comfort, and trust in a sophisticated market.',
    difficulty: 'Intermediate', difficultyColor: '#f59e0b', icon: '⌚', aiCompetitors: 3,
    settings: { marketScenario: 'mountain-expedition', startingCash: 5000000, maxBrandsPerTeam: 4, regionsAvailable: ['EUROPE'], segmentsAvailable: ['Mountain', 'Recreation', 'Speed'] }
  },
  'global-domination': {
    id: 'global-domination', name: 'Laptop Empire',
    tagline: 'Build a global laptop brand across 3 continents',
    description: 'The full challenge. Launch laptops across 3 regions for 5 customer segments. Maximum complexity, maximum reward.',
    difficulty: 'Advanced', difficultyColor: '#ef4444', icon: '💻', aiCompetitors: 3,
    settings: { marketScenario: 'global-domination', startingCash: 5000000, maxBrandsPerTeam: 5, regionsAvailable: ['LATAM', 'EUROPE', 'APAC'], segmentsAvailable: ['Worker', 'Recreation', 'Youth', 'Mountain', 'Speed'] }
  },
  'speed-innovation': {
    id: 'speed-innovation', name: 'VR Rush',
    tagline: 'Next-gen gaming headsets for Asia-Pacific',
    description: 'Target hardcore gamers and casual VR users in APAC — the world\'s largest gaming market. Heavy R&D and bold marketing are the keys to winning.',
    difficulty: 'Advanced', difficultyColor: '#ef4444', icon: '🥽', aiCompetitors: 2,
    settings: { marketScenario: 'speed-innovation', startingCash: 4500000, maxBrandsPerTeam: 4, regionsAvailable: ['APAC'], segmentsAvailable: ['Speed', 'Youth'] }
  }
};

const AI_TEAMS = [
  { name: 'NovaTech Industries', emoji: '🤖' },
  { name: 'Zenith Electronics', emoji: '🏢' },
  { name: 'Pulse Digital', emoji: '⚡' }
];

const AI_BRAND_NAMES = [['Nova X1'], ['Zenith Pro'], ['Pulse Max']];

const SEGMENT_LABELS = {
  'local-launch': { Worker: 'Budget Buyers', Recreation: 'Social Connectors' },
  'mountain-expedition': { Mountain: 'Athletes', Recreation: 'Health-Conscious', Speed: 'Tech Enthusiasts' },
  'global-domination': { Worker: 'Business Pros', Recreation: 'Students', Youth: 'Casual Users', Mountain: 'Creative Pros', Speed: 'Gamers' },
  'speed-innovation': { Speed: 'Hardcore Gamers', Youth: 'Casual Gamers' }
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET = return scenarios list
  if (req.method === 'GET') {
    return res.json({
      scenarios: Object.values(SCENARIOS).map(s => ({
        id: s.id, name: s.name, tagline: s.tagline, description: s.description,
        difficulty: s.difficulty, difficultyColor: s.difficultyColor, icon: s.icon,
        aiCompetitors: s.aiCompetitors,
        regions: s.settings.regionsAvailable,
        segments: s.settings.segmentsAvailable.map(seg => (SEGMENT_LABELS[s.id] || {})[seg] || seg)
      }))
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const { scenarioId } = req.body;
    const scenario = SCENARIOS[scenarioId];
    if (!scenario) return res.status(400).json({ error: 'Invalid scenario' });

    // Check for existing active simulation
    const existing = await sql`
      SELECT g.id as game_id, g.name, g.status, g.current_quarter,
             t.id as team_id, t.name as team_name
      FROM teams t
      JOIN games g ON g.id = t.game_id
      WHERE g.user_id = ${user.id}
        AND g.market_scenario = ${scenario.id}
        AND g.status = 'active'
        AND t.is_ai = false
      LIMIT 1
    `;

    if (existing.rows.length > 0) {
      const e = existing.rows[0];
      return res.json({
        success: true, alreadyStarted: true,
        game: { id: e.game_id, name: e.name, status: e.status, currentQuarter: e.current_quarter },
        team: { id: e.team_id, name: e.team_name }
      });
    }

    // Create solo game
    const code = generateGameCode();
    const gameResult = await sql`
      INSERT INTO games (name, code, user_id, market_scenario, settings, status, current_quarter)
      VALUES (
        ${scenario.name + ' — ' + (user.name || 'Player').split(' ')[0]},
        ${code}, ${user.id}, ${scenario.id},
        ${JSON.stringify(scenario.settings)}, 'active', 1
      ) RETURNING *
    `;
    const game = gameResult.rows[0];

    // Seed segments
    await SegmentDB.seedDefaults(game.id);

    // Create player team (company)
    const playerTeam = await TeamDB.create({
      gameId: game.id,
      name: (user.name || 'Player').split(' ')[0] + "'s Company",
      logoEmoji: scenario.icon,
      cashBalance: scenario.settings.startingCash,
      isAi: false
    });

    // Create AI competitor teams with brands
    const segs = scenario.settings.segmentsAvailable;
    for (let i = 0; i < scenario.aiCompetitors; i++) {
      const ai = AI_TEAMS[i % AI_TEAMS.length];
      const aiTeam = await TeamDB.create({
        gameId: game.id, name: ai.name, logoEmoji: ai.emoji,
        cashBalance: scenario.settings.startingCash, isAi: true
      });

      // Create a brand for each AI team targeting a segment
      const targetSeg = segs[i % segs.length];
      const brandName = AI_BRAND_NAMES[i % AI_BRAND_NAMES.length][0];
      const q = () => 4 + Math.floor(Math.random() * 3); // 4-6 quality
      await BrandDB.create({
        teamId: aiTeam.id, name: brandName, targetSegment: targetSeg,
        frameQuality: q(), wheelsQuality: q(), drivetrainQuality: q(), brakesQuality: q(),
        suspensionQuality: q(), seatQuality: q(), handlebarsQuality: q(), electronicsQuality: 2 + Math.floor(Math.random() * 3)
      });
    }

    res.json({
      success: true, alreadyStarted: false,
      game: { id: game.id, name: game.name, status: 'active', currentQuarter: 1 },
      team: { id: playerTeam.id, name: playerTeam.name },
      scenario: { id: scenario.id, name: scenario.name, difficulty: scenario.difficulty }
    });
  } catch (error) {
    console.error('Start simulation error:', error);
    res.status(500).json({ error: 'Failed to start simulation: ' + error.message });
  }
}
