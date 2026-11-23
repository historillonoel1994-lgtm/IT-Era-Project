export interface VerifiedAuthUser {
  valid: boolean;
  email?: string;
  userId?: string;
  aal?: string;
  reason?: string;
}

const verifiedJwtCache = new Map<
  string,
  { email: string; userId: string; aal?: string; expiresAt: number }
>();

export function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function extractBearerTokenFromHeaders(
  headers: Record<string, string | string[] | undefined>
): string | null {
  const getHeader = (name: string): string | undefined => {
    const target = name.toLowerCase();
    for (const [k, v] of Object.entries(headers || {})) {
      if (k.toLowerCase() === target) {
        return Array.isArray(v) ? v[0] : v;
      }
    }
    return undefined;
  };

  const authHeader = getHeader('authorization');
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token.length > 20) return token;
  }

  const altHeader = getHeader('x-supabase-access-token');
  if (typeof altHeader === 'string' && altHeader.trim().length > 20) {
    return altHeader.trim();
  }

  return null;
}

export async function verifySupabaseAccessToken(token: string): Promise<VerifiedAuthUser> {
  if (!token || token.length < 20) {
    return { valid: false, reason: 'Missing authentication token.' };
  }

  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload !== 'object') {
    return { valid: false, reason: 'Malformed authentication token.' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp && Number(payload.exp) <= nowSec) {
    return { valid: false, reason: 'Your session has expired. Please sign in again.' };
  }

  const cached = verifiedJwtCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      valid: true,
      email: cached.email,
      userId: cached.userId,
      aal: cached.aal,
    };
  }

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const supabaseKey = (
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();

  // Cryptographically verify token against Supabase Auth when server env vars are configured
  if (supabaseUrl && supabaseKey) {
    try {
      const resp = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/user`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: supabaseKey,
        },
      });

      if (!resp.ok) {
        return {
          valid: false,
          reason:
            resp.status === 401 || resp.status === 403
              ? 'Authentication session is invalid or expired. Please sign in again.'
              : `Authentication verification failed (HTTP ${resp.status}).`,
        };
      }

      const userData: any = await resp.json();
      const verifiedEmail = typeof userData?.email === 'string' ? userData.email.trim().toLowerCase() : '';
      const verifiedId = typeof userData?.id === 'string' ? userData.id : '';
      if (!verifiedEmail || !verifiedId) {
        return { valid: false, reason: 'Authenticated user record is incomplete.' };
      }

      const aal = typeof payload.aal === 'string' ? payload.aal : undefined;
      verifiedJwtCache.set(token, {
        email: verifiedEmail,
        userId: verifiedId,
        aal,
        expiresAt: Math.min(Date.now() + 60_000, (Number(payload.exp) || nowSec + 60) * 1000),
      });

      // Prevent unbounded cache growth
      if (verifiedJwtCache.size > 2000) {
        const nowMs = Date.now();
        for (const [k, v] of verifiedJwtCache.entries()) {
          if (v.expiresAt <= nowMs) verifiedJwtCache.delete(k);
        }
      }

      return { valid: true, email: verifiedEmail, userId: verifiedId, aal };
    } catch (err) {
      console.error('Supabase JWT verification error:', err);
      return {
        valid: false,
        reason: 'Could not reach Supabase Auth to verify your session. Please try again.',
      };
    }
  }

  // Fallback when server process env does not expose Supabase URL/key:
  // Strictly require a structurally valid, non-expired Supabase Auth JWT carrying sub + email + aud='authenticated'
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const userId = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  const aud = payload.aud;
  if (!email || !userId || (aud && aud !== 'authenticated')) {
    return { valid: false, reason: 'Invalid authentication token claims.' };
  }

  return {
    valid: true,
    email,
    userId,
    aal: typeof payload.aal === 'string' ? payload.aal : undefined,
  };
}

export function getAllowedCorsOrigin(originHeader?: string): string | null {
  if (!originHeader || typeof originHeader !== 'string') return null;
  const cleanOrigin = originHeader.trim().replace(/\/+$/, '');

  const envListOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const configuredOrigins = [
    ...envListOrigins,
    process.env.FRONTEND_URL,
    process.env.NETLIFY_SITE_URL,
    process.env.URL,
    process.env.DEPLOY_PRIME_URL,
    process.env.APP_URL,
    'https://studybuddyaiassistant.netlify.app',
  ]
    .filter((u): u is string => Boolean(u && typeof u === 'string'))
    .map((u) => {
      try {
        return new URL(u).origin;
      } catch {
        return u.trim().replace(/\/+$/, '');
      }
    });

  if (configuredOrigins.includes(cleanOrigin)) {
    return cleanOrigin;
  }

  // Allow Netlify deploy previews for Study Buddy AI or local dev hosts
  if (
    /^https:\/\/[a-z0-9-]+--studybuddyaiassistant\.netlify\.app$/i.test(cleanOrigin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(cleanOrigin)
  ) {
    return cleanOrigin;
  }

  return null;
}
