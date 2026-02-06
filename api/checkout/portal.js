// api/checkout/portal.js
import Stripe from 'stripe';
import { sql } from '@vercel/postgres';
import { getUserFromRequest, cors } from '../../lib/auth.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const decoded = getUserFromRequest(req);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const result = await sql`SELECT stripe_customer_id FROM users WHERE id = ${decoded.userId}`;
    const customerId = result.rows[0]?.stripe_customer_id;
    if (!customerId) return res.status(400).json({ error: 'No subscription found' });

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${req.headers.origin || process.env.APP_URL}/dashboard.html`,
    });

    return res.json({ url: session.url });
  } catch (error) {
    console.error('Portal error:', error);
    return res.status(500).json({ error: 'Failed to create portal session' });
  }
}
