import { QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME, getUserId, response, parseBody } from "/opt/nodejs/utils.mjs";

const MEAL_TYPES = ['daily', 'breakfast', 'lunch', 'dinner'];

export const handler = async (event) => {
  const userId = getUserId(event);
  const pk = `user#${userId}`;

  switch (event.routeKey) {
    case "GET /nutrition": {
      const { date, from, to } = event.queryStringParameters ?? {};

      // 期間クエリ: from + to
      if (from && to) {
        const result = await db.send(new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
          ExpressionAttributeValues: {
            ":pk": pk,
            ":from": `NUTRITION#${from}#`,
            ":to": `NUTRITION#${to}#z`,
          },
        }));

        // 日付ごとにグルーピング
        const byDate = {};
        for (const item of (result.Items ?? [])) {
          const { PK, SK, ...rest } = item;
          const itemDate = rest.date;
          if (!byDate[itemDate]) {
            byDate[itemDate] = Object.fromEntries(MEAL_TYPES.map((t) => [t, null]));
          }
          byDate[itemDate][rest.mealType] = rest;
        }
        return response(200, byDate);
      }

      // 単日クエリ: date
      if (!date) {
        return response(400, { error: "date or from/to query parameters are required" });
      }

      const result = await db.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": pk,
          ":sk": `NUTRITION#${date}#`,
        },
      }));

      // 全区分をnull初期化して、取得済みデータで上書き
      const records = Object.fromEntries(MEAL_TYPES.map((t) => [t, null]));
      for (const item of (result.Items ?? [])) {
        const { PK, SK, ...rest } = item;
        records[rest.mealType] = rest;
      }

      return response(200, records);
    }

    case "PUT /nutrition/{date}/{mealType}": {
      const date = event.pathParameters.date;
      const mealType = event.pathParameters.mealType;

      if (!MEAL_TYPES.includes(mealType)) {
        return response(400, { error: `Invalid mealType: ${mealType}` });
      }

      const body = parseBody(event);
      const now = new Date().toISOString();
      const item = {
        ...body,
        date,
        mealType,
        updatedAt: now,
        createdAt: body.createdAt ?? now,
      };

      await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: pk,
          SK: `NUTRITION#${date}#${mealType}`,
          ...item,
        },
      }));

      return response(200, item);
    }

    default:
      return response(400, { error: "Unknown route" });
  }
};
