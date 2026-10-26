const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
let expectedVersion = "";
const explicitExecutable = process.env.EXAM2PDF_ELECTRON_PATH || "";
let executable = explicitExecutable;
let packagedExecutable = "";
let distributionRoot = "";
let packageRoot = "";

try {
  const electronPackagePath = require.resolve("electron/package.json");
  const electronPackage = require(electronPackagePath);
  packageRoot = path.dirname(electronPackagePath);
  expectedVersion = electronPackage.version;
  distributionRoot = process.env.ELECTRON_OVERRIDE_DIST_PATH || path.join(packageRoot, "dist");
  if (!executable) {
    executable = process.platform === "darwin"
      ? path.join(distributionRoot, "Electron.app", "Contents", "MacOS", "Electron")
      : process.platform === "win32"
        ? path.join(distributionRoot, "electron.exe")
        : path.join(distributionRoot, "electron");
    if (!fs.existsSync(executable)) executable = "";
  }
  packagedExecutable = process.platform === "darwin"
    ? path.join(distributionRoot, "Electron.app", "Contents", "MacOS", "Electron")
    : process.platform === "win32"
      ? path.join(distributionRoot, "electron.exe")
      : path.join(distributionRoot, "electron");
} catch (error) {
  console.error("Unable to locate the Electron package:", error.message);
  process.exit(1);
}

if (!executable || !fs.existsSync(executable)) {
  console.error("Electron " + (expectedVersion || "runtime") + " binary is missing. Run npm install with network access, or set EXAM2PDF_ELECTRON_PATH to a matching Electron executable.");
  process.exit(1);
}

const childEnvironment = { ...process.env };
delete childEnvironment.ELECTRON_RUN_AS_NODE;
let runtimeVersion = "";
let runtimeCheckMethod = "Node-mode runtime probe";
if (path.resolve(executable) === path.resolve(packagedExecutable)) {
  try {
    const executableInfo = fs.statSync(executable);
    if (!executableInfo.isFile() || executableInfo.size < 1 || (process.platform !== "win32" && (executableInfo.mode & 0o111) === 0)) {
      console.error("Electron executable is not a usable file: " + executable);
      process.exit(1);
    }
    const installedPath = fs.readFileSync(path.join(packageRoot, "path.txt"), "utf8").trim();
    const installedVersion = fs.readFileSync(path.join(distributionRoot, "version"), "utf8").trim().replace(/^v/, "");
    const expectedPath = path.relative(distributionRoot, packagedExecutable).split(path.sep).join("/");
    if (installedPath !== expectedPath || installedVersion !== expectedVersion) {
      console.error("Electron package files are incomplete or mismatched. Expected " + expectedVersion + " at " + expectedPath + ".");
      process.exit(1);
    }
    runtimeVersion = installedVersion;
  } catch (error) {
    console.error("Unable to verify the installed Electron package: " + error.message);
    process.exit(1);
  }
}

const runtimeProbe = spawnSync(executable, ["-e", "if (!process.versions.electron) process.exit(2); process.stdout.write(process.versions.electron);"], {
  encoding: "utf8",
  timeout: 10000,
  env: { ...childEnvironment, ELECTRON_RUN_AS_NODE: "1" }
});
if (runtimeProbe.error || runtimeProbe.status !== 0) {
  const detail = runtimeProbe.error
    ? runtimeProbe.error.message
    : runtimeProbe.signal
      ? "process terminated by " + runtimeProbe.signal
      : "process exited with status " + runtimeProbe.status;
  const stderr = String(runtimeProbe.stderr || "").trim();
  console.error("Unable to load the Electron runtime in Node mode: " + detail + (stderr ? " — " + stderr : ""));
  process.exit(1);
}
runtimeVersion = String(runtimeProbe.stdout || "").trim();
const expectedMajor = Number(String(expectedVersion).match(/^\d+/)?.[0]);
const runtimeMajor = Number(runtimeVersion.match(/v?(\d+)\.\d+\.\d+/)?.[1]);
if (!Number.isInteger(runtimeMajor) || (Number.isInteger(expectedMajor) && runtimeMajor !== expectedMajor)) {
  console.error("Electron runtime version mismatch. This project requires Electron " + expectedVersion + ", but found " + (runtimeVersion || "an unknown version") + ".");
  process.exit(1);
}

if (process.argv.includes("--check-only")) {
  console.log("Electron " + runtimeCheckMethod + " verified: " + runtimeVersion + " (project requires " + expectedVersion + ").");
  process.exit(0);
}

let smokeDataPath = "";
if (process.argv.includes("--startup-smoke")) {
  try {
    smokeDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "exam2pdf-startup-smoke-"));
    childEnvironment.EXAM2PDF_STARTUP_SMOKE = "1";
    childEnvironment.EXAM2PDF_STARTUP_SMOKE_DATA = smokeDataPath;
  } catch (error) {
    console.error("Unable to create temporary startup smoke data:", error.message);
    process.exit(1);
  }
}

function cleanSmokeData() {
  if (!smokeDataPath) return;
  try { fs.rmSync(smokeDataPath, { recursive: true, force: true }); }
  catch (error) { console.error("Unable to remove temporary startup smoke data:", error.message); }
}

const child = spawn(executable, [projectRoot], { cwd: projectRoot, stdio: "inherit", env: childEnvironment });
child.on("error", (error) => {
  cleanSmokeData();
  console.error("Unable to start exam2pdf:", error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  cleanSmokeData();
  if (signal) {
    console.error("Electron exited because of signal " + signal + ".");
    process.exitCode = 1;
  } else process.exitCode = code == null ? 1 : code;
});
