// lib/db.js - Database helpers for MarketSim Live
import { sql } from '@vercel/postgres';

// ==================== USER DB ====================
export const UserDB = {
  async create(email, passwordHash, name) {
    const result = await sql`
      INSERT INTO users (email, password_hash, name, auth_provider)
      VALUES (${email}, ${passwordHash}, ${name}, 'email')
      RETURNING *
    `;
    return result.rows[0];
  },

  async createGoogleUser(email, name, googleId) {
    const result = await sql`
      INSERT INTO users (email, name, google_id, auth_provider, email_verified)
      VALUES (${email}, ${name}, ${googleId}, 'google', true)
      RETURNING *
    `;
    return result.rows[0];
  },

  async linkGoogleAccount(userId, googleId) {
    const result = await sql`
      UPDATE users SET google_id = ${googleId}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${userId}
      RETURNING *
    `;
    return result.rows[0];
  },

  async findByEmail(email) {
    const result = await sql`SELECT * FROM users WHERE email = ${email}`;
    return result.rows[0] || null;
  },

  async findById(id) {
    const result = await sql`SELECT * FROM users WHERE id = ${id}`;
    return result.rows[0] || null;
  },

  async setResetToken(email, token, expiresAt) {
    const result = await sql`
      UPDATE users SET reset_token = ${token}, reset_token_expires = ${expiresAt}, updated_at = CURRENT_TIMESTAMP
      WHERE email = ${email} RETURNING *
    `;
    return result.rows[0];
  },

  async findByResetToken(token) {
    const result = await sql`
      SELECT * FROM users WHERE reset_token = ${token} AND reset_token_expires > CURRENT_TIMESTAMP
    `;
    return result.rows[0] || null;
  },

  async updatePassword(id, passwordHash) {
    const result = await sql`
      UPDATE users SET password_hash = ${passwordHash}, reset_token = NULL, reset_token_expires = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id} RETURNING *
    `;
    return result.rows[0];
  },

  async getAll() {
    const result = await sql`SELECT id, email, name, is_admin, auth_provider, created_at FROM users ORDER BY created_at DESC`;
    return result.rows;
  }
};

// ==================== GAME DB ====================
export const GameDB = {
  async create({ name, code, userId, marketScenario = 'local-launch', settings = {} }) {
    const result = await sql`
      INSERT INTO games (name, code, user_id, market_scenario, settings)
      VALUES (${name}, ${code}, ${userId}, ${marketScenario}, ${JSON.stringify(settings)})
      RETURNING *
    `;
    return result.rows[0];
  },

  async findById(id) {
    const result = await sql`SELECT * FROM games WHERE id = ${id}`;
    return result.rows[0] || null;
  },

  async findByCode(code) {
    const result = await sql`SELECT * FROM games WHERE code = ${code.toUpperCase()}`;
    return result.rows[0] || null;
  },

  async findByUser(userId) {
    const result = await sql`
      SELECT g.*, COUNT(DISTINCT t.id) as team_count
      FROM games g LEFT JOIN teams t ON t.game_id = g.id
      GROUP BY g.id
      HAVING g.user_id = ${userId}
      ORDER BY g.created_at DESC
    `;
    return result.rows;
  },

  async updateStatus(id, status) {
    const result = await sql`
      UPDATE games SET status = ${status}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id} RETURNING *
    `;
    return result.rows[0];
  },

  async advanceQuarter(id) {
    const result = await sql`
      UPDATE games SET current_quarter = current_quarter + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id} AND current_quarter < 8 RETURNING *
    `;
    return result.rows[0];
  },

  async setQuarterDeadline(id, deadline) {
    const result = await sql`
      UPDATE games SET quarter_deadline = ${deadline}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id} RETURNING *
    `;
    return result.rows[0];
  },

  async resetTeamSubmissions(gameId) {
    await sql`UPDATE teams SET has_submitted = false WHERE game_id = ${gameId}`;
  },

  async getWithTeams(gameId) {
    const game = await this.findById(gameId);
    if (!game) return null;
    const teams = await TeamDB.findByGame(gameId);
    return { ...game, teams };
  }
};

// ==================== TEAM DB ====================
export const TeamDB = {
  async create({ gameId, name, logoEmoji = '📱', cashBalance = 5000000, isAi = false }) {
    const result = await sql`
      INSERT INTO teams (game_id, name, logo_emoji, cash_balance, is_ai)
      VALUES (${gameId}, ${name}, ${logoEmoji}, ${cashBalance}, ${isAi})
      RETURNING *
    `;
    return result.rows[0];
  },

  async findById(id) {
    const result = await sql`SELECT * FROM teams WHERE id = ${id}`;
    return result.rows[0] || null;
  },

  async findByGame(gameId) {
    const result = await sql`
      SELECT * FROM teams WHERE game_id = ${gameId} ORDER BY name
    `;
    return result.rows;
  },

  async updateFinancials(id, { cashBalance, totalInvestment, cumulativeProfit, retainedEarnings }) {
    const result = await sql`
      UPDATE teams SET
        cash_balance = COALESCE(${cashBalance}, cash_balance),
        total_investment = COALESCE(${totalInvestment}, total_investment),
        cumulative_profit = COALESCE(${cumulativeProfit}, cumulative_profit),
        retained_earnings = COALESCE(${retainedEarnings}, retained_earnings),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id} RETURNING *
    `;
    return result.rows[0];
  },

  async setSubmitted(id, submitted = true) {
    const result = await sql`
      UPDATE teams SET has_submitted = ${submitted}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id} RETURNING *
    `;
    return result.rows[0];
  },

};

// ==================== MARKET SEGMENT DB ====================
export const SegmentDB = {
  async getForGame(gameId) {
    const result = await sql`SELECT * FROM market_segments WHERE game_id = ${gameId} ORDER BY name`;
    return result.rows;
  },

  async seedDefaults(gameId) {
    const segments = [
      { name: 'Worker', code: 'worker', desc: 'Budget-conscious professionals who need reliable, practical products for daily use', priceMin: 600, priceMax: 1000, potentialLatam: 3000, potentialEurope: 5000, potentialApac: 4000, growth: 0.05, priceSens: 0.25, performance: 0.10, durability: 0.25, style: 0.05, comfort: 0.25, lightweight: 0.05, customization: 0.05 },
      { name: 'Recreation', code: 'recreation', desc: 'Casual users who value style, comfort, and a great user experience', priceMin: 700, priceMax: 1200, potentialLatam: 4000, potentialEurope: 6000, potentialApac: 5000, growth: 0.08, priceSens: 0.15, performance: 0.10, durability: 0.15, style: 0.20, comfort: 0.20, lightweight: 0.10, customization: 0.10 },
      { name: 'Youth', code: 'youth', desc: 'Young buyers looking for trendy, affordable products with social appeal', priceMin: 500, priceMax: 900, potentialLatam: 5000, potentialEurope: 4000, potentialApac: 6000, growth: 0.10, priceSens: 0.30, performance: 0.05, durability: 0.10, style: 0.30, comfort: 0.10, lightweight: 0.05, customization: 0.10 },
      { name: 'Mountain', code: 'mountain', desc: 'Power users who demand rugged, high-performance products for demanding tasks', priceMin: 900, priceMax: 1500, potentialLatam: 2000, potentialEurope: 4000, potentialApac: 3000, growth: 0.06, priceSens: 0.10, performance: 0.30, durability: 0.20, style: 0.05, comfort: 0.05, lightweight: 0.15, customization: 0.15 },
      { name: 'Speed', code: 'speed', desc: 'Performance enthusiasts focused on cutting-edge specs and lightweight design', priceMin: 1000, priceMax: 1800, potentialLatam: 1500, potentialEurope: 3500, potentialApac: 2500, growth: 0.04, priceSens: 0.05, performance: 0.30, durability: 0.10, style: 0.10, comfort: 0.05, lightweight: 0.30, customization: 0.10 }
    ];

    for (const s of segments) {
      await sql`
        INSERT INTO market_segments (game_id, name, code, description, pref_price_sensitivity, pref_performance, pref_durability, pref_style, pref_comfort, pref_lightweight, pref_customization, potential_demand_latam, potential_demand_europe, potential_demand_apac, min_price, max_price, growth_rate)
        VALUES (${gameId}, ${s.name}, ${s.code}, ${s.desc}, ${s.priceSens}, ${s.performance}, ${s.durability}, ${s.style}, ${s.comfort}, ${s.lightweight}, ${s.customization}, ${s.potentialLatam}, ${s.potentialEurope}, ${s.potentialApac}, ${s.priceMin}, ${s.priceMax}, ${s.growth})
      `;
    }
  }
};

// ==================== BRAND DB ====================
export const BrandDB = {
  async create({ teamId, name, targetSegment, frameQuality = 3, wheelsQuality = 3, drivetrainQuality = 3, brakesQuality = 3, suspensionQuality = 3, seatQuality = 3, handlebarsQuality = 3, electronicsQuality = 0, rdInvestment = 0 }) {
    const components = [frameQuality, wheelsQuality, drivetrainQuality, brakesQuality, suspensionQuality, seatQuality, handlebarsQuality, electronicsQuality];
    const overallQuality = components.reduce((sum, q) => sum + q, 0) / components.filter(q => q > 0).length;
    const unitCost = 150 + components.reduce((sum, q) => sum + q * 40, 0);

    const result = await sql`
      INSERT INTO brands (team_id, name, target_segment, comp_frame, comp_wheels, comp_drivetrain, comp_brakes, comp_suspension, comp_seat, comp_handlebars, comp_electronics, overall_quality, unit_cost, rd_investment)
      VALUES (${teamId}, ${name}, ${targetSegment}, ${frameQuality}, ${wheelsQuality}, ${drivetrainQuality}, ${brakesQuality}, ${suspensionQuality}, ${seatQuality}, ${handlebarsQuality}, ${electronicsQuality}, ${overallQuality}, ${unitCost}, ${rdInvestment})
      RETURNING *
    `;
    // Normalize column names for downstream code
    return normalizeBrand(result.rows[0]);
  },

  async findByTeam(teamId) {
    const result = await sql`SELECT * FROM brands WHERE team_id = ${teamId} AND status = 'active' ORDER BY name`;
    return result.rows.map(normalizeBrand);
  },

  async findById(id) {
    const result = await sql`SELECT * FROM brands WHERE id = ${id}`;
    return result.rows[0] ? normalizeBrand(result.rows[0]) : null;
  },

  async update(id, updates) {
    const components = [
      updates.frameQuality || 3, updates.wheelsQuality || 3, updates.drivetrainQuality || 3,
      updates.brakesQuality || 3, updates.suspensionQuality || 3, updates.seatQuality || 3,
      updates.handlebarsQuality || 3, updates.electronicsQuality || 0
    ];
    const overallQuality = components.reduce((s, q) => s + q, 0) / components.filter(q => q > 0).length;
    const unitCost = 150 + components.reduce((s, q) => s + q * 40, 0);

    const result = await sql`
      UPDATE brands SET
        name = COALESCE(${updates.name}, name),
        target_segment = COALESCE(${updates.targetSegment}, target_segment),
        comp_frame = COALESCE(${updates.frameQuality}, comp_frame),
        comp_wheels = COALESCE(${updates.wheelsQuality}, comp_wheels),
        comp_drivetrain = COALESCE(${updates.drivetrainQuality}, comp_drivetrain),
        comp_brakes = COALESCE(${updates.brakesQuality}, comp_brakes),
        comp_suspension = COALESCE(${updates.suspensionQuality}, comp_suspension),
        comp_seat = COALESCE(${updates.seatQuality}, comp_seat),
        comp_handlebars = COALESCE(${updates.handlebarsQuality}, comp_handlebars),
        comp_electronics = COALESCE(${updates.electronicsQuality}, comp_electronics),
        overall_quality = ${overallQuality},
        unit_cost = ${unitCost},
        rd_investment = COALESCE(${updates.rdInvestment}, rd_investment)
      WHERE id = ${id} RETURNING *
    `;
    return normalizeBrand(result.rows[0]);
  },

  async deactivate(id) {
    await sql`UPDATE brands SET status = 'inactive' WHERE id = ${id}`;
  }
};

// Normalize brand column names so downstream code can use either naming
function normalizeBrand(b) {
  if (!b) return b;
  b.frame_quality = b.comp_frame;
  b.wheels_quality = b.comp_wheels;
  b.drivetrain_quality = b.comp_drivetrain;
  b.brakes_quality = b.comp_brakes;
  b.suspension_quality = b.comp_suspension;
  b.seat_quality = b.comp_seat;
  b.handlebars_quality = b.comp_handlebars;
  b.electronics_quality = b.comp_electronics;
  return b;
}

// ==================== DECISION DB ====================
export const DecisionDB = {
  async upsert(teamId, quarter, decisions) {
    const { pricing = {}, advertising = {}, internet = {}, salesforce = {}, distribution = {}, rdBudget = 0, rdProjects = {}, production = {}, dividend = 0 } = decisions;

    const result = await sql`
      INSERT INTO quarterly_decisions (team_id, quarter, pricing_decisions, advertising_decisions, internet_marketing, salesforce_decisions, distribution_decisions, rd_budget, rd_projects, production_decisions, dividend_payment)
      VALUES (${teamId}, ${quarter}, ${JSON.stringify(pricing)}, ${JSON.stringify(advertising)}, ${JSON.stringify(internet)}, ${JSON.stringify(salesforce)}, ${JSON.stringify(distribution)}, ${rdBudget}, ${JSON.stringify(rdProjects)}, ${JSON.stringify(production)}, ${dividend})
      ON CONFLICT (team_id, quarter) DO UPDATE SET
        pricing_decisions = ${JSON.stringify(pricing)},
        advertising_decisions = ${JSON.stringify(advertising)},
        internet_marketing = ${JSON.stringify(internet)},
        salesforce_decisions = ${JSON.stringify(salesforce)},
        distribution_decisions = ${JSON.stringify(distribution)},
        rd_budget = ${rdBudget},
        rd_projects = ${JSON.stringify(rdProjects)},
        production_decisions = ${JSON.stringify(production)},
        dividend_payment = ${dividend},
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    return result.rows[0];
  },

  async findByTeamAndQuarter(teamId, quarter) {
    const result = await sql`
      SELECT * FROM quarterly_decisions WHERE team_id = ${teamId} AND quarter = ${quarter}
    `;
    return result.rows[0] || null;
  },

  async findAllForQuarter(gameId, quarter) {
    const result = await sql`
      SELECT qd.*, t.name as team_name FROM quarterly_decisions qd
      JOIN teams t ON t.id = qd.team_id
      WHERE t.game_id = ${gameId} AND qd.quarter = ${quarter}
    `;
    return result.rows;
  }
};

// ==================== RESULT DB ====================
export const ResultDB = {
  async create(teamId, quarter, results) {
    const r = results;
    const res = await sql`
      INSERT INTO quarterly_results (team_id, quarter, total_demand, total_units_sold, stockouts, market_share_primary, market_share_secondary, total_revenue, cost_of_goods, gross_profit, advertising_expense, salesforce_expense, distribution_expense, internet_marketing_expense, rd_expense, admin_expense, total_expenses, operating_profit, net_income, beginning_cash, ending_cash, brand_satisfaction, ad_satisfaction, price_satisfaction, overall_satisfaction, financial_performance, market_performance, marketing_effectiveness, investment_in_future, creation_of_wealth, balanced_scorecard)
      VALUES (${teamId}, ${quarter}, ${r.totalDemand || 0}, ${r.unitsSold || 0}, ${r.stockouts || 0}, ${r.marketSharePrimary || 0}, ${r.marketShareSecondary || 0}, ${r.revenue || 0}, ${r.costOfGoods || 0}, ${r.grossProfit || 0}, ${r.advertisingExpense || 0}, ${r.salesforceExpense || 0}, ${r.distributionExpense || 0}, ${r.internetExpense || 0}, ${r.rdExpense || 0}, ${r.adminExpense || 0}, ${r.totalExpenses || 0}, ${r.operatingProfit || 0}, ${r.netIncome || 0}, ${r.beginningCash || 0}, ${r.endingCash || 0}, ${r.brandSatisfaction || 0}, ${r.adSatisfaction || 0}, ${r.priceSatisfaction || 0}, ${r.overallSatisfaction || 0}, ${r.financialPerformance || 0}, ${r.marketPerformance || 0}, ${r.marketingEffectiveness || 0}, ${r.investmentInFuture || 0}, ${r.creationOfWealth || 0}, ${r.balancedScorecard || 0})
      RETURNING *
    `;
    return res.rows[0];
  },

  async findByTeamAndQuarter(teamId, quarter) {
    const result = await sql`SELECT * FROM quarterly_results WHERE team_id = ${teamId} AND quarter = ${quarter}`;
    return result.rows[0] || null;
  },

  async findAllByTeam(teamId) {
    const result = await sql`SELECT * FROM quarterly_results WHERE team_id = ${teamId} ORDER BY quarter`;
    return result.rows;
  },

  async findAllForQuarter(gameId, quarter) {
    const result = await sql`
      SELECT qr.*, t.name as team_name FROM quarterly_results qr
      JOIN teams t ON t.id = qr.team_id
      WHERE t.game_id = ${gameId} AND qr.quarter = ${quarter}
      ORDER BY qr.balanced_scorecard DESC
    `;
    return result.rows;
  },

  async getCumulativeScorecard(teamId, currentQuarter) {
    const startQ = Math.max(1, currentQuarter - 3);
    const result = await sql`
      SELECT AVG(balanced_scorecard) as cumulative_scorecard,
             AVG(financial_performance) as avg_financial,
             AVG(market_performance) as avg_market,
             AVG(marketing_effectiveness) as avg_marketing,
             AVG(investment_in_future) as avg_investment,
             AVG(creation_of_wealth) as avg_wealth
      FROM quarterly_results WHERE team_id = ${teamId} AND quarter BETWEEN ${startQ} AND ${currentQuarter}
    `;
    return result.rows[0];
  }
};

// ==================== MARKET RESEARCH DB ====================
export const MarketResearchDB = {
  async save(gameId, quarter, data) {
    const result = await sql`
      INSERT INTO market_research (game_id, quarter, segment_demands, competitor_prices, brand_judgments, ad_judgments, market_trends)
      VALUES (${gameId}, ${quarter}, ${JSON.stringify(data.segmentDemands || {})}, ${JSON.stringify(data.competitorPrices || {})}, ${JSON.stringify(data.brandJudgments || {})}, ${JSON.stringify(data.adJudgments || {})}, ${JSON.stringify(data.marketTrends || {})})
      ON CONFLICT (game_id, quarter) DO UPDATE SET
        segment_demands = ${JSON.stringify(data.segmentDemands || {})},
        competitor_prices = ${JSON.stringify(data.competitorPrices || {})},
        brand_judgments = ${JSON.stringify(data.brandJudgments || {})},
        ad_judgments = ${JSON.stringify(data.adJudgments || {})},
        market_trends = ${JSON.stringify(data.marketTrends || {})}
      RETURNING *
    `;
    return result.rows[0];
  },

  async findByQuarter(gameId, quarter) {
    const result = await sql`SELECT * FROM market_research WHERE game_id = ${gameId} AND quarter = ${quarter}`;
    return result.rows[0] || null;
  }
};

// ==================== GAME EVENTS DB ====================
export const EventDB = {
  async log(gameId, teamId, quarter, eventType, details = {}) {
    await sql`
      INSERT INTO game_events (game_id, team_id, quarter, event_type, details)
      VALUES (${gameId}, ${teamId}, ${quarter}, ${eventType}, ${JSON.stringify(details)})
    `;
  },

  async getForGame(gameId, limit = 50) {
    const result = await sql`
      SELECT ge.*, t.name as team_name FROM game_events ge
      LEFT JOIN teams t ON t.id = ge.team_id
      WHERE ge.game_id = ${gameId}
      ORDER BY ge.created_at DESC LIMIT ${limit}
    `;
    return result.rows;
  }
};
