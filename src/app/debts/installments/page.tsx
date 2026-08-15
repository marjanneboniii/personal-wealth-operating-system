import InstallmentsPage from "@/app/installments/page";

export const dynamic = "force-dynamic";

export const metadata = { title: "اقساط" };

/**
 * بدهی → اقساط
 *
 * Product architecture places Installments UNDER the Debt domain (§18).
 * This route is a pure PRESENTATION ALIAS of the existing installments page:
 * same server component, same tenant-scoped queries, same `payInstallment`
 * workflow, same `/new?type=debt_repayment&installmentId=` deep-links.
 *
 * The original `/installments` route is intentionally kept alive for existing
 * links (overview dashboard, planning page, actions.ts revalidation list).
 * No installment logic, schedule semantics or planned-vs-actual behaviour is
 * changed here.
 */
export default InstallmentsPage;
