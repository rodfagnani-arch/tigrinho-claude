import type { MinesStartResponse } from "../_shared/contracts.ts";
import {
  ALLOWED_MINE_COUNTS,
  MINES_MAX_BET_CENTS,
  MINES_MIN_BET_CENTS,
  createMinePositions,
} from "../_shared/games.ts";
import {
  assertRequestAllowed,
  databaseError,
  errorResponse,
  jsonResponse,
  preflightResponse,
  readJsonObject,
} from "../_shared/http.ts";
import {
  GAME_RATE_LIMITS,
  consumeGameRateLimit,
} from "../_shared/rate-limit.ts";
import { requireRequestContext } from "../_shared/supabase.ts";
import { integerField, oneOfIntegers, uuidField } from "../_shared/validation.ts";

Deno.serve(async (request) => {
  const preflight = preflightResponse(request);
  if (preflight) return preflight;

  try {
    assertRequestAllowed(request);
    const { user, admin } = await requireRequestContext(request);
    await consumeGameRateLimit(
      admin,
      user.id,
      GAME_RATE_LIMITS.minesStart,
    );
    const body = await readJsonObject(request);
    const roundId = uuidField(body, "requestId");
    const betCents = integerField(
      body,
      "betCents",
      MINES_MIN_BET_CENTS,
      MINES_MAX_BET_CENTS,
    );
    const mineCount = oneOfIntegers(body, "mineCount", ALLOWED_MINE_COUNTS);
    const minePositions = createMinePositions(mineCount);

    const { data, error } = await admin.rpc("start_mines_round", {
      p_user_id: user.id,
      p_round_id: roundId,
      p_bet_cents: betCents,
      p_mine_count: mineCount,
      p_mine_positions: minePositions,
    });

    if (error) throw databaseError(error);
    if (!data || typeof data !== "object") {
      throw new Error("mines_start_returned_no_data");
    }

    return jsonResponse(request, data as MinesStartResponse);
  } catch (error) {
    return errorResponse(request, error);
  }
});
