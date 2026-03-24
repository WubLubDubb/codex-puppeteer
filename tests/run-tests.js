process.env.CODEX_PUPPETEER_CODEX_MODE = "simulated";

const { runAutomationAgentTests } = await import("./automation-agent.test.js");
const { runCodexAdapterTests } = await import("./codex-adapter.test.js");
const { runMessageParserTests } = await import("./message-parser.test.js");
const { runOutputAnalysisTests } = await import("./output-analysis.test.js");
const { runRepositoryPersistenceTests } = await import("./repository-persistence.test.js");
const { runRuntimeRecoveryTests } = await import("./runtime-recovery.test.js");
const { runServiceEntryTests } = await import("./service-entry.test.js");
const { runSystemAdapterTests } = await import("./system-adapter.test.js");
const { runTelegramClientTests } = await import("./telegram-client.test.js");
const { runTelegramControllerTests } = await import("./telegram-controller.test.js");
const { runTelegramEntryTests } = await import("./telegram-entry.test.js");
const { runWaitDetectionTests } = await import("./wait-detection.test.js");
const { runWeComClientTests } = await import("./wecom-client.test.js");
const { runWeComControllerTests } = await import("./wecom-controller.test.js");
const { runWeComCryptoTests } = await import("./wecom-crypto.test.js");

const results = [];

async function runCase(name, callback) {
  try {
    await callback();
    results.push({ name, status: "passed" });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: "failed", error });
    console.error(`FAIL ${name}`);
    console.error(error.stack ?? error.message ?? error);
  }
}

await runMessageParserTests(runCase);
await runOutputAnalysisTests(runCase);
await runAutomationAgentTests(runCase);
await runWaitDetectionTests(runCase);
await runRepositoryPersistenceTests(runCase);
await runRuntimeRecoveryTests(runCase);
await runSystemAdapterTests(runCase);
await runServiceEntryTests(runCase);
await runCodexAdapterTests(runCase);
await runWeComCryptoTests(runCase);
await runWeComClientTests(runCase);
await runWeComControllerTests(runCase);
await runTelegramClientTests(runCase);
await runTelegramControllerTests(runCase);
await runTelegramEntryTests(runCase);

const failed = results.filter((result) => result.status === "failed");
console.log(`\nExecuted ${results.length} tests. ${failed.length} failed.`);

if (failed.length > 0) {
  process.exitCode = 1;
}
