export interface ProviderCreditResult {
  provider: string;
  balance_usd: number | null;
  used_usd: number | null;
  purchased_usd: number | null;
  supported: boolean;
  raw_response: Record<string, unknown> | null;
  fetched_at: string;
  error?: string;
}

export interface CreditProvider {
  readonly providerName: string;
  fetch(apiKey: string): Promise<ProviderCreditResult>;
}
