"use server";

import { z } from "zod";
import { syncFullWalletData, getWatchWalletPortfolio, getWatchWalletPositions, getWatchWalletTransactions } from "@/features/observation/service";

const addressSchema = z
  .string()
  .min(26, "Address too short")
  .max(128)
  .transform((s) => s.trim().toLowerCase())
  .refine((s) => /^0x[a-fA-F0-9]{40}$/.test(s) || s.length >= 32, "Invalid wallet address format");

export async function syncWalletAction(address: string) {
  try {
    const parsedAddress = addressSchema.parse(address);

    // Check API key presence — graceful handling per spec
    if (!process.env.ZERION_API_KEY) {
      console.warn("[syncWalletAction] ZERION_API_KEY missing — will return empty cache with warning");
    }

    const result = await syncFullWalletData(parsedAddress);

    return {
      ok: true,
      message: `Wallet ${parsedAddress.slice(0, 6)}... synced: ${result.positionsCount} positions, ${result.transactionsCount} transactions, ${result.nftsCount} NFTs, ${result.perpsCount} perps`,
      data: result,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Wallet sync failed",
    };
  }
}

export async function getWalletObservedPortfolioAction(address: string) {
  try {
    const parsedAddress = addressSchema.parse(address);
    const portfolio = await getWatchWalletPortfolio(parsedAddress);

    if (!portfolio) {
      return { ok: false, message: "No portfolio cache found for wallet, please sync first", data: null };
    }

    return { ok: true, data: portfolio };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Failed to fetch portfolio", data: null };
  }
}

export async function getWalletDeFiPositionsAction(address: string) {
  try {
    const parsedAddress = addressSchema.parse(address);
    const positions = await getWatchWalletPositions(parsedAddress);

    return { ok: true, data: positions };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Failed to fetch DeFi positions", data: [] };
  }
}

export async function getWalletTransactionsHistoryAction(address: string) {
  try {
    const parsedAddress = addressSchema.parse(address);
    const transactions = await getWatchWalletTransactions(parsedAddress, 100);

    return { ok: true, data: transactions };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Failed to fetch transactions", data: [] };
  }
}
