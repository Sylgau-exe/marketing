# MarketSim — Stripe Payment Setup Guide

## Step 1: Create Products in Stripe Dashboard

Go to **https://dashboard.stripe.com/products** and create two products:

### Product 1: Pro Monthly
- **Name:** MarketSim Pro Monthly
- **Description:** Full access to all simulations, scenarios, and unlimited decisions
- **Pricing:** $19.00 USD / month (Recurring)
- After creating, copy the **Price ID** (starts with `price_...`)

### Product 2: Pro Lifetime
- **Name:** MarketSim Pro Lifetime
- **Description:** One-time payment for lifetime access to all features
- **Pricing:** $149.00 USD (One time)
- After creating, copy the **Price ID** (starts with `price_...`)

## Step 2: Get Your API Keys

Go to **https://dashboard.stripe.com/apikeys**

- Copy the **Publishable key** (`pk_test_...` or `pk_live_...`)
- Copy the **Secret key** (`sk_test_...` or `sk_live_...`)

## Step 3: Set Up Webhook

Go to **https://dashboard.stripe.com/webhooks**

1. Click **Add endpoint**
2. URL: `https://marketing-psi-livid.vercel.app/api/webhooks/stripe`
3. Select these events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Click **Add endpoint**
5. Copy the **Signing secret** (`whsec_...`)

## Step 4: Add Environment Variables in Vercel

Go to **https://vercel.com** → Your MarketSim project → **Settings** → **Environment Variables**

Add these:

| Variable | Value |
|----------|-------|
| `STRIPE_SECRET_KEY` | `sk_test_...` (or `sk_live_...` for production) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` |

## Step 5: Update Price IDs in Code

Open `public/pricing.html` and replace the placeholder Price IDs:

```javascript
const PRICE_IDS = {
  monthly: 'price_XXXXX',   // ← Replace with your Pro Monthly Price ID
  lifetime: 'price_YYYYY'   // ← Replace with your Pro Lifetime Price ID
};
```

## Step 6: Run Database Migration

In Neon SQL Editor, run:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_tier VARCHAR(50) DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) DEFAULT 'inactive';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_type VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS decisions_used INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_users_stripe ON users(stripe_customer_id);
```

## Step 7: Redeploy

Push to GitHub and Vercel will auto-deploy.

## Testing

Use Stripe test cards:
- **Success:** 4242 4242 4242 4242
- **Declined:** 4000 0000 0000 0002
- **3D Secure:** 4000 0000 0000 3220

Expiry: any future date, CVC: any 3 digits.

## How It Works

1. Free users can submit **3 decisions** (quarters)
2. On the 4th submit attempt → paywall modal appears
3. User clicks "Upgrade" → goes to `/pricing.html`
4. User picks Monthly ($19) or Lifetime ($149) → Stripe Checkout
5. After payment → Stripe webhook updates `subscription_tier = 'pro'`
6. User redirected to dashboard with success message
7. All future decision submissions are unlimited
8. Admin dashboard shows plan badges (Free / 💎 Pro Monthly / 👑 Lifetime)
9. Revenue tab shows MRR and plan breakdown
