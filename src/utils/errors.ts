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
  RESOURCE_NOT_FOUND: "E_RESOURCE_NOT_FOUND",
  VERSION_NOT_FOUND: "E_VERSION_NOT_FOUND",
  INSTALL_NOT_FOUND: "E_INSTALL_NOT_FOUND",
} as const;
