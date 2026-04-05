import { ScanCommand, BatchWriteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME } from "/opt/nodejs/utils.mjs";

function buildChatMessageIndexFromItem(item) {
  const userId = String(item.PK ?? "").replace(/^user#/, "");
  return {
    GSI1PK: `CHAT_MSG#${userId}`,
    GSI1SK: new Date(item.createdAt).getTime(),
  };
}

async function runLegacyStateMigration() {
  const scanResult = await db.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: "SK = :sk",
    ExpressionAttributeValues: { ":sk": "STATE#full" },
  }));

  const items = scanResult.Items ?? [];
  let totalMigrated = 0;

  for (const item of items) {
    const pk = item.PK;
    const state = item.state;
    if (!state) continue;

    const writeItems = [];

    if (state.user) {
      writeItems.push({ PutRequest: { Item: { PK: pk, SK: "USER#profile", ...state.user } } });
    }
    if (state.settings) {
      writeItems.push({ PutRequest: { Item: { PK: pk, SK: "SETTINGS#main", ...state.settings } } });
    }
    if (state.aiConfig) {
      writeItems.push({ PutRequest: { Item: { PK: pk, SK: "AICONFIG#main", ...state.aiConfig } } });
    }
    if (state.meta) {
      writeItems.push({ PutRequest: { Item: { PK: pk, SK: "META#main", ...state.meta } } });
    }
    for (const quest of state.quests ?? []) {
      writeItems.push({ PutRequest: { Item: { PK: pk, SK: `QUEST#${quest.id}`, ...quest } } });
    }
    for (const completion of state.completions ?? []) {
      writeItems.push({ PutRequest: { Item: { PK: pk, SK: `COMPLETION#${completion.id}`, ...completion } } });
    }
    for (const skill of state.skills ?? []) {
      writeItems.push({ PutRequest: { Item: { PK: pk, SK: `SKILL#${skill.id}`, ...skill } } });
    }
    for (const msg of state.assistantMessages ?? []) {
      writeItems.push({ PutRequest: { Item: { PK: pk, SK: `MSG#${msg.id}`, ...msg } } });
    }
    for (const dict of state.personalSkillDictionary ?? []) {
      writeItems.push({ PutRequest: { Item: { PK: pk, SK: `DICT#${dict.id}`, ...dict } } });
    }

    for (let i = 0; i < writeItems.length; i += 25) {
      const batch = writeItems.slice(i, i + 25);
      await db.send(new BatchWriteCommand({
        RequestItems: { [TABLE_NAME]: batch },
      }));
    }

    totalMigrated += writeItems.length;
    console.log(`Migrated ${writeItems.length} items for ${pk}`);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      usersProcessed: items.length,
      totalItemsMigrated: totalMigrated,
    }),
  };
}

async function runChatMessageIndexBackfill(event) {
  const limit = Number(event.limit ?? 100);
  const scanResult = await db.send(new ScanCommand({
    TableName: TABLE_NAME,
    Limit: limit,
    ExclusiveStartKey: event.lastEvaluatedKey,
    FilterExpression: "begins_with(SK, :sk) AND attribute_not_exists(GSI1PK)",
    ExpressionAttributeValues: { ":sk": "CHAT_MSG#" },
  }));

  let updated = 0;
  for (const item of scanResult.Items ?? []) {
    await db.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        ...item,
        ...buildChatMessageIndexFromItem(item),
      },
    }));
    updated += 1;
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      updated,
      lastEvaluatedKey: scanResult.LastEvaluatedKey ?? null,
    }),
  };
}

export const handler = async (event = {}) => {
  if (event.mode === "chat-message-index-backfill") {
    return runChatMessageIndexBackfill(event);
  }

  return runLegacyStateMigration();
};
