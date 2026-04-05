import { QueryCommand, PutCommand, DeleteCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME, getUserId, response, parseBody } from "/opt/nodejs/utils.mjs";

function buildChatMessageIndex(userId, createdAt) {
  return {
    GSI1PK: `CHAT_MSG#${userId}`,
    GSI1SK: new Date(createdAt).getTime(),
  };
}

function toJstRangeEpochMillis(fromDate, toDate) {
  return {
    from: new Date(`${fromDate}T00:00:00+09:00`).getTime(),
    to: new Date(`${toDate}T23:59:59.999+09:00`).getTime(),
  };
}

export const handler = async (event) => {
  const userId = getUserId(event);
  const pk = `user#${userId}`;

  switch (event.routeKey) {
    case "GET /chat-sessions": {
      const result = await db.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": pk, ":sk": "CHAT_SESSION#" },
      }));
      const items = (result.Items ?? [])
        .map(({ PK, SK, ...rest }) => rest)
        .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
      return response(200, items);
    }

    case "POST /chat-sessions": {
      const item = parseBody(event);
      const now = new Date().toISOString();
      const record = { ...item, createdAt: item.createdAt ?? now, updatedAt: item.updatedAt ?? now };
      await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: { PK: pk, SK: `CHAT_SESSION#${record.id}`, ...record },
      }));
      return response(201, record);
    }

    case "PUT /chat-sessions/{id}": {
      const id = event.pathParameters.id;
      const updates = parseBody(event);
      const now = new Date().toISOString();
      const item = { ...updates, id, updatedAt: updates.updatedAt ?? now };
      await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: { PK: pk, SK: `CHAT_SESSION#${id}`, ...item },
      }));
      return response(200, item);
    }

    case "DELETE /chat-sessions/{id}": {
      const id = event.pathParameters.id;
      const msgResult = await db.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": pk, ":sk": `CHAT_MSG#${id}#` },
        ProjectionExpression: "PK, SK",
      }));

      const deleteItems = [
        { PK: pk, SK: `CHAT_SESSION#${id}` },
        ...(msgResult.Items ?? []),
      ];

      for (let i = 0; i < deleteItems.length; i += 25) {
        const batch = deleteItems.slice(i, i + 25);
        await db.send(new BatchWriteCommand({
          RequestItems: {
            [TABLE_NAME]: batch.map((key) => ({
              DeleteRequest: { Key: { PK: key.PK, SK: key.SK } },
            })),
          },
        }));
      }

      return response(200, { deleted: id });
    }

    case "GET /chat-sessions/{id}/messages": {
      const id = event.pathParameters.id;
      const result = await db.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": pk, ":sk": `CHAT_MSG#${id}#` },
        ScanIndexForward: true,
      }));
      const items = (result.Items ?? [])
        .map(({ PK, SK, GSI1PK, GSI1SK, ...rest }) => rest)
        .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
      return response(200, items);
    }

    case "GET /chat-messages": {
      const { from, to, sessionId } = event.queryStringParameters ?? {};
      const { from: fromEpoch, to: toEpoch } = toJstRangeEpochMillis(from, to);

      const result = await db.send(new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :gsi1pk AND GSI1SK BETWEEN :from AND :to",
        ExpressionAttributeValues: {
          ":gsi1pk": `CHAT_MSG#${userId}`,
          ":from": fromEpoch,
          ":to": toEpoch,
        },
        ScanIndexForward: true,
      }));

      let items = (result.Items ?? [])
        .map(({ PK, SK, GSI1PK, GSI1SK, ...rest }) => rest)
        .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));

      if (sessionId) {
        items = items.filter((item) => item.sessionId === sessionId);
      }

      return response(200, items);
    }

    case "POST /chat-sessions/{id}/messages": {
      const id = event.pathParameters.id;
      const item = parseBody(event);
      const now = new Date().toISOString();
      const record = { ...item, sessionId: id, createdAt: item.createdAt ?? now };
      await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: pk,
          SK: `CHAT_MSG#${id}#${record.id}`,
          ...record,
          ...buildChatMessageIndex(userId, record.createdAt),
        },
      }));
      return response(201, record);
    }

    default:
      return response(400, { error: "Unknown route" });
  }
};
