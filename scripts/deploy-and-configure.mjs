#!/usr/bin/env node
/**
 * Cross-platform deployment script for Good Roots Network.
 * Deploys the backend SAM stack and configures frontend environment variables.
 *
 * Usage:
 *   node scripts/deploy-and-configure.mjs [--profile PROFILE] [--region REGION] [--stack-name STACK_NAME]
 */

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// Ã¢â€â‚¬Ã¢â€â‚¬ colours Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const NO_COLOR =
  process.env.NO_COLOR ||
  (process.platform === "win32" && process.env.TERM !== "xterm");

const c = NO_COLOR
  ? { h: "", b: "", ok: "", warn: "", err: "", cyan: "", reset: "" }
  : {
      h: "\x1b[95m",
      b: "\x1b[1m",
      ok: "\x1b[92m",
      warn: "\x1b[93m",
      err: "\x1b[91m",
      cyan: "\x1b[96m",
      blue: "\x1b[94m",
      reset: "\x1b[0m",
    };

const step = (msg) => console.log(`\n${c.blue}> ${msg}${c.reset}`);
const ok = (msg) => console.log(`${c.ok}+ ${msg}${c.reset}`);
const warn = (msg) => console.log(`${c.warn}! ${msg}${c.reset}`);
const fail = (msg) => console.error(`${c.err}x ${msg}${c.reset}`);

// Ã¢â€â‚¬Ã¢â€â‚¬ helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function run(cmd, args, opts = {}) {
  const env = { ...process.env, ...opts.env };
  try {
    const stdout = execFileSync(cmd, args, {
      cwd: opts.cwd,
      env,
      stdio: ["inherit", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    return { ok: true, stdout: stdout.toString() };
  } catch (e) {
    return { ok: false, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
  }
}

function checkPrerequisites() {
  step("Checking prerequisites...");
  let allGood = true;
  for (const [tool, args] of [["sam", ["--version"]], ["aws", ["--version"]]]) {
    const r = run(tool, args);
    if (r.ok) {
      ok(`${tool}: ${r.stdout.trim().split("\n")[0]}`);
    } else {
      fail(`${tool} is not installed or not in PATH`);
      allGood = false;
    }
  }
  return allGood;
}

function buildBackend(backendDir, profile) {
  step("Building backend...");
  const env = { SAM_CLI_TELEMETRY: "0" };
  if (profile) env.AWS_PROFILE = profile;

  const r = run("sam", ["build"], { cwd: backendDir, env });
  if (r.ok) {
    ok("Backend built successfully");
    return true;
  }
  fail("Backend build failed");
  if (r.stdout.trim()) console.log(r.stdout);
  if (r.stderr?.trim()) console.error(r.stderr);
  return false;
}

function deployBackend(backendDir, { profile, region, stackName, parameterOverrides }) {
  step("Deploying backend...");
  const args = ["deploy"];
  if (profile) args.push("--profile", profile);
  if (region) args.push("--region", region);
  if (stackName) args.push("--stack-name", stackName);
  if (parameterOverrides) args.push("--parameter-overrides", parameterOverrides);

  const env = {};
  if (profile) env.AWS_PROFILE = profile;

  const r = run("sam", args, { cwd: backendDir, env });
  if (r.ok) {
    ok("Backend deployed successfully");
    return true;
  }
  fail("Backend deployment failed");
  if (r.stdout.trim()) console.log(r.stdout);
  if (r.stderr?.trim()) console.error(r.stderr);
  return false;
}

function getStackOutputs(stackName, { profile, region }) {
  step("Retrieving stack outputs...");
  const args = [
    "cloudformation", "describe-stacks",
    "--stack-name", stackName,
    "--query", "Stacks[0].Outputs",
    "--output", "json",
  ];
  if (profile) args.push("--profile", profile);
  if (region) args.push("--region", region);

  const env = {};
  if (profile) env.AWS_PROFILE = profile;

  const r = run("aws", args, { env });
  if (!r.ok) {
    fail("Failed to retrieve stack outputs");
    if (r.stderr) console.error(r.stderr);
    return null;
  }
  try {
    const outputs = JSON.parse(r.stdout);
    const map = Object.fromEntries(outputs.map((o) => [o.OutputKey, o.OutputValue]));
    ok(`Retrieved ${Object.keys(map).length} outputs`);
    return map;
  } catch (e) {
    fail(`Failed to parse stack outputs: ${e.message}`);
    return null;
  }
}

function getExportValue(name, { profile, region }) {
  const args = [
    "cloudformation", "list-exports",
    "--query", `Exports[?Name=='${name}'].Value | [0]`,
    "--output", "text",
  ];
  if (profile) args.push("--profile", profile);
  if (region) args.push("--region", region);

  const env = {};
  if (profile) env.AWS_PROFILE = profile;

  const r = run("aws", args, { env });
  if (!r.ok) {
    fail(`Failed to retrieve export ${name}`);
    if (r.stderr) console.error(r.stderr);
    return null;
  }

  const value = r.stdout.trim();
  if (!value || value === "None") {
    fail(`CloudFormation export ${name} was not found`);
    return null;
  }

  return value;
}

function writeEnvFile(targetDir, content, label) {
  const envPath = resolve(targetDir, ".env");
  try {
    writeFileSync(envPath, content, "utf-8");
    ok(`Created ${label} env at ${envPath}`);
    return true;
  } catch (e) {
    fail(`Failed to create ${label} .env file: ${e.message}`);
    return false;
  }
}

function createEnvFiles(frontendDir, outputs, region) {
  step("Creating frontend .env files...");

  const foundationUrl = process.env.FOUNDATION_URL ?? "";
  const frontendContent = `# AWS Amplify Configuration
# Auto-generated by scripts/deploy-and-configure.mjs

VITE_USER_POOL_ID=${outputs.UserPoolId ?? ""}
VITE_USER_POOL_CLIENT_ID=${outputs.UserPoolClientId ?? ""}
VITE_USER_POOL_DOMAIN=${outputs.UserPoolDomain ?? ""}
VITE_API_URL=${outputs.ApiUrl ?? ""}
VITE_FRONTEND_URL=http://localhost:5173
VITE_AWS_REGION=${region}
VITE_FOUNDATION_URL=${foundationUrl}
`;

  const frontendOk = writeEnvFile(frontendDir, frontendContent, "frontend");
  return frontendOk;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ main Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function main() {
  process.env.SAM_CLI_TELEMETRY ??= "0";
  process.env.AWS_PAGER ??= "";

  const { values } = parseArgs({
    options: {
      help:                 { type: "boolean", short: "h", default: false },
      profile:              { type: "string" },
      region:               { type: "string", default: "us-east-1" },
      "stack-name":         { type: "string", default: "grn" },
      "parameter-overrides":{ type: "string" },
      "skip-build":         { type: "boolean", default: false },
      "skip-deploy":        { type: "boolean", default: false },
      "config-only":        { type: "boolean", default: false },
      "no-color":           { type: "boolean", default: false },
      ci:                   { type: "boolean", default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`usage: node scripts/deploy-and-configure.mjs [options]

Options:
  -h, --help              Show this help message
  --profile PROFILE       AWS profile to use
  --region REGION         AWS region (default: us-east-1)
  --stack-name NAME       CloudFormation stack name
  --parameter-overrides   Raw SAM parameter overrides string
  --skip-build            Skip sam build
  --skip-deploy           Skip sam deploy
  --config-only           Only refresh apps/grn/.env from stack outputs
  --no-color              Disable colored output
  --ci                    CI mode (prints stack outputs instead of next steps)`);
    return;
  }

  const skipBuild  = values["skip-build"]  || values["config-only"];
  const skipDeploy = values["skip-deploy"] || values["config-only"];
  const profile    = values.profile;
  const region     = values.region;
  const stackName  = values["stack-name"];
  const parameterOverrides = values["parameter-overrides"];
  const ciMode     = values.ci || ["1", "true", "yes"].includes((process.env.CI ?? "").toLowerCase());

  const backendDir  = resolve(repoRoot, "services", "grn-api");
  const frontendDir = resolve(repoRoot, "apps", "grn");
  if (!existsSync(backendDir))  { fail(`Backend directory not found: ${backendDir}`);  process.exit(1); }
  if (!existsSync(frontendDir)) { fail(`Frontend directory not found: ${frontendDir}`); process.exit(1); }

  console.log(`${c.h}${c.b}`);
  console.log("=".repeat(60));
  console.log("  Good Roots Network - Deploy & Configure");
  console.log("=".repeat(60));
  console.log(c.reset);
  console.log(`Backend:  ${backendDir}`);
  console.log(`Frontend: ${frontendDir}`);
  console.log(`Profile:  ${profile ?? "(default)"}`);
  console.log(`Region:   ${region}`);
  console.log(`Stack:    ${stackName}`);

  if (!checkPrerequisites()) {
    fail("Missing required tools. Please install them and try again.");
    process.exit(1);
  }

  if (!skipBuild && !skipDeploy) {
    if (!buildBackend(backendDir, profile)) process.exit(1);
  }

  if (!skipDeploy) {
    if (!deployBackend(backendDir, { profile, region, stackName, parameterOverrides })) process.exit(1);
  }

  const outputs = getStackOutputs(stackName, { profile, region });
  if (!outputs) process.exit(1);

  const userPoolId = getExportValue("OGF-UserPoolId", { profile, region });
  const userPoolClientId = getExportValue("OGF-UserPoolClientId", { profile, region });
  const userPoolDomain = getExportValue("OGF-UserPoolDomain", { profile, region });
  if (!userPoolId || !userPoolClientId || !userPoolDomain) process.exit(1);

  outputs.UserPoolId = userPoolId;
  outputs.UserPoolClientId = userPoolClientId;
  outputs.UserPoolDomain = userPoolDomain;

  if (!ciMode) {
    if (!createEnvFiles(frontendDir, outputs, region)) process.exit(1);

    console.log(`\n${c.ok}${c.b}+ Deployment and configuration complete!${c.reset}`);
    console.log(`\n${c.cyan}Next steps:${c.reset}`);
  console.log("  1. cd apps/grn");
    console.log("  2. npm install (if not already done)");
    console.log("  3. npm run dev");
    console.log(`\n${c.cyan}Frontend will be available at:${c.reset} http://localhost:5173`);
  } else {
    console.log(`\n${c.ok}${c.b}+ Deployment complete!${c.reset}`);
    console.log(`\n${c.cyan}Stack outputs:${c.reset}`);
    for (const [k, v] of Object.entries(outputs)) console.log(`${k}=${v}`);
  }
}

main();
