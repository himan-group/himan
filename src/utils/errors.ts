export class HimanError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HimanError";
  }
}

export const errorCodes = {
  CONFIG_NOT_FOUND: "E_CONFIG_NOT_FOUND",
  NOT_IMPLEMENTED: "E_NOT_IMPLEMENTED",
  INVALID_INPUT: "E_INVALID_INPUT",
} as const;
