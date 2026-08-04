"use server";

import { z } from "zod";
import { runOnChainScenarioSimulation, getAiScenarioHistory, getDuneQueryCache } from "@/features/scenarios/service";

const executeScenarioSchema = z.object({
  userHypothesis: z.string().min(10, "Hypothesis must be at least 10 characters").max(5000),
  duneQueryId: z.number().int().positive("Dune query ID must be positive integer"),
  parameters: z.record(z.string(), z.any()).optional(),
});

export async function executeScenarioAction(userHypothesis: string, duneQueryId: number, parameters?: Record<string, any>) {
  try {
    const parsed = executeScenarioSchema.parse({ userHypothesis, duneQueryId, parameters });

    // Check env keys — graceful handling per spec
    if (!process.env.DUNE_API_KEY) {
      console.warn("[executeScenarioAction] DUNE_API_KEY missing — Dune fetch will return empty with warning");
    }
    if (!process.env.GOOGLE_AI_STUDIO_API_KEY && !process.env.GOOGLE_API_KEY) {
      console.warn("[executeScenarioAction] GOOGLE_AI_STUDIO_API_KEY missing — AI evaluation will return mock Persian analysis");
    }

    const result = await runOnChainScenarioSimulation(parsed.userHypothesis, parsed.duneQueryId, parsed.parameters);

    return {
      ok: true,
      message: `Scenario simulation completed: ${result.scenarioTitle}`,
      data: result,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Scenario execution failed",
    };
  }
}

export async function getScenarioHistoryAction() {
  try {
    const history = await getAiScenarioHistory(50);
    return { ok: true, data: history };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Failed to fetch scenario history", data: [] };
  }
}

export async function getDuneQueryCacheAction(queryId: number) {
  try {
    const id = z.number().int().positive().parse(queryId);
    const cached = await getDuneQueryCache(id);
    if (!cached) {
      return { ok: false, message: "No cache found for query", data: null };
    }
    return { ok: true, data: cached };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Failed to fetch Dune cache", data: null };
  }
}
