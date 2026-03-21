import { QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME, getUserId, response, parseBody } from "/opt/nodejs/utils.mjs";

function getPrefix(routeKey) {
  if (routeKey.includes("/dictionary")) return "DICT#";
  if (routeKey.includes("/messages")) return "MSG#";
  return null;
}

export const handler = async (event) => {
  const userId = getUserId(event);
  const pk = `user#${userId}`;
  const method = event.routeKey.split(" ")[0];
  const prefix = getPrefix(event.routeKey);

  if (!prefix) return response(400, { error: "Unknown route" });

  switch (method) {
    case "GET": {
      const result = await db.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": pk, ":sk": prefix },
      }));
      const items = (result.Items ?? []).map(({ PK, SK, ...rest }) => rest);
      return response(200, items);
    }

    case "POST": {
      const item = parseBody(event);
      const now = new Date().toISOString();
      const record = { ...item, createdAt: item.createdAt ?? now };
      await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: { PK: pk, SK: `${prefix}${record.id}`, ...record },
      }));
      return response(201, record);
    }

    case "PUT": {
      const id = event.pathParameters.id;
      const updates = parseBody(event);
      const item = { ...updates, id };
      await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: { PK: pk, SK: `${prefix}${id}`, ...item },
      }));
      return response(200, item);
    }

    default:
      return response(400, { error: "Unknown method" });
  }
};
