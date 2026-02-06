-- MarketSim Live - Marketing & Sales Simulation Database Schema
-- Run this in Neon SQL Editor (https://console.neon.tech)

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  password_hash VARCHAR(255),
  organization VARCHAR(255),
  job_title VARCHAR(255),
  is_admin BOOLEAN DEFAULT false,
  is_instructor BOOLEAN DEFAULT false,
  google_id VARCHAR(255),
  auth_provider VARCHAR(50) DEFAULT 'email',
  email_verified BOOLEAN DEFAULT false,
  reset_token VARCHAR(255),
  reset_token_expires TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Games (simulation instances)
CREATE TABLE IF NOT EXISTS games (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(20) UNIQUE NOT NULL,
  instructor_id INTEGER REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'setup',
  current_quarter INTEGER DEFAULT 0,
  total_quarters INTEGER DEFAULT 8,
  market_scenario VARCHAR(50) DEFAULT 'bikes',
  max_teams INTEGER DEFAULT 8,
  max_team_size INTEGER DEFAULT 5,
  quarter_deadline TIMESTAMP,
  auto_advance BOOLEAN DEFAULT false,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Teams
CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  company_name VARCHAR(255),
  logo_emoji VARCHAR(10) DEFAULT '🚲',
  cash_balance DECIMAL(12,2) DEFAULT 5000000,
  total_investment DECIMAL(12,2) DEFAULT 5000000,
  cumulative_profit DECIMAL(12,2) DEFAULT 0,
  retained_earnings DECIMAL(12,2) DEFAULT 0,
  has_submitted BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(game_id, name)
);

-- Team members
CREATE TABLE IF NOT EXISTS team_members (
  id SERIAL PRIMARY KEY,
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(100) DEFAULT 'member',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id, user_id)
);

-- Market segments
CREATE TABLE IF NOT EXISTS market_segments (
  id SERIAL PRIMARY KEY,
  game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(20) NOT NULL,
  description TEXT,
  pref_price_sensitivity INTEGER DEFAULT 5,
  pref_performance INTEGER DEFAULT 5,
  pref_durability INTEGER DEFAULT 5,
  pref_style INTEGER DEFAULT 5,
  pref_comfort INTEGER DEFAULT 5,
  pref_lightweight INTEGER DEFAULT 5,
  pref_customization INTEGER DEFAULT 5,
  potential_demand_latam INTEGER DEFAULT 2000,
  potential_demand_europe INTEGER DEFAULT 3000,
  potential_demand_apac INTEGER DEFAULT 2500,
  min_price DECIMAL(10,2) DEFAULT 500,
  max_price DECIMAL(10,2) DEFAULT 2000,
  ideal_price DECIMAL(10,2) DEFAULT 1000,
  growth_rate DECIMAL(5,2) DEFAULT 5.0
);

-- Brands (products)
CREATE TABLE IF NOT EXISTS brands (
  id SERIAL PRIMARY KEY,
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  target_segment VARCHAR(20),
  status VARCHAR(20) DEFAULT 'active',
  comp_frame INTEGER DEFAULT 5,
  comp_wheels INTEGER DEFAULT 5,
  comp_drivetrain INTEGER DEFAULT 5,
  comp_brakes INTEGER DEFAULT 5,
  comp_suspension INTEGER DEFAULT 3,
  comp_seat INTEGER DEFAULT 5,
  comp_handlebars INTEGER DEFAULT 5,
  comp_electronics INTEGER DEFAULT 0,
  overall_quality DECIMAL(5,2) DEFAULT 50,
  unit_cost DECIMAL(10,2) DEFAULT 300,
  rd_investment DECIMAL(12,2) DEFAULT 0,
  quarter_created INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Quarterly decisions
CREATE TABLE IF NOT EXISTS quarterly_decisions (
  id SERIAL PRIMARY KEY,
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  quarter INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'draft',
  primary_segment VARCHAR(20),
  secondary_segment VARCHAR(20),
  pricing_decisions JSONB DEFAULT '[]',
  advertising_decisions JSONB DEFAULT '[]',
  internet_marketing JSONB DEFAULT '{}',
  salesforce_decisions JSONB DEFAULT '{}',
  distribution_decisions JSONB DEFAULT '{}',
  rd_budget DECIMAL(12,2) DEFAULT 0,
  rd_projects JSONB DEFAULT '[]',
  production_decisions JSONB DEFAULT '[]',
  dividend_payment DECIMAL(12,2) DEFAULT 0,
  submitted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id, quarter)
);

-- Quarterly results
CREATE TABLE IF NOT EXISTS quarterly_results (
  id SERIAL PRIMARY KEY,
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  quarter INTEGER NOT NULL,
  total_demand INTEGER DEFAULT 0,
  total_units_sold INTEGER DEFAULT 0,
  stockouts INTEGER DEFAULT 0,
  market_share_primary DECIMAL(5,2) DEFAULT 0,
  market_share_secondary DECIMAL(5,2) DEFAULT 0,
  total_revenue DECIMAL(12,2) DEFAULT 0,
  cost_of_goods DECIMAL(12,2) DEFAULT 0,
  gross_profit DECIMAL(12,2) DEFAULT 0,
  advertising_expense DECIMAL(12,2) DEFAULT 0,
  salesforce_expense DECIMAL(12,2) DEFAULT 0,
  distribution_expense DECIMAL(12,2) DEFAULT 0,
  internet_marketing_expense DECIMAL(12,2) DEFAULT 0,
  rd_expense DECIMAL(12,2) DEFAULT 0,
  admin_expense DECIMAL(12,2) DEFAULT 0,
  total_expenses DECIMAL(12,2) DEFAULT 0,
  operating_profit DECIMAL(12,2) DEFAULT 0,
  net_income DECIMAL(12,2) DEFAULT 0,
  beginning_cash DECIMAL(12,2) DEFAULT 0,
  ending_cash DECIMAL(12,2) DEFAULT 0,
  brand_satisfaction DECIMAL(5,3) DEFAULT 0,
  ad_satisfaction DECIMAL(5,3) DEFAULT 0,
  price_satisfaction DECIMAL(5,3) DEFAULT 0,
  overall_satisfaction DECIMAL(5,3) DEFAULT 0,
  financial_performance DECIMAL(8,3) DEFAULT 0,
  market_performance DECIMAL(8,3) DEFAULT 0,
  marketing_effectiveness DECIMAL(8,3) DEFAULT 0,
  investment_in_future DECIMAL(8,3) DEFAULT 0,
  creation_of_wealth DECIMAL(8,3) DEFAULT 0,
  balanced_scorecard DECIMAL(8,3) DEFAULT 0,
  results_detail JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id, quarter)
);

-- Market research
CREATE TABLE IF NOT EXISTS market_research (
  id SERIAL PRIMARY KEY,
  game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
  quarter INTEGER NOT NULL,
  segment_demands JSONB DEFAULT '{}',
  competitor_prices JSONB DEFAULT '{}',
  brand_judgments JSONB DEFAULT '{}',
  ad_judgments JSONB DEFAULT '{}',
  market_trends JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(game_id, quarter)
);

-- Game events log
CREATE TABLE IF NOT EXISTS game_events (
  id SERIAL PRIMARY KEY,
  game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
  team_id INTEGER REFERENCES teams(id),
  quarter INTEGER,
  event_type VARCHAR(50),
  message TEXT,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Admin activity log
CREATE TABLE IF NOT EXISTS admin_activity_log (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER REFERENCES users(id),
  action VARCHAR(100),
  details JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_games_code ON games(code);
CREATE INDEX IF NOT EXISTS idx_games_instructor ON games(instructor_id);
CREATE INDEX IF NOT EXISTS idx_teams_game ON teams(game_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_brands_team ON brands(team_id);
CREATE INDEX IF NOT EXISTS idx_decisions_team_quarter ON quarterly_decisions(team_id, quarter);
CREATE INDEX IF NOT EXISTS idx_results_team_quarter ON quarterly_results(team_id, quarter);
CREATE INDEX IF NOT EXISTS idx_events_game ON game_events(game_id);
