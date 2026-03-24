import { AuthorizationError } from "./errors.js";

export class PolicyEngine {
  constructor(securityConfig) {
    this.securityConfig = securityConfig;
  }

  authorizeSource({ message }) {
    const allowedSources = this.securityConfig.allowedSources ?? [];

    if (allowedSources.includes("*")) {
      return;
    }

    if (!allowedSources.includes(message.sourceId)) {
      throw new AuthorizationError(
        `Source "${message.sourceId}" is not allowed to control the automation agent.`,
        "source_not_allowed",
        { sourceId: message.sourceId }
      );
    }
  }

  authorizeShutdown(parsedCommand) {
    if (parsedCommand.commandKey !== "shutdown") {
      return;
    }

    const immediatePassword = typeof parsedCommand.args.p === "string" ? parsedCommand.args.p : null;
    const armedPassword = typeof parsedCommand.args.a === "string" ? parsedCommand.args.a : null;

    if (immediatePassword && armedPassword) {
      throw new AuthorizationError(
        "Shutdown commands must use either -p for immediate mode or -a for watch mode, not both.",
        "shutdown_mode_conflict"
      );
    }

    const providedPassword = immediatePassword ?? armedPassword;

    if (!providedPassword) {
      throw new AuthorizationError(
        "Shutdown commands require a password using -p or -a.",
        "shutdown_password_missing"
      );
    }

    if (providedPassword !== this.securityConfig.shutdownPassword) {
      throw new AuthorizationError(
        "The shutdown password is invalid.",
        "shutdown_password_invalid"
      );
    }
  }
}
