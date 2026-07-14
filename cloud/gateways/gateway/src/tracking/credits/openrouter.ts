import type { CreditProvider, ProviderCreditResult } from './base';

export class OpenRouterCreditProvider implements CreditProvider {
  readonly providerName = 'openrouter';

  async fetch(apiKey: string): Promise<ProviderCreditResult> {
    const res = await fetch('https://openrouter.ai/api/v1/credits', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      throw new Error(`OpenRouter credits API returned ${res.status}`);
    }

    const json = await res.json() as { data: { total_credits: number; total_usage: number } };
    const purchased = json.data.total_credits;
    const used = json.data.total_usage;

    return {
      provider: 'openrouter',
      balance_usd: purchased - used,
      used_usd: used,
      purchased_usd: purchased,
      supported: true,
      raw_response: json as Record<string, unknown>,
      fetched_at: new Date().toISOString(),
    };
  }
}
