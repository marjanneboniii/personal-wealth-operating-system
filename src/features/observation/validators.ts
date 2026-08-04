import { z } from "zod";

export const createObservationRunSchema = z.object({
  walletIdentityId: z.string().uuid(),
  providerName: z.enum(["DEBANK", "ZERION", "RPC", "COINGECKO", "MANUAL"]).default("DEBANK"),
});

export const providerPositionSchema = z.object({
  rawSymbol: z.string().min(1).max(50),
  rawName: z.string().max(200).optional(),
  contractAddress: z.string().max(128).optional().nullable(),
  chainId: z.number().int().optional().nullable(),
  networkCode: z.string().max(20).optional().nullable(),
  decimals: z.number().int().min(0).max(36).optional().nullable(),
  quantity: z.string().regex(/^-?\d+(\.\d+)?$/, "Invalid quantity"),
  priceUSD: z.string().optional().nullable(),
  valueUSD: z.string().optional().nullable(),
  positionType: z
    .enum(["token", "lp", "aave_supply", "aave_borrow", "pendle_pt", "pendle_yt", "staking", "vault", "lending", "borrowing"])
    .optional()
    .default("token"),
  protocol: z.string().max(100).optional().nullable(),
  metadata: z.record(z.string(), z.any()).optional().nullable(),
});

export const observationProviderSchema = z.object({
  name: z.string().min(2).max(50),
  type: z.enum(["api", "rpc"]).default("api"),
  config: z.string().optional().nullable(),
  isActive: z.boolean().optional().default(true),
});
