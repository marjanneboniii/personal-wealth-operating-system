import { z } from "zod";

const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function isValidAddress(addr: string): boolean {
  const trimmed = addr.trim();
  return ethAddressRegex.test(trimmed) || solanaAddressRegex.test(trimmed) || trimmed.length >= 26;
}

export const createWalletIdentitySchema = z.object({
  userId: z.string().uuid().optional().nullable(),
  address: z
    .string()
    .min(26, "Address too short")
    .max(128)
    .transform((s) => s.trim().toLowerCase())
    .refine((s) => isValidAddress(s), "Invalid blockchain address format"),
  networkId: z.string().uuid().optional().nullable(),
  chainId: z.number().int().optional().nullable(),
  label: z.string().max(200).optional(),
  walletType: z
    .enum(["personal", "external_research", "protocol_treasury", "whale", "exchange"])
    .optional()
    .default("personal"),
  ownershipCategory: z
    .enum(["self_custody", "external", "research", "observed", "custodial"])
    .optional()
    .default("self_custody"),
  isVerified: z.boolean().optional().default(false),
  linkedAccountId: z.string().uuid().optional().nullable(),
  notes: z.string().max(1000).optional(),
});

export const listWalletIdentitiesSchema = z.object({
  userId: z.string().uuid().optional(),
  walletType: z.enum(["personal", "external_research", "protocol_treasury", "whale", "exchange"]).optional(),
  ownershipCategory: z
    .enum(["self_custody", "external", "research", "observed", "custodial"])
    .optional(),
});

export type CreateWalletIdentityValidated = z.infer<typeof createWalletIdentitySchema>;
