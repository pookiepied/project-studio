import { verifyToken } from '@studio/jwt';
import type { Env } from '../types';

export interface RequestIdentity {
  userId: string;
  email?: string;
  role?: string;
}

export async function resolveIdentity(
  request: Request,
  env: Env,
): Promise<RequestIdentity | null> {
  const bearer = await resolveBearerIdentity(request, env);
  if (bearer) return bearer;

  const access = resolveCloudflareAccessIdentity(request);
  return access;
}

async function resolveBearerIdentity(
  request: Request,
  env: Env,
): Promise<RequestIdentity | null> {
  const header = request.headers.get('Authorization') ?? '';
  if (!header.startsWith('Bearer ') || !env.JWT_SECRET) return null;

  const token = header.slice(7).trim();
  const payload = await verifyToken(token, env.JWT_SECRET);
  if (!payload || payload.type === 'refresh' || !payload.sub) return null;

  if (env.REVOKED_KV) {
    const revoked = await env.REVOKED_KV.get(`revoked:${token}`);
    if (revoked !== null) return null;

    const jti = (payload as { jti?: string }).jti;
    if (jti && (await env.REVOKED_KV.get(`revoked-jti:${jti}`)) !== null) {
      return null;
    }
  }

  return {
    userId: payload.sub,
    email: (payload as { email?: string }).email,
    role: (payload as { role?: string }).role,
  };
}

function resolveCloudflareAccessIdentity(request: Request): RequestIdentity | null {
  const token = request.headers.get('cf-access-jwt-assertion') ?? '';
  if (!token) return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as {
      sub?: string;
      email?: string;
    };
    const userId = payload.sub ?? payload.email;
    return userId ? { userId, email: payload.email } : null;
  } catch {
    return null;
  }
}
