import { describe, expect, it } from 'vitest'

import {
  buildAwsInvokeArgs,
  buildBackfillPayload,
  parseBackfillInvokeResponse,
} from '../../scripts/backfill-chat-message-index.mjs'

describe('backfill chat message index script helpers', () => {
  it('builds the initial payload without a pagination key', () => {
    expect(buildBackfillPayload({ limit: 100 })).toBe(
      '{"mode":"chat-message-index-backfill","limit":100}',
    )
  })

  it('includes the pagination key when continuing a backfill', () => {
    expect(
      buildBackfillPayload({
        limit: 100,
        lastEvaluatedKey: { PK: 'user#123', SK: 'CHAT_MSG#chat_1#msg_1' },
      }),
    ).toBe(
      '{"mode":"chat-message-index-backfill","limit":100,"lastEvaluatedKey":{"PK":"user#123","SK":"CHAT_MSG#chat_1#msg_1"}}',
    )
  })

  it('builds aws cli arguments with file-based payload input', () => {
    expect(
      buildAwsInvokeArgs({
        region: 'ap-northeast-1',
        functionName: 'jibun-ikusei-migrateState',
        payloadPath: 'payload.json',
        responsePath: 'response.json',
      }),
    ).toEqual([
      'lambda',
      'invoke',
      '--region',
      'ap-northeast-1',
      '--function-name',
      'jibun-ikusei-migrateState',
      '--cli-binary-format',
      'raw-in-base64-out',
      '--payload',
      'fileb://payload.json',
      'response.json',
    ])
  })

  it('parses the lambda invoke payload body', () => {
    expect(
      parseBackfillInvokeResponse(
        JSON.stringify({
          statusCode: 200,
          body: JSON.stringify({
            updated: 42,
            lastEvaluatedKey: { PK: 'user#123', SK: 'CHAT_MSG#chat_1#msg_1' },
          }),
        }),
      ),
    ).toEqual({
      updated: 42,
      lastEvaluatedKey: { PK: 'user#123', SK: 'CHAT_MSG#chat_1#msg_1' },
    })
  })
})
