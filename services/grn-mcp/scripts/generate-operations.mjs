#!/usr/bin/env node
/**
 * Turns the GRN OpenAPI spec into the operations the grower MCP server
 * offers as tools (docs/grn-mcp-server.md).
 *
 * Generated, like apps/grn's API reference, so the tools cannot drift from the
 * contract the API actually serves. Unlike the reference, every `$ref` is
 * inlined: a tool's input schema has to stand on its own. `--check` fails when
 * the committed output no longer matches the spec, and `npm run lint` runs it.
 *
 * Which operations become tools is decided in src/catalog.mjs, not here: this
 * file describes every operation, so a new endpoint is never silently missed.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, relative, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolvePath(here, '../../..');
const SPEC_PATH = resolvePath(repoRoot, 'services/grn-api/openapi.yaml');
const OUTPUT_PATH = resolvePath(here, '../src/generated/operations.json');
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

// OpenAPI-only keywords that are not JSON Schema; a strict validator rejects them.
const OPENAPI_ONLY = new Set(['nullable', 'example', 'xml', 'discriminator', 'externalDocs']);

const fileCache = new Map();
function loadYaml(absolutePath) {
  if (!fileCache.has(absolutePath)) fileCache.set(absolutePath, yaml.load(readFileSync(absolutePath, 'utf-8')));
  return fileCache.get(absolutePath);
}

const decodeSegment = (segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~');
function followPointer(document, pointer) {
  return (pointer ?? '')
    .replace(/^#?\//, '')
    .split('/')
    .filter(Boolean)
    .reduce((node, segment) => (node == null ? undefined : node[decodeSegment(segment)]), document);
}

function resolveRef(ref, file) {
  const [filePart, pointer = ''] = ref.split('#');
  const target = filePart ? resolvePath(dirname(file), filePart) : file;
  const value = followPointer(loadYaml(target), pointer);
  if (value === undefined) throw new Error(`Unresolvable $ref ${ref} in ${relative(repoRoot, file)}`);
  return { value, file: target, key: `${target}#${pointer}` };
}

/** One level of $ref, for parameters, bodies and responses. */
function deref(node, file) {
  let current = { value: node, file };
  for (let depth = 0; current.value && typeof current.value.$ref === 'string'; depth += 1) {
    if (depth > 10) throw new Error(`$ref chain too deep at ${node.$ref}`);
    current = resolveRef(current.value.$ref, current.file);
  }
  return current;
}

/**
 * A JSON Schema with every $ref inlined and OpenAPI-only keywords translated.
 * `nullable: true` becomes a null-admitting type. A schema that refers back to
 * itself is cut to `{}` at the repeat, so recursion cannot hang the build.
 */
function inlineSchema(node, file, seen = new Set()) {
  if (Array.isArray(node)) return node.map((item) => inlineSchema(item, file, seen));
  if (!node || typeof node !== 'object') return node;
  if (typeof node.$ref === 'string') {
    const target = resolveRef(node.$ref, file);
    if (seen.has(target.key)) return {};
    const siblings = { ...node };
    delete siblings.$ref;
    const inlined = inlineSchema(target.value, target.file, new Set([...seen, target.key]));
    return Object.keys(siblings).length ? { ...inlined, ...inlineSchema(siblings, file, seen) } : inlined;
  }
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (OPENAPI_ONLY.has(key)) continue;
    out[key] = key === 'properties' || key === '$defs' || key === 'patternProperties'
      ? Object.fromEntries(Object.entries(value ?? {}).map(([name, schema]) => [name, inlineSchema(schema, file, seen)]))
      : inlineSchema(value, file, seen);
  }
  if (node.nullable === true) {
    if (typeof out.type === 'string') out.type = [out.type, 'null'];
    else if (Array.isArray(out.type) && !out.type.includes('null')) out.type = [...out.type, 'null'];
    if (Array.isArray(out.enum) && !out.enum.includes(null)) out.enum = [...out.enum, null];
  }
  return out;
}

/** `Idempotency-Key` → `idempotencyKey`: header names as tool argument names. */
const argumentName = (name) => name.toLowerCase().replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

function collectParameters(raw, file) {
  return (raw ?? []).map((rawParameter) => {
    const { value: parameter, file: parameterFile } = deref(rawParameter, file);
    if (!['path', 'query', 'header'].includes(parameter.in)) {
      throw new Error(`Unsupported parameter location ${parameter.in} for ${parameter.name}`);
    }
    return {
      name: parameter.name,
      argument: parameter.in === 'header' ? argumentName(parameter.name) : parameter.name,
      in: parameter.in,
      required: parameter.in === 'path' || Boolean(parameter.required),
      description: parameter.description?.trim() ?? null,
      schema: inlineSchema(parameter.schema ?? { type: 'string' }, parameterFile)
    };
  });
}

function collectBody(raw, file) {
  if (!raw) return null;
  const { value: body, file: bodyFile } = deref(raw, file);
  const [contentType] = Object.keys(body?.content ?? {});
  if (!contentType) return null;
  return {
    required: Boolean(body.required),
    contentType,
    description: body.description?.trim() ?? null,
    schema: inlineSchema(body.content[contentType].schema ?? {}, bodyFile)
  };
}

function build() {
  const spec = loadYaml(SPEC_PATH);
  const operations = [];
  for (const [path, rawItem] of Object.entries(spec.paths ?? {})) {
    const { value: item, file } = deref(rawItem, SPEC_PATH);
    if (!item) throw new Error(`${path} could not be resolved`);
    const shared = collectParameters(item.parameters, file);
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation) continue;
      if (!operation.operationId) throw new Error(`${method.toUpperCase()} ${path} has no operationId`);
      const own = collectParameters(operation.parameters, file);
      const parameters = [...shared.filter((p) => !own.some((o) => o.name === p.name && o.in === p.in)), ...own];
      operations.push({
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
        summary: operation.summary?.trim() ?? null,
        description: operation.description?.trim() ?? null,
        tags: operation.tags ?? [],
        public: Array.isArray(operation.security) && operation.security.length === 0,
        parameters,
        body: collectBody(operation.requestBody, file)
      });
    }
  }
  operations.sort((a, b) => a.operationId.localeCompare(b.operationId));
  const ids = operations.map((o) => o.operationId);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) throw new Error(`Duplicate operationId ${duplicate}`);
  return { source: 'services/grn-api/openapi.yaml', version: spec.info?.version ?? null, operations };
}

const serialised = `${JSON.stringify(build(), null, 2)}\n`;
if (process.argv.includes('--check')) {
  let existing = '';
  try {
    existing = readFileSync(OUTPUT_PATH, 'utf-8');
  } catch {
    existing = '';
  }
  if (existing !== serialised) {
    console.error(
      'src/generated/operations.json is out of date with services/grn-api/openapi.yaml.\n' +
        'Run `npm run generate --workspace services/grn-mcp` and commit the result.'
    );
    process.exit(1);
  }
  console.log('Operations are in sync with the spec.');
} else {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, serialised);
  console.log(`Wrote ${JSON.parse(serialised).operations.length} operations to src/generated/operations.json`);
}
