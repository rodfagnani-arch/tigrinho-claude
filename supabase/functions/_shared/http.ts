import { corsHeaders, isOriginAllowed } from "./cors.ts";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export function preflightResponse(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;

  if (!isOriginAllowed(request)) {
    return jsonResponse(request, { error: "origin_not_allowed" }, 403);
  }

  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function assertRequestAllowed(request: Request): void {
  if (!isOriginAllowed(request)) {
    throw new ApiError(403, "origin_not_allowed", "Origem não permitida.");
  }

  if (request.method !== "POST") {
    throw new ApiError(405, "method_not_allowed", "Método não permitido.");
  }
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 16_384) {
    throw new ApiError(413, "body_too_large", "Corpo da requisição muito grande.");
  }

  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not_an_object");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "invalid_json", "JSON inválido.");
  }
}

export async function readOptionalJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 16_384) {
    throw new ApiError(413, "body_too_large", "Corpo da requisição muito grande.");
  }

  const text = await request.text();
  if (!text.trim()) return {};

  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not_an_object");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "invalid_json", "JSON inválido.");
  }
}

export function jsonResponse(
  request: Request,
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

const DATABASE_ERRORS: Record<string, { status: number; code: string; message: string }> = {
  insufficient_balance: {
    status: 409,
    code: "insufficient_balance",
    message: "Saldo insuficiente.",
  },
  balance_limit_exceeded: {
    status: 409,
    code: "balance_limit_exceeded",
    message: "O saldo atingiu o limite permitido.",
  },
  wallet_version_limit_exceeded: {
    status: 409,
    code: "wallet_version_limit_exceeded",
    message: "A carteira atingiu o limite de operações permitido.",
  },
  wallet_not_found: {
    status: 409,
    code: "wallet_not_found",
    message: "Carteira indisponível.",
  },
  round_not_found: {
    status: 404,
    code: "round_not_found",
    message: "Rodada não encontrada.",
  },
  round_not_active: {
    status: 409,
    code: "round_not_active",
    message: "A rodada não está ativa.",
  },
  active_round_exists: {
    status: 409,
    code: "active_round_exists",
    message: "Já existe uma rodada de Mines ativa. Retome-a antes de iniciar outra.",
  },
  nothing_to_cashout: {
    status: 409,
    code: "nothing_to_cashout",
    message: "Revele ao menos uma célula segura antes de retirar.",
  },
  round_conflict: {
    status: 409,
    code: "round_conflict",
    message: "O identificador da rodada já está em uso.",
  },
  idempotency_conflict: {
    status: 409,
    code: "idempotency_conflict",
    message: "A requisição já foi usada com outros dados.",
  },
  rate_limit_exceeded: {
    status: 429,
    code: "rate_limit_exceeded",
    message: "Muitas solicitações. Tente novamente em instantes.",
  },
};

export function databaseError(error: { message?: string; code?: string }): ApiError {
  const known = error.message ? DATABASE_ERRORS[error.message] : undefined;
  if (known) return new ApiError(known.status, known.code, known.message);

  console.error("Database operation failed", {
    code: error.code ?? "unknown",
    message: error.message ?? "unknown",
  });
  return new ApiError(500, "database_error", "Não foi possível concluir a operação.");
}

export function errorResponse(request: Request, error: unknown): Response {
  if (error instanceof ApiError) {
    const retryAfterSeconds = error.retryAfterSeconds === undefined
      ? undefined
      : Math.max(1, Math.ceil(error.retryAfterSeconds));

    return jsonResponse(
      request,
      {
        error: error.code,
        message: error.message,
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      },
      error.status,
      retryAfterSeconds === undefined
        ? {}
        : { "Retry-After": String(retryAfterSeconds) },
    );
  }

  console.error("Unhandled Edge Function error", error);
  return jsonResponse(
    request,
    { error: "internal_error", message: "Erro interno do servidor." },
    500,
  );
}
