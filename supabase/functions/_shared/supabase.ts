import {
  createClient,
  type SupabaseClient,
  type User,
} from "npm:@supabase/supabase-js@2";
import { ApiError } from "./http.ts";

export interface RequestContext {
  user: User;
  admin: SupabaseClient;
}

function requiredEnvironment(names: string[]): string {
  for (const name of names) {
    const value = Deno.env.get(name);
    if (value) return value;
  }

  throw new ApiError(500, "configuration_error", "Backend não configurado.");
}

function keyFromDictionaryEnvironment(name: string): string | null {
  const rawValue = Deno.env.get(name);
  if (!rawValue) return null;

  try {
    const keys = JSON.parse(rawValue) as Record<string, unknown>;
    const preferred = keys.default;
    if (typeof preferred === "string" && preferred) return preferred;

    const firstKey = Object.values(keys).find(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    return firstKey ?? null;
  } catch {
    throw new ApiError(500, "configuration_error", "Chaves do backend inválidas.");
  }
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match?.[1]) {
    throw new ApiError(401, "unauthorized", "Autenticação necessária.");
  }

  return match[1];
}

export async function requireRequestContext(request: Request): Promise<RequestContext> {
  const token = bearerToken(request);
  const url = requiredEnvironment(["SUPABASE_URL"]);
  const publicKey = keyFromDictionaryEnvironment("SUPABASE_PUBLISHABLE_KEYS")
    ?? requiredEnvironment(["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"]);
  const secretKey = keyFromDictionaryEnvironment("SUPABASE_SECRET_KEYS")
    ?? requiredEnvironment(["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);

  const authClient = createClient(url, publicKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await authClient.auth.getUser(token);

  if (error || !data.user) {
    throw new ApiError(401, "unauthorized", "Sessão inválida ou expirada.");
  }

  const admin = createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return { user: data.user, admin };
}
