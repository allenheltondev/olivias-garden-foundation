/**
 * The MCP keys table, `ogf-mcp-keys-<env>` (template.yaml). One item per key,
 * `PK = KEY#<id>`. A handful of keys at most, so listing them is a Scan.
 * Its own table: the MCP function's role names this table and nothing that
 * holds a supporter's data.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';

const pk = (id) => `KEY#${id}`;

function fromItem(item) {
  return {
    id: String(item.id),
    label: String(item.label),
    scopes: Array.isArray(item.scopes) ? item.scopes : [],
    operator: item.operator ?? null,
    secretHash: String(item.secretHash),
    createdAt: String(item.createdAt),
    expiresAt: String(item.expiresAt),
    lastUsedAt: item.lastUsedAt ?? null
  };
}

function isConditionFailure(error) {
  return error?.name === 'ConditionalCheckFailedException';
}

export class DynamoKeyStore {
  constructor(table, doc) {
    this.table = table;
    this.doc = doc ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  async get(id) {
    const out = await this.doc.send(new GetCommand({ TableName: this.table, Key: { PK: pk(id) }, ConsistentRead: true }));
    return out.Item ? fromItem(out.Item) : null;
  }

  async create(record) {
    await this.doc.send(new PutCommand({
      TableName: this.table,
      Item: { PK: pk(record.id), ...record },
      ConditionExpression: 'attribute_not_exists(PK)'
    }));
  }

  async list() {
    const rows = [];
    let start;
    do {
      const out = await this.doc.send(new ScanCommand({ TableName: this.table, ExclusiveStartKey: start }));
      rows.push(...(out.Items ?? []).map(fromItem));
      start = out.LastEvaluatedKey;
    } while (start);
    return rows;
  }

  async delete(id) {
    try {
      await this.doc.send(new DeleteCommand({
        TableName: this.table,
        Key: { PK: pk(id) },
        ConditionExpression: 'attribute_exists(PK)'
      }));
      return true;
    } catch (error) {
      if (isConditionFailure(error)) return false;
      throw error;
    }
  }

  async touch(id, at) {
    try {
      await this.doc.send(new UpdateCommand({
        TableName: this.table,
        Key: { PK: pk(id) },
        UpdateExpression: 'SET lastUsedAt = :at',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeValues: { ':at': at }
      }));
    } catch (error) {
      // Revoked between the read and this write: nothing to record.
      if (!isConditionFailure(error)) throw error;
    }
  }
}
