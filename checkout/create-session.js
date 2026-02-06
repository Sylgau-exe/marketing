// api/checkout/create-session.js
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

  const { priceId, mode } = req.body; // mode: 'subscription' or 'payment'

  try {
    const userResult = await sql`SELECT email, name, stripe_customer_id FROM users WHERE id = ${decoded.userId}`;
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name || undefined,
        metadata: { userId: decoded.userId.toString() }
      });
      customerId = customer.id;
      await sql`UPDATE users SET stripe_customer_id = ${customerId} WHERE id = ${decoded.userId}`;
    }

    const sessionParams = {
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: mode || 'subscription',
      success_url: `${req.headers.origin || process.env.APP_URL}/dashboard.html?payment=success`,
      cancel_url: `${req.headers.origin || process.env.APP_URL}/pricing.html?payment=cancelled`,
      metadata: { userId: decoded.userId.toString(), planType: mode === 'payment' ? 'lifetime' : 'monthly' }
    };

    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error('Checkout error:', error);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
