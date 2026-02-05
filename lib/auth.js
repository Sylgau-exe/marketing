// lib/auth.js - Authentication helpers for MarketSim Live
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

export function generateToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, isAdmin: user.is_admin, isInstructor: user.is_instructor },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

export function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}

export function getUserFromRequest(req) {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  return verifyToken(token);
}

export async function requireAuth(req, res) {
  const decoded = getUserFromRequest(req);
  if (!decoded) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  return decoded;
}

export async function requireInstructor(req, res) {
  const decoded = await requireAuth(req, res);
  if (!decoded) return null;
  if (!decoded.isAdmin && !decoded.isInstructor) {
    res.status(403).json({ error: 'Instructor access required' });
    return null;
  }
  return decoded;
}

export function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, reset_token, reset_token_expires, ...safeUser } = user;
  return safeUser;
}

export function cors(res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
