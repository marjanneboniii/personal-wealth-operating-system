/** Display-only normalization of legacy USDG names; IDs and stored data stay intact. */
export function displayAccountName(name: string): string {
  if (!name) return "";
  return name.replace(
    /(?:گلوبال[\s‌]+دلار|دلار[\s‌]+گلوبال|global[\s_-]+dollar|dollar[\s_-]+global)(?:\s*\(\s*USDG\s*\))?|\bUSDG\b|\bGlobal\s+Dollar\b|\bDollar\s+Global\b/gi,
    "یو اس دی جی",
  );
}
