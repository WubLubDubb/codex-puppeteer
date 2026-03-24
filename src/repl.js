import { createDefaultAgent } from "./automation-agent.js";
import readline from "node:readline";

const agent = createDefaultAgent();
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true
});

function printResponse(result) {
  if (!result?.task?.response) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const response = result.task.response;

  if (response.actionId === "screen") {
    console.log(response.rendered || "(no captured output)");
    return;
  }

  if (response.actionId === "read") {
    console.log(response.content);
    return;
  }

  console.log(JSON.stringify(response, null, 2));
}

async function handleLine(line) {
  const content = line.trim();

  if (!content) {
    return;
  }

  if (["exit", "quit"].includes(content.toLowerCase())) {
    rl.close();
    return;
  }

  const result = await agent.receiveText({
    sourceId: "owner.wechat",
    messageId: `repl-${Date.now()}`,
    content
  });

  printResponse(result);
}

console.log("WxCodex local REPL");
console.log("Examples: /create -n DemoProject -w demo, /send -n session-0001 -m \"help\" ");
console.log("Type exit to quit.");
rl.setPrompt("wxcodex> ");
rl.prompt();

rl.on("line", (line) => {
  rl.pause();
  handleLine(line)
    .catch((error) => {
      console.error(error.stack ?? error.message ?? error);
    })
    .finally(() => {
      rl.resume();
      rl.prompt();
    });
});

rl.on("close", () => {
  process.exit(0);
});
