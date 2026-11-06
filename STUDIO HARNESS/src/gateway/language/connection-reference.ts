const CONNECTION_PREFIX = "connection:";

export function inheritsVendorCredential(connection: {
  readonly id: string;
  readonly catalogProvider?: string | undefined;
  readonly baseUrl?: string | undefined;
}): boolean {
  return connection.id === connection.catalogProvider && connection.baseUrl === undefined;
}

// The colon keeps connection routes disjoint from every legacy provider slug.
export function connectionProviderId(connectionId: string): string {
  return `${CONNECTION_PREFIX}${connectionId}`;
}

export function connectionIdFromProvider(providerId: string): string | undefined {
  return providerId.startsWith(CONNECTION_PREFIX)
    ? providerId.slice(CONNECTION_PREFIX.length)
    : undefined;
}

export function connectionModelReference(connectionId: string, modelId: string): string {
  return `${connectionProviderId(connectionId)}/${modelId}`;
}
