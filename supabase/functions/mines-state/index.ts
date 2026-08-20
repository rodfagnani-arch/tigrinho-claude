import type { MinesStateResponse } from "../_shared/contracts.ts";
import {
  assertRequestAllowed,
  databaseError,
  errorResponse,
  jsonResponse,
  preflightResponse,
  readOptionalJsonObject,
} from "../_shared/http.ts";
import {
  GAME_RATE_LIMITS,
  consumeGameRateLimit,
} from "../_shared/rate-limit.ts";
import { requireRequestContext } from "../_shared/supabase.ts";
import { uuidField } from "../_shared/validation.ts";

Deno.serve(async (request) => {
  const preflight = preflightResponse(request);
  if (preflight) return preflight;

  try {
    assertRequestAllowed(request);
    const { user, admin } = await requireRequestContext(request);
    await consumeGameRateLimit(
      admin,
      user.id,
      GAME_RATE_LIMITS.minesState,
    );
    const body = await readOptionalJsonObject(request);
    const roundId = body.roundId === undefined || body.roundId === null
      ? null
      : uuidField(body, "roundId");
    const { data, error } = await admin.rpc("get_mines_state", {
      p_user_id: user.id,
      p_round_id: roundId,
    });

    if (error) throw databaseError(error);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("mines_state_returned_no_data");
    }

    return jsonResponse(request, data as MinesStateResponse);
  } catch (error) {
    return errorResponse(request, error);
  }
});
