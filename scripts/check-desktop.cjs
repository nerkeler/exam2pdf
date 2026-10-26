const path = require("node:path");
const { spawn } = require("node:child_process");

const executable = require("electron");
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [path.join(__dirname, "fixtures", "desktop-acceptance.cjs")], {
  cwd: path.resolve(__dirname, ".."),
  env: environment,
  stdio: "inherit"
});
child.on("error", (error) => {
  console.error("Unable to start desktop acceptance:", error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) console.error("Desktop acceptance exited because of signal " + signal);
  process.exitCode = signal || code == null ? 1 : code;
});
