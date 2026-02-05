# MarketSim Live 🚴

A competitive marketing simulation web platform where teams manage a carbon fiber bicycle startup across global markets. Inspired by Harvard's Marketplace simulation.

## Features
- **5 Market Segments**: Worker, Recreation, Youth, Mountain, Speed
- **3 Global Regions**: LATAM, Europe, APAC
- **8 Decision Rounds** with brand design, pricing, advertising, sales force, distribution, R&D
- **Balanced Scorecard** grading (Financial × Market × Marketing × Investment × Wealth)
- **Team Competition** (3-5 per team, 4-8 teams per game)
- **Instructor Tools**: Create games, manage teams, advance quarters, analytics
- **Full Auth**: Email/password + Google OAuth

## Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS (dark theme, responsive)
- **Backend**: Node.js serverless functions (Vercel)
- **Database**: PostgreSQL (Neon recommended)
- **Auth**: JWT + Google OAuth
- **Email**: Resend

## Setup

### 1. Create Database
Create a PostgreSQL database (Neon free tier works great):
```
psql $POSTGRES_URL < schema.sql
```

### 2. Environment Variables
Create `.env` or set in Vercel dashboard:
```
POSTGRES_URL=postgresql://user:pass@host/db?sslmode=require
JWT_SECRET=your-secret-key-min-32-chars
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=https://yourdomain.com/api/auth/google/callback
RESEND_API_KEY=re_xxxxx
FROM_EMAIL=noreply@yourdomain.com
ADMIN_EMAIL=admin@yourdomain.com
APP_URL=https://yourdomain.com
```

### 3. Install & Deploy
```bash
npm install
vercel --prod
```

### 4. Create Admin User
Register through the UI, then update in DB:
```sql
UPDATE users SET is_admin = true, is_instructor = true WHERE email = 'you@email.com';
```

## Project Structure
```
marketsim/
├── api/
│   ├── auth/           # Login, register, Google OAuth, password reset
│   ├── admin/          # User management, stats
│   ├── game/           # Create, join, list, details, advance quarter
│   ├── simulation/     # Submit decisions, results, leaderboard, research
│   └── team/           # Brand management, team members
├── lib/
│   ├── auth.js         # JWT auth middleware
│   ├── db.js           # Database models
│   ├── email.js        # Email service (Resend)
│   └── simulation-engine.js  # Core game logic
├── public/
│   ├── index.html      # Landing page
│   ├── dashboard.html  # Player dashboard
│   ├── simulation.html # Main game interface
│   └── admin.html      # Admin panel
├── schema.sql          # Database schema
├── package.json
└── vercel.json
```

## Game Flow
1. **Instructor** creates a game → gets a game code
2. **Students** join with the code → auto-assigned to teams
3. Each quarter, teams make decisions (brands, pricing, ads, etc.)
4. Teams submit → Instructor advances the quarter
5. Simulation engine processes all decisions simultaneously
6. Results generated → teams review and plan next quarter
7. After 8 quarters, final balanced scorecard determines winner

## Simulation Engine
- **Demand Model**: Multiplicative pull factors (targeting × brand fit × price × ads × sales × distribution)
- **Seasonality**: Q2/Q5/Q8 peak (spring/fall), Q3/Q6 low (summer/winter)
- **Market Growth**: Each segment grows at different rates
- **Balanced Scorecard**: Financial Performance × Market Performance × Marketing Effectiveness × Investment in Future × Creation of Wealth
