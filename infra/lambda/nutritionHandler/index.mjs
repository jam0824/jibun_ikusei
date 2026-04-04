import { QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME, getUserId, response, parseBody } from "/opt/nodejs/utils.mjs";

const MEAL_TYPES = ['daily', 'breakfast', 'lunch', 'dinner'];

export const handler = async (event) => {
  const userId = getUserId(event);
  const pk = `user#${userId}`;

  switch (event.routeKey) {
    case "GET /nutrition": {
      const date = event.queryStringParameters?.date;
      if (!date) {
        return response(400, { error: "date query parameter is required" });
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
