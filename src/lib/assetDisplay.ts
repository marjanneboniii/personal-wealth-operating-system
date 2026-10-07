/** Display-only normalization of legacy USDG names; IDs and stored data stay intact. */
export function displayAccountName(name: string): string {
  return name.replace(/(?:گلوبال[\s‌]+دلار|global\s+dollar)(?:\s*\(\s*USDG\s*\))?|\bUSDG\b/gi, "یو اس دی جی");
}
