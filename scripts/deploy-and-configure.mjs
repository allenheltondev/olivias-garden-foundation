#!/usr/bin/env node
/**
 * Cross-platform deployment script for the foundation monorepo.
 * Builds and deploys a SAM stack and writes the matching app's .env.
 *
 * Usage:
 *   node scripts/deploy-and-configure.mjs [--target grn|admin|store] [options]
 *
 * Targets:
 *   grn    Default. Deploys services/grn-api, writes apps/grn/.env.
 *   admin  Deploys services/admin-api, writes apps/admin/.env.
 *   store  Deploys services/store-api, writes apps/store/.env.
 *          Supports --stripe-secret-key and --stripe-webhook-secret
 *          (or env STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET).
 */

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

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

function getStackOutputs(stackName, { profile, region, optional = false }) {
  step(`Retrieving stack outputs for ${stackName}...`);
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
    if (optional) {
      warn(`Stack ${stackName} not found; skipping cross-stack output lookup`);
      return null;
    }
    fail(`Failed to retrieve outputs for ${stackName}`);
    if (r.stderr) console.error(r.stderr);
    return null;
  }
  try {
    const outputs = JSON.parse(r.stdout);
    const map = Object.fromEntries(outputs.map((o) => [o.OutputKey, o.OutputValue]));
    ok(`Retrieved ${Object.keys(map).length} outputs from ${stackName}`);
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

function appendOverride(existing, addition) {
  const trimmed = (existing ?? "").trim();
  if (!trimmed) return addition;
  return `${trimmed} ${addition}`;
}

const TARGETS = {
  grn: {
    label: "Good Roots Network",
    backendDir: resolve(repoRoot, "services", "grn-api"),
    frontendDir: resolve(repoRoot, "apps", "grn"),
    devUrl: "http://localhost:5173",
    defaultStackName: "grn",
    buildOverrides: () => "",
    buildEnv: ({ outputs, region, foundationUrl, devUrl }) => `# AWS Amplify Configuration
# Auto-generated by scripts/deploy-and-configure.mjs

VITE_USER_POOL_ID=${outputs.UserPoolId ?? ""}
VITE_USER_POOL_CLIENT_ID=${outputs.UserPoolClientId ?? ""}
VITE_USER_POOL_DOMAIN=${outputs.UserPoolDomain ?? ""}
VITE_API_URL=${outputs.ApiUrl ?? ""}
VITE_FRONTEND_URL=${devUrl}
VITE_AWS_REGION=${region}
VITE_FOUNDATION_URL=${foundationUrl}
`,
  },
  admin: {
    label: "Admin console",
    backendDir: resolve(repoRoot, "services", "admin-api"),
    frontendDir: resolve(repoRoot, "apps", "admin"),
    devUrl: "http://localhost:5175",
    defaultStackName: "ogf-admin",
    buildOverrides: () => "",
    buildEnv: async ({ outputs, region, foundationUrl, devUrl, profile, opts }) => {
      const okraOutputs =
        opts.adminOkraStack
          ? getStackOutputs(opts.adminOkraStack, { profile, region, optional: true })
          : null;
      const storeOutputs =
        opts.adminStoreStack
          ? getStackOutputs(opts.adminStoreStack, { profile, region, optional: true })
          : null;
      const grnOutputs =
        opts.adminGrnStack
          ? getStackOutputs(opts.adminGrnStack, { profile, region, optional: true })
          : null;

      return `# Admin console configuration
# Auto-generated by scripts/deploy-and-configure.mjs

VITE_USER_POOL_ID=${outputs.UserPoolId ?? ""}
VITE_USER_POOL_CLIENT_ID=${outputs.UserPoolClientId ?? ""}
VITE_AWS_REGION=${region}
VITE_ADMIN_API_URL=${outputs.ApiUrl ?? ""}
VITE_OKRA_ADMIN_API_URL=${okraOutputs?.HttpApiUrl ?? okraOutputs?.ApiUrl ?? ""}
VITE_STORE_API_URL=${storeOutputs?.ApiUrl ?? ""}
VITE_FOUNDATION_URL=${foundationUrl}
VITE_GRN_URL=${grnOutputs?.FrontendUrl ?? ""}
VITE_FRONTEND_URL=${devUrl}
`;
    },
  },
  store: {
    label: "Store",
    backendDir: resolve(repoRoot, "services", "store-api"),
    frontendDir: resolve(repoRoot, "apps", "store"),
    devUrl: "http://localhost:5177",
    defaultStackName: "ogf-store",
    buildOverrides: ({ opts }) => {
      const overrides = [];
      const stripeSecretKey = opts.stripeSecretKey ?? process.env.STRIPE_SECRET_KEY;
      const stripeWebhookSecret = opts.stripeWebhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET;
      if (stripeSecretKey) {
        overrides.push(`StripeSecretKey=${stripeSecretKey}`);
      } else {
        warn("No --stripe-secret-key (and STRIPE_SECRET_KEY unset). Stripe checkout will return 503 until set.");
      }
      if (stripeWebhookSecret) {
        overrides.push(`StripeWebhookSecret=${stripeWebhookSecret}`);
      } else {
        warn("No --stripe-webhook-secret (and STRIPE_WEBHOOK_SECRET unset). The webhook endpoint will reject events.");
      }
      if (opts.domainName) overrides.push(`DomainName=${opts.domainName}`);
      if (opts.domainHostedZoneId) overrides.push(`DomainHostedZoneId=${opts.domainHostedZoneId}`);
      if (opts.environmentName) overrides.push(`EnvironmentName=${opts.environmentName}`);
      return overrides.join(" ");
    },
    buildEnv: async ({ outputs, region, foundationUrl, devUrl, profile, opts }) => {
      const grnOutputs =
        opts.adminGrnStack
          ? getStackOutputs(opts.adminGrnStack, { profile, region, optional: true })
          : null;

      return `# Store configuration
# Auto-generated by scripts/deploy-and-configure.mjs

VITE_USER_POOL_ID=${outputs.UserPoolId ?? ""}
VITE_USER_POOL_CLIENT_ID=${outputs.UserPoolClientId ?? ""}
VITE_AWS_REGION=${region}
VITE_STORE_API_URL=${outputs.ApiUrl ?? ""}
VITE_FOUNDATION_URL=${foundationUrl}
VITE_GRN_URL=${grnOutputs?.FrontendUrl ?? ""}
VITE_FRONTEND_URL=${devUrl}
`;
    },
  },
};

async function main() {
  process.env.SAM_CLI_TELEMETRY ??= "0";
  process.env.AWS_PAGER ??= "";

  const { values } = parseArgs({
    options: {
      help:                      { type: "boolean", short: "h", default: false },
      target:                    { type: "string", default: "grn" },
      profile:                   { type: "string" },
      region:                    { type: "string", default: "us-east-1" },
      "stack-name":              { type: "string" },
      "parameter-overrides":     { type: "string" },
      "skip-build":              { type: "boolean", default: false },
      "skip-deploy":             { type: "boolean", default: false },
      "config-only":             { type: "boolean", default: false },
      "no-color":                { type: "boolean", default: false },
      ci:                        { type: "boolean", default: false },
      // Store target options
      "stripe-secret-key":       { type: "string" },
      "stripe-webhook-secret":   { type: "string" },
      "domain-name":             { type: "string" },
      "domain-hosted-zone-id":   { type: "string" },
      "environment-name":        { type: "string" },
      // Cross-stack lookups (admin / store env builders)
      "admin-okra-stack":        { type: "string", default: "ogf-okra-dev" },
      "admin-store-stack":       { type: "string", default: "ogf-store" },
      "admin-grn-stack":         { type: "string", default: "grn" },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`usage: node scripts/deploy-and-configure.mjs [options]

Options:
  -h, --help                    Show this help message
  --target NAME                 grn | admin | store (default: grn)
  --profile PROFILE             AWS profile to use
  --region REGION               AWS region (default: us-east-1)
  --stack-name NAME             CloudFormation stack name (target-specific default)
  --parameter-overrides STR     Extra raw SAM parameter overrides string (appended)
  --skip-build                  Skip sam build
  --skip-deploy                 Skip sam deploy
  --config-only                 Only refresh the target's .env from stack outputs
  --no-color                    Disable colored output
  --ci                          CI mode (prints stack outputs instead of next steps)

Store target options (--target store):
  --stripe-secret-key KEY       Stripe secret key (or env STRIPE_SECRET_KEY)
  --stripe-webhook-secret KEY   Stripe webhook signing secret (or env STRIPE_WEBHOOK_SECRET)
  --domain-name DOMAIN          Optional root domain (e.g. oliviasgarden.org)
  --domain-hosted-zone-id ID    Optional Route53 hosted zone id
  --environment-name NAME       dev | staging | prod | pr

Cross-stack lookup options (used when writing .env):
  --admin-okra-stack NAME       Okra stack name (default: ogf-okra-dev)
  --admin-store-stack NAME      Store stack name (default: ogf-store)
  --admin-grn-stack NAME        GRN stack name (default: grn)`);
    return;
  }

  const targetName = values.target;
  const target = TARGETS[targetName];
  if (!target) {
    fail(`Unknown --target "${targetName}". Expected one of: ${Object.keys(TARGETS).join(", ")}`);
    process.exit(1);
  }

  const skipBuild  = values["skip-build"]  || values["config-only"];
  const skipDeploy = values["skip-deploy"] || values["config-only"];
  const profile    = values.profile;
  const region     = values.region;
  const stackName  = values["stack-name"] ?? target.defaultStackName;
  const ciMode     = values.ci || ["1", "true", "yes"].includes((process.env.CI ?? "").toLowerCase());

  const opts = {
    stripeSecretKey: values["stripe-secret-key"],
    stripeWebhookSecret: values["stripe-webhook-secret"],
    domainName: values["domain-name"],
    domainHostedZoneId: values["domain-hosted-zone-id"],
    environmentName: values["environment-name"],
    adminOkraStack: values["admin-okra-stack"],
    adminStoreStack: values["admin-store-stack"],
    adminGrnStack: values["admin-grn-stack"],
  };

  let parameterOverrides;
  if (!skipDeploy) {
    parameterOverrides = appendOverride(
      target.buildOverrides({ opts }),
      values["parameter-overrides"] ?? ""
    );
    if (!parameterOverrides) parameterOverrides = undefined;
  }

  if (!existsSync(target.backendDir)) {
    fail(`Backend directory not found: ${target.backendDir}`);
    process.exit(1);
  }
  if (!existsSync(target.frontendDir)) {
    fail(`Frontend directory not found: ${target.frontendDir}`);
    process.exit(1);
  }

  console.log(`${c.h}${c.b}`);
  console.log("=".repeat(60));
  console.log(`  Olivia's Garden Foundation - Deploy & Configure`);
  console.log("=".repeat(60));
  console.log(c.reset);
  console.log(`Target:   ${target.label} (${targetName})`);
  console.log(`Backend:  ${target.backendDir}`);
  console.log(`Frontend: ${target.frontendDir}`);
  console.log(`Profile:  ${profile ?? "(default)"}`);
  console.log(`Region:   ${region}`);
  console.log(`Stack:    ${stackName}`);
  if (parameterOverrides) {
    const redacted = parameterOverrides.replace(/(StripeSecretKey|StripeWebhookSecret)=([^\s]+)/g, "$1=***");
    console.log(`Params:   ${redacted}`);
  }

  if (!checkPrerequisites()) {
    fail("Missing required tools. Please install them and try again.");
    process.exit(1);
  }

  if (!skipBuild && !skipDeploy) {
    if (!buildBackend(target.backendDir, profile)) process.exit(1);
  }

  if (!skipDeploy) {
    if (!deployBackend(target.backendDir, { profile, region, stackName, parameterOverrides })) {
      process.exit(1);
    }
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

  if (ciMode) {
    console.log(`\n${c.ok}${c.b}+ Deployment complete!${c.reset}`);
    console.log(`\n${c.cyan}Stack outputs:${c.reset}`);
    for (const [k, v] of Object.entries(outputs)) console.log(`${k}=${v}`);
    return;
  }

  const foundationUrl = process.env.FOUNDATION_URL ?? "";
  const envContent = await target.buildEnv({
    outputs,
    region,
    foundationUrl,
    devUrl: target.devUrl,
    profile,
    opts,
  });
  if (!writeEnvFile(target.frontendDir, envContent, target.label)) process.exit(1);

  console.log(`\n${c.ok}${c.b}+ Deployment and configuration complete!${c.reset}`);
  console.log(`\n${c.cyan}Next steps:${c.reset}`);
  const relFrontend = target.frontendDir.replace(repoRoot + "/", "");
  console.log(`  1. cd ${relFrontend}`);
  console.log(`  2. npm install (if not already done)`);
  console.log(`  3. npm run dev`);
  console.log(`\n${c.cyan}Frontend will be available at:${c.reset} ${target.devUrl}`);
  if (targetName === "store") {
    const apiUrl = outputs.ApiUrl ?? "";
    if (apiUrl) {
      console.log(`\n${c.cyan}Stripe webhook endpoint:${c.reset} ${outputs.StripeWebhookEndpoint ?? `${apiUrl}/webhook`}`);
      console.log("  Configure this URL in the Stripe dashboard for the");
      console.log("  'checkout.session.completed' event, then re-deploy with the");
      console.log("  signing secret via --stripe-webhook-secret.");
    }
  }
}

await main();
