import { CommandValidationError } from "./errors.js";

function tokenize(commandText) {
  const tokens = commandText.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  return tokens ? tokens.map((token) => token.trim()) : [];
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function normalizeCommandKey(token) {
  return token.replace(/^\/+/, "").toLowerCase();
}

const commandAliases = {
  ping: "sys"
};

export class CommandParser {
  parse(commandText) {
    if (typeof commandText !== "string" || commandText.trim() === "") {
      throw new CommandValidationError(
        "Command text is required.",
        "command_empty"
      );
    }

    const tokens = tokenize(commandText.trim());
    const [commandToken, ...argumentTokens] = tokens;
    const commandKey = normalizeCommandKey(commandToken ?? "");

    if (!commandKey) {
      throw new CommandValidationError(
        "A slash command is required, for example /create or /send.",
        "command_key_missing"
      );
    }

    const args = {};
    let index = 0;

    while (index < argumentTokens.length) {
      const token = argumentTokens[index];

      if (!token.startsWith("-") || token === "-") {
        throw new CommandValidationError(
          `Invalid argument "${token}". Expected flag syntax like -n demo.`,
          "command_argument_invalid"
        );
      }

      const key = token.slice(1);

      if (!key) {
        throw new CommandValidationError(
          `Invalid argument "${token}".`,
          "command_argument_invalid"
        );
      }

      const nextToken = argumentTokens[index + 1];

      if (!nextToken || nextToken.startsWith("-")) {
        args[key] = true;
        index += 1;
        continue;
      }

      args[key] = unquote(nextToken);
      index += 2;
    }

    return {
      commandKey: commandAliases[commandKey] ?? commandKey,
      args,
      raw: commandText
    };
  }
}
