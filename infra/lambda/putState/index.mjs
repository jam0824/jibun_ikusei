import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: "ap-northeast-1" });
const db = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME;

export const handler = async (event) => {
  const userId = event.requestContext.authorizer.jwt.claims.sub;
  const state = JSON.parse(event.body);

  await db.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `user#${userId}`,
      SK: "STATE#full",
      state,
      updatedAt: new Date().toISOString()
    }
  }));

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true })
  };
};
