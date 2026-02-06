// api/webhooks/stripe.js
import Stripe from 'stripe';
import { sql } from '@vercel/postgres';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sig = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerId = session.customer;
        const planType = session.metadata?.planType || (session.mode === 'payment' ? 'lifetime' : 'monthly');

        await sql`
          UPDATE users SET
            subscription_tier = 'pro',
            subscription_status = 'active',
            subscription_type = ${planType},
            updated_at = CURRENT_TIMESTAMP
          WHERE stripe_customer_id = ${customerId}
        `;
        console.log('✅ Subscription activated:', customerId, planType);
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const status = sub.status;
        await sql`
          UPDATE users SET
            subscription_status = ${status},
            updated_at = CURRENT_TIMESTAMP
          WHERE stripe_customer_id = ${sub.customer}
        `;
        console.log('📝 Subscription updated:', sub.customer, status);
        break;
      }

      case 'customer.subscription.deleted': {
        await sql`
          UPDATE users SET
            subscription_tier = 'free',
            subscription_status = 'cancelled',
            subscription_type = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE stripe_customer_id = ${event.data.object.customer}
        `;
        console.log('❌ Subscription cancelled:', event.data.object.customer);
        break;
      }

      case 'invoice.payment_failed': {
        await sql`
          UPDATE users SET
            subscription_status = 'past_due',
            updated_at = CURRENT_TIMESTAMP
          WHERE stripe_customer_id = ${event.data.object.customer}
        `;
        console.log('⚠️ Payment failed:', event.data.object.customer);
        break;
      }

      default:
        console.log('Unhandled event:', event.type);
    }

    return res.json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}
