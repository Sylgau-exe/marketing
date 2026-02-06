// api/simulation/submit-decisions.js
import { sql } from '@vercel/postgres';
import { requireAuth, cors } from '../../lib/auth.js';
import { GameDB, TeamDB, TeamMemberDB, DecisionDB } from '../../lib/db.js';

const FREE_DECISION_LIMIT = 3;

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const decoded = await requireAuth(req, res);
  if (!decoded) return;

  try {
    const { game_id, team_id, decisions, submit = false, quarter } = req.body;
    if (!game_id || !team_id) return res.status(400).json({ error: 'Game ID and Team ID are required' });

    const members = await TeamMemberDB.findByTeam(team_id);
    if (!members.some(m => m.user_id === decoded.userId)) return res.status(403).json({ error: 'You are not on this team' });

    const game = await GameDB.findById(game_id);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (game.status !== 'active') return res.status(400).json({ error: 'Game is not active' });

    const teams = await TeamDB.findByGame(game_id);
    const team = teams.find(t => t.id === parseInt(team_id));
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (team.has_submitted && submit) return res.status(400).json({ error: 'Already submitted for this quarter' });

    // --- Paywall check on submit ---
    if (submit) {
      let userRow;
      try {
        const u = await sql`SELECT subscription_tier, subscription_status, decisions_used, is_admin FROM users WHERE id = ${decoded.userId}`;
        userRow = u.rows[0];
      } catch(e) { userRow = null; }

      const isPro = userRow && (
        userRow.is_admin ||
        (userRow.subscription_tier === 'pro' && userRow.subscription_status === 'active')
      );

      if (!isPro) {
        const used = parseInt(userRow?.decisions_used) || 0;
        if (used >= FREE_DECISION_LIMIT) {
          return res.status(402).json({
            error: 'Free plan limit reached',
            code: 'PAYWALL',
            decisionsUsed: used,
            limit: FREE_DECISION_LIMIT
          });
        }
      }
    }

    const errors = validateDecisions(decisions, team, game);
    if (errors.filter(e => e.severity === 'error').length > 0 && submit) return res.status(400).json({ error: 'Validation failed', errors });

    await DecisionDB.upsert(team_id, game.current_quarter, {
      pricing: decisions.pricing || {},
      advertising: decisions.advertising || {},
      internet: decisions.internet_marketing || decisions.internet || {},
      salesforce: decisions.salesforce || {},
      distribution: decisions.distribution || {},
      rdBudget: decisions.rd_budget || 0,
      rdProjects: decisions.rd_projects || [],
      production: decisions.production || {},
      dividend: decisions.dividend || 0
    });

    if (submit) {
      await TeamDB.setSubmitted(team_id, true);
      // Increment decisions_used counter
      try {
        await sql`UPDATE users SET decisions_used = COALESCE(decisions_used, 0) + 1 WHERE id = ${decoded.userId}`;
      } catch(e) { console.error('Could not increment decisions_used:', e); }
    }

    res.json({ success: true, saved: true, submitted: submit, warnings: errors.filter(e => e.severity === 'warning'), quarter: game.current_quarter });
  } catch (error) {
    console.error('Submit decisions error:', error);
    res.status(500).json({ error: 'Failed to save decisions' });
  }
}

function validateDecisions(decisions, team, game) {
  const errors = [];
  const cash = parseFloat(team.cash_balance);
  let totalExpenses = 0;

  if (decisions.advertising) {
    const adTotal = Object.values(decisions.advertising).reduce((s, v) => s + (parseFloat(v) || 0), 0);
    totalExpenses += adTotal;
    if (adTotal > cash * 0.5) errors.push({ field: 'advertising', message: 'Ad spending exceeds 50% of cash', severity: 'warning' });
  }
  if (decisions.internet_marketing) totalExpenses += Object.values(decisions.internet_marketing).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  if (decisions.rd_budget) totalExpenses += parseFloat(decisions.rd_budget) || 0;
  if (decisions.salesforce) Object.values(decisions.salesforce).forEach(r => { if (r.count && r.salary) totalExpenses += r.count * r.salary; });
  if (decisions.dividend) {
    const div = parseFloat(decisions.dividend) || 0;
    totalExpenses += div;
    if (div > cash * 0.3) errors.push({ field: 'dividend', message: 'Dividend exceeds 30% of cash', severity: 'warning' });
  }
  if (totalExpenses > cash * 1.2) errors.push({ field: 'total', message: 'Expenses significantly exceed cash', severity: 'error' });

  return errors;
}
