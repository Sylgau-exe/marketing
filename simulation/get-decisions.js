// api/simulation/get-decisions.js
import { requireAuth, cors } from '../../lib/auth.js';
import { GameDB, TeamMemberDB, DecisionDB } from '../../lib/db.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const decoded = await requireAuth(req, res);
  if (!decoded) return;

  try {
    const { game_id, team_id, quarter } = req.query;
    if (!game_id || !team_id) return res.status(400).json({ error: 'Game ID and Team ID required' });

    const members = await TeamMemberDB.findByTeam(team_id);
    if (!members.some(m => m.user_id === decoded.userId)) return res.status(403).json({ error: 'Not on this team' });

    const game = await GameDB.findById(game_id);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    const q = quarter !== undefined ? parseInt(quarter) : game.current_quarter;
    const decisions = await DecisionDB.findByTeamAndQuarter(team_id, q);

    res.json({
      quarter: q,
      currentQuarter: game.current_quarter,
      decisions: decisions ? {
        pricing: decisions.pricing_decisions,
        advertising: decisions.advertising_decisions,
        internet_marketing: decisions.internet_marketing,
        salesforce: decisions.salesforce_decisions,
        distribution: decisions.distribution_decisions,
        rd_budget: decisions.rd_budget,
        rd_projects: decisions.rd_projects,
        production: decisions.production_decisions,
        dividend: decisions.dividend_payment
      } : null,
      lastModified: decisions ? decisions.updated_at : null
    });
  } catch (error) {
    console.error('Get decisions error:', error);
    res.status(500).json({ error: 'Failed to get decisions' });
  }
}
