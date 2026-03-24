export class AutomationError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
  }
}

export class CommandValidationError extends AutomationError {}
export class ConfigurationError extends AutomationError {}
export class AuthorizationError extends AutomationError {}
export class ContextResolutionError extends AutomationError {}
export class AdapterExecutionError extends AutomationError {}

export function serializeError(error) {
  if (error instanceof AutomationError) {
    return {
      name: error.name,
      code: error.code,
      message: error.message,
      details: error.details
    };
  }

  return {
    name: error?.name ?? "Error",
    code: "unexpected_error",
    message: error?.message ?? "An unexpected error occurred.",
    details: {}
  };
}
