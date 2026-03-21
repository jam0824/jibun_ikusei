import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: "ap-northeast-1" });
export const db = DynamoDBDocumentClient.from(client);
export const TABLE_NAME = process.env.TABLE_NAME;

export function getUserId(event) {
  return event.requestContext.authorizer.jwt.claims.sub;
}

export function response(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function parseBody(event) {
  return JSON.parse(event.body);
}
