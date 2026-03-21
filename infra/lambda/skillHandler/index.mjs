import { QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME, getUserId, response, parseBody } from "/opt/nodejs/utils.mjs";

export const handler = async (event) => {
  const userId = getUserId(event);
  const pk = `user#${userId}`;

  switch (event.routeKey) {
    case "GET /skills": {
      const result = await db.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": pk, ":sk": "SKILL#" },
      }));
      const skills = (result.Items ?? []).map(({ PK, SK, ...rest }) => rest);
      return response(200, skills);
    }

    case "POST /skills": {
      const skill = parseBody(event);
      const now = new Date().toISOString();
      const item = { ...skill, createdAt: skill.createdAt ?? now, updatedAt: now };
      await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: { PK: pk, SK: `SKILL#${item.id}`, ...item },
      }));
      return response(201, item);
    }

    case "PUT /skills/{id}": {
      const id = event.pathParameters.id;
      const updates = parseBody(event);
      const now = new Date().toISOString();
      const item = { ...updates, id, updatedAt: now };
      await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: { PK: pk, SK: `SKILL#${id}`, ...item },
      }));
      return response(200, item);
    }

    default:
      return response(400, { error: "Unknown route" });
  }
};
