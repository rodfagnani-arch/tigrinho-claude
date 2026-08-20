import type { SlotWin } from "./contracts.ts";

export const SLOT_MIN_BET_CENTS = 1_000;
export const SLOT_MAX_BET_CENTS = 10_000;
export const MINES_MIN_BET_CENTS = 100;
export const MINES_MAX_BET_CENTS = 100_000;
export const ALLOWED_MINE_COUNTS = [1, 3, 5, 10, 15] as const;

const GRID_SIZE = 5;
const UINT32_RANGE = 0x1_0000_0000;

const SLOT_SYMBOLS = [
  { symbol: "🐟", weight: 30, valueTenths: 12 },
  { symbol: "🐠", weight: 25, valueTenths: 15 },
  { symbol: "🦈", weight: 5, valueTenths: 60 },
  { symbol: "🐡", weight: 25, valueTenths: 13 },
  { symbol: "🦞", weight: 9, valueTenths: 25 },
  { symbol: "🐚", weight: 19, valueTenths: 16 },
  { symbol: "💎", weight: 2, valueTenths: 100 },
  { symbol: "🌿", weight: 30, valueTenths: 10 },
  { symbol: "🪸", weight: 10, valueTenths: 20 },
  { symbol: "🎣", weight: 8, valueTenths: 30 },
] as const;

export function secureRandomInteger(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > UINT32_RANGE) {
    throw new RangeError("Invalid random integer range");
  }

  const rejectionLimit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
  const buffer = new Uint32Array(1);

  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0] >= rejectionLimit);

  return buffer[0] % maxExclusive;
}

function randomSlotSymbol(): string {
  const totalWeight = SLOT_SYMBOLS.reduce((total, item) => total + item.weight, 0);
  let position = secureRandomInteger(totalWeight);

  for (const item of SLOT_SYMBOLS) {
    position -= item.weight;
    if (position < 0) return item.symbol;
  }

  return SLOT_SYMBOLS[0].symbol;
}

function clusterFactorTenths(size: number): number {
  if (size >= 10) return 100 + (size - 10) * 20;
  if (size >= 8) return 50 + (size - 8) * 20;
  if (size >= 6) return 20 + (size - 6) * 10;
  if (size === 5) return 15;
  return 10;
}

export function createSlotResult(betCents: number): {
  grid: string[][];
  wins: SlotWin[];
  payoutCents: number;
} {
  const grid = Array.from(
    { length: GRID_SIZE },
    () => Array.from({ length: GRID_SIZE }, randomSlotSymbol),
  );
  const visited = Array.from(
    { length: GRID_SIZE },
    () => Array<boolean>(GRID_SIZE).fill(false),
  );
  const wins: SlotWin[] = [];
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let column = 0; column < GRID_SIZE; column += 1) {
      if (visited[row][column]) continue;

      const symbol = grid[row][column];
      const queue = [{ row, column }];
      const cells: Array<{ row: number; column: number }> = [];
      visited[row][column] = true;

      while (queue.length > 0) {
        const current = queue.shift()!;
        cells.push(current);

        for (const [rowStep, columnStep] of directions) {
          const nextRow = current.row + rowStep;
          const nextColumn = current.column + columnStep;
          const inside = nextRow >= 0 && nextRow < GRID_SIZE
            && nextColumn >= 0 && nextColumn < GRID_SIZE;

          if (
            inside
            && !visited[nextRow][nextColumn]
            && grid[nextRow][nextColumn] === symbol
          ) {
            visited[nextRow][nextColumn] = true;
            queue.push({ row: nextRow, column: nextColumn });
          }
        }
      }

      if (cells.length < 4) continue;

      const definition = SLOT_SYMBOLS.find((item) => item.symbol === symbol)!;
      const payoutCents = Math.round(
        betCents * definition.valueTenths * clusterFactorTenths(cells.length) / 100,
      );
      wins.push({ symbol, cells, payoutCents });
    }
  }

  return {
    grid,
    wins,
    payoutCents: wins.reduce((total, win) => total + win.payoutCents, 0),
  };
}

export function createMinePositions(mineCount: number): number[] {
  const positions = new Set<number>();
  while (positions.size < mineCount) positions.add(secureRandomInteger(25));
  return [...positions].sort((left, right) => left - right);
}

