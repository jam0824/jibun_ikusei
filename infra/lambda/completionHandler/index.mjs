import { QueryCommand, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME, getUserId, response, parseBody } from "/opt/nodejs/utils.mjs";

const USER_LEVEL_XP = 100;
const SKILL_LEVEL_XP = 50;

function getLevelFromXp(totalXp, stepXp) {
  const safe = Math.max(0, totalXp);
  return Math.floor(safe / stepXp) + 1;
}

async function queryByPrefix(pk, prefix) {
  const result = await db.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
    ExpressionAttributeValues: { ":pk": pk, ":sk": prefix },
  }));

  return result.Items ?? [];
}

async function loadAggregateSource(pk) {
  const [completions, skills, userResult] = await Promise.all([
    queryByPrefix(pk, "COMPLETION#"),
    queryByPrefix(pk, "SKILL#"),
    db.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk, SK: "USER#profile" },
    })),
  ]);

  return {
    completions,
    skills,
    user: userResult.Item ?? undefined,
  };
}

function toDbItem(pk, sk, item) {
  const { PK, SK, ...rest } = item;
  return {
    PK: pk,
    SK: sk,
    ...rest,
  };
}

function upsertCompletion(completions, completion) {
  return [
    ...completions.filter((entry) => entry.id !== completion.id),
    completion,
  ];
}

function buildAggregateState({ completions, skills, user, now }) {
  const activeCompletions = completions.filter((completion) => !completion.undoneAt);
  const skillTotals = new Map(skills.map((skill) => [skill.id, 0]));

  for (const completion of activeCompletions) {
    if (!completion.resolvedSkillId || !completion.skillXpAwarded) {
      continue;
    }

    if (!skillTotals.has(completion.resolvedSkillId)) {
      continue;
    }

    skillTotals.set(
      completion.resolvedSkillId,
      (skillTotals.get(completion.resolvedSkillId) ?? 0) + completion.skillXpAwarded,
    );
  }

  const aggregatedSkills = skills.map((skill) => {
    const totalXp = skillTotals.get(skill.id) ?? 0;
    const level = getLevelFromXp(totalXp, SKILL_LEVEL_XP);
    const didChange = (skill.totalXp ?? 0) !== totalXp || (skill.level ?? 1) !== level;

    return {
      ...skill,
      createdAt: skill.createdAt ?? now,
      totalXp,
      level,
      updatedAt: didChange ? now : (skill.updatedAt ?? skill.createdAt ?? now),
    };
  });

  const totalXp = activeCompletions.reduce((sum, completion) => sum + (completion.userXpAwarded ?? 0), 0);
  const level = getLevelFromXp(totalXp, USER_LEVEL_XP);
  const userDidChange = !user || (user.totalXp ?? 0) !== totalXp || (user.level ?? 1) !== level;

  const aggregatedUser = {
    ...(user ?? {}),
    id: user?.id ?? "local_user",
    totalXp,
    level,
    createdAt: user?.createdAt ?? now,
    updatedAt: userDidChange ? now : (user?.updatedAt ?? user?.createdAt ?? now),
  };

  return {
    user: aggregatedUser,
    skills: aggregatedSkills,
    skillMap: new Map(aggregatedSkills.map((skill) => [skill.id, skill])),
  };
}

async function persistAggregateState(pk, aggregate) {
  await db.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: toDbItem(pk, "USER#profile", aggregate.user),
  }));

  for (const skill of aggregate.skills) {
    await db.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: toDbItem(pk, `SKILL#${skill.id}`, skill),
    }));
  }
}

export const handler = async (event) => {
  const userId = getUserId(event);
  const pk = `user#${userId}`;

  switch (event.routeKey) {
    case "GET /completions": {
      const completions = await queryByPrefix(pk, "COMPLETION#");
      return response(200, completions.map(({ PK, SK, ...rest }) => rest));
    }

    case "POST /completions": {
      const body = parseBody(event);
      const now = new Date().toISOString();

      const existingCompletion = await db.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: pk, SK: `COMPLETION#${body.id}` },
      }));

      if (existingCompletion.Item) {
        const aggregate = buildAggregateState({
          ...(await loadAggregateSource(pk)),
          now,
        });
        await persistAggregateState(pk, aggregate);

        return response(201, {
          completionId: body.id,
          userXpAwarded: existingCompletion.Item.userXpAwarded ?? body.userXpAwarded,
          totalXp: aggregate.user.totalXp ?? 0,
          level: aggregate.user.level ?? 1,
          userLevelUp: false,
          skillLevelUp: false,
        });
      }

      const questResult = await db.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: pk, SK: `QUEST#${body.questId}` },
      }));
      const quest = questResult.Item;
      const questStatus = quest?.status ?? "active";
      if (!quest || !quest.title || questStatus !== "active") {
        return response(400, { error: "クエストが見つからないか、完了できない状態です。" });
      }

      const source = await loadAggregateSource(pk);
      const beforeAggregate = buildAggregateState({ ...source, now });
      const completionItem = {
        PK: pk,
        SK: `COMPLETION#${body.id}`,
        ...body,
        createdAt: now,
      };
      const afterAggregate = buildAggregateState({
        completions: upsertCompletion(source.completions, completionItem),
        skills: source.skills,
        user: source.user,
        now,
      });

      await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: completionItem,
      }));
      await persistAggregateState(pk, afterAggregate);

      const userLevelUp = afterAggregate.user.level > beforeAggregate.user.level;
      const skillLevelUp = Boolean(
        body.resolvedSkillId
        && body.skillXpAwarded
        && (afterAggregate.skillMap.get(body.resolvedSkillId)?.level ?? 1)
          > (beforeAggregate.skillMap.get(body.resolvedSkillId)?.level ?? 1),
      );

      return response(201, {
        completionId: body.id,
        userXpAwarded: body.userXpAwarded,
        totalXp: afterAggregate.user.totalXp,
        level: afterAggregate.user.level,
        userLevelUp,
        skillLevelUp,
      });
    }

    case "PUT /completions/{id}": {
      const id = event.pathParameters.id;
      const updates = parseBody(event);
      const now = new Date().toISOString();

      const existing = await db.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: pk, SK: `COMPLETION#${id}` },
      }));

      const item = { ...(existing.Item ?? {}), ...updates, PK: pk, SK: `COMPLETION#${id}` };
      const source = await loadAggregateSource(pk);
      const aggregate = buildAggregateState({
        completions: upsertCompletion(source.completions, item),
        skills: source.skills,
        user: source.user,
        now,
      });

      await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      }));
      await persistAggregateState(pk, aggregate);

      const { PK, SK, ...rest } = item;
      return response(200, rest);
    }

    default:
      return response(400, { error: "Unknown route" });
  }
};
