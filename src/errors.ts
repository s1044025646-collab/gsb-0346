export type ErrorCode =
  | "E_INVALID_INTEGER"
  | "E_INVALID_JSON"
  | "E_EMPTY_ARRAY"
  | "E_LENGTH_NOT_POWER_OF_TWO"
  | "E_LENGTH_MISMATCH"
  | "E_LIMIT_EXCEEDED"
  | "E_NOT_FOUND"
  | "E_BAD_OP"
  | "E_BAD_PARAM"
  | "E_INTERNAL";

export class ApiError extends Error {
  constructor(public code: ErrorCode, message: string, public status = 400) {
    super(message);
  }
}
