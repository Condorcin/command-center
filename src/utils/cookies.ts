export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  maxAge?: number;
  path?: string;
}

const DEFAULT_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'Strict',
  path: '/',
};

/**
 * Set a cookie in the response
 */
export function setCookie(
  name: string,
  value: string,
  options: CookieOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const parts: string[] = [`${name}=${value}`];

  if (opts.maxAge) {
    parts.push(`Max-Age=${opts.maxAge}`);
  }

  if (opts.path) {
    parts.push(`Path=${opts.path}`);
  }

  if (opts.httpOnly) {
    parts.push('HttpOnly');
  }

  if (opts.secure) {
    parts.push('Secure');
  }

  if (opts.sameSite) {
    parts.push(`SameSite=${opts.sameSite}`);
  }

  return parts.join('; ');
}

/**
 * Delete a cookie
 */
export function deleteCookie(name: string): string {
  return setCookie(name, '', {
    maxAge: 0,
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
  });
}

/**
 * Parse cookies from request headers
 */
export function parseCookies(cookieHeader: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};

  if (!cookieHeader) {
    return cookies;
  }

  cookieHeader.split(';').forEach((cookie) => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name && rest.length > 0) {
      cookies[name] = rest.join('=');
    }
  });

  return cookies;
}

/**
 * Get a cookie value from request
 */
export function getCookie(
  request: Request,
  name: string
): string | null {
  const cookieHeader = request.headers.get('Cookie');
  const cookies = parseCookies(cookieHeader);
  return cookies[name] || null;
}

