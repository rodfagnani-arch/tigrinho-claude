import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError, databaseError } from "./http.ts";

export type GameRateLimitAction =
  | "slot-spin"
  | "mines-start"
  | "mines-reveal"
  | "mines-cashout"
  | "mines-state";

interface GameRateLimitPolicy {
  action: GameRateLimitAction;
  maxRequests: number;
  windowSeconds: number;
}

export const GAME_RATE_LIMITS = {
  slotSpin: {
    action: "slot-spin",
    maxRequests: 30,
    windowSeconds: 10,
  },
  minesStart: {
    action: "mines-start",
    maxRequests: 20,
    windowSeconds: 60,
  },
  minesReveal: {
    action: "mines-reveal",
    maxRequests: 120,
    windowSeconds: 60,
  },
  minesCashout: {
    action: "mines-cashout",
    maxRequests: 30,
    windowSeconds: 60,
  },
  minesState: {
    action: "mines-state",
    maxRequests: 120,
    windowSeconds: 60,
  },
} as const satisfies Record<string, GameRateLimitPolicy>;

export interface GameRateLimitDecision {
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

function safeInteger(value: unknown, fallback: number): number {
  return Number.isSafeInteger(value) ? value as number : fallback;
}

export async function consumeGameRateLimit(
  admin: SupabaseClient,
  userId: string,
  policy: GameRateLimitPolicy,
): Promise<GameRateLimitDecision> {
  // Every authenticated attempt counts, including idempotent retries. A 429 is
  // raised before the game RPC, so its request/round UUID remains reusable.
  const { data, error } = await admin.rpc("consume_game_rate_limit", {
    p_user_id: userId,
    p_action: policy.action,
    p_max_requests: policy.maxRequests,
    p_window_seconds: policy.windowSeconds,
  });

  if (error) throw databaseError(error);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("rate_limit_returned_no_data");
  }

  const result = data as Record<string, unknown>;
  const retryAfterSeconds = Math.max(
    1,
    safeInteger(result.retryAfterSeconds, policy.windowSeconds),
  );

  if (result.allowed === false && result.error === "rate_limit_exceeded") {
    throw new ApiError(
      429,
      "rate_limit_exceeded",
      "Muitas solicitações. Tente novamente em instantes.",
      retryAfterSeconds,
    );
  }

  if (result.allowed !== true) {
    throw new Error("rate_limit_returned_invalid_data");
  }

  return {
    limit: safeInteger(result.limit, policy.maxRequests),
    remaining: Math.max(0, safeInteger(result.remaining, 0)),
    retryAfterSeconds,
  };
}
