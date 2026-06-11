function cspValue(value, fallback) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  return normalized || fallback;
}

function buildCsp(env) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${cspValue(env.COMMENT_IMG_SRC, 'https: data:')}`,
    `connect-src ${cspValue(env.COMMENT_API_ORIGIN, "'self'")}`,
    `frame-ancestors ${cspValue(env.COMMENT_FRAME_ANCESTORS, "'none'")}`,
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'"
  ].join('; ');
}

export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', buildCsp(env));
    headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};
