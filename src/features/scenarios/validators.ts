import { z } from "zod";

const decimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "Must be a valid decimal string")
  .refine((v) => {
    try {
      const n = Number(v);
      return !isNaN(n) && isFinite(n);
    } catch {
      return false;
    }
  }, "Invalid number");

const positiveDecimalString = decimalString.refine(
  (v) => {
    const numeric = Number(v);
    // allow string parsing to decimal logic, just check >0
    return numeric > 0;
  },
  { message: "Must be greater than zero" },
);

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return !isNaN(d.getTime());
  }, "Invalid date");

export const createScenarioSchema = z.object({
  name: z.string().min(1, "Name required").max(200),
  description: z.string().max(1000).optional(),
  assetId: z.string().uuid("assetId must be UUID"),
  initialCapital: positiveDecimalString,
  capitalCurrencyId: z.string().uuid().optional().nullable(),
  startDate: isoDate.refine(
    (v) => {
      const today = new Date().toISOString().slice(0, 10);
      return v <= today;
    },
    { message: "Start date cannot be in the future" },
  ),
  initialPrice: positiveDecimalString.optional(),
  notes: z.string().max(2000).optional(),
  userId: z.string().uuid().optional().nullable(),
});

export const evaluateScenarioSchema = z.object({
  scenarioId: z.string().uuid(),
  evaluationDate: isoDate.optional(),
});

export const compareBenchmarksSchema = z.object({
  scenarioId: z.string().uuid(),
  benchmarkSymbols: z
    .array(z.string().min(1).max(20))
    .min(1, "At least one benchmark required")
    .max(10),
  evaluationDate: isoDate.optional(),
});

export const timeRangeSchema = z.object({
  scenarioId: z.string().uuid(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
});

export const listScenariosSchema = z.object({
  userId: z.string().uuid().optional(),
  status: z.enum(["active", "archived", "closed"]).optional(),
});

export type CreateScenarioValidated = z.infer<typeof createScenarioSchema>;
export type EvaluateScenarioValidated = z.infer<typeof evaluateScenarioSchema>;
export type CompareBenchmarksValidated = z.infer<typeof compareBenchmarksSchema>;
export type TimeRangeValidated = z.infer<typeof timeRangeSchema>;
