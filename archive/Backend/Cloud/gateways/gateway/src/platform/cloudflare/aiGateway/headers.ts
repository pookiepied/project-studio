const PROVIDER_AUTH_HEADERS = [
  "authorization",
  "x-goog-api-key",
  "x-api-key",
  "xi-api-key"
];

export function stripProviderAuthorization(headers: Headers): Headers {
  const sanitized = new Headers(headers);
  for (const name of PROVIDER_AUTH_HEADERS) sanitized.delete(name);
  return sanitized;
}

export function withCloudflareGatewayFetch(innerFetch: typeof fetch = fetch): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    return innerFetch(input, {
      ...init,
      headers: stripProviderAuthorization(headers)
    });
  }) as typeof fetch;
}
