export type Cents = number;

export interface GridCell {
  row: number;
  column: number;
}

export interface SlotWin {
  symbol: string;
  cells: GridCell[];
  payoutCents: Cents;
}

export interface SlotSpinRequest {
  requestId: string;
  betCents: Cents;
}

export interface SlotSpinResponse {
  roundId: string;
  status: "won" | "lost";
  betCents: Cents;
  payoutCents: Cents;
  balanceCents: Cents;
  walletVersion: number;
  grid: string[][];
  wins: SlotWin[];
}

export interface MinesStartRequest {
  requestId: string;
  betCents: Cents;
  mineCount: 1 | 3 | 5 | 10 | 15;
}

export interface MinesStartResponse {
  roundId: string;
  status: "active" | "won" | "lost" | "cashed_out" | "cancelled";
  betCents: Cents;
  mineCount: number;
  totalSafe: number;
  safeRevealed: number;
  balanceCents: Cents;
  walletVersion: number;
}

export interface MinesRevealRequest {
  roundId: string;
  cellIndex: number;
}

export interface MinesRevealResponse {
  roundId: string;
  cellIndex: number;
  hitMine: boolean;
  status: "active" | "won" | "lost" | "cashed_out" | "cancelled";
  autoCashedOut?: boolean;
  safeRevealed: number;
  totalSafe: number;
  multiplier: number;
  potentialPayoutCents: Cents;
  payoutCents: Cents;
  balanceCents: Cents;
  walletVersion: number;
  minePositions?: number[];
}

export interface MinesCashoutRequest {
  roundId: string;
}

export interface MinesCashoutResponse {
  roundId: string;
  status: "cashed_out";
  safeRevealed: number;
  totalSafe: number;
  multiplier: number;
  payoutCents: Cents;
  balanceCents: Cents;
  walletVersion: number;
  minePositions: number[];
}

export interface MinesStateRequest {
  roundId?: string | null;
}

export interface MinesStateEmptyResponse {
  roundId: null;
  status: "none";
  balanceCents: Cents;
  walletVersion: number;
}

interface MinesStateRoundBase {
  roundId: string;
  betCents: Cents;
  mineCount: number;
  totalSafe: number;
  safeRevealed: number;
  revealedSafeIndexes: number[];
  multiplier: number;
  potentialPayoutCents: Cents;
  balanceCents: Cents;
  walletVersion: number;
}

export interface MinesStateActiveResponse extends MinesStateRoundBase {
  status: "active";
  minePositions?: never;
}

export interface MinesStateEndedResponse extends MinesStateRoundBase {
  status: "won" | "lost" | "cashed_out" | "cancelled";
  minePositions: number[];
}

export type MinesStateResponse =
  | MinesStateEmptyResponse
  | MinesStateActiveResponse
  | MinesStateEndedResponse;
