export type ParsedRow = {
  lineIndex: number;
  rawText: string;
  date: string;
  asset: string;
  type: "buy" | "sell" | "income" | "expense" | "transfer" | "opening";
  quantity: string;
  price: string;
  fee: string;
  description: string;
  primaryAccountCode?: string;
  counterAccountCode?: string;
};

/**
 * Parses CSV, TSV, or tab/comma/pipe-delimited text into raw structured import rows.
 * Supports standard columns: Date, Asset, Quantity, Price, Fee, Type, Description
 */
export function parseImportText(input: string): ParsedRow[] {
  if (!input || !input.trim()) return [];

  const lines = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  if (!lines.length) return [];

  // Detect delimiter (comma, tab, or pipe)
  const firstLine = lines[0];
  let delimiter = ",";
  if (firstLine.includes("\t")) delimiter = "\t";
  else if (firstLine.includes("|")) delimiter = "|";
  else if (firstLine.includes(";")) delimiter = ";";

  const rows: ParsedRow[] = [];
  let hasHeader = false;

  // Header detection
  const headerTokens = firstLine.split(delimiter).map((t) => t.trim().toLowerCase().replace(/['"]/g, ""));
  const headerMap: Record<string, number> = {};

  headerTokens.forEach((token, index) => {
    if (["date", "تاریخ"].includes(token)) headerMap.date = index;
    else if (["asset", "symbol", "دارایی", "نماد"].includes(token)) headerMap.asset = index;
    else if (["quantity", "qty", "amount", "مقدار", "تعداد"].includes(token)) headerMap.quantity = index;
    else if (["price", "unit_price", "unitprice", "قیمت", "فی"].includes(token)) headerMap.price = index;
    else if (["fee", "commission", "کارمزد"].includes(token)) headerMap.fee = index;
    else if (["type", "direction", "kind", "نوع", "تراکنش"].includes(token)) headerMap.type = index;
    else if (["description", "desc", "memo", "شرح", "توضیحات"].includes(token)) headerMap.description = index;
  });

  if (headerMap.date !== undefined || headerMap.asset !== undefined || headerMap.quantity !== undefined) {
    hasHeader = true;
  }

  const startIdx = hasHeader ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const rawLine = lines[i];
    const tokens = rawLine.split(delimiter).map((t) => t.trim().replace(/^['"]|['"]$/g, ""));

    if (!tokens.some((t) => t.length > 0)) continue;

    let date = "";
    let asset = "";
    let quantity = "0";
    let price = "0";
    let fee = "0";
    let typeRaw = "buy";
    let description = "";

    if (hasHeader) {
      if (headerMap.date !== undefined && tokens[headerMap.date]) date = tokens[headerMap.date];
      if (headerMap.asset !== undefined && tokens[headerMap.asset]) asset = tokens[headerMap.asset].toUpperCase();
      if (headerMap.quantity !== undefined && tokens[headerMap.quantity]) quantity = tokens[headerMap.quantity];
      if (headerMap.price !== undefined && tokens[headerMap.price]) price = tokens[headerMap.price];
      if (headerMap.fee !== undefined && tokens[headerMap.fee]) fee = tokens[headerMap.fee];
      if (headerMap.type !== undefined && tokens[headerMap.type]) typeRaw = tokens[headerMap.type].toLowerCase();
      if (headerMap.description !== undefined && tokens[headerMap.description]) description = tokens[headerMap.description];
    } else {
      // Positional fallback: Date, Asset, Quantity, Price, Fee, Type, Description
      date = tokens[0] ?? "";
      asset = (tokens[1] ?? "").toUpperCase();
      quantity = tokens[2] ?? "0";
      price = tokens[3] ?? "0";
      fee = tokens[4] ?? "0";
      typeRaw = (tokens[5] ?? "buy").toLowerCase();
      description = tokens[6] ?? "";
    }

    // Determine type
    let type: ParsedRow["type"] = "buy";
    if (["sell", "sale", "فروش"].includes(typeRaw)) type = "sell";
    else if (["income", "inflow", "درآمد", "واریز"].includes(typeRaw)) type = "income";
    else if (["expense", "outflow", "هزینه", "برداشت"].includes(typeRaw)) type = "expense";
    else if (["transfer", "انتقال"].includes(typeRaw)) type = "transfer";
    else if (["opening", "initial", "افتتاحیه", "موجودی اولیه"].includes(typeRaw)) type = "opening";

    // Normalize date format YYYY-MM-DD
    const normalizedDate = normalizeDate(date);

    rows.push({
      lineIndex: i + 1,
      rawText: rawLine,
      date: normalizedDate,
      asset: asset.trim(),
      type,
      quantity: cleanNumber(quantity),
      price: cleanNumber(price),
      fee: cleanNumber(fee),
      description: description || `واردشده از فایل (${asset})`,
    });
  }

  return rows;
}

function cleanNumber(str: string): string {
  if (!str) return "0";
  const cleaned = str.replace(/[^0-9.-]/g, "");
  return cleaned === "" || cleaned === "-" ? "0" : cleaned;
}

function normalizeDate(str: string): string {
  if (!str) return "";
  const s = str.trim().slice(0, 10);

  // YYYY-MM-DD or YYYY/MM/DD
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(s)) {
    const parts = s.split(/[-/]/).map((p) => p.padStart(2, "0"));
    return `${parts[0]}-${parts[1]}-${parts[2]}`;
  }

  // DD-MM-YYYY or DD/MM/YYYY
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(s)) {
    const parts = s.split(/[-/]/);
    return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
  }

  return s;
}
