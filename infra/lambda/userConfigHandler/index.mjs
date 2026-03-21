import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME, getUserId, response, parseBody } from "/opt/nodejs/utils.mjs";

const ROUTE_TO_SK = {
  "/user": "USER#profile",
  "/settings": "SETTINGS#main",
  "/ai-config": "AICONFIG#main",
  "/meta": "META#main",
};

function getSkFromRoute(routeKey) {
  for (const [path, sk] of Object.entries(ROUTE_TO_SK)) {
    if (routeKey.endsWith(path)) return sk;
  }
  return null;
}

export const handler = async (event) => {
  const userId = getUserId(event);
  const pk = `user#${userId}`;
  const method = event.routeKey.split(" ")[0];
  const sk = getSkFromRoute(event.routeKey);

  if (!sk) return response(400, { error: "Unknown route" });

  if (method === "GET") {
    const result = await db.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk, SK: sk },
    }));
    const { PK, SK, ...rest } = result.Item ?? {};
    return response(200, Object.keys(rest).length > 0 ? rest : null);
  }

  if (method === "PUT") {
    const body = parseBody(event);
    const now = new Date().toISOString();
    const item = { ...body, updatedAt: now };
    await db.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: { PK: pk, SK: sk, ...item },
    }));
    return response(200, { updated: true });
  }

  return response(400, { error: "Unknown method" });
};
