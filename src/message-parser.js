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

function looksLikeSessionReference(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return false;
  }

  return (
    /^\d+$/.test(text) ||
    /^session-\d+$/i.test(text) ||
    /^[0-9a-f]{8,}-[0-9a-f-]{8,}$/i.test(text)
  );
}

const commandAliases = {
  ping: "sys",
  h: "help",
  p: "projects",
  c: "create",
  l: "list",
  a: "activate",
  mo: "mode",
  s: "send",
  sc: "screen",
  r: "read",
  cur: "current",
  ctx: "current",
  k: "kill",
  ep: "enablepermission",
  dp: "disablepermission"
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

    if (commandKey === "create" || commandAliases[commandKey] === "create") {
      if (argumentTokens[0] && !argumentTokens[0].startsWith("-")) {
        const first = unquote(argumentTokens[0]);
        const second = argumentTokens[1];

        if (/^\d+$/.test(first) && (!second || second.startsWith("-"))) {
          args.w = first;
          index = 1;
        } else {
          args.n = first;
          index = 2;

          if (second && !second.startsWith("-")) {
            args.w = unquote(second);
          } else {
            index = 1;
          }
        }
      }
    } else if (commandKey === "activate" || commandAliases[commandKey] === "activate") {
      if (argumentTokens[0] && !argumentTokens[0].startsWith("-")) {
        args.n = unquote(argumentTokens[0]);
        index = 1;

        if (argumentTokens[1] && !argumentTokens[1].startsWith("-")) {
          args.w = unquote(argumentTokens[1]);
          index = 2;
        }
      }
    } else if (commandKey === "send" || commandAliases[commandKey] === "send") {
      if (argumentTokens[0] && !argumentTokens[0].startsWith("-")) {
        const first = unquote(argumentTokens[0]);
        const remaining = argumentTokens.slice(1);
        const nextIsValue = remaining[0] && !remaining[0].startsWith("-");

        if (nextIsValue && looksLikeSessionReference(first)) {
          args.n = first;
          args.m = remaining.map(unquote).join(" ");
          index = argumentTokens.length;
        } else {
          args.m = argumentTokens.map(unquote).join(" ");
          index = argumentTokens.length;
        }
      }
    } else if (commandKey === "mode" || commandAliases[commandKey] === "mode") {
      if (argumentTokens[0] && !argumentTokens[0].startsWith("-")) {
        const first = unquote(argumentTokens[0]).toLowerCase();
        const second = argumentTokens[1];
        const isModeValue = first === "auto" || first === "manual";

        if (isModeValue) {
          args.m = first;
          index = 1;

          if (second && !second.startsWith("-")) {
            args.n = unquote(second);
            index = 2;
          }
        } else {
          args.n = unquote(argumentTokens[0]);
          index = 1;

          if (second && !second.startsWith("-")) {
            args.m = unquote(second).toLowerCase();
            index = 2;
          }
        }
      }
    }

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

export class WeChatCommandParser extends CommandParser {}
