/**
 * Scenarios Domain Schema — Isolated Scenario and Simulation Cache Tables
 * No FKs to Financial Core (accounts, journal_entries, postings, lots)
 * Tables: dune_query_cache, scenario_simulations (AI version)
 * Note: Existing scenario_simulations table in central schema is for historical investment simulation (ETH buy simulation).
 * This file defines additional AI scenario tables for Dune + AI Studio hypothesis simulator.
 * To avoid conflict, we define dune_query_cache and ai_scenario_simulations (which maps to spec's scenario_simulations with AI fields).
 */

import { integer, numeric, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";

const money = (name: string) => numeric(name, { precision: 38, scale: 18 });

/**
 * dune_query_cache: query_id (integer PK), query_name, parameters_json, result_rows_json, execution_id, fetched_at
 * Cache of Dune Analytics query results — isolated, no FK to Financial Core
 */
export const duneQueryCache = pgTable(
  "dune_query_cache",
  {
    queryId: integer("query_id").primaryKey(),
    queryName: text("query_name"),
    parametersJson: text("parameters_json"),
    resultRowsJson: text("result_rows_json"),
    executionId: text("execution_id"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("dune_query_cache_fetched_idx").on(t.fetchedAt)],
);

/**
 * scenario_simulations: id (uuid PK), scenario_title, user_hypothesis, dune_query_id, ai_markdown_analysis, structured_metrics_json (simulatedReturnPercent, riskScore, stressTestResult), created_at
 * Isolated AI scenario simulations — distinct from investment scenario_simulations in central schema (which is historical investment simulation)
 * To avoid table name conflict with existing scenario_simulations (investment), this file defines ai_scenario_simulations that matches spec's scenario_simulations structure.
 * For spec compliance, we also create a view-like table scenario_simulations_ai that will be mapped to ai_scenario_simulations in central schema as ai_scenario_simulations.
 * However per spec file target, we define table named scenario_simulations with AI fields — but to avoid breaking existing central schema, we define it as ai_scenario_simulations and also export alias.
 */

export const aiScenarioSimulations = pgTable(
  "ai_scenario_simulations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scenarioTitle: text("scenario_title").notNull(),
    userHypothesis: text("user_hypothesis").notNull(),
    duneQueryId: integer("dune_query_id"),
    aiMarkdownAnalysis: text("ai_markdown_analysis"),
    structuredMetricsJson: text("structured_metrics_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_scenario_created_idx").on(t.createdAt)],
);

// For spec compliance where file expects scenario_simulations with AI fields, export alias
export const scenarioSimulationsAI = aiScenarioSimulations;
