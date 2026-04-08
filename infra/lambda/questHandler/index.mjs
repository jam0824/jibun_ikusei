import { QueryCommand, PutCommand, DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME, getUserId, response, parseBody } from "/opt/nodejs/utils.mjs";

export const handler = async (event) => {
  const userId = getUserId(event);
  const pk = `user#${userId}`;

  switch (event.routeKey) {
    case "GET /quests": {
      const result = await db.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": pk, ":sk": "QUEST#" },
      }));
      const quests = (result.Items ?? []).map(({ PK, SK, ...rest }) => rest);
      return response(200, quests);
    }

    case "POST /quests": {
      const quest = parseBody(event);
      const now = new Date().toISOString();
      const item = { ...quest, createdAt: quest.createdAt ?? now, updatedAt: now };
      await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: { PK: pk, SK: `QUEST#${item.id}`, ...item },
      }));
      return response(201, item);
    }

    case "PUT /quests/{id}": {
      const id = event.pathParameters.id;
      const updates = parseBody(event);
      const now = new Date().toISOString();
      const existing = await db.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: pk, SK: `QUEST#${id}` },
      }));
      const item = {
        ...(existing.Item ?? {}),
        ...updates,
        id,
        createdAt: existing.Item?.createdAt ?? updates.createdAt ?? now,
        updatedAt: now,
      };
      await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: { PK: pk, SK: `QUEST#${id}`, ...item },
      }));
      return response(200, item);
    }

    case "DELETE /quests/{id}": {
      const id = event.pathParameters.id;
      await db.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { PK: pk, SK: `QUEST#${id}` },
      }));
      return response(200, { deleted: id });
    }

    default:
      return response(400, { error: "Unknown route" });
  }
};
