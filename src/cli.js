import { createDefaultAgent } from "./automation-agent.js";

const rawArgs = process.argv.slice(2);

if (rawArgs.length === 0) {
  console.error("Usage: node src/cli.js [sourceId] /create -n <projectName> -w <workspaceAliasOrPath>");
  process.exit(1);
}

let sourceId = "owner.wechat";
let commandParts = rawArgs;

if (!rawArgs[0].startsWith("/")) {
  sourceId = rawArgs[0];
  commandParts = rawArgs.slice(1);
}

const content = commandParts.join(" ");
const agent = createDefaultAgent();
const result = await agent.receiveText({
  sourceId,
  messageId: `cli-${Date.now()}`,
  content
});

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;
