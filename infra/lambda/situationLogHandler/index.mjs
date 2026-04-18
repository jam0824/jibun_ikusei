import { QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME, getUserId, response, parseBody } from "/opt/nodejs/utils.mjs";

export const handler = async (event) => {
  const userId = getUserId(event);
  const pk = `user#${userId}`;

  switch (event.routeKey) {
    case "GET /situation-logs": {
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
          ":skFrom": `SITUATION#${from}`,
          ":skTo": `SITUATION#${to}~`,
        },
        ScanIndexForward: false,
        Limit: limit,
      }));

      const items = (result.Items ?? []).map(({ PK, SK, ttl, ...rest }) => rest);
      return response(200, items);
    }

    case "POST /situation-logs": {
      const body = parseBody(event);

      if (!body.summary || !body.timestamp) {
        return response(400, { error: "summary and timestamp are required" });
      }

      const shortId = crypto.randomUUID().slice(0, 8);

      await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: pk,
          SK: `SITUATION#${body.timestamp}#${shortId}`,
          summary: body.summary,
          timestamp: body.timestamp,
          details: body.details ?? {},
        },
      }));

      return response(200, { logged: true });
    }

    default:
      return response(400, { error: "Unknown route" });
  }
};
