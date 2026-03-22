import { QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME, getUserId, response, parseBody } from "/opt/nodejs/utils.mjs";

export const handler = async (event) => {
  const userId = getUserId(event);
  const pk = `user#${userId}`;

  switch (event.routeKey) {
    case "GET /browsing-times": {
      const params = event.queryStringParameters ?? {};
      const { from, to } = params;

      if (!from || !to) {
        return response(400, { error: "from and to query parameters are required" });
      }

      const result = await db.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND SK BETWEEN :skFrom AND :skTo",
        ExpressionAttributeValues: {
          ":pk": pk,
          ":skFrom": `BROWSE#${from}`,
          ":skTo": `BROWSE#${to}`,
        },
      }));

      const items = (result.Items ?? []).map(({ PK, SK, ...rest }) => rest);
      return response(200, items);
    }

    case "POST /browsing-times": {
      const { entries } = parseBody(event);
      const now = new Date().toISOString();

      for (const entry of entries) {
        await db.send(new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: pk,
            SK: `BROWSE#${entry.date}`,
            date: entry.date,
            domains: entry.domains,
            totalSeconds: entry.totalSeconds,
            updatedAt: now,
          },
        }));
      }

      return response(200, { synced: entries.length });
    }

    default:
      return response(400, { error: "Unknown route" });
  }
};
