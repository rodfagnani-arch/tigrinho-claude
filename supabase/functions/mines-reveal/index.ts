import type { MinesRevealResponse } from "../_shared/contracts.ts";
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
import { integerField, uuidField } from "../_shared/validation.ts";

Deno.serve(async (request) => {
  const preflight = preflightResponse(request);
  if (preflight) return preflight;

  try {
    assertRequestAllowed(request);
    const { user, admin } = await requireRequestContext(request);
    await consumeGameRateLimit(
      admin,
      user.id,
      GAME_RATE_LIMITS.minesReveal,
    );
    const body = await readJsonObject(request);
    const roundId = uuidField(body, "roundId");
    const cellIndex = integerField(body, "cellIndex", 0, 24);
    const { data, error } = await admin.rpc("reveal_mines_cell", {
      p_user_id: user.id,
      p_round_id: roundId,
      p_cell_index: cellIndex,
    });

    if (error) throw databaseError(error);
    if (!data || typeof data !== "object") {
      throw new Error("mines_reveal_returned_no_data");
    }

    return jsonResponse(request, data as MinesRevealResponse);
  } catch (error) {
    return errorResponse(request, error);
  }
});
