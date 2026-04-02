import { QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME, getUserId, response, parseBody } from "/opt/nodejs/utils.mjs";

export const handler = async (event) => {
  const userId = getUserId(event);
  const pk = `user#${userId}`;

  switch (event.routeKey) {
    case "GET /health-data": {
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
          ":skFrom": `HEALTH#${from}`,
          ":skTo": `HEALTH#${to}~`,
        },
      }));

      const items = (result.Items ?? [])
        .map(({ PK, SK, ...rest }) => rest)
        .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

      return response(200, items);
    }

    case "POST /health-data": {
      const { entries } = parseBody(event);

      if (!Array.isArray(entries) || entries.length === 0) {
        return response(400, { error: "entries array required" });
      }

      if (entries.length > 500) {
        return response(400, { error: "Max 500 entries per request" });
      }

      for (const entry of entries) {
        if (!entry?.date || !entry?.time) {
          return response(400, { error: "date and time are required for each entry" });
        }

        await db.send(new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: pk,
            SK: `HEALTH#${entry.date}#${entry.time}`,
            date: entry.date,
            time: entry.time,
            weight_kg: entry.weight_kg ?? null,
            body_fat_pct: entry.body_fat_pct ?? null,
            source: entry.source ?? "health_planet",
          },
        }));
      }

      return response(200, { synced: entries.length });
    }

    default:
      return response(400, { error: "Unknown route" });
  }
};
