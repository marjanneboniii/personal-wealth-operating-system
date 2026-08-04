/**
 * Dune Analytics Provider & MCP Adapter — Uses DUNE_API_KEY
 * Implements: getLatestQueryResult, executeQueryAndPoll, toMCPToolDefinition (MCP tool format for LLM agent)
 * CRITICAL: Isolated cache, no FK to Financial Core, never writes ledger
 */

export type DuneQueryResult = {
  queryId: number;
  queryName?: string;
  resultRows: Record<string, any>[];
  executionId?: string;
  fetchedAt: Date;
};

export type MCPToolDefinition = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, any>;
    required: string[];
  };
};

function getApiKey(): string {
  const key = process.env.DUNE_API_KEY;
  if (!key) {
    console.warn("[DuneAnalyticsProvider] DUNE_API_KEY is not set in environment variables. Provider will return empty results. Please set DUNE_API_KEY in .env.local");
    return "";
  }
  return key;
}

export class DuneAnalyticsProvider {
  private baseUrl = "https://api.dune.com/api/v1";
  private apiKey: string;

  constructor() {
    this.apiKey = getApiKey();
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["X-DUNE-API-KEY"] = this.apiKey;
    }
    return headers;
  }

  private async fetchWithErrorHandling(url: string, options: RequestInit = {}): Promise<any> {
    if (!this.apiKey) {
      console.warn(`[DuneAnalyticsProvider] Skipping fetch ${url} — missing API key`);
      return null;
    }
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          ...this.getHeaders(),
          ...(options.headers as any),
        },
      });
      if (!res.ok) {
        const text = await res.text();
        console.error(`[DuneAnalyticsProvider] API error ${res.status} for ${url}: ${text.slice(0, 1000)}`);
        if (res.status === 401) {
          console.error("[DuneAnalyticsProvider] Unauthorized — check DUNE_API_KEY");
        }
        return null;
      }
      return await res.json();
    } catch (e) {
      console.error(`[DuneAnalyticsProvider] Network error for ${url}:`, e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  /**
   * Get latest query result for a queryId
   * Endpoint: GET /v1/query/{queryId}/results
   */
  async getLatestQueryResult(queryId: number): Promise<DuneQueryResult | null> {
    const url = `${this.baseUrl}/query/${queryId}/results?limit=1000`;
    const data = await this.fetchWithErrorHandling(url);

    if (!data) return null;

    try {
      // Dune response: { result: { rows: [...] }, execution_id, query_id }
      const rows = data?.result?.rows || data?.rows || [];
      const executionId = data?.execution_id || data?.executionId || undefined;
      const queryName = data?.query_name || `Query ${queryId}`;

      return {
        queryId,
        queryName,
        resultRows: rows,
        executionId,
        fetchedAt: new Date(),
      };
    } catch (e) {
      console.error("[DuneAnalyticsProvider] Failed to parse latest result", e);
      return null;
    }
  }

  /**
   * Execute query and poll for results
   * Steps:
   * 1. POST /v1/query/{queryId}/execute with parameters
   * 2. Poll GET /v1/execution/{executionId}/status until state=QUERY_STATE_COMPLETED
   * 3. GET /v1/execution/{executionId}/results
   */
  async executeQueryAndPoll(queryId: number, parameters?: Record<string, any>): Promise<DuneQueryResult | null> {
    // Step 1: Execute
    const executeUrl = `${this.baseUrl}/query/${queryId}/execute`;
    const executeBody: any = {};
    if (parameters) {
      executeBody.query_parameters = parameters;
    }

    const executeData = await this.fetchWithErrorHandling(executeUrl, {
      method: "POST",
      body: JSON.stringify(executeBody),
    });

    if (!executeData) return null;

    const executionId = executeData?.execution_id || executeData?.executionId;
    if (!executionId) {
      console.error("[DuneAnalyticsProvider] No execution_id returned from execute", executeData);
      return null;
    }

    // Step 2: Poll status
    const statusUrl = `${this.baseUrl}/execution/${executionId}/status`;
    let attempts = 0;
    const maxAttempts = 30; // 30 * 2s = 60s max
    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const statusData = await this.fetchWithErrorHandling(statusUrl);
      if (!statusData) {
        attempts++;
        continue;
      }

      const state = statusData?.state || statusData?.status;
      if (state === "QUERY_STATE_COMPLETED" || state === "completed") {
        break;
      } else if (state === "QUERY_STATE_FAILED" || state === "failed" || state === "QUERY_STATE_CANCELLED") {
        console.error(`[DuneAnalyticsProvider] Query execution failed with state ${state}`, statusData);
        return null;
      }
      attempts++;
    }

    if (attempts >= maxAttempts) {
      console.error("[DuneAnalyticsProvider] Polling timed out after max attempts");
      return null;
    }

    // Step 3: Get results
    const resultsUrl = `${this.baseUrl}/execution/${executionId}/results?limit=1000`;
    const resultsData = await this.fetchWithErrorHandling(resultsUrl);

    if (!resultsData) return null;

    const rows = resultsData?.result?.rows || resultsData?.rows || [];

    return {
      queryId,
      queryName: `Query ${queryId} Execution ${executionId}`,
      resultRows: rows,
      executionId,
      fetchedAt: new Date(),
    };
  }

  /**
   * Expose Dune query runner as standardized Model Context Protocol (MCP) tool format for LLM agent integration
   * Returns MCP tool definition for LLM agents to call Dune queries
   */
  toMCPToolDefinition(): MCPToolDefinition {
    return {
      name: "dune_query_runner",
      description:
        "Run Dune Analytics queries to fetch on-chain metrics for DeFi hypothesis simulation. Use this tool to get latest on-chain data like TVL, volume, wallet holdings, protocol metrics. Requires queryId from Dune Analytics dashboard (e.g., 1234567). Optionally pass query parameters as key-value object.",
      inputSchema: {
        type: "object",
        properties: {
          queryId: {
            type: "number",
            description: "Dune Analytics query ID (integer) from Dune dashboard URL, e.g., 1234567 from https://dune.com/queries/1234567",
          },
          parameters: {
            type: "object",
            description: "Optional query parameters as key-value pairs, e.g., {\"wallet_address\": \"0x...\", \"chain\": \"ethereum\"}",
            additionalProperties: true,
          },
          executeFresh: {
            type: "boolean",
            description: "If true, executes query fresh and polls for results; if false, gets latest cached result. Default false for speed.",
            default: false,
          },
        },
        required: ["queryId"],
      },
    };
  }

  /**
   * Helper to run query via MCP tool input format
   */
  async runViaMCPTool(input: { queryId: number; parameters?: Record<string, any>; executeFresh?: boolean }): Promise<DuneQueryResult | null> {
    if (input.executeFresh) {
      return this.executeQueryAndPoll(input.queryId, input.parameters);
    } else {
      return this.getLatestQueryResult(input.queryId);
    }
  }
}
