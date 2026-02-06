// api/team/brands.js - Brand CRUD
import { requireAuth, cors } from '../../lib/auth.js';
import { TeamMemberDB, BrandDB } from '../../lib/db.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const decoded = await requireAuth(req, res);
  if (!decoded) return;

  try {
    if (req.method === 'GET') return handleGet(req, res, decoded);
    if (req.method === 'POST') return handleCreate(req, res, decoded);
    if (req.method === 'PUT') return handleUpdate(req, res, decoded);
    if (req.method === 'DELETE') return handleDeactivate(req, res, decoded);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Brand API error:', error);
    res.status(500).json({ error: 'Brand operation failed' });
  }
}

function clamp(val, min, max) { return Math.min(max, Math.max(min, parseInt(val) || min)); }

function formatBrand(b) {
  return {
    id: b.id, name: b.name, targetSegment: b.target_segment,
    components: { frame: b.frame_quality, wheels: b.wheels_quality, drivetrain: b.drivetrain_quality, brakes: b.brakes_quality, suspension: b.suspension_quality, seat: b.seat_quality, handlebars: b.handlebars_quality, electronics: b.electronics_quality },
    overallQuality: b.overall_quality, unitCost: b.unit_cost, rdInvestment: b.rd_investment, isActive: b.is_active
  };
}

async function verifyAccess(teamId, userId) {
  const members = await TeamMemberDB.findByTeam(teamId);
  return members.some(m => m.user_id === userId);
}

async function handleGet(req, res, decoded) {
  const teamId = req.query.team_id || req.query.teamId;
  if (!teamId) return res.status(400).json({ error: 'Team ID required' });
  if (!await verifyAccess(teamId, decoded.userId)) return res.status(403).json({ error: 'Access denied' });
  const brands = await BrandDB.findByTeam(teamId);
  res.json({ brands: brands.map(formatBrand) });
}

async function handleCreate(req, res, decoded) {
  const { team_id, game_id, name, target_segment, components, rdInvestment = 0 } = req.body;
  const teamId = team_id;
  if (!teamId || !name || !target_segment) return res.status(400).json({ error: 'Team ID, name, and target segment required' });
  if (!await verifyAccess(teamId, decoded.userId)) return res.status(403).json({ error: 'Access denied' });

  const existing = await BrandDB.findByTeam(teamId);
  if (existing.filter(b => b.is_active).length >= 5) return res.status(400).json({ error: 'Maximum 5 active brands' });
  if (existing.some(b => b.name.toLowerCase() === name.toLowerCase() && b.is_active)) return res.status(400).json({ error: 'Brand name already exists' });

  const c = components || {};
  const brand = await BrandDB.create({
    teamId, name: name.substring(0, 30), targetSegment: target_segment,
    frameQuality: clamp(c.frame, 0, 5), wheelsQuality: clamp(c.wheels, 0, 5),
    drivetrainQuality: clamp(c.drivetrain, 0, 5), brakesQuality: clamp(c.brakes, 0, 5),
    suspensionQuality: clamp(c.suspension, 0, 5), seatQuality: clamp(c.seat, 0, 5),
    handlebarsQuality: clamp(c.handlebars, 0, 5), electronicsQuality: clamp(c.electronics, 0, 5),
    rdInvestment: Math.max(0, parseFloat(rdInvestment) || 0)
  });

  res.status(201).json({ success: true, brand: formatBrand(brand) });
}

async function handleUpdate(req, res, decoded) {
  const { brandId, brand_id, components, target_segment, targetSegment, rdInvestment } = req.body;
  const bid = brandId || brand_id;
  if (!bid) return res.status(400).json({ error: 'Brand ID required' });

  const updates = {};
  if (components) {
    updates.frameQuality = clamp(components.frame, 0, 5);
    updates.wheelsQuality = clamp(components.wheels, 0, 5);
    updates.drivetrainQuality = clamp(components.drivetrain, 0, 5);
    updates.brakesQuality = clamp(components.brakes, 0, 5);
    updates.suspensionQuality = clamp(components.suspension, 0, 5);
    updates.seatQuality = clamp(components.seat, 0, 5);
    updates.handlebarsQuality = clamp(components.handlebars, 0, 5);
    updates.electronicsQuality = clamp(components.electronics, 0, 5);
  }
  if (target_segment || targetSegment) updates.targetSegment = target_segment || targetSegment;
  if (rdInvestment !== undefined) updates.rdInvestment = Math.max(0, parseFloat(rdInvestment));

  const updated = await BrandDB.update(bid, updates);
  res.json({ success: true, brand: formatBrand(updated) });
}

async function handleDeactivate(req, res, decoded) {
  const bid = req.query.brandId || req.query.brand_id;
  if (!bid) return res.status(400).json({ error: 'Brand ID required' });
  await BrandDB.deactivate(bid);
  res.json({ success: true, message: 'Brand deactivated' });
}
