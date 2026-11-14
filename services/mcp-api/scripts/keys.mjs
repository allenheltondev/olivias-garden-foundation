/**
 * Mint, list and revoke the operator MCP server's keys (docs/mcp-server.md, "Keys").
 *
 *   npm run mcp:keys -w services/mcp-api -- create --env prod --label "laptop claude" --operator you@example.org --scope all:write [--days 90]
 *   npm run mcp:keys -w services/mcp-api -- list   --env prod
 *   npm run mcp:keys -w services/mcp-api -- revoke --env prod <id>
 *
 * Runs with your AWS credentials, on the environment's keys table
 * (`ogf-mcp-keys-<env>`, or --table). Being able to write that table is what
 * makes someone able to mint a key: nothing reachable over the internet can,
 * and a key cannot mint another. The operator must be an admin in the user
 * pool (found by email; the pool id comes from the OGF-UserPoolId export, or
 * --user-pool-id). The key is printed once and stored nowhere.
 */

import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { CloudFormationClient, ListExportsCommand } from '@aws-sdk/client-cloudformation';
import { DynamoKeyStore } from '../src/mcp/dynamo-keys.mjs';
import { CognitoOperatorDirectory } from '../src/mcp/operator.mjs';
import { KeyError, SCOPES, listKeys, mintKey, revokeKey } from '../src/mcp/keys.mjs';

async function userPoolFromExports() {
  const cf = new CloudFormationClient({});
  let next;
  do {
    const out = await cf.send(new ListExportsCommand({ NextToken: next }));
    const found = (out.Exports ?? []).find((e) => e.Name === 'OGF-UserPoolId');
    if (found) return found.Value;
    next = out.NextToken;
  } while (next);
  throw new KeyError('No OGF-UserPoolId export in this account and region; pass --user-pool-id.');
}

const usage = (io) => {
  io.err('usage: npm run mcp:keys -w services/mcp-api -- <create|list|revoke> --env <prod|staging|dev> [--table NAME]');
  io.err('  create --label NAME --operator EMAIL --scope SCOPE [--scope SCOPE…] [--days N] [--user-pool-id ID]');
  io.err(`         scopes: ${SCOPES.join(', ')}, all:read, all:write`);
  io.err('  revoke <id>');
  return 2;
};

/** deps: { openStore(table), openDirectory(userPoolId), resolveUserPool() } */
export async function runKeysCli(argv, deps, io) {
  const [command, ...rest] = argv;
  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        env: { type: 'string' },
        table: { type: 'string' },
        label: { type: 'string' },
        operator: { type: 'string' },
        scope: { type: 'string', multiple: true },
        days: { type: 'string' },
        'user-pool-id': { type: 'string' }
      }
    });
  } catch (error) {
    io.err(`error: ${error.message}`);
    return usage(io);
  }
  const { values, positionals } = parsed;
  if (!values.env && !values.table) return usage(io);
  const table = values.table ?? `ogf-mcp-keys-${values.env}`;
  const store = deps.openStore(table);

  try {
    switch (command) {
      case 'create': {
        if (!values.label || !values.operator) return usage(io);
        const directory = deps.openDirectory(values['user-pool-id'] ?? (await deps.resolveUserPool()));
        const operator = await directory.findByEmail(values.operator);
        if (!operator?.sub) throw new KeyError(`No single user with email ${values.operator} in the user pool.`);
        if (!(await directory.isAdmin(operator.username))) {
          throw new KeyError(`${values.operator} is not in the admin group; a key can only act as an admin.`);
        }
        const { key, info } = await mintKey(store, {
          label: values.label,
          scopes: values.scope ?? [],
          operator,
          days: values.days === undefined ? undefined : Number(values.days)
        });
        io.out(`Minted ${info.id} (${info.label}, as ${operator.email}: ${info.scopes.join(', ')}), expires ${info.expiresAt.slice(0, 10)}.`);
        io.out('');
        io.out(`  ${key}`);
        io.out('');
        io.out('This is the only time the key is shown. Give it to your MCP client as a header:');
        io.out('  Authorization: Bearer <key>');
        io.out(`Revoke with: npm run mcp:keys -w services/mcp-api -- revoke --env ${values.env ?? '<env>'} ${info.id}`);
        return 0;
      }
      case 'list': {
        const keys = await listKeys(store);
        if (keys.length === 0) io.out(`No keys in ${table}.`);
        for (const k of keys) {
          io.out(
            `${k.id}  ${k.label.padEnd(24)} ${(k.operator?.email ?? '-').padEnd(28)} ${k.scopes.join(',')}  ` +
            `expires ${k.expiresAt.slice(0, 10)}  last used ${k.lastUsedAt?.slice(0, 16).replace('T', ' ') ?? 'never'}`
          );
        }
        return 0;
      }
      case 'revoke': {
        const id = positionals[0];
        if (!id) return usage(io);
        await revokeKey(store, id);
        io.out(`Revoked ${id}. Its next request is refused.`);
        return 0;
      }
      default:
        return usage(io);
    }
  } catch (error) {
    if (error instanceof KeyError) {
      io.err(`error: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runKeysCli(
    process.argv.slice(2),
    {
      openStore: (table) => new DynamoKeyStore(table),
      openDirectory: (poolId) => new CognitoOperatorDirectory(poolId),
      resolveUserPool: userPoolFromExports
    },
    { out: console.log, err: console.error }
  ).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  );
}
