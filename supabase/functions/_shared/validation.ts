import { ApiError } from "./http.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidField(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ApiError(400, "invalid_request", `${field} precisa ser um UUID válido.`);
  }
  return value.toLowerCase();
}

export function integerField(
  body: Record<string, unknown>,
  field: string,
  minimum: number,
  maximum: number,
): number {
  const value = body[field];
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new ApiError(
      400,
      "invalid_request",
      `${field} precisa ser um inteiro entre ${minimum} e ${maximum}.`,
    );
  }
  return value as number;
}

export function oneOfIntegers(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly number[],
): number {
  const value = body[field];
  if (!Number.isSafeInteger(value) || !allowed.includes(value as number)) {
    throw new ApiError(
      400,
      "invalid_request",
      `${field} possui um valor não permitido.`,
    );
  }
  return value as number;
}

