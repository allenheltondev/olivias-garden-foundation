import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { SectionHeading } from '@olivias/ui';
import { getApiEndpoint } from '../config/amplify';
import reference from '../generated/apiReference.json';

interface ReferenceParameter {
  name: string;
  in: string;
  required: boolean;
  type: string;
  description: string | null;
}

interface ReferenceResponse {
  status: string;
  description: string | null;
  shape: string | null;
}

interface ReferenceOperation {
  path: string;
  method: string;
  operationId: string | null;
  summary: string | null;
  description: string | null;
  tags: string[];
  requiresAuth: boolean;
  parameters: ReferenceParameter[];
  requestBody: { required: boolean; contentType: string; shape: string | null } | null;
  responses: ReferenceResponse[];
}

interface ApiReference {
  title: string;
  version: string | null;
  source: string;
  tags: { name: string; description: string | null }[];
  operations: ReferenceOperation[];
}

const apiReference = reference as ApiReference;

/**
 * Tags that describe a property of an operation rather than the area it
 * belongs to. Grouping by one of these would scatter, say, every idempotent
 * endpoint into a section of its own, so they are shown as badges instead.
 */
const MODIFIER_TAGS = new Set(['Idempotent', 'Pro', 'Grower Only', 'Public', 'Admin']);

function primaryTag(operation: ReferenceOperation): string {
  return operation.tags.find((tag) => !MODIFIER_TAGS.has(tag)) ?? 'Other';
}

function modifierTags(operation: ReferenceOperation): string[] {
  return operation.tags.filter((tag) => MODIFIER_TAGS.has(tag));
}

/**
 * `aria-labelledby` is an IDREFS attribute, so a value containing a space is
 * read as two separate id references. A tag like "API Access" would point at
 * `tag-API` and `Access`, neither of which exists, leaving the section with no
 * accessible name. Slugify once and use the same value on both ends.
 */
function tagId(tag: string): string {
  return `tag-${tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
}

/**
 * The deployed host, so a key holder can build a request from this page alone
 * rather than reading it out of network traffic. Read from the same config the
 * app uses for its own calls, so staging and production stay correct without a
 * second source of truth — and guarded, because getApiEndpoint throws when
 * VITE_API_URL is unset rather than returning empty.
 */
function apiBaseUrl(): string | null {
  try {
    return getApiEndpoint();
  } catch {
    return null;
  }
}

function matches(operation: ReferenceOperation, term: string): boolean {
  if (!term) return true;
  const haystack = [
    operation.path,
    operation.method,
    operation.summary ?? '',
    operation.operationId ?? '',
    ...operation.tags,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(term.toLowerCase());
}

export function ApiReferencePage() {
  const [search, setSearch] = useState('');
  const baseUrl = useMemo(() => apiBaseUrl(), []);

  const groups = useMemo(() => {
    const byTag = new Map<string, ReferenceOperation[]>();
    for (const operation of apiReference.operations) {
      if (!matches(operation, search)) continue;
      const tag = primaryTag(operation);
      const existing = byTag.get(tag);
      if (existing) {
        existing.push(operation);
      } else {
        byTag.set(tag, [operation]);
      }
    }
    return [...byTag.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [search]);

  const descriptions = useMemo(
    () => new Map(apiReference.tags.map((tag) => [tag.name, tag.description])),
    []
  );

  const matchCount = groups.reduce((total, [, operations]) => total + operations.length, 0);

  return (
    <section className="grn-section grn-api-reference">
      <SectionHeading
        title="API reference"
        body="Every endpoint the Good Roots API serves. Combine the base URL below with any path, and send your key in the Authorization header."
      />

      {baseUrl ? (
        <dl className="grn-api-reference__base">
          <dt>Base URL</dt>
          <dd>
            <code>{baseUrl}</code>
          </dd>
          <dt>Authorization</dt>
          <dd>
            <code>Authorization: Bearer grnk_…</code>
          </dd>
        </dl>
      ) : null}

      <p className="grn-api-reference__meta">
        Version {apiReference.version} · {apiReference.operations.length} endpoints ·{' '}
        <Link to="/settings/api-keys">Manage your keys</Link>
      </p>

      <label className="grn-api-reference__search">
        <span className="grn-api-reference__search-label">Search endpoints</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="listings, POST, /crops…"
          className="grn-api-reference__search-input"
        />
      </label>

      {search ? (
        <p className="grn-api-reference__count" role="status">
          {matchCount === 0
            ? 'No endpoints match that search.'
            : `${matchCount} endpoint${matchCount === 1 ? '' : 's'} match.`}
        </p>
      ) : null}

      {groups.map(([tag, operations]) => (
        <section key={tag} className="grn-api-reference__group" aria-labelledby={tagId(tag)}>
          <h2 id={tagId(tag)} className="grn-api-reference__group-title">
            {tag}
          </h2>
          {descriptions.get(tag) ? (
            <p className="grn-api-reference__group-body">{descriptions.get(tag)}</p>
          ) : null}

          <ul className="grn-api-reference__list" role="list">
            {operations.map((operation) => (
              <li
                key={`${operation.method} ${operation.path}`}
                className="grn-api-reference__endpoint"
              >
                <div className="grn-api-reference__signature">
                  <span
                    className={`grn-api-reference__method grn-api-reference__method--${operation.method.toLowerCase()}`}
                  >
                    {operation.method}
                  </span>
                  <code className="grn-api-reference__path">{operation.path}</code>
                  {!operation.requiresAuth ? (
                    <span className="grn-api-reference__badge grn-api-reference__badge--public">
                      No auth
                    </span>
                  ) : null}
                  {modifierTags(operation)
                    .filter((tagName) => tagName !== 'Public')
                    .map((tagName) => (
                      <span key={tagName} className="grn-api-reference__badge">
                        {tagName}
                      </span>
                    ))}
                </div>

                {operation.summary ? (
                  <p className="grn-api-reference__summary">{operation.summary}</p>
                ) : null}
                {operation.description ? (
                  <p className="grn-api-reference__description">{operation.description}</p>
                ) : null}

                {operation.parameters.length > 0 ? (
                  <div className="grn-api-reference__detail">
                    <h3>Parameters</h3>
                    <ul role="list">
                      {operation.parameters.map((parameter) => (
                        <li key={`${parameter.in}-${parameter.name}`}>
                          <code>{parameter.name}</code>
                          <span className="grn-api-reference__param-meta">
                            {parameter.in} · {parameter.type}
                            {parameter.required ? ' · required' : ''}
                          </span>
                          {parameter.description ? <span> — {parameter.description}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {operation.requestBody ? (
                  <div className="grn-api-reference__detail">
                    <h3>Request body</h3>
                    <p>
                      <code>{operation.requestBody.contentType}</code>
                      {operation.requestBody.shape ? ` · ${operation.requestBody.shape}` : ''}
                      {operation.requestBody.required ? ' · required' : ' · optional'}
                    </p>
                  </div>
                ) : null}

                {operation.responses.length > 0 ? (
                  <div className="grn-api-reference__detail">
                    <h3>Responses</h3>
                    <ul role="list">
                      {operation.responses.map((response) => (
                        <li key={response.status}>
                          <code>{response.status}</code>
                          {response.description ? <span> — {response.description}</span> : null}
                          {response.shape ? (
                            <span className="grn-api-reference__param-meta">
                              {response.shape}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

export default ApiReferencePage;
