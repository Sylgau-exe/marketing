// api/game/quick-join.js - Self-service scenario matchmaking
import { sql } from '@vercel/postgres';
import { requireAuth } from '../../lib/auth.js';
import { TeamDB, TeamMemberDB, SegmentDB } from '../../lib/db.js';
import { generateGameCode } from '../../lib/simulation-engine.js';

// ========== 4 PRESET SCENARIOS ==========
const SCENARIOS = {
  'local-launch': {
    id: 'local-launch',
    name: 'Phone First',
    tagline: 'Launch a smartphone brand in emerging markets',
    description: 'Build an affordable smartphone brand for Latin America. Target budget-conscious first-time buyers and social media enthusiasts. A great first scenario to learn the fundamentals.',
    difficulty: 'Beginner',
    difficultyColor: '#10b981',
    icon: '📱',
    maxTeams: 4,
    settings: {
      quarterDuration: 7,
      marketScenario: 'local-launch',
      autoAdvance: false,
      seasonality: true,
      startingCash: 6000000,
      maxBrandsPerTeam: 3,
      regionsAvailable: ['LATAM'],
      segmentsAvailable: ['Worker', 'Recreation']
    }
  },
  'mountain-expedition': {
    id: 'mountain-expedition',
    name: 'Wearable Edge',
    tagline: 'Smart wearables for the European health & fitness market',
    description: 'Build smart wearables for European athletes, health-conscious buyers, and tech enthusiasts. Balance performance, comfort, and trust in a sophisticated market.',
    difficulty: 'Intermediate',
    difficultyColor: '#f59e0b',
    icon: '⌚',
    maxTeams: 6,
    settings: {
      quarterDuration: 7,
      marketScenario: 'mountain-expedition',
      autoAdvance: false,
      seasonality: true,
      startingCash: 5000000,
      maxBrandsPerTeam: 4,
      regionsAvailable: ['EUROPE'],
      segmentsAvailable: ['Mountain', 'Recreation', 'Speed']
    }
  },
  'global-domination': {
    id: 'global-domination',
    name: 'Laptop Empire',
    tagline: 'Build a global laptop brand across 3 continents',
    description: 'The full challenge. Launch laptops across 3 regions for 5 customer segments — from budget students to creative pros and gamers. Maximum complexity, maximum reward.',
    difficulty: 'Advanced',
    difficultyColor: '#ef4444',
    icon: '💻',
    maxTeams: 6,
    settings: {
      quarterDuration: 7,
      marketScenario: 'global-domination',
      autoAdvance: false,
      seasonality: true,
      startingCash: 5000000,
      maxBrandsPerTeam: 5,
      regionsAvailable: ['LATAM', 'EUROPE', 'APAC'],
      segmentsAvailable: ['Worker', 'Recreation', 'Youth', 'Mountain', 'Speed']
    }
  },
  'speed-innovation': {
    id: 'speed-innovation',
    name: 'VR Rush',
    tagline: 'Next-gen gaming headsets for Asia-Pacific',
    description: 'Target hardcore gamers and casual VR users in APAC — the world\'s largest gaming market. Heavy R&D and bold marketing are the keys to winning this race.',
    difficulty: 'Advanced',
    difficultyColor: '#ef4444',
    icon: '🥽',
    maxTeams: 4,
    settings: {
      quarterDuration: 7,
      marketScenario: 'speed-innovation',
      autoAdvance: false,
      seasonality: true,
      startingCash: 4500000,
      maxBrandsPerTeam: 4,
      regionsAvailable: ['APAC'],
      segmentsAvailable: ['Speed', 'Youth']
    }
  }
};

const TEAM_NAMES = [
  'Pixel Labs', 'Circuit Ventures', 'Quantum Forge', 'Nova Systems',
  'Byte Force', 'Signal Works', 'Horizon Tech', 'Ember Studio',
  'Atlas Digital', 'Prism Group', 'Apex Devices', 'Ionic Labs',
  'Flux Dynamics', 'Zenith Co', 'Pulse Factory', 'Vertex Labs',
  'Echo Systems', 'Neon Collective', 'Cipher Works', 'Stealth Tech',
  'Orbit Labs', 'Warp Studio', 'Core Dynamics', 'Spark Ventures'
];

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

// Friendly segment names per scenario
const SEGMENT_LABELS = {
  'local-launch': { Worker: 'Budget Buyers', Recreation: 'Social Connectors' },
  'mountain-expedition': { Mountain: 'Athletes', Recreation: 'Health-Conscious', Speed: 'Tech Enthusiasts' },
  'global-domination': { Worker: 'Business Pros', Recreation: 'Students', Youth: 'Casual Users', Mountain: 'Creative Pros', Speed: 'Gamers' },
  'speed-innovation': { Speed: 'Hardcore Gamers', Youth: 'Casual Gamers' }
};

export default async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET = return scenarios list (no auth needed)
  if (req.method === 'GET') {
    return res.json({
      scenarios: Object.values(SCENARIOS).map(s => ({
        id: s.id,
        name: s.name,
        tagline: s.tagline,
        description: s.description,
        difficulty: s.difficulty,
        difficultyColor: s.difficultyColor,
        icon: s.icon,
        maxTeams: s.maxTeams,
        regions: s.settings.regionsAvailable,
        segments: s.settings.segmentsAvailable.map(seg => (SEGMENT_LABELS[s.id]||{})[seg] || seg)
      }))
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await requireAuth(req, res);
    if (!user) return; // requireAuth already sent 401

    const { scenarioId } = req.body;
    const scenario = SCENARIOS[scenarioId];
    if (!scenario) return res.status(400).json({ error: 'Invalid scenario' });

    // Step 1: Check if user already in active game for this scenario
    const existingResult = await sql`
      SELECT g.id as game_id, g.code, g.name, g.status, g.current_quarter,
             t.id as team_id, t.name as team_name
      FROM team_members tm
      JOIN teams t ON t.id = tm.team_id
      JOIN games g ON g.id = t.game_id
      WHERE tm.user_id = ${user.id}
        AND g.market_scenario = ${scenario.id}
        AND g.status IN ('lobby', 'active')
      LIMIT 1
    `;

    if (existingResult.rows.length > 0) {
      const existing = existingResult.rows[0];
      return res.json({
        success: true,
        alreadyJoined: true,
        game: { id: existing.game_id, code: existing.code, name: existing.name, status: existing.status, currentQuarter: existing.current_quarter },
        team: { id: existing.team_id, name: existing.team_name }
      });
    }

    // Step 2: Find lobby game with open slots
    const lobbyResult = await sql`
      SELECT g.*, COUNT(DISTINCT t.id) as team_count
      FROM games g
      LEFT JOIN teams t ON t.game_id = g.id
      WHERE g.market_scenario = ${scenario.id}
        AND g.status = 'lobby'
      GROUP BY g.id
      HAVING COUNT(DISTINCT t.id) < g.max_teams
      ORDER BY COUNT(DISTINCT t.id) DESC
      LIMIT 1
    `;

    let game;
    if (lobbyResult.rows.length > 0) {
      game = lobbyResult.rows[0];
    } else {
      // Step 3: Create new game
      const code = generateGameCode();
      const gameResult = await sql`
        INSERT INTO games (name, code, instructor_id, market_scenario, max_teams, settings, status)
        VALUES (
          ${scenario.name + ' #' + Math.floor(Math.random() * 9000 + 1000)},
          ${code},
          ${user.id},
          ${scenario.id},
          ${scenario.maxTeams},
          ${JSON.stringify(scenario.settings)},
          'lobby'
        )
        RETURNING *
      `;
      game = gameResult.rows[0];
      await SegmentDB.seedDefaults(game.id);
    }

    // Step 4: Pick unique team name
    const existingTeams = await TeamDB.findByGame(game.id);
    const usedNames = existingTeams.map(t => t.name.toLowerCase());
    const shuffled = [...TEAM_NAMES].sort(() => Math.random() - 0.5);
    let teamName = shuffled.find(n => !usedNames.includes(n.toLowerCase()));
    if (!teamName) teamName = 'Team ' + Math.floor(Math.random() * 9000 + 1000);

    // Step 5: Create team & add user
    const team = await TeamDB.create({ gameId: game.id, name: teamName, logoEmoji: scenario.icon });
    await TeamMemberDB.add(team.id, user.id, 'president');

    res.json({
      success: true,
      alreadyJoined: false,
      game: { id: game.id, code: game.code, name: game.name, status: game.status, currentQuarter: game.current_quarter },
      team: { id: team.id, name: team.name },
      scenario: { id: scenario.id, name: scenario.name, difficulty: scenario.difficulty }
    });
  } catch (error) {
    console.error('Quick-join error:', error);
    res.status(500).json({ error: 'Failed to join game. Please try again.' });
  }
}
