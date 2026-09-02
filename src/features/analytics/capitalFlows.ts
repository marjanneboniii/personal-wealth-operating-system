import { getCapitalFlowRecords } from "@/features/ledger/queries";
import { D, Decimal } from "@/domain/decimal";

export type CapitalFlowType = "deposit" | "withdrawal" | "opening_balance";

export type CapitalFlowItem = {
  id: string;
  entryDate: string;
  type: CapitalFlowType;
  amount: string;
  sourceReference: string;
  description: string;
};

export type CapitalFlowsSummary = {
  inflows: CapitalFlowItem[];
  outflows: CapitalFlowItem[];
  netExternalCapitalFlow: string;
};

export interface ExternalCapitalFlowProvider {
  getExternalCapitalFlows(
    userId?: string,
    periodStart?: string,
    periodEnd?: string,
  ): Promise<CapitalFlowsSummary>;
}

/**
 * Default Implementation of ExternalCapitalFlowProvider.
 *
 * ARCHITECTURAL RULE (Patch 1):
 * Analytics consumes data strictly through Accounting Query Services (getCapitalFlowRecords).
 * Exposes ONLY explicit external capital deposits, withdrawals, and opening entries.
 * It NEVER treats generic salary/business income, household expenses, or internal trade sales as external capital flows.
 */
export class DefaultExternalCapitalFlowProvider implements ExternalCapitalFlowProvider {
  async getExternalCapitalFlows(
    userId?: string,
    periodStart = "2025-01-01",
    periodEnd = "2026-08-02",
  ): Promise<CapitalFlowsSummary> {
    // Call Accounting Query Service (Accounting Core -> Analytics Adapter -> Wealth Analytics).
    // The tenant id is threaded through so capital-flow records are strictly
    // user-scoped — never a global read across users.
    const rows = await getCapitalFlowRecords(periodStart, periodEnd, userId);

    const inflows: CapitalFlowItem[] = [];
    const outflows: CapitalFlowItem[] = [];
    let netInflowsDec = Decimal.zero();
    let netOutflowsDec = Decimal.zero();

    for (const r of rows) {
      const val = D(r.baseValue);

      // Only explicit opening capital entries or capital injections/withdrawals are classified as capital flows
      const isOpening = r.type === "opening" || r.description.includes("افتتاحیه");
      const isCapitalDeposit = r.description.includes("تزریق سرمایه") || r.description.includes("واریز اولیه") || r.description.includes("Capital Deposit");
      const isCapitalWithdrawal = r.description.includes("برداشت سرمایه") || r.description.includes("Capital Withdrawal");

      // DIRECTION FIRST: an explicit capital-withdrawal posting (negative
      // asset leg) must be classified as an outflow even when the entry type
      // is `opening` (e.g. a capital exit booked with an opening-type entry).
      // The previous if/else matched those rows as «opening» and silently
      // dropped the negative leg, so a pure withdrawal looked like zero net
      // flows and appeared as a fake investment loss.
      if (isCapitalWithdrawal) {
        if (val.lt(0)) {
          outflows.push({
            id: r.id,
            entryDate: r.entryDate,
            type: "withdrawal",
            amount: val.abs().toString(),
            sourceReference: r.reference ?? r.id,
            description: r.description,
          });
          netOutflowsDec = netOutflowsDec.add(val.abs());
        }
      } else if (isOpening || isCapitalDeposit) {
        if (val.gt(0)) {
          inflows.push({
            id: r.id,
            entryDate: r.entryDate,
            type: isOpening ? "opening_balance" : "deposit",
            amount: val.toString(),
            sourceReference: r.reference ?? r.id,
            description: r.description,
          });
          netInflowsDec = netInflowsDec.add(val);
        }
      }
    }

    return {
      inflows,
      outflows,
      netExternalCapitalFlow: netInflowsDec.sub(netOutflowsDec).toString(),
    };
  }
}
