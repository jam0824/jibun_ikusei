import { QueryCommand, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME, getUserId, response, parseBody } from "/opt/nodejs/utils.mjs";

const USER_LEVEL_XP = 100;
const SKILL_LEVEL_XP = 50;

function getLevelFromXp(totalXp, stepXp) {
  const safe = Math.max(0, totalXp);
  return Math.floor(safe / stepXp) + 1;
}

export const handler = async (event) => {
  const userId = getUserId(event);
  const pk = `user#${userId}`;

  switch (event.routeKey) {
    case "GET /completions": {
      const result = await db.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": pk, ":sk": "COMPLETION#" },
      }));
      const completions = (result.Items ?? []).map(({ PK, SK, ...rest }) => rest);
      return response(200, completions);
    }

    case "POST /completions": {
      const body = parseBody(event);
      const now = new Date().toISOString();

      // 冪等性チェック: 同じIDのcompletionが既に存在する場合はスキップ
      const existingCompletion = await db.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: pk, SK: `COMPLETION#${body.id}` },
      }));
      if (existingCompletion.Item) {
        // 既に処理済み — 前回の結果を返す
        const currentUserForIdempotent = await db.send(new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: pk, SK: "USER#profile" },
        }));
        const cu = currentUserForIdempotent.Item ?? { totalXp: 0, level: 1 };
        return response(201, {
          completionId: body.id,
          userXpAwarded: existingCompletion.Item.userXpAwarded ?? body.userXpAwarded,
          totalXp: cu.totalXp ?? 0,
          level: cu.level ?? 1,
          userLevelUp: false,
          skillLevelUp: false,
        });
      }

      // ユーザーの現在のXPを取得
      const userResult = await db.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: pk, SK: "USER#profile" },
      }));
      const currentUser = userResult.Item ?? { totalXp: 0, level: 1 };
      const currentXp = currentUser.totalXp ?? 0;
      const oldLevel = getLevelFromXp(currentXp, USER_LEVEL_XP);

      // XPフロア: レベルダウンなし、そのレベル内のXPは0が下限
      const levelFloor = (oldLevel - 1) * USER_LEVEL_XP;
      const newTotalXp = Math.max(levelFloor, currentXp + body.userXpAwarded);
      const newLevel = getLevelFromXp(newTotalXp, USER_LEVEL_XP);
      const userLevelUp = newLevel > oldLevel;

      // トランザクション: completion作成 + user XP更新
      const transactItems = [
        {
          Put: {
            TableName: TABLE_NAME,
            Item: {
              PK: pk,
              SK: `COMPLETION#${body.id}`,
              ...body,
              createdAt: now,
            },
          },
        },
        {
          Put: {
            TableName: TABLE_NAME,
            Item: {
              PK: pk,
              SK: "USER#profile",
              id: "local_user",
              totalXp: newTotalXp,
              level: newLevel,
              createdAt: currentUser.createdAt ?? now,
              updatedAt: now,
            },
          },
        },
      ];

      // スキルXPの更新がある場合
      let skillLevelUp = false;
      if (body.resolvedSkillId && body.skillXpAwarded) {
        const skillResult = await db.send(new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: pk, SK: `SKILL#${body.resolvedSkillId}` },
        }));
        const currentSkill = skillResult.Item;
        if (currentSkill) {
          const newSkillXp = (currentSkill.totalXp ?? 0) + body.skillXpAwarded;
          const newSkillLevel = getLevelFromXp(newSkillXp, SKILL_LEVEL_XP);
          const oldSkillLevel = getLevelFromXp(currentSkill.totalXp ?? 0, SKILL_LEVEL_XP);
          skillLevelUp = newSkillLevel > oldSkillLevel;

          transactItems.push({
            Put: {
              TableName: TABLE_NAME,
              Item: {
                PK: pk,
                SK: `SKILL#${body.resolvedSkillId}`,
                ...currentSkill,
                PK: undefined, SK: undefined,
                totalXp: newSkillXp,
                level: newSkillLevel,
                updatedAt: now,
              },
            },
          });
          // PK/SKの重複を防ぐためクリーンアップ
          const skillItem = transactItems[transactItems.length - 1].Put.Item;
          skillItem.PK = pk;
          skillItem.SK = `SKILL#${body.resolvedSkillId}`;
        }
      }

      await db.send(new TransactWriteCommand({ TransactItems: transactItems }));

      return response(201, {
        completionId: body.id,
        userXpAwarded: body.userXpAwarded,
        totalXp: newTotalXp,
        level: newLevel,
        userLevelUp,
        skillLevelUp,
      });
    }

    case "PUT /completions/{id}": {
      const id = event.pathParameters.id;
      const updates = parseBody(event);

      // 既存のcompletionを取得してマージ
      const existing = await db.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: pk, SK: `COMPLETION#${id}` },
      }));

      const item = { ...(existing.Item ?? {}), ...updates, PK: pk, SK: `COMPLETION#${id}` };
      await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      }));

      const { PK, SK, ...rest } = item;
      return response(200, rest);
    }

    default:
      return response(400, { error: "Unknown route" });
  }
};
