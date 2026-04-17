import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME, getUserId, response, parseBody } from "/opt/nodejs/utils.mjs";

const RAW_EVENT_PREFIX = "ACTION_LOG#RAW_EVENT#";
const SESSION_PREFIX = "ACTION_LOG#SESSION#";
const DAILY_PREFIX = "ACTION_LOG#DAILY#";
const WEEKLY_PREFIX = "ACTION_LOG#WEEKLY#";
const DEVICE_PREFIX = "ACTION_LOG#DEVICE#";
const OPEN_LOOP_PREFIX = "ACTION_LOG#OPEN_LOOP#";
const DELETION_REQUEST_PREFIX = "ACTION_LOG#DELETION_REQUEST#";
const PRIVACY_RULES_SK = "ACTION_LOG#PRIVACY_RULES";

function nowJstIso() {
  const now = new Date();
  const jstMillis = now.getTime() + 9 * 60 * 60 * 1000;
  return new Date(jstMillis).toISOString().replace("Z", "+09:00");
}

function stripSystemFields(item) {
  if (!item) {
    return null;
  }
  const { PK, SK, ttl, GSI1PK, GSI1SK, ...rest } = item;
  return rest;
}

function requireDateRange(event) {
  const params = event.queryStringParameters ?? {};
  const from = params.from;
  const to = params.to;
  if (!from || !to) {
    return { error: response(400, { error: "from and to query parameters are required" }) };
  }
  return { from, to };
}

function queryBetween({ pk, prefix, from, to }) {
  return db.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :skFrom AND :skTo",
      ExpressionAttributeValues: {
        ":pk": pk,
        ":skFrom": `${prefix}${from}`,
        ":skTo": `${prefix}${to}~`,
      },
      ScanIndexForward: true,
    }),
  );
}

function queryBeginsWith({ pk, prefix }) {
  return db.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: {
        ":pk": pk,
        ":prefix": prefix,
      },
      ScanIndexForward: true,
    }),
  );
}

function buildRawEventSk(event) {
  const dateKey = event.dateKey ?? String(event.occurredAt ?? "").slice(0, 10);
  return `${RAW_EVENT_PREFIX}${dateKey}#${event.occurredAt}#${event.id}`;
}

function buildRawEventItem(pk, event) {
  const item = {
    PK: pk,
    SK: buildRawEventSk(event),
    ...event,
    dateKey: event.dateKey ?? String(event.occurredAt ?? "").slice(0, 10),
  };
  if (event.expiresAt) {
    item.ttl = Math.floor(Date.parse(event.expiresAt) / 1000);
  }
  return item;
}

function buildSessionItem(pk, session) {
  return {
    PK: pk,
    SK: `${SESSION_PREFIX}${session.dateKey}#${session.startedAt}#${session.id}`,
    ...session,
  };
}

function buildDailyItem(pk, dateKey, log) {
  return {
    PK: pk,
    SK: `${DAILY_PREFIX}${dateKey}`,
    ...log,
    dateKey,
  };
}

function buildWeeklyItem(pk, weekKey, review) {
  return {
    PK: pk,
    SK: `${WEEKLY_PREFIX}${weekKey}`,
    ...review,
    weekKey,
  };
}

function buildDeviceItem(pk, id, existing, updates) {
  const now = updates.updatedAt ?? nowJstIso();
  return {
    PK: pk,
    SK: `${DEVICE_PREFIX}${id}`,
    ...existing,
    ...updates,
    id,
    createdAt: existing?.createdAt ?? updates.createdAt ?? now,
    updatedAt: now,
  };
}

function buildOpenLoopItem(pk, openLoop) {
  return {
    PK: pk,
    SK: `${OPEN_LOOP_PREFIX}${openLoop.dateKey}#${openLoop.id}`,
    ...openLoop,
  };
}

function buildDeletionRequestItem(pk, deletionRequest) {
  return {
    PK: pk,
    SK: `${DELETION_REQUEST_PREFIX}${deletionRequest.id}`,
    ...deletionRequest,
  };
}

function buildWeekRangeFromWeekKey(weekKey) {
  const match = /^(?<year>\d{4})-W(?<week>\d{2})$/.exec(String(weekKey ?? ""));
  if (!match?.groups) {
    return null;
  }
  const year = Number(match.groups.year);
  const week = Number(match.groups.week);
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const januaryFourthDay = januaryFourth.getUTCDay() || 7;
  const weekOneMonday = new Date(Date.UTC(year, 0, 4 - (januaryFourthDay - 1)));
  const start = new Date(weekOneMonday);
  start.setUTCDate(weekOneMonday.getUTCDate() + (week - 1) * 7);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

function rangesOverlap(leftFrom, leftTo, rightFrom, rightTo) {
  return !(leftTo < rightFrom || rightTo < leftFrom);
}

async function deleteItems(items, pk) {
  for (const item of items ?? []) {
    await db.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { PK: pk, SK: item.SK },
      }),
    );
  }
}

export const handler = async (event) => {
  const userId = getUserId(event);
  const pk = `user#${userId}`;

  switch (event.routeKey) {
    case "POST /action-log/raw-events": {
      const body = parseBody(event);
      const events = body.events;
      if (!Array.isArray(events) || events.length === 0) {
        return response(400, { error: "events array required" });
      }

      for (const eventRecord of events) {
        await db.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: buildRawEventItem(pk, eventRecord),
          }),
        );
      }

      return response(200, { logged: events.length });
    }

    case "GET /action-log/raw-events": {
      const range = requireDateRange(event);
      if ("error" in range) {
        return range.error;
      }
      const result = await queryBetween({
        pk,
        prefix: RAW_EVENT_PREFIX,
        from: range.from,
        to: range.to,
      });
      return response(200, (result.Items ?? []).map(stripSystemFields));
    }

    case "PUT /action-log/sessions": {
      const body = parseBody(event);
      const sessions = Array.isArray(body.sessions) ? body.sessions : null;
      if (sessions === null) {
        return response(400, { error: "sessions array required" });
      }

      const dateKeys = [...new Set(sessions.map((session) => session.dateKey).filter(Boolean))];
      for (const dateKey of dateKeys) {
        const existing = await queryBeginsWith({
          pk,
          prefix: `${SESSION_PREFIX}${dateKey}#`,
        });
        for (const item of existing.Items ?? []) {
          await db.send(
            new DeleteCommand({
              TableName: TABLE_NAME,
              Key: { PK: pk, SK: item.SK },
            }),
          );
        }
      }

      for (const session of sessions) {
        await db.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: buildSessionItem(pk, session),
          }),
        );
      }

      return response(200, { updated: sessions.length });
    }

    case "GET /action-log/sessions": {
      const range = requireDateRange(event);
      if ("error" in range) {
        return range.error;
      }
      const result = await queryBetween({
        pk,
        prefix: SESSION_PREFIX,
        from: range.from,
        to: range.to,
      });
      return response(200, (result.Items ?? []).map(stripSystemFields));
    }

    case "PUT /action-log/sessions/{id}/hidden": {
      const sessionId = event.pathParameters?.id;
      const body = parseBody(event);
      const dateKey = body.dateKey;
      if (!dateKey || typeof body.hidden !== "boolean") {
        return response(400, { error: "dateKey and hidden are required" });
      }
      const existing = await queryBeginsWith({
        pk,
        prefix: `${SESSION_PREFIX}${dateKey}#`,
      });
      const target = (existing.Items ?? []).find((item) => item.id === sessionId);
      if (!target) {
        return response(404, { error: "session not found" });
      }
      const item = {
        ...target,
        hidden: body.hidden,
      };
      await db.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item,
        }),
      );
      return response(200, stripSystemFields(item));
    }

    case "GET /action-log/daily/{dateKey}": {
      const dateKey = event.pathParameters?.dateKey;
      const result = await db.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: pk, SK: `${DAILY_PREFIX}${dateKey}` },
        }),
      );
      return response(200, stripSystemFields(result.Item));
    }

    case "PUT /action-log/daily/{dateKey}": {
      const dateKey = event.pathParameters?.dateKey;
      const body = parseBody(event);
      const item = buildDailyItem(pk, dateKey, body);
      await db.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item,
        }),
      );
      return response(200, stripSystemFields(item));
    }

    case "GET /action-log/daily": {
      const range = requireDateRange(event);
      if ("error" in range) {
        return range.error;
      }
      const result = await queryBetween({
        pk,
        prefix: DAILY_PREFIX,
        from: range.from,
        to: range.to,
      });
      return response(200, (result.Items ?? []).map(stripSystemFields));
    }

    case "GET /action-log/weekly/{weekKey}": {
      const weekKey = event.pathParameters?.weekKey;
      const result = await db.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: pk, SK: `${WEEKLY_PREFIX}${weekKey}` },
        }),
      );
      return response(200, stripSystemFields(result.Item));
    }

    case "PUT /action-log/weekly/{weekKey}": {
      const weekKey = event.pathParameters?.weekKey;
      const body = parseBody(event);
      const item = buildWeeklyItem(pk, weekKey, body);
      await db.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item,
        }),
      );
      return response(200, stripSystemFields(item));
    }

    case "GET /action-log/weekly": {
      const year = event.queryStringParameters?.year;
      if (!year) {
        return response(400, { error: "year query parameter is required" });
      }
      const result = await queryBetween({
        pk,
        prefix: WEEKLY_PREFIX,
        from: `${year}-W`,
        to: `${year}-W`,
      });
      return response(200, (result.Items ?? []).map(stripSystemFields));
    }

    case "GET /action-log/devices": {
      const result = await queryBeginsWith({ pk, prefix: DEVICE_PREFIX });
      return response(200, (result.Items ?? []).map(stripSystemFields));
    }

    case "PUT /action-log/devices/{id}": {
      const id = event.pathParameters?.id;
      const updates = parseBody(event);
      const existingResult = await db.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: pk, SK: `${DEVICE_PREFIX}${id}` },
        }),
      );
      const existing = stripSystemFields(existingResult.Item) ?? {};
      const item = buildDeviceItem(pk, id, existing, updates);
      await db.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item,
        }),
      );
      return response(200, stripSystemFields(item));
    }

    case "GET /action-log/privacy-rules": {
      const result = await db.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: pk, SK: PRIVACY_RULES_SK },
        }),
      );
      return response(200, result.Item?.rules ?? []);
    }

    case "PUT /action-log/privacy-rules": {
      const body = parseBody(event);
      const rules = Array.isArray(body.rules) ? body.rules : null;
      if (rules === null) {
        return response(400, { error: "rules array required" });
      }
      const item = {
        PK: pk,
        SK: PRIVACY_RULES_SK,
        rules,
        updatedAt: nowJstIso(),
      };
      await db.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item,
        }),
      );
      return response(200, { updated: rules.length });
    }

    case "GET /action-log/open-loops": {
      const range = requireDateRange(event);
      if ("error" in range) {
        return range.error;
      }
      const result = await queryBetween({
        pk,
        prefix: OPEN_LOOP_PREFIX,
        from: range.from,
        to: range.to,
      });
      return response(200, (result.Items ?? []).map(stripSystemFields));
    }

    case "PUT /action-log/open-loops": {
      const body = parseBody(event);
      const dateKeys = Array.isArray(body.dateKeys) ? body.dateKeys.filter(Boolean) : null;
      const openLoops = Array.isArray(body.openLoops) ? body.openLoops : null;
      if (dateKeys === null || openLoops === null) {
        return response(400, { error: "dateKeys and openLoops are required" });
      }

      for (const dateKey of [...new Set(dateKeys)]) {
        const existing = await queryBeginsWith({
          pk,
          prefix: `${OPEN_LOOP_PREFIX}${dateKey}#`,
        });
        for (const item of existing.Items ?? []) {
          await db.send(
            new DeleteCommand({
              TableName: TABLE_NAME,
              Key: { PK: pk, SK: item.SK },
            }),
          );
        }
      }

      for (const openLoop of openLoops) {
        await db.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: buildOpenLoopItem(pk, openLoop),
          }),
        );
      }

      return response(200, { updated: openLoops.length });
    }

    case "DELETE /action-log/range": {
      const range = requireDateRange(event);
      if ("error" in range) {
        return range.error;
      }

      const [rawEvents, sessions, dailyLogs, openLoops, weeklyCandidates] = await Promise.all([
        queryBetween({ pk, prefix: RAW_EVENT_PREFIX, from: range.from, to: range.to }),
        queryBetween({ pk, prefix: SESSION_PREFIX, from: range.from, to: range.to }),
        queryBetween({ pk, prefix: DAILY_PREFIX, from: range.from, to: range.to }),
        queryBetween({ pk, prefix: OPEN_LOOP_PREFIX, from: range.from, to: range.to }),
        queryBeginsWith({ pk, prefix: WEEKLY_PREFIX }),
      ]);

      const weeklyReviews = (weeklyCandidates.Items ?? []).filter((item) => {
        const weekRange = buildWeekRangeFromWeekKey(item.weekKey);
        if (!weekRange) {
          return false;
        }
        return rangesOverlap(range.from, range.to, weekRange.from, weekRange.to);
      });

      await deleteItems(rawEvents.Items, pk);
      await deleteItems(sessions.Items, pk);
      await deleteItems(dailyLogs.Items, pk);
      await deleteItems(openLoops.Items, pk);
      await deleteItems(weeklyReviews, pk);

      const deletionRequest = {
        id: `delete_${nowJstIso().replace(/[^0-9]/g, "").slice(0, 14)}`,
        from: range.from,
        to: range.to,
        createdAt: nowJstIso(),
      };
      await db.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: buildDeletionRequestItem(pk, deletionRequest),
        }),
      );

      return response(200, {
        deleted: {
          rawEvents: rawEvents.Items?.length ?? 0,
          sessions: sessions.Items?.length ?? 0,
          dailyLogs: dailyLogs.Items?.length ?? 0,
          weeklyReviews: weeklyReviews.length,
          openLoops: openLoops.Items?.length ?? 0,
        },
        deletionRequestId: deletionRequest.id,
      });
    }

    case "GET /action-log/deletion-requests": {
      const result = await queryBeginsWith({ pk, prefix: DELETION_REQUEST_PREFIX });
      const items = (result.Items ?? [])
        .map(stripSystemFields)
        .sort((left, right) => String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")));
      return response(200, items);
    }

    case "POST /action-log/deletion-requests/{id}/ack": {
      const id = event.pathParameters?.id;
      await db.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { PK: pk, SK: `${DELETION_REQUEST_PREFIX}${id}` },
        }),
      );
      return response(200, { acked: id });
    }

    default:
      return response(400, { error: "Unknown route" });
  }
};
