import { QueryCommand, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME, getUserId, response, parseBody } from "/opt/nodejs/utils.mjs";

export const handler = async (event) => {
  const userId = getUserId(event);
  const pk = `user#${userId}`;

  switch (event.routeKey) {
    // ------------------------------------------------------------------
    // POST /fitbit-data — 1日分のサマリーを upsert する
    // ------------------------------------------------------------------
    case "POST /fitbit-data": {
      let body;
      try {
        body = parseBody(event);
      } catch {
        return response(400, { error: "Invalid JSON body" });
      }

      if (!body || !body.date) {
        return response(400, { error: "date is required" });
      }

      const now = new Date().toISOString();
      const existing = await db.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: pk, SK: `FITBIT#${body.date}` },
      }));

      await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: pk,
          SK: `FITBIT#${body.date}`,
          date: body.date,
          heart: body.heart ?? null,
          active_zone_minutes: body.active_zone_minutes ?? null,
          sleep: body.sleep ?? null,
          activity: body.activity ?? null,
          createdAt: existing.Item?.createdAt ?? now,
          updatedAt: now,
        },
      }));

      return response(200, { saved: body.date });
    }

    // ------------------------------------------------------------------
    // GET /fitbit-data — 期間クエリ または 単一日取得
    // ------------------------------------------------------------------
    case "GET /fitbit-data": {
      const params = event.queryStringParameters ?? {};
      const { from, to, date } = params;

      // 単一日取得
      if (date) {
        const result = await db.send(new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: pk, SK: `FITBIT#${date}` },
        }));

        if (!result.Item) {
          return response(200, null);
        }

        const { PK, SK, ...rest } = result.Item;
        return response(200, rest);
      }

      // 期間クエリ
      if (!from || !to) {
        return response(400, { error: "from and to query parameters are required" });
      }

      const result = await db.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND SK BETWEEN :skFrom AND :skTo",
        ExpressionAttributeValues: {
          ":pk": pk,
          ":skFrom": `FITBIT#${from}`,
          ":skTo": `FITBIT#${to}~`,
        },
      }));

      const items = (result.Items ?? [])
        .map(({ PK, SK, ...rest }) => rest)
        .sort((a, b) => a.date.localeCompare(b.date));

      return response(200, items);
    }

    default:
      return response(400, { error: "Unknown route" });
  }
};
