import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const privateTestRunner = resolve(process.cwd(), "tests", "run-tests.js");

if (!existsSync(privateTestRunner)) {
  console.log("Private test suite is not included in this public repository.");
  process.exit(0);
}

await import(pathToFileURL(privateTestRunner).href);
