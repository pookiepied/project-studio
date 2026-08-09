export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
export function getRequestId(req: Request): string {
  return req.headers.get("x-request-id") ?? req.headers.get("cf-ray") ?? generateRequestId();
}
