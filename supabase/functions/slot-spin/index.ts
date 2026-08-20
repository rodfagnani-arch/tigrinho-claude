import type { SlotSpinResponse } from "../_shared/contracts.ts";
import {
  SLOT_MAX_BET_CENTS,
  SLOT_MIN_BET_CENTS,
  createSlotResult,
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
      GAME_RATE_LIMITS.slotSpin,
    );
    const body = await readJsonObject(request);
    const roundId = uuidField(body, "requestId");
    const betCents = integerField(
      body,
      "betCents",
      SLOT_MIN_BET_CENTS,
      SLOT_MAX_BET_CENTS,
    );
    const result = createSlotResult(betCents);

    const { data, error } = await admin.rpc("settle_slot_spin", {
      p_user_id: user.id,
      p_round_id: roundId,
      p_bet_cents: betCents,
      p_payout_cents: result.payoutCents,
      p_result: {
        grid: result.grid,
        wins: result.wins,
      },
    });

    if (error) throw databaseError(error);
    if (!data || typeof data !== "object") {
      throw new Error("slot_spin_returned_no_data");
    }

    return jsonResponse(request, data as SlotSpinResponse);
  } catch (error) {
    return errorResponse(request, error);
  }
});
