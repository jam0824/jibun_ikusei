import { ScanCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME } from "/opt/nodejs/utils.mjs";

export const handler = async () => {
  // STATE#full を持つ全ユーザーをスキャン
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

    // User
    if (state.user) {
      writeItems.push({ PutRequest: { Item: { PK: pk, SK: "USER#profile", ...state.user } } });
    }

    // Settings
    if (state.settings) {
      writeItems.push({ PutRequest: { Item: { PK: pk, SK: "SETTINGS#main", ...state.settings } } });
    }

    // AiConfig
    if (state.aiConfig) {
      writeItems.push({ PutRequest: { Item: { PK: pk, SK: "AICONFIG#main", ...state.aiConfig } } });
    }

    // Meta
    if (state.meta) {
      writeItems.push({ PutRequest: { Item: { PK: pk, SK: "META#main", ...state.meta } } });
    }

    // Quests
    for (const quest of state.quests ?? []) {
      writeItems.push({ PutRequest: { Item: { PK: pk, SK: `QUEST#${quest.id}`, ...quest } } });
    }

    // Completions
    for (const completion of state.completions ?? []) {
      writeItems.push({ PutRequest: { Item: { PK: pk, SK: `COMPLETION#${completion.id}`, ...completion } } });
    }

    // Skills
    for (const skill of state.skills ?? []) {
      writeItems.push({ PutRequest: { Item: { PK: pk, SK: `SKILL#${skill.id}`, ...skill } } });
    }

    // AssistantMessages
    for (const msg of state.assistantMessages ?? []) {
      writeItems.push({ PutRequest: { Item: { PK: pk, SK: `MSG#${msg.id}`, ...msg } } });
    }

    // PersonalSkillDictionary
    for (const dict of state.personalSkillDictionary ?? []) {
      writeItems.push({ PutRequest: { Item: { PK: pk, SK: `DICT#${dict.id}`, ...dict } } });
    }

    // BatchWriteItem は25件ずつ
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
};
