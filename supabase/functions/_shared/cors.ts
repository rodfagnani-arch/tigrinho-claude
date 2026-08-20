const ALLOWED_HEADERS = "authorization, x-client-info, apikey, content-type";

function configuredOrigins(): string[] {
  return (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function isOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  const allowed = configuredOrigins();

  // Requests without Origin are still authenticated with a user JWT. An empty
  // list is convenient for local development; production should set the env.
  return !origin || allowed.length === 0 || allowed.includes(origin);
}

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  const allowed = configuredOrigins();
  const responseOrigin = origin && allowed.includes(origin) ? origin : "*";

  return {
    "Access-Control-Allow-Origin": responseOrigin,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Expose-Headers": "Retry-After",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
