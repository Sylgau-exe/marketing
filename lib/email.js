// lib/email.js - Email service for MarketSim Live
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'MarketSim Live <noreply@marketsim.live>';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@marketsim.live';
const APP_URL = process.env.APP_URL || 'https://marketsim.live';

export async function sendEmail({ to, subject, html, text, replyTo }) {
  if (!RESEND_API_KEY) { console.error('RESEND_API_KEY not configured'); return; }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: Array.isArray(to) ? to : [to], subject, html, text, reply_to: replyTo }),
  });
  return response.json();
}

export async function sendWelcomeEmail({ name, email }) {
  const firstName = name?.split(' ')[0] || 'there';
  return sendEmail({
    to: email,
    subject: `Welcome to MarketSim Live, ${firstName}! 🚲`,
    html: `<div style="font-family:system-ui;max-width:600px;margin:0 auto;padding:20px"><div style="background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:16px;overflow:hidden"><div style="padding:40px 30px;text-align:center;color:white"><h1 style="margin:0">🚲 Welcome to MarketSim Live!</h1><p>Strategic Marketing Simulation</p></div><div style="background:white;padding:30px"><p>Hi ${firstName},</p><p>You're now part of MarketSim Live — a competitive marketing simulation where you'll lead a carbon fiber bicycle company to success.</p><p><strong>What's next?</strong></p><p>• Join a game using a code from your instructor<br>• Form your team and pick your roles<br>• Design brands, set prices, and compete!</p><p><a href="${APP_URL}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600">Get Started →</a></p></div></div></div>`,
    replyTo: ADMIN_EMAIL,
  });
}

export async function sendGameInviteEmail({ name, email, gameCode, gameName, instructorName }) {
  return sendEmail({
    to: email,
    subject: `You're invited to join ${gameName} on MarketSim Live! 🎮`,
    html: `<div style="font-family:system-ui;max-width:600px;margin:0 auto;padding:20px"><div style="background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:16px;overflow:hidden"><div style="padding:40px 30px;text-align:center;color:white"><h1 style="margin:0">🎮 Game Invitation</h1></div><div style="background:white;padding:30px"><p>Hi ${name?.split(' ')[0] || 'there'},</p><p>${instructorName} has invited you to join <strong>${gameName}</strong>.</p><div style="text-align:center;margin:20px 0;padding:20px;background:#f1f5f9;border-radius:12px"><p style="margin:0 0 8px;color:#64748b">Your Game Code</p><p style="margin:0;font-size:32px;font-weight:bold;letter-spacing:4px;color:#6366f1">${gameCode}</p></div><p><a href="${APP_URL}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600">Join Game →</a></p></div></div></div>`,
  });
}

export async function sendPasswordResetEmail({ name, email, resetToken }) {
  const resetUrl = `${APP_URL}?reset_token=${resetToken}`;
  return sendEmail({
    to: email,
    subject: 'Reset your MarketSim Live password',
    html: `<div style="font-family:system-ui;max-width:600px;margin:0 auto;padding:20px"><div style="background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:16px;overflow:hidden"><div style="padding:40px 30px;text-align:center;color:white"><h1 style="margin:0">🔑 Reset Password</h1></div><div style="background:white;padding:30px"><p>Hi ${name?.split(' ')[0] || 'there'},</p><p>Click below to reset your password. This link expires in 1 hour.</p><p><a href="${resetUrl}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600">Reset Password</a></p></div></div></div>`,
    text: `Reset your password: ${resetUrl}`,
  });
}

export async function sendQuarterReminderEmail({ name, email, gameName, quarter, deadline }) {
  return sendEmail({
    to: email,
    subject: `⏰ Quarter ${quarter} deadline approaching — ${gameName}`,
    html: `<div style="font-family:system-ui;max-width:600px;margin:0 auto;padding:20px"><div style="background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:16px;overflow:hidden"><div style="padding:30px;text-align:center;color:white"><h1 style="margin:0">⏰ Deadline Approaching</h1></div><div style="background:white;padding:30px"><p>Hi ${name?.split(' ')[0] || 'there'},</p><p>Quarter ${quarter} of <strong>${gameName}</strong> needs your decisions by <strong>${deadline}</strong>.</p><p>Don't forget to submit your team's decisions!</p><p><a href="${APP_URL}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600">Submit Decisions →</a></p></div></div></div>`,
  });
}
