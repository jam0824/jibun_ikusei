import { QueryCommand, PutCommand, DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME, getUserId, response, parseBody } from "/opt/nodejs/utils.mjs";

const VALID_STATUSES = new Set(["unread", "read", "archived"]);
const VALID_ADDED_FROM = new Set(["android-share", "manual"]);

function toJstIso(value = new Date()) {
  const jst = new Date(value.getTime() + 9 * 60 * 60 * 1000);
  const pad = (num) => String(num).padStart(2, "0");
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}T${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}:${pad(jst.getUTCSeconds())}+09:00`;
}

function buildCanonicalUrl(url) {
  const protocol = url.protocol.toLowerCase();
  const host = url.host.toLowerCase();
  let pathname = url.pathname || "";
  if (pathname !== "/") {
    pathname = pathname.replace(/\/+$/u, "");
  }
  if (pathname === "/") {
    pathname = "";
  }
  return `${protocol}//${host}${pathname}${url.search}`;
}

function canonicalizeScrapUrl(rawUrl) {
  const trimmed = String(rawUrl ?? "").trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.hostname = parsed.hostname.toLowerCase();
    const withoutHash = new URL(parsed.toString());
    withoutHash.hash = "";
    return {
      url: parsed.toString(),
      canonicalUrl: buildCanonicalUrl(withoutHash),
      domain: parsed.hostname.toLowerCase(),
    };
  } catch {
    return null;
  }
}

function stripKeys(item) {
  const { PK, SK, ...rest } = item;
  return rest;
}

function normalizeScrap(input, existing) {
  const resolved = canonicalizeScrapUrl(input?.url ?? existing?.url);
  if (!resolved) {
    return { error: "保存できるURLではありません。" };
  }

  const now = toJstIso();
  const status = VALID_STATUSES.has(input?.status) ? input.status : existing?.status ?? "unread";
  const addedFrom = VALID_ADDED_FROM.has(input?.addedFrom) ? input.addedFrom : existing?.addedFrom ?? "manual";
  const title = String(input?.title ?? existing?.title ?? resolved.domain).trim() || resolved.domain;

  const scrap = {
    ...(existing ?? {}),
    ...input,
    id: String(input?.id ?? existing?.id ?? ""),
    url: resolved.url,
    canonicalUrl: resolved.canonicalUrl,
    title,
    domain: String(input?.domain ?? existing?.domain ?? resolved.domain).trim() || resolved.domain,
    sourceText: typeof input?.sourceText === "string" ? input.sourceText.slice(0, 1000) : existing?.sourceText,
    memo: typeof input?.memo === "string" && input.memo.trim() ? input.memo.trim() : input?.memo === null ? undefined : existing?.memo,
    status,
    addedFrom,
    createdAt: existing?.createdAt ?? input?.createdAt ?? now,
    updatedAt: now,
    readAt: status === "read" ? input?.readAt ?? existing?.readAt ?? now : status === "unread" ? undefined : existing?.readAt,
    archivedAt: status === "archived" ? input?.archivedAt ?? existing?.archivedAt ?? now : status === "unread" || status === "read" ? undefined : existing?.archivedAt,
  };

  if (!scrap.id) {
    return { error: "id is required." };
  }

  return { scrap };
}

async function listScraps(pk) {
  const result = await db.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
    ExpressionAttributeValues: { ":pk": pk, ":sk": "SCRAP#" },
  }));
  return (result.Items ?? []).map(stripKeys);
}

export const handler = async (event) => {
  const userId = getUserId(event);
  const pk = `user#${userId}`;

  switch (event.routeKey) {
    case "GET /scraps": {
      return response(200, await listScraps(pk));
    }

    case "POST /scraps": {
      const incoming = parseBody(event);
      const normalized = normalizeScrap(incoming);
      if (normalized.error) {
        return response(400, { error: normalized.error });
      }

      const existing = (await listScraps(pk)).find(
        (scrap) => scrap.canonicalUrl === normalized.scrap.canonicalUrl,
      );
      if (existing) {
        return response(200, existing);
      }

      await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: { PK: pk, SK: `SCRAP#${normalized.scrap.id}`, ...normalized.scrap },
      }));
      return response(201, normalized.scrap);
    }

    case "PUT /scraps/{id}": {
      const id = event.pathParameters.id;
      const existingResult = await db.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: pk, SK: `SCRAP#${id}` },
      }));
      if (!existingResult.Item) {
        return response(404, { error: "Not found" });
      }

      const incoming = parseBody(event);
      const normalized = normalizeScrap({ ...incoming, id }, stripKeys(existingResult.Item));
      if (normalized.error) {
        return response(400, { error: normalized.error });
      }

      await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: { PK: pk, SK: `SCRAP#${id}`, ...normalized.scrap },
      }));
      return response(200, normalized.scrap);
    }

    case "DELETE /scraps/{id}": {
      const id = event.pathParameters.id;
      await db.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { PK: pk, SK: `SCRAP#${id}` },
      }));
      return response(200, { deleted: id });
    }

    default:
      return response(400, { error: "Unknown route" });
  }
};
