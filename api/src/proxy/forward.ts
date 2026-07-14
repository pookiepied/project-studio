export interface ForwardOptions {
  userId: string;
  method?: string;
  body?: BodyInit | null;
  contentType?: string | null;
  search?: string;
}

export function forwardToWorker(
  worker: Fetcher,
  path: string,
  options: ForwardOptions,
): Promise<Response> {
  const headers = new Headers();
  headers.set('X-User-ID', options.userId);
  if (options.contentType) headers.set('Content-Type', options.contentType);

  return worker.fetch(
    new Request(`https://internal${path}${options.search ?? ''}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body,
    }),
  );
}

export async function mirrorResponse(response: Response): Promise<Response> {
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}
