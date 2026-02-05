const { requireAuth, handleCors } = require('../../lib/auth');
const { TeamMemberDB, BrandDB, GameDB, TeamDB } = require('../../lib/db');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  
  try {
    const user = await requireAuth(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    
    const method = req.method;
    
    if (method === 'GET') {
      return handleGet(req, res, user);
    } else if (method === 'POST') {
      return handleCreate(req, res, user);
    } else if (method === 'PUT') {
      return handleUpdate(req, res, user);
    } else if (method === 'DELETE') {
      return handleDeactivate(req, res, user);
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Brand API error:', error);
    res.status(500).json({ error: 'Brand operation failed' });
  }
};

async function verifyTeamAccess(teamId, userId) {
  const members = await TeamMemberDB.findByTeam(teamId);
  return members.some(m => m.user_id === userId);
}

async function handleGet(req, res, user) {
  const { teamId } = req.query;
  if (!teamId) return res.status(400).json({ error: 'Team ID required' });
  
  if (!await verifyTeamAccess(teamId, user.id)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  const brands = await BrandDB.findByTeam(teamId);
  res.json({
    brands: brands.map(formatBrand)
  });
}

async function handleCreate(req, res, user) {
  const { teamId, name, targetSegment, components, rdInvestment = 0 } = req.body;
  
  if (!teamId || !name || !targetSegment) {
    return res.status(400).json({ error: 'Team ID, name, and target segment are required' });
  }
  
  if (!await verifyTeamAccess(teamId, user.id)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  // Check max brands
  const existing = await BrandDB.findByTeam(teamId);
  const activeBrands = existing.filter(b => b.is_active);
  if (activeBrands.length >= 5) {
    return res.status(400).json({ error: 'Maximum 5 active brands allowed' });
  }
  
  // Check unique name within team
  if (existing.some(b => b.name.toLowerCase() === name.toLowerCase() && b.is_active)) {
    return res.status(400).json({ error: 'Brand name already exists for this team' });
  }
  
  const comp = {
    frame: clamp(components?.frame || 3, 0, 5),
    wheels: clamp(components?.wheels || 3, 0, 5),
    drivetrain: clamp(components?.drivetrain || 3, 0, 5),
    brakes: clamp(components?.brakes || 3, 0, 5),
    suspension: clamp(components?.suspension || 2, 0, 5),
    seat: clamp(components?.seat || 2, 0, 5),
    handlebars: clamp(components?.handlebars || 2, 0, 5),
    electronics: clamp(components?.electronics || 1, 0, 5)
  };
  
  const brand = await BrandDB.create({
    teamId,
    name: name.substring(0, 30),
    targetSegment,
    components: comp,
    rdInvestment: Math.max(0, parseFloat(rdInvestment) || 0)
  });
  
  res.status(201).json({ success: true, brand: formatBrand(brand) });
}

async function handleUpdate(req, res, user) {
  const { brandId, components, targetSegment, rdInvestment } = req.body;
  
  if (!brandId) return res.status(400).json({ error: 'Brand ID required' });
  
  // Find brand and verify access
  const brand = await BrandDB.findById ? await BrandDB.findById(brandId) : null;
  
  const updates = {};
  if (components) {
    updates.components = {
      frame: clamp(components.frame, 0, 5),
      wheels: clamp(components.wheels, 0, 5),
      drivetrain: clamp(components.drivetrain, 0, 5),
      brakes: clamp(components.brakes, 0, 5),
      suspension: clamp(components.suspension, 0, 5),
      seat: clamp(components.seat, 0, 5),
      handlebars: clamp(components.handlebars, 0, 5),
      electronics: clamp(components.electronics, 0, 5)
    };
  }
  if (targetSegment) updates.targetSegment = targetSegment;
  if (rdInvestment !== undefined) updates.rdInvestment = Math.max(0, parseFloat(rdInvestment));
  
  const updated = await BrandDB.update(brandId, updates);
  res.json({ success: true, brand: formatBrand(updated) });
}

async function handleDeactivate(req, res, user) {
  const { brandId } = req.query;
  if (!brandId) return res.status(400).json({ error: 'Brand ID required' });
  
  await BrandDB.deactivate(brandId);
  res.json({ success: true, message: 'Brand deactivated' });
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, parseInt(val) || min));
}

function formatBrand(b) {
  return {
    id: b.id,
    name: b.name,
    targetSegment: b.target_segment,
    components: b.components || {
      frame: b.frame_quality,
      wheels: b.wheels_quality,
      drivetrain: b.drivetrain_quality,
      brakes: b.brakes_quality,
      suspension: b.suspension_quality,
      seat: b.seat_quality,
      handlebars: b.handlebars_quality,
      electronics: b.electronics_quality
    },
    overallQuality: b.overall_quality,
    unitCost: b.unit_cost,
    rdInvestment: b.rd_investment,
    isActive: b.is_active,
    createdAt: b.created_at
  };
}
