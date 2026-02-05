const { requireAuth, handleCors } = require('../../lib/auth');
const { GameDB, TeamDB, TeamMemberDB, DecisionDB, BrandDB } = require('../../lib/db');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  
  try {
    const user = await requireAuth(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    const { gameId, teamId, decisions, submit = false } = req.body;
    
    if (!gameId || !teamId) {
      return res.status(400).json({ error: 'Game ID and Team ID are required' });
    }
    
    // Verify user is on this team
    const members = await TeamMemberDB.findByTeam(teamId);
    if (!members.some(m => m.user_id === user.id)) {
      return res.status(403).json({ error: 'You are not on this team' });
    }
    
    // Get game
    const game = await GameDB.getWithTeams(gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (game.status !== 'active') {
      return res.status(400).json({ error: 'Game is not active' });
    }
    
    const team = await TeamDB.findByGame(gameId).then(teams => teams.find(t => t.id === teamId));
    if (!team) return res.status(404).json({ error: 'Team not found' });
    
    if (team.has_submitted && submit) {
      return res.status(400).json({ error: 'Decisions already submitted for this quarter. Wait for next quarter.' });
    }
    
    // Validate decisions
    const errors = validateDecisions(decisions, team, game);
    if (errors.length > 0 && submit) {
      return res.status(400).json({ error: 'Decision validation failed', errors });
    }
    
    // Save decisions (upsert)
    await DecisionDB.upsert({
      teamId,
      quarter: game.current_quarter,
      decisions: {
        pricing: decisions.pricing || {},
        advertising: decisions.advertising || {},
        internet_marketing: decisions.internet_marketing || {},
        salesforce: decisions.salesforce || {},
        distribution: decisions.distribution || {},
        rd_budget: decisions.rd_budget || 0,
        rd_projects: decisions.rd_projects || [],
        production: decisions.production || {},
        dividend: decisions.dividend || 0
      }
    });
    
    // If submitting, mark team as submitted
    if (submit) {
      await TeamDB.setSubmitted(teamId, true);
    }
    
    res.json({
      success: true,
      saved: true,
      submitted: submit,
      warnings: errors.filter(e => e.severity === 'warning'),
      quarter: game.current_quarter
    });
  } catch (error) {
    console.error('Submit decisions error:', error);
    res.status(500).json({ error: 'Failed to save decisions' });
  }
};

function validateDecisions(decisions, team, game) {
  const errors = [];
  const cash = parseFloat(team.cash_balance);
  
  // Calculate total expenses
  let totalExpenses = 0;
  
  // Advertising
  if (decisions.advertising) {
    const adTotal = Object.values(decisions.advertising).reduce((s, v) => s + (parseFloat(v) || 0), 0);
    totalExpenses += adTotal;
    if (adTotal > cash * 0.5) {
      errors.push({ field: 'advertising', message: 'Ad spending exceeds 50% of cash', severity: 'warning' });
    }
  }
  
  // Internet marketing
  if (decisions.internet_marketing) {
    const imTotal = Object.values(decisions.internet_marketing).reduce((s, v) => s + (parseFloat(v) || 0), 0);
    totalExpenses += imTotal;
  }
  
  // R&D
  if (decisions.rd_budget) {
    totalExpenses += parseFloat(decisions.rd_budget) || 0;
  }
  
  // Salesforce
  if (decisions.salesforce) {
    Object.values(decisions.salesforce).forEach(region => {
      if (region.count && region.salary) {
        totalExpenses += region.count * region.salary;
      }
    });
  }
  
  // Dividend
  if (decisions.dividend) {
    const div = parseFloat(decisions.dividend) || 0;
    totalExpenses += div;
    if (div > cash * 0.3) {
      errors.push({ field: 'dividend', message: 'Dividend exceeds 30% of cash', severity: 'warning' });
    }
  }
  
  // Cash check
  if (totalExpenses > cash * 1.2) {
    errors.push({ field: 'total', message: 'Total planned expenses significantly exceed available cash', severity: 'error' });
  }
  
  // Pricing checks
  if (decisions.pricing) {
    Object.entries(decisions.pricing).forEach(([brandId, prices]) => {
      Object.entries(prices).forEach(([region, price]) => {
        if (price < 200 || price > 3000) {
          errors.push({ field: 'pricing', message: `Price for brand ${brandId} in ${region} is out of range ($200-$3000)`, severity: 'warning' });
        }
      });
    });
  }
  
  // Production checks
  if (decisions.production) {
    Object.entries(decisions.production).forEach(([brandId, units]) => {
      if (units < 0) {
        errors.push({ field: 'production', message: `Cannot produce negative units for brand ${brandId}`, severity: 'error' });
      }
      if (units > 50000) {
        errors.push({ field: 'production', message: `Production over 50,000 units for brand ${brandId} may cause stockpile issues`, severity: 'warning' });
      }
    });
  }
  
  return errors;
}
