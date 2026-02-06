// lib/email.js - Email service for MarketSim Live (Solo Mode)
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
    subject: `Welcome to MarketSim Live, ${firstName}! 🎯`,
    html: `<div style="font-family:system-ui;max-width:600px;margin:0 auto;padding:20px"><div style="background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:16px;overflow:hidden"><div style="padding:40px 30px;text-align:center;color:white"><h1 style="margin:0">🎯 Welcome to MarketSim Live!</h1><p>Strategic Marketing Simulation</p></div><div style="background:white;padding:30px"><p>Hi ${firstName},</p><p>Welcome to MarketSim Live — a hands-on marketing simulation where you'll lead a tech company through 8 quarters of strategic decisions.</p><p><strong>Here's how it works:</strong></p><p>1. Pick an industry scenario (smartphones, wearables, laptops, or VR headsets)<br>2. Design products, set prices, and run marketing campaigns<br>3. Compete against AI rivals across global markets<br>4. Track your performance on the balanced scorecard</p><p>Your first 3 decisions are free — no credit card needed.</p><p><a href="${APP_URL}/dashboard.html" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600">Start Your First Simulation →</a></p></div></div></div>`,
    replyTo: ADMIN_EMAIL,
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
    html: `<div style="font-family:system-ui;max-width:600px;margin:0 auto;padding:20px"><div style="background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:16px;overflow:hidden"><div style="padding:30px;text-align:center;color:white"><h1 style="margin:0">⏰ Don't Lose Momentum</h1></div><div style="background:white;padding:30px"><p>Hi ${name?.split(' ')[0] || 'there'},</p><p>Quarter ${quarter} of <strong>${gameName}</strong> is waiting for your decisions.</p><p>Your competitors are making moves — time to submit yours!</p><p><a href="${APP_URL}/dashboard.html" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600">Make Your Decisions →</a></p></div></div></div>`,
  });
}
