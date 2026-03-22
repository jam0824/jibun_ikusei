import { QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME, getUserId, response, parseBody } from "/opt/nodejs/utils.mjs";

const TTL_DAYS = 31;

export const handler = async (event) => {
  const userId = getUserId(event);
  const pk = `user#${userId}`;

  switch (event.routeKey) {
    case "GET /activity-logs": {
      const params = event.queryStringParameters ?? {};
      const { from, to } = params;

      if (!from || !to) {
        return response(400, { error: "from and to query parameters are required" });
      }

      const limit = parseInt(params.limit) || 500;

      const result = await db.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND SK BETWEEN :skFrom AND :skTo",
        ExpressionAttributeValues: {
          ":pk": pk,
          ":skFrom": `LOG#${from}`,
          ":skTo": `LOG#${to}~`,
        },
        ScanIndexForward: false,
        Limit: limit,
      }));

      const items = (result.Items ?? []).map(({ PK, SK, ttl, ...rest }) => rest);
      return response(200, items);
    }

    case "POST /activity-logs": {
      const body = parseBody(event);
      const entries = body.entries;

      if (!Array.isArray(entries) || entries.length === 0) {
        return response(400, { error: "entries array required" });
      }

      if (entries.length > 100) {
        return response(400, { error: "Max 100 entries per request" });
      }

      const ttl = Math.floor(Date.now() / 1000) + TTL_DAYS * 86400;

      for (const entry of entries) {
        const shortId = crypto.randomUUID().slice(0, 8);
        await db.send(new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: pk,
            SK: `LOG#${entry.timestamp}#${shortId}`,
            ttl,
            source: entry.source,
            action: entry.action,
            category: entry.category,
            details: entry.details ?? {},
            timestamp: entry.timestamp,
          },
        }));
      }

      return response(200, { logged: entries.length });
    }

    default:
      return response(400, { error: "Unknown route" });
  }
};
