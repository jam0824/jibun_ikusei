import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: "ap-northeast-1" });
const db = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME;

export const handler = async (event) => {
  const userId = event.requestContext.authorizer.jwt.claims.sub;

  const result = await db.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: `user#${userId}`, SK: "STATE#full" }
  }));

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result.Item?.state ?? null)
  };
};
