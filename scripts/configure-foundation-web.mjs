#!/usr/bin/env node
/**
 * Local dev bootstrap for the foundation web app.
 * Deploys foundation/GRN/okra stacks with sensible dev defaults, then writes
 * apps/web/.env.local so local hosted login and okra API calls work out of the box.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const grnDir = resolve(repoRoot, "services", "grn-api");
const okraDir = resolve(repoRoot, "services", "okra-api");
const grnSamconfigPath = resolve(grnDir, "samconfig.toml");
const okraSamconfigPath = resolve(okraDir, "samconfig.toml");
const webEnvPath = resolve(repoRoot, "apps", "web", ".env.local");

const NO_COLOR =
  process.env.NO_COLOR ||
  (process.platform === "win32" && process.env.TERM !== "xterm");

const c = NO_COLOR
  ? { ok: "", err: "", info: "", reset: "" }
  : {
      ok: "\x1b[92m",
      err: "\x1b[91m",
      info: "\x1b[94m",
      reset: "\x1b[0m",
    };

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
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout?.toString() ?? "",
      stderr: error.stderr?.toString() ?? "",
    };
  }
}

function step(message) {
  console.log(`\n${c.info}> ${message}${c.reset}`);
}

function ok(message) {
  console.log(`${c.ok}+ ${message}${c.reset}`);
}

function fail(message, details) {
  console.error(`${c.err}x ${message}${c.reset}`);
  if (details) {
    console.error(details);
  }
  process.exit(1);
}

function requireTool(tool, args) {
  step(`Checking ${tool} availability`);
  const result = run(tool, args);
  if (!result.ok) {
    fail(`Missing required tool: ${tool}`);
  }
  ok(`${tool} is available`);
}

function escapeParameterValue(value) {
  return `"${String(value).replace(/(["\\])/g, "\\$1")}"`;
}

function unescapeSamValue(value) {
  return value
    .replace(/\\"/g, "\"")
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");
}

function getExportValue(name, { profile, region }) {
  step(`Reading CloudFormation export ${name}`);
  const args = [
    "cloudformation",
    "list-exports",
    "--region",
    region,
    "--query",
    `Exports[?Name=='${name}'].Value`,
    "--output",
    "json",
  ];

  if (profile) {
    args.push("--profile", profile);
  }

  const result = run("aws", args);
  if (!result.ok) {
    fail(`Failed to read CloudFormation export ${name}`, result.stderr || result.stdout);
  }

  let values;
  try {
    values = JSON.parse(result.stdout);
  } catch (error) {
    fail(`Failed to parse CloudFormation export ${name}`, error.message);
  }

  const value = Array.isArray(values) ? values[0] : null;
  if (!value || value === "None") {
    fail(`CloudFormation export ${name} was not found`);
  }

  ok(`Resolved export ${name}`);
  return value;
}

const FOUNDATION_USER_POOL_ID_EXPORT = "OGF-UserPoolId";
const FOUNDATION_USER_POOL_CLIENT_ID_EXPORT = "OGF-UserPoolClientId";
const FOUNDATION_USER_POOL_DOMAIN_EXPORT = "OGF-UserPoolDomain";

function getStackOutput(stackName, outputKey, { profile, region }) {
  step(`Reading stack output ${outputKey} from ${stackName}`);
  const args = [
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    stackName,
    "--region",
    region,
    "--query",
    `Stacks[0].Outputs[?OutputKey=='${outputKey}'].OutputValue`,
    "--output",
    "json",
  ];

  if (profile) {
    args.push("--profile", profile);
  }

  const result = run("aws", args);
  if (!result.ok) {
    fail(`Failed to read stack output ${outputKey} from ${stackName}`, result.stderr || result.stdout);
  }

  let values;
  try {
    values = JSON.parse(result.stdout);
  } catch (error) {
    fail(`Failed to parse stack output ${outputKey} from ${stackName}`, error.message);
  }

  const value = Array.isArray(values) ? values[0] : null;
  if (!value || value === "None") {
    fail(`Stack output ${outputKey} was not found on ${stackName}`);
  }

  ok(`Resolved ${outputKey} from ${stackName}`);
  return value;
}

function deployFoundationStack({
  profile,
  region,
  stackName,
  environment,
  domainName,
  domainHostedZoneId,
  databaseUrl,
  signupSlackWebhookUrl,
}) {
  const foundationDir = resolve(repoRoot, "infra", "foundation-web");
  const foundationFunctionsDir = resolve(foundationDir, "functions");

  step("Installing foundation function dependencies");
  const installResult = run("npm", ["ci", "--ignore-scripts"], {
    cwd: foundationFunctionsDir,
    env: { npm_config_cache: resolve(foundationFunctionsDir, ".npm-cache") },
  });
  if (!installResult.ok) {
    fail("Failed to install foundation function dependencies", installResult.stderr || installResult.stdout);
  }
  ok("Foundation function dependencies installed");

  step(`Building foundation stack ${stackName}`);
  samBuild(foundationDir, { profile, region });
  ok(`Foundation build completed for ${stackName}`);

  step(`Deploying foundation stack ${stackName}`);
  const parameterOverrides = [
    `EnvironmentName=${environment}`,
    `DomainName=${domainName}`,
    `DomainHostedZoneId=${domainHostedZoneId}`,
    `DatabaseUrl=${escapeParameterValue(databaseUrl)}`,
  ];

  if (signupSlackWebhookUrl) {
    parameterOverrides.push(`SignupSlackWebhookUrl=${escapeParameterValue(signupSlackWebhookUrl)}`);
  }

  samDeploy(foundationDir, {
    profile,
    region,
    stackName,
    capabilities: ["CAPABILITY_IAM"],
    parameterOverrides,
  });
  ok(`Foundation stack ${stackName} deployed`);
}

function samBuild(serviceDir, { profile, region }) {
  const args = ["build"];
  if (profile) {
    args.push("--profile", profile);
  }
  if (region) {
    args.push("--region", region);
  }

  const result = run("sam", args, { cwd: serviceDir, env: { SAM_CLI_TELEMETRY: "0" } });
  if (!result.ok) {
    fail(`SAM build failed in ${serviceDir}`, result.stderr || result.stdout);
  }
}

function samDeploy(serviceDir, { profile, region, stackName, capabilities, parameterOverrides }) {
  const builtTemplatePath = resolve(serviceDir, ".aws-sam", "build", "template.yaml");
  const args = [
    "deploy",
    "--template-file",
    builtTemplatePath,
    "--stack-name",
    stackName,
    "--resolve-s3",
    "--s3-prefix",
    stackName,
    "--region",
    region,
    "--capabilities",
    ...capabilities,
    "--no-confirm-changeset",
    "--no-fail-on-empty-changeset",
    "--parameter-overrides",
    ...parameterOverrides,
  ];

  if (profile) {
    args.push("--profile", profile);
  }

  const result = run("sam", args, { cwd: serviceDir, env: { SAM_CLI_TELEMETRY: "0" } });
  if (!result.ok) {
    fail(`SAM deploy failed for ${stackName}`, result.stderr || result.stdout);
  }
}

function deployGrnStack({
  profile,
  region,
  stackName,
  environment,
  foundationStackName,
  databaseUrl,
}) {
  step(`Building GRN stack ${stackName}`);
  samBuild(grnDir, { profile, region });
  ok(`GRN build completed for ${stackName}`);

  step(`Deploying GRN stack ${stackName}`);
  samDeploy(grnDir, {
    profile,
    region,
    stackName,
    capabilities: ["CAPABILITY_IAM", "CAPABILITY_AUTO_EXPAND"],
    parameterOverrides: [
      `DomainName=${escapeParameterValue("localhost:5173")}`,
      "DomainProtocol=http",
      `DatabaseUrl=${escapeParameterValue(databaseUrl)}`,
      `EnvironmentName=${environment}`,
    ],
  });
  ok(`GRN stack ${stackName} deployed`);
}

function deployOkraStack({
  profile,
  region,
  stackName,
  databaseUrl,
  ciAdminUsername,
  ciAdminPassword,
}) {
  step(`Building okra stack ${stackName}`);
  samBuild(okraDir, { profile, region });
  ok(`Okra build completed for ${stackName}`);

  step(`Deploying okra stack ${stackName}`);
  samDeploy(okraDir, {
    profile,
    region,
    stackName,
    capabilities: ["CAPABILITY_IAM"],
    parameterOverrides: [
      `DatabaseUrl=${escapeParameterValue(databaseUrl)}`,
      `CiAdminUsername=${escapeParameterValue(ciAdminUsername)}`,
      `CiAdminPassword=${escapeParameterValue(ciAdminPassword)}`,
    ],
  });
  ok(`Okra stack ${stackName} deployed`);
}

function extractParameterOverrideFromSamconfig(path, key) {
  if (!existsSync(path)) {
    return null;
  }

  const content = readFileSync(path, "utf-8");

  const escapedQuotedMatch = content.match(new RegExp(`${key}=\\\\(["'])(.*?)\\\\\\1`));
  if (escapedQuotedMatch) {
    return unescapeSamValue(escapedQuotedMatch[2]);
  }

  const quotedMatch = content.match(new RegExp(`${key}=(["'])(.*?)\\1`));
  if (quotedMatch) {
    return unescapeSamValue(quotedMatch[2]);
  }

  const bareMatch = content.match(new RegExp(`${key}=([^\\s"\\],]+)`));
  if (bareMatch) {
    return bareMatch[1];
  }

  return null;
}

function extractDatabaseUrlFromSamconfig(path) {
  return extractParameterOverrideFromSamconfig(path, "DatabaseUrl");
}

function isValidEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

function resolveOkraDeployConfig() {
  const samconfigCiAdminUsername = extractParameterOverrideFromSamconfig(okraSamconfigPath, "CiAdminUsername");
  const samconfigCiAdminPassword = extractParameterOverrideFromSamconfig(okraSamconfigPath, "CiAdminPassword");

  const ciAdminUsername =
    process.env.OKRA_CI_ADMIN_USERNAME ??
    process.env.CI_ADMIN_USERNAME ??
    samconfigCiAdminUsername ??
    "okra-ci-admin@local.ogf.dev";

  const ciAdminPassword =
    process.env.OKRA_CI_ADMIN_PASSWORD ??
    process.env.CI_ADMIN_PASSWORD ??
    samconfigCiAdminPassword ??
    "OkraDev123!Local";

  if (!isValidEmail(ciAdminUsername)) {
    fail(
      `Okra CI admin username must be a valid email address. Received: ${ciAdminUsername}`,
      "Set OKRA_CI_ADMIN_USERNAME, CI_ADMIN_USERNAME, or fix services/okra-api/samconfig.toml.",
    );
  }

  return {
    databaseUrl:
      process.env.OKRA_DATABASE_URL ??
      process.env.DATABASE_URL ??
      extractDatabaseUrlFromSamconfig(okraSamconfigPath),
    ciAdminUsername,
    ciAdminPassword,
  };
}

function resolveDatabaseUrls() {
  const grnDatabaseUrl =
    process.env.GRN_DATABASE_URL ??
    process.env.DATABASE_URL ??
    extractDatabaseUrlFromSamconfig(grnSamconfigPath);

  const okraDeployConfig = resolveOkraDeployConfig();
  const okraDatabaseUrl = okraDeployConfig.databaseUrl ?? grnDatabaseUrl;

  return { grnDatabaseUrl, okraDatabaseUrl, okraDeployConfig };
}

function writeWebEnvFile({ region, okraApiBase, userPoolId, userPoolClientId, userPoolDomain, grnUrl }) {
  step(`Writing ${webEnvPath}`);
  const content = `# Auto-generated by scripts/configure-foundation-web.mjs
VITE_OKRA_API_BASE=${okraApiBase}
VITE_AUTH_USER_POOL_ID=${userPoolId}
VITE_AUTH_USER_POOL_CLIENT_ID=${userPoolClientId}
VITE_AUTH_USER_POOL_DOMAIN=${userPoolDomain}
VITE_AWS_REGION=${region}
VITE_GRN_URL=${grnUrl}
`;

  writeFileSync(webEnvPath, content, "utf-8");
  ok(`Configured ${webEnvPath}`);
}

function main() {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h", default: false },
      profile: { type: "string" },
      region: { type: "string", default: "us-east-1" },
      environment: { type: "string", default: "dev" },
      "foundation-stack-name": { type: "string", default: "ogf-web-dev" },
      "grn-stack-name": { type: "string", default: "ogf-grn-dev" },
      "okra-stack-name": { type: "string", default: "ogf-okra-dev" },
      "domain-name": { type: "string", default: "" },
      "domain-hosted-zone-id": { type: "string", default: "" },
      "config-only": { type: "boolean", default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`usage: node scripts/configure-foundation-web.mjs [options]

Options:
  -h, --help                     Show this help message
  --profile PROFILE             AWS profile to use
  --region REGION               AWS region (default: us-east-1)
  --environment ENV             Deployment environment (default: dev)
  --foundation-stack-name NAME  Foundation stack name (default: ogf-web-dev)
  --grn-stack-name NAME         GRN stack name (default: ogf-grn-dev)
  --okra-stack-name NAME        Okra stack name (default: ogf-okra-dev)
  --domain-name DOMAIN          Optional custom domain for foundation stack deploy
  --domain-hosted-zone-id ID    Optional Route53 hosted zone ID for foundation deploy
  --config-only                 Skip deploy and only refresh apps/web/.env.local`);
    return;
  }

  const profile = values.profile;
  const region = values.region;
  const environment = values.environment;
  const foundationStackName = values["foundation-stack-name"];
  const grnStackName = values["grn-stack-name"];
  const okraStackName = values["okra-stack-name"];
  const configOnly = values["config-only"];
  const signupSlackWebhookUrl =
    process.env.FOUNDATION_SIGNUP_SLACK_WEBHOOK_URL ??
    process.env.SIGNUP_SLACK_WEBHOOK_URL ??
    "";

  console.log(`Foundation stack: ${foundationStackName}`);
  console.log(`GRN stack: ${grnStackName}`);
  console.log(`Okra stack: ${okraStackName}`);
  console.log(`Region: ${region}`);
  console.log(`Profile: ${profile ?? "(default)"}`);

  requireTool("aws", ["--version"]);
  if (!configOnly) {
    requireTool("sam", ["--version"]);
  }

  const { grnDatabaseUrl, okraDatabaseUrl, okraDeployConfig } = resolveDatabaseUrls();

  if (!configOnly && !grnDatabaseUrl) {
    fail("GRN database URL was not found. Set GRN_DATABASE_URL or DATABASE_URL, or keep it in services/grn-api/samconfig.toml.");
  }

  if (!configOnly && !okraDatabaseUrl) {
    fail("Okra database URL was not found. Set OKRA_DATABASE_URL or DATABASE_URL, or create services/okra-api/samconfig.toml.");
  }

  if (!configOnly) {
    deployFoundationStack({
      profile,
      region,
      stackName: foundationStackName,
      environment,
      domainName: values["domain-name"],
      domainHostedZoneId: values["domain-hosted-zone-id"],
      databaseUrl: grnDatabaseUrl,
      signupSlackWebhookUrl,
    });

    deployGrnStack({
      profile,
      region,
      stackName: grnStackName,
      environment,
      foundationStackName,
      databaseUrl: grnDatabaseUrl,
    });

    deployOkraStack({
      profile,
      region,
      stackName: okraStackName,
      databaseUrl: okraDatabaseUrl,
      ciAdminUsername: okraDeployConfig.ciAdminUsername,
      ciAdminPassword: okraDeployConfig.ciAdminPassword,
    });
  }

  const okraApiBase = getStackOutput(okraStackName, "HttpApiUrl", { profile, region });
  const userPoolId = getExportValue(FOUNDATION_USER_POOL_ID_EXPORT, { profile, region });
  const userPoolClientId = getExportValue(FOUNDATION_USER_POOL_CLIENT_ID_EXPORT, { profile, region });
  const userPoolDomain = getExportValue(FOUNDATION_USER_POOL_DOMAIN_EXPORT, { profile, region });
  const grnFrontendUrl = getStackOutput(grnStackName, "FrontendUrl", { profile, region });

  writeWebEnvFile({
    region,
    okraApiBase,
    userPoolId,
    userPoolClientId,
    userPoolDomain,
    grnUrl: grnFrontendUrl,
  });

  ok("Foundation web local configuration is ready");
  console.log("Local auth callback URL is http://localhost:4174/auth/callback");
}

main();
