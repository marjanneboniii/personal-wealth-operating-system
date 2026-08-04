/**
 * Google AI Studio Provider — Uses @google/generative-ai with GOOGLE_AI_STUDIO_API_KEY
 * Implements: evaluateDeFiHypothesis(hypothesisPrompt, onChainDataRows)
 * Uses model gemini-1.5-pro (or latest Gemini 2.0 API) with structured JSON response schema output containing markdownAnalysis (in Persian) and structuredMetrics
 * CRITICAL: No FK to Financial Core, never writes ledger, isolated AI analysis
 */

export type StructuredMetrics = {
  simulatedReturnPercent: number;
  riskScore: number; // 0-100
  stressTestResult: string; // e.g., "pass", "fail", "high risk"
  confidenceScore?: number;
  additionalMetrics?: Record<string, any>;
};

export type AIHypothesisEvaluation = {
  markdownAnalysis: string; // in Persian
  structuredMetrics: StructuredMetrics;
  rawResponse: string;
};

function getApiKey(): string {
  const key = process.env.GOOGLE_AI_STUDIO_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) {
    console.warn(
      "[GoogleAIStudioProvider] GOOGLE_AI_STUDIO_API_KEY is not set in environment variables. Provider will return mock analysis. Please set GOOGLE_AI_STUDIO_API_KEY in .env.local",
    );
    return "";
  }
  return key;
}

export class GoogleAIStudioProvider {
  private apiKey: string;
  private modelName: string;

  constructor(modelName: string = "gemini-1.5-pro") {
    this.apiKey = getApiKey();
    // Allow override via env GOOGLE_AI_MODEL
    this.modelName = process.env.GOOGLE_AI_MODEL || modelName;
  }

  /**
   * Evaluate DeFi hypothesis with on-chain data rows
   * Uses Gemini with structured JSON response schema
   */
  async evaluateDeFiHypothesis(hypothesisPrompt: string, onChainDataRows: Record<string, any>[]): Promise<AIHypothesisEvaluation> {
    if (!this.apiKey) {
      // Return mock analysis in Persian for graceful handling when key missing
      console.warn("[GoogleAIStudioProvider] Missing API key — returning mock Persian analysis");
      return this.getMockEvaluation(hypothesisPrompt, onChainDataRows);
    }

    try {
      // Dynamically import @google/generative-ai to avoid hard dependency if not installed
      let GoogleGenerativeAI: any;
      try {
        const genAiModule = await import("@google/generative-ai");
        GoogleGenerativeAI = genAiModule.GoogleGenerativeAI;
      } catch (e) {
        console.warn("[GoogleAIStudioProvider] @google/generative-ai not installed, using fetch fallback", e);
        return this.evaluateViaFetch(hypothesisPrompt, onChainDataRows);
      }

      const genAI = new GoogleGenerativeAI(this.apiKey);
      const model = genAI.getGenerativeModel({
        model: this.modelName,
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.7,
        },
      });

      const systemPrompt = `
You are a Principal DeFi Research Analyst and Risk Manager. You evaluate DeFi hypotheses using on-chain data.

Requirements for output:
- You MUST respond with valid JSON only, no markdown code fences
- JSON structure: { "markdownAnalysis": string (in Persian), "structuredMetrics": { "simulatedReturnPercent": number, "riskScore": number (0-100), "stressTestResult": string, "confidenceScore": number, "additionalMetrics": object } }
- markdownAnalysis must be in Persian (Farsi), detailed, professional, covering:
  - تحلیل فرضیه
  - تحلیل داده‌های آن‌چین
  - ریسک‌ها
  - سناریوهای مختلف
  - توصیه‌ها
- structuredMetrics:
  - simulatedReturnPercent: estimated return % based on hypothesis and data (e.g., 15.5)
  - riskScore: 0-100, 0 low risk, 100 critical risk
  - stressTestResult: "pass" | "fail" | "high risk" | "moderate"
  - confidenceScore: 0-100 confidence in analysis
  - additionalMetrics: any extra metrics like TVL change, volume, etc.

User Hypothesis: ${hypothesisPrompt}

On-Chain Data Rows (sample, may be truncated):
${JSON.stringify(onChainDataRows.slice(0, 50), null, 2)}

Analyze the hypothesis against the on-chain data and provide your evaluation.
`;

      const result = await model.generateContent(systemPrompt);
      const response = await result.response;
      const text = response.text();

      // Parse JSON response
      let parsed: any;
      try {
        // Remove markdown code fences if present
        const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        parsed = JSON.parse(cleaned);
      } catch (parseError) {
        console.error("[GoogleAIStudioProvider] Failed to parse JSON response, returning raw text as markdownAnalysis", parseError);
        return {
          markdownAnalysis: text, // fallback raw text, may not be Persian but better than nothing
          structuredMetrics: {
            simulatedReturnPercent: 0,
            riskScore: 50,
            stressTestResult: "moderate",
            confidenceScore: 30,
          },
          rawResponse: text,
        };
      }

      const markdownAnalysis = parsed.markdownAnalysis || parsed.markdown_analysis || "تحلیل ناموفق بود";
      const structuredMetrics: StructuredMetrics = {
        simulatedReturnPercent: Number(parsed.structuredMetrics?.simulatedReturnPercent ?? parsed.structured_metrics?.simulated_return_percent ?? 0),
        riskScore: Number(parsed.structuredMetrics?.riskScore ?? parsed.structured_metrics?.risk_score ?? 50),
        stressTestResult: String(parsed.structuredMetrics?.stressTestResult ?? parsed.structured_metrics?.stress_test_result ?? "moderate"),
        confidenceScore: parsed.structuredMetrics?.confidenceScore ? Number(parsed.structuredMetrics.confidenceScore) : undefined,
        additionalMetrics: parsed.structuredMetrics?.additionalMetrics || parsed.structured_metrics?.additional_metrics || {},
      };

      return {
        markdownAnalysis,
        structuredMetrics,
        rawResponse: text,
      };
    } catch (e) {
      console.error("[GoogleAIStudioProvider] Error during evaluation", e);
      return this.getMockEvaluation(hypothesisPrompt, onChainDataRows, e instanceof Error ? e.message : String(e));
    }
  }

  private async evaluateViaFetch(hypothesisPrompt: string, onChainDataRows: Record<string, any>[]): Promise<AIHypothesisEvaluation> {
    // Fallback using direct fetch to Generative Language API
    if (!this.apiKey) return this.getMockEvaluation(hypothesisPrompt, onChainDataRows);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`;

    const prompt = `
تحلیل فرضیه DeFi: ${hypothesisPrompt}
داده‌های آن‌چین: ${JSON.stringify(onChainDataRows.slice(0, 20))}

لطفا به صورت JSON با ساختار { "markdownAnalysis": "تحلیل فارسی", "structuredMetrics": { "simulatedReturnPercent": number, "riskScore": number, "stressTestResult": string } } پاسخ بده.
`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.7 },
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(`[GoogleAIStudioProvider] Fetch API error ${res.status}: ${text.slice(0, 1000)}`);
        return this.getMockEvaluation(hypothesisPrompt, onChainDataRows, `API error ${res.status}`);
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

      let parsed: any;
      try {
        const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        parsed = JSON.parse(cleaned);
      } catch {
        return {
          markdownAnalysis: text,
          structuredMetrics: { simulatedReturnPercent: 0, riskScore: 50, stressTestResult: "moderate" },
          rawResponse: text,
        };
      }

      return {
        markdownAnalysis: parsed.markdownAnalysis || text,
        structuredMetrics: {
          simulatedReturnPercent: Number(parsed.structuredMetrics?.simulatedReturnPercent ?? 0),
          riskScore: Number(parsed.structuredMetrics?.riskScore ?? 50),
          stressTestResult: String(parsed.structuredMetrics?.stressTestResult ?? "moderate"),
          confidenceScore: parsed.structuredMetrics?.confidenceScore ? Number(parsed.structuredMetrics.confidenceScore) : undefined,
          additionalMetrics: parsed.structuredMetrics?.additionalMetrics || {},
        },
        rawResponse: text,
      };
    } catch (e) {
      console.error("[GoogleAIStudioProvider] Fetch fallback error", e);
      return this.getMockEvaluation(hypothesisPrompt, onChainDataRows, e instanceof Error ? e.message : String(e));
    }
  }

  private getMockEvaluation(hypothesisPrompt: string, onChainDataRows: Record<string, any>[], errorMessage?: string): AIHypothesisEvaluation {
    const rowCount = onChainDataRows.length;
    const sampleKeys = rowCount > 0 ? Object.keys(onChainDataRows[0]).slice(0, 5).join(", ") : "بدون داده";

    const markdownAnalysis = `
## تحلیل فرضیه DeFi (Mock - کلید API موجود نیست)

**فرضیه کاربر:**
${hypothesisPrompt}

**وضعیت:**
${errorMessage ? `خطا در دریافت تحلیل واقعی: ${errorMessage}` : "کلید Google AI Studio تنظیم نشده است - تحلیل شبیه‌سازی شده"}

**تحلیل داده‌های آن‌چین:**
- تعداد ردیف‌های داده: ${rowCount}
- فیلدهای نمونه: ${sampleKeys}
- داده‌ها برای تحلیل کامل کافی نیستند یا کلید API موجود نیست.

**ریسک‌ها:**
- ریسک بالا به دلیل عدم دسترسی به تحلیل واقعی
- نیاز به بررسی دستی داده‌های آن‌چین

**سناریوها:**
- سناریوی خوش‌بینانه: بازده مثبت در صورت تأیید فرضیه
- سناریوی بدبینانه: ریسک نقدینگی و نوسانات بازار

**توصیه‌ها:**
- کلید GOOGLE_AI_STUDIO_API_KEY را در .env.local تنظیم کنید
- داده‌های بیشتری از Dune Analytics دریافت کنید
- تحلیل دستی انجام دهید

*این تحلیل به صورت خودکار و شبیه‌سازی شده تولید شده است.*
`;

    return {
      markdownAnalysis: markdownAnalysis.trim(),
      structuredMetrics: {
        simulatedReturnPercent: 0,
        riskScore: 75,
        stressTestResult: "high risk",
        confidenceScore: 10,
        additionalMetrics: {
          rowCount,
          mock: true,
          error: errorMessage || "API key missing",
        },
      },
      rawResponse: markdownAnalysis,
    };
  }
}
