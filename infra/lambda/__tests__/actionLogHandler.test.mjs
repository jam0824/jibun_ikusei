import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockSend, makeEvent, parseResponse } from './helpers.mjs'
import { handler } from '../actionLogHandler/index.mjs'

describe('actionLogHandler', () => {
  beforeEach(() => {
    mockSend.mockReset()
  })

  it('POST /action-log/raw-events saves raw events with ttl and deterministic SK', async () => {
    const savedItems = []
    mockSend.mockImplementation((command) => {
      savedItems.push(command.input.Item)
      return Promise.resolve({})
    })

    const body = {
      deviceId: 'device_1',
      events: [
        {
          id: 'raw_1',
          deviceId: 'device_1',
          source: 'desktop_agent',
          eventType: 'active_window_changed',
          occurredAt: '2026-04-17T09:15:00+09:00',
          expiresAt: '2026-05-17T09:15:00+09:00',
          appName: 'Code.exe',
          windowTitle: 'main.py - VS Code',
        },
      ],
    }

    const { statusCode, body: responseBody } = parseResponse(
      await handler(makeEvent('POST /action-log/raw-events', { body })),
    )

    expect(statusCode).toBe(200)
    expect(responseBody.logged).toBe(1)
    expect(savedItems).toHaveLength(1)
    expect(savedItems[0].SK).toBe(
      'ACTION_LOG#RAW_EVENT#2026-04-17#2026-04-17T09:15:00+09:00#raw_1',
    )
    expect(savedItems[0].ttl).toBe(Math.floor(Date.parse('2026-05-17T09:15:00+09:00') / 1000))
  })

  it('POST /action-log/raw-events uses the same key when the same event is retried', async () => {
    const savedItems = []
    mockSend.mockImplementation((command) => {
      savedItems.push(command.input.Item)
      return Promise.resolve({})
    })

    const body = {
      deviceId: 'device_1',
      events: [
        {
          id: 'raw_1',
          deviceId: 'device_1',
          source: 'desktop_agent',
          eventType: 'active_window_changed',
          occurredAt: '2026-04-17T09:15:00+09:00',
          expiresAt: '2026-05-17T09:15:00+09:00',
        },
      ],
    }

    await handler(makeEvent('POST /action-log/raw-events', { body }))
    await handler(makeEvent('POST /action-log/raw-events', { body }))

    expect(savedItems).toHaveLength(2)
    expect(savedItems[0].SK).toBe(savedItems[1].SK)
  })

  it('GET /action-log/raw-events returns a range without PK/SK/ttl', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: 'user#test-user-123',
          SK: 'ACTION_LOG#RAW_EVENT#2026-04-17#2026-04-17T09:15:00+09:00#raw_1',
          ttl: 1780000000,
          id: 'raw_1',
          deviceId: 'device_1',
          source: 'desktop_agent',
          eventType: 'active_window_changed',
          occurredAt: '2026-04-17T09:15:00+09:00',
        },
      ],
    })

    const event = makeEvent('GET /action-log/raw-events')
    event.queryStringParameters = { from: '2026-04-17', to: '2026-04-17' }
    const { statusCode, body } = parseResponse(await handler(event))

    expect(statusCode).toBe(200)
    expect(body).toEqual([
      {
        id: 'raw_1',
        deviceId: 'device_1',
        source: 'desktop_agent',
        eventType: 'active_window_changed',
        occurredAt: '2026-04-17T09:15:00+09:00',
      },
    ])
  })

  it('GET /action-log/raw-events/page returns newest-first items with a cursor for the next page', async () => {
    const commands = []
    mockSend.mockImplementation((command) => {
      commands.push(command)
      return Promise.resolve({
        Items: [
          {
            PK: 'user#test-user-123',
            SK: 'ACTION_LOG#RAW_EVENT#2026-04-17#2026-04-17T11:15:00+09:00#raw_2',
            id: 'raw_2',
            deviceId: 'device_1',
            source: 'desktop_agent',
            eventType: 'heartbeat',
            occurredAt: '2026-04-17T11:15:00+09:00',
          },
          {
            PK: 'user#test-user-123',
            SK: 'ACTION_LOG#RAW_EVENT#2026-04-17#2026-04-17T11:05:00+09:00#raw_1',
            id: 'raw_1',
            deviceId: 'device_1',
            source: 'desktop_agent',
            eventType: 'active_window_changed',
            occurredAt: '2026-04-17T11:05:00+09:00',
          },
        ],
        LastEvaluatedKey: {
          PK: 'user#test-user-123',
          SK: 'ACTION_LOG#RAW_EVENT#2026-04-17#2026-04-17T11:05:00+09:00#raw_1',
        },
      })
    })

    const event = makeEvent('GET /action-log/raw-events/page')
    event.queryStringParameters = { from: '2026-04-17', to: '2026-04-17', limit: '2' }
    const { statusCode, body } = parseResponse(await handler(event))

    expect(statusCode).toBe(200)
    expect(body.items.map((item) => item.id)).toEqual(['raw_2', 'raw_1'])
    expect(body.nextCursor).toEqual(expect.any(String))
    expect(commands[0].input.ScanIndexForward).toBe(false)
    expect(commands[0].input.Limit).toBe(2)
  })

  it('PUT /action-log/sessions replaces sessions for included date keys and GET returns the range', async () => {
    const commands = []
    mockSend.mockImplementation((command) => {
      commands.push(command)
      if (command.constructor.name === 'QueryCommand') {
        return Promise.resolve({
          Items: [
            {
              PK: 'user#test-user-123',
              SK: 'ACTION_LOG#SESSION#2026-04-17#2026-04-17T08:00:00+09:00#old_session',
            },
          ],
        })
      }
      return Promise.resolve({})
    })

    const putBody = {
      deviceId: 'device_1',
      sessions: [
        {
          id: 'session_1',
          deviceId: 'device_1',
          startedAt: '2026-04-17T09:00:00+09:00',
          endedAt: '2026-04-17T10:00:00+09:00',
          dateKey: '2026-04-17',
          title: '調査',
          primaryCategory: '学習',
          activityKinds: ['research'],
          appNames: ['Chrome'],
          domains: ['example.com'],
          projectNames: [],
          searchKeywords: ['example', 'research'],
          noteIds: [],
          openLoopIds: [],
          hidden: false,
        },
      ],
    }

    const { statusCode, body: responseBody } = parseResponse(
      await handler(makeEvent('PUT /action-log/sessions', { body: putBody })),
    )

    expect(statusCode).toBe(200)
    expect(responseBody.updated).toBe(1)
    const batchCommands = commands.filter((command) => command.constructor.name === 'BatchWriteCommand')
    expect(batchCommands).toHaveLength(2)
    expect(batchCommands[0].input.RequestItems['test-table']).toEqual([
      {
        DeleteRequest: {
          Key: {
            PK: 'user#test-user-123',
            SK: 'ACTION_LOG#SESSION#2026-04-17#2026-04-17T08:00:00+09:00#old_session',
          },
        },
      },
    ])
    expect(batchCommands[1].input.RequestItems['test-table']).toEqual([
      {
        PutRequest: {
          Item: {
            PK: 'user#test-user-123',
            SK: 'ACTION_LOG#SESSION#2026-04-17#2026-04-17T09:00:00+09:00#session_1',
            ...putBody.sessions[0],
          },
        },
      },
    ])
    expect(commands.some((command) => command.constructor.name === 'DeleteCommand')).toBe(false)
    expect(commands.some((command) => command.constructor.name === 'PutCommand')).toBe(false)

    mockSend.mockReset()
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: 'user#test-user-123',
          SK: 'ACTION_LOG#SESSION#2026-04-17#2026-04-17T09:00:00+09:00#session_1',
          ...putBody.sessions[0],
        },
      ],
    })

    const getEvent = makeEvent('GET /action-log/sessions')
    getEvent.queryStringParameters = { from: '2026-04-17', to: '2026-04-17' }
    const { statusCode: getStatus, body: getBody } = parseResponse(await handler(getEvent))

    expect(getStatus).toBe(200)
    expect(getBody).toEqual([putBody.sessions[0]])
  })

  it('GET /action-log/sessions/page skips hidden sessions when includeHidden is false', async () => {
    const commands = []
    mockSend.mockImplementation((command) => {
      commands.push(command)
      if (commands.length === 1) {
        return Promise.resolve({
          Items: [
            {
              PK: 'user#test-user-123',
              SK: 'ACTION_LOG#SESSION#2026-04-17#2026-04-17T11:15:00+09:00#session_hidden',
              id: 'session_hidden',
              deviceId: 'device_1',
              startedAt: '2026-04-17T11:15:00+09:00',
              endedAt: '2026-04-17T11:20:00+09:00',
              dateKey: '2026-04-17',
              title: 'Hidden session',
              primaryCategory: '学習',
              activityKinds: ['research'],
              appNames: ['Chrome'],
              domains: ['example.com'],
              projectNames: [],
              searchKeywords: ['hidden'],
              noteIds: [],
              openLoopIds: [],
              hidden: true,
            },
          ],
          LastEvaluatedKey: {
            PK: 'user#test-user-123',
            SK: 'ACTION_LOG#SESSION#2026-04-17#2026-04-17T11:15:00+09:00#session_hidden',
          },
        })
      }
      return Promise.resolve({
        Items: [
          {
            PK: 'user#test-user-123',
            SK: 'ACTION_LOG#SESSION#2026-04-17#2026-04-17T11:05:00+09:00#session_visible',
            id: 'session_visible',
            deviceId: 'device_1',
            startedAt: '2026-04-17T11:05:00+09:00',
            endedAt: '2026-04-17T11:10:00+09:00',
            dateKey: '2026-04-17',
            title: 'Visible session',
            primaryCategory: '学習',
            activityKinds: ['research'],
            appNames: ['Chrome'],
            domains: ['example.com'],
            projectNames: [],
            searchKeywords: ['visible'],
            noteIds: [],
            openLoopIds: [],
            hidden: false,
          },
        ],
      })
    })

    const event = makeEvent('GET /action-log/sessions/page')
    event.queryStringParameters = {
      from: '2026-04-17',
      to: '2026-04-17',
      limit: '1',
      includeHidden: 'false',
    }
    const { statusCode, body } = parseResponse(await handler(event))

    expect(statusCode).toBe(200)
    expect(body.items.map((item) => item.id)).toEqual(['session_visible'])
    expect(body.nextCursor).toBeNull()
    expect(commands[0].input.ScanIndexForward).toBe(false)
    expect(commands[0].input.Limit).toBe(1)
    expect(commands[1].input.ExclusiveStartKey).toEqual({
      PK: 'user#test-user-123',
      SK: 'ACTION_LOG#SESSION#2026-04-17#2026-04-17T11:15:00+09:00#session_hidden',
    })
  })

  it('PUT /action-log/sessions batches delete and put requests in chunks of 25', async () => {
    const commands = []
    const existingItems = Array.from({ length: 30 }, (_, index) => ({
      PK: 'user#test-user-123',
      SK: `ACTION_LOG#SESSION#2026-04-17#2026-04-17T08:${String(index).padStart(2, '0')}:00+09:00#old_session_${index}`,
    }))
    const sessions = Array.from({ length: 30 }, (_, index) => ({
      id: `session_${index}`,
      deviceId: 'device_1',
      startedAt: `2026-04-17T09:${String(index).padStart(2, '0')}:00+09:00`,
      endedAt: `2026-04-17T10:${String(index).padStart(2, '0')}:00+09:00`,
      dateKey: '2026-04-17',
      title: `session ${index}`,
      primaryCategory: '学習',
      activityKinds: ['research'],
      appNames: ['Chrome'],
      domains: ['example.com'],
      projectNames: [],
      searchKeywords: [`keyword-${index}`],
      noteIds: [],
      openLoopIds: [],
      hidden: false,
    }))

    mockSend.mockImplementation((command) => {
      commands.push(command)
      if (command.constructor.name === 'QueryCommand') {
        return Promise.resolve({ Items: existingItems })
      }
      return Promise.resolve({})
    })

    const { statusCode, body } = parseResponse(
      await handler(
        makeEvent('PUT /action-log/sessions', {
          body: {
            deviceId: 'device_1',
            sessions,
          },
        }),
      ),
    )

    expect(statusCode).toBe(200)
    expect(body.updated).toBe(30)
    const batchCommands = commands.filter((command) => command.constructor.name === 'BatchWriteCommand')
    expect(batchCommands).toHaveLength(4)
    expect(batchCommands.map((command) => command.input.RequestItems['test-table'].length)).toEqual([
      25,
      5,
      25,
      5,
    ])
    expect(
      batchCommands
        .slice(0, 2)
        .every((command) => command.input.RequestItems['test-table'].every((item) => 'DeleteRequest' in item)),
    ).toBe(true)
    expect(
      batchCommands
        .slice(2)
        .every((command) => command.input.RequestItems['test-table'].every((item) => 'PutRequest' in item)),
    ).toBe(true)
  })

  it('PUT /action-log/sessions uses explicit dateKeys to clear dates even when no sessions remain', async () => {
    const commands = []
    mockSend.mockImplementation((command) => {
      commands.push(command)
      if (command.constructor.name === 'QueryCommand') {
        return Promise.resolve({
          Items: [
            {
              PK: 'user#test-user-123',
              SK: 'ACTION_LOG#SESSION#2026-04-16#2026-04-16T08:00:00+09:00#old_session',
            },
          ],
        })
      }
      return Promise.resolve({})
    })

    const { statusCode, body } = parseResponse(
      await handler(
        makeEvent('PUT /action-log/sessions', {
          body: {
            deviceId: 'device_1',
            dateKeys: ['2026-04-16'],
            sessions: [],
          },
        }),
      ),
    )

    expect(statusCode).toBe(200)
    expect(body.updated).toBe(0)
    expect(
      commands.some(
        (command) =>
          command.constructor.name === 'QueryCommand' &&
          command.input.ExpressionAttributeValues[':prefix'] === 'ACTION_LOG#SESSION#2026-04-16#',
      ),
    ).toBe(true)
    const batchCommands = commands.filter((command) => command.constructor.name === 'BatchWriteCommand')
    expect(batchCommands).toHaveLength(1)
    expect(batchCommands[0].input.RequestItems['test-table']).toEqual([
      {
        DeleteRequest: {
          Key: {
            PK: 'user#test-user-123',
            SK: 'ACTION_LOG#SESSION#2026-04-16#2026-04-16T08:00:00+09:00#old_session',
          },
        },
      },
    ])
    expect(commands.some((command) => command.constructor.name === 'DeleteCommand')).toBe(false)
    expect(commands.some((command) => command.constructor.name === 'PutCommand')).toBe(false)
  })

  it('PUT /action-log/sessions retries batch writes when DynamoDB returns unprocessed items', async () => {
    const commands = []
    let batchAttempt = 0
    const body = {
      deviceId: 'device_1',
      sessions: [
        {
          id: 'session_retry',
          deviceId: 'device_1',
          startedAt: '2026-04-17T09:00:00+09:00',
          endedAt: '2026-04-17T10:00:00+09:00',
          dateKey: '2026-04-17',
          title: 'retry',
          primaryCategory: '学習',
          activityKinds: ['research'],
          appNames: ['Chrome'],
          domains: ['example.com'],
          projectNames: [],
          searchKeywords: ['retry'],
          noteIds: [],
          openLoopIds: [],
          hidden: false,
        },
      ],
    }

    mockSend.mockImplementation((command) => {
      commands.push(command)
      if (command.constructor.name === 'QueryCommand') {
        return Promise.resolve({ Items: [] })
      }
      if (command.constructor.name === 'BatchWriteCommand') {
        batchAttempt += 1
        if (batchAttempt === 1) {
          return Promise.resolve({
            UnprocessedItems: {
              'test-table': command.input.RequestItems['test-table'],
            },
          })
        }
      }
      return Promise.resolve({})
    })

    const { statusCode, body: responseBody } = parseResponse(
      await handler(makeEvent('PUT /action-log/sessions', { body })),
    )

    expect(statusCode).toBe(200)
    expect(responseBody.updated).toBe(1)
    const batchCommands = commands.filter((command) => command.constructor.name === 'BatchWriteCommand')
    expect(batchCommands).toHaveLength(2)
    expect(batchCommands[0].input.RequestItems['test-table']).toEqual(
      batchCommands[1].input.RequestItems['test-table'],
    )
  })

  it('daily routes support exact get/put and range get', async () => {
    const daily = {
      id: 'daily_1',
      dateKey: '2026-04-17',
      summary: 'summary',
      mainThemes: ['route'],
      noteIds: [],
      openLoopIds: [],
      reviewQuestions: ['q1'],
      generatedAt: '2026-04-17T23:59:00+09:00',
    }

    mockSend.mockResolvedValueOnce({ Item: undefined })
    const missing = makeEvent('GET /action-log/daily/{dateKey}', {
      pathParameters: { dateKey: '2026-04-17' },
    })
    const { statusCode: missingStatus, body: missingBody } = parseResponse(await handler(missing))
    expect(missingStatus).toBe(200)
    expect(missingBody).toBeNull()

    let savedItem = null
    mockSend.mockImplementationOnce((command) => {
      savedItem = command.input.Item
      return Promise.resolve({})
    })
    const putEvent = makeEvent('PUT /action-log/daily/{dateKey}', {
      pathParameters: { dateKey: '2026-04-17' },
      body: daily,
    })
    const { statusCode: putStatus } = parseResponse(await handler(putEvent))
    expect(putStatus).toBe(200)
    expect(savedItem.SK).toBe('ACTION_LOG#DAILY#2026-04-17')

    mockSend.mockResolvedValueOnce({
      Items: [{ PK: 'user#test-user-123', SK: 'ACTION_LOG#DAILY#2026-04-17', ...daily }],
    })
    const rangeEvent = makeEvent('GET /action-log/daily')
    rangeEvent.queryStringParameters = { from: '2026-04-01', to: '2026-04-17' }
    const { statusCode: rangeStatus, body: rangeBody } = parseResponse(await handler(rangeEvent))
    expect(rangeStatus).toBe(200)
    expect(rangeBody).toEqual([daily])
  })

  it('weekly routes support exact get/put and year list get', async () => {
    const weekly = {
      id: 'weekly_1',
      weekKey: '2026-W16',
      summary: 'summary',
      categoryDurations: { 学習: 120 },
      focusThemes: ['route'],
      openLoopIds: [],
      generatedAt: '2026-04-17T23:59:00+09:00',
    }

    mockSend.mockResolvedValueOnce({ Item: undefined })
    const missing = makeEvent('GET /action-log/weekly/{weekKey}', {
      pathParameters: { weekKey: '2026-W16' },
    })
    const { statusCode: missingStatus, body: missingBody } = parseResponse(await handler(missing))
    expect(missingStatus).toBe(200)
    expect(missingBody).toBeNull()

    let savedItem = null
    mockSend.mockImplementationOnce((command) => {
      savedItem = command.input.Item
      return Promise.resolve({})
    })
    const putEvent = makeEvent('PUT /action-log/weekly/{weekKey}', {
      pathParameters: { weekKey: '2026-W16' },
      body: weekly,
    })
    const { statusCode: putStatus } = parseResponse(await handler(putEvent))
    expect(putStatus).toBe(200)
    expect(savedItem.SK).toBe('ACTION_LOG#WEEKLY#2026-W16')

    mockSend.mockResolvedValueOnce({
      Items: [{ PK: 'user#test-user-123', SK: 'ACTION_LOG#WEEKLY#2026-W16', ...weekly }],
    })
    const listEvent = makeEvent('GET /action-log/weekly')
    listEvent.queryStringParameters = { year: '2026' }
    const { statusCode: listStatus, body: listBody } = parseResponse(await handler(listEvent))
    expect(listStatus).toBe(200)
    expect(listBody).toEqual([weekly])
  })

  it('device routes support list and partial update upsert', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: 'user#test-user-123',
          SK: 'ACTION_LOG#DEVICE#device_1',
          id: 'device_1',
          name: 'main-pc',
          platform: 'windows',
          captureState: 'active',
          createdAt: '2026-04-17T09:00:00+09:00',
          updatedAt: '2026-04-17T09:00:00+09:00',
        },
      ],
    })

    const listEvent = makeEvent('GET /action-log/devices')
    const { statusCode: listStatus, body: listBody } = parseResponse(await handler(listEvent))
    expect(listStatus).toBe(200)
    expect(listBody).toHaveLength(1)

    mockSend.mockResolvedValueOnce({ Item: undefined })
    let savedItem = null
    mockSend.mockImplementationOnce((command) => {
      savedItem = command.input.Item
      return Promise.resolve({})
    })
    const putEvent = makeEvent('PUT /action-log/devices/{id}', {
      pathParameters: { id: 'device_1' },
      body: { name: 'office-pc' },
    })
    const { statusCode: putStatus, body: putBody } = parseResponse(await handler(putEvent))
    expect(putStatus).toBe(200)
    expect(putBody.name).toBe('office-pc')
    expect(savedItem.SK).toBe('ACTION_LOG#DEVICE#device_1')
  })

  it('privacy rule routes support list and full replace', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined })
    const missingEvent = makeEvent('GET /action-log/privacy-rules')
    const { statusCode: missingStatus, body: missingBody } = parseResponse(await handler(missingEvent))
    expect(missingStatus).toBe(200)
    expect(missingBody).toEqual([])

    let savedItem = null
    const rules = [
      {
        id: 'rule_1',
        type: 'domain',
        value: 'example.com',
        mode: 'domain_only',
        enabled: true,
      },
    ]
    mockSend.mockImplementationOnce((command) => {
      savedItem = command.input.Item
      return Promise.resolve({})
    })
    const putEvent = makeEvent('PUT /action-log/privacy-rules', {
      body: { rules },
    })
    const { statusCode: putStatus, body: putBody } = parseResponse(await handler(putEvent))
    expect(putStatus).toBe(200)
    expect(putBody.updated).toBe(1)
    expect(savedItem.SK).toBe('ACTION_LOG#PRIVACY_RULES')
    expect(savedItem.rules).toEqual(rules)

    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'user#test-user-123',
        SK: 'ACTION_LOG#PRIVACY_RULES',
        rules,
      },
    })
    const getEvent = makeEvent('GET /action-log/privacy-rules')
    const { statusCode: getStatus, body: getBody } = parseResponse(await handler(getEvent))
    expect(getStatus).toBe(200)
    expect(getBody).toEqual(rules)
  })

  it('open-loop routes support range get and dateKey full replace', async () => {
    const openLoops = [
      {
        id: 'loop_1',
        createdAt: '2026-04-17T10:00:00+09:00',
        updatedAt: '2026-04-17T10:05:00+09:00',
        dateKey: '2026-04-17',
        title: 'manifestの確認',
        description: 'manifest v3 を見直す',
        status: 'open',
        linkedSessionIds: ['session_1'],
      },
    ]

    const commands = []
    mockSend.mockImplementation((command) => {
      commands.push(command)
      if (command.constructor.name === 'QueryCommand') {
        return Promise.resolve({
          Items: [
            {
              PK: 'user#test-user-123',
              SK: 'ACTION_LOG#OPEN_LOOP#2026-04-17#old_loop',
            },
          ],
        })
      }
      return Promise.resolve({})
    })

    const putEvent = makeEvent('PUT /action-log/open-loops', {
      body: {
        dateKeys: ['2026-04-17'],
        openLoops,
      },
    })
    const { statusCode: putStatus, body: putBody } = parseResponse(await handler(putEvent))
    expect(putStatus).toBe(200)
    expect(putBody.updated).toBe(1)
    expect(commands.some((command) => command.constructor.name === 'DeleteCommand')).toBe(true)
    const savedPut = commands.find((command) => command.constructor.name === 'PutCommand')
    expect(savedPut.input.Item.SK).toBe('ACTION_LOG#OPEN_LOOP#2026-04-17#loop_1')

    mockSend.mockReset()
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: 'user#test-user-123',
          SK: 'ACTION_LOG#OPEN_LOOP#2026-04-17#loop_1',
          ...openLoops[0],
        },
      ],
    })

    const getEvent = makeEvent('GET /action-log/open-loops')
    getEvent.queryStringParameters = { from: '2026-04-17', to: '2026-04-17' }
    const { statusCode: getStatus, body: getBody } = parseResponse(await handler(getEvent))
    expect(getStatus).toBe(200)
    expect(getBody).toEqual(openLoops)
  })

  it('PUT /action-log/sessions/{id}/hidden updates only the target session hidden state', async () => {
    const existingSession = {
      PK: 'user#test-user-123',
      SK: 'ACTION_LOG#SESSION#2026-04-17#2026-04-17T09:00:00+09:00#session_1',
      id: 'session_1',
      deviceId: 'device_1',
      startedAt: '2026-04-17T09:00:00+09:00',
      endedAt: '2026-04-17T10:00:00+09:00',
      dateKey: '2026-04-17',
      title: 'Chrome調査',
      primaryCategory: '学習',
      activityKinds: ['調査'],
      appNames: ['Chrome'],
      domains: ['developer.chrome.com'],
      projectNames: [],
      searchKeywords: ['chrome'],
      noteIds: [],
      openLoopIds: [],
      hidden: false,
    }

    let savedItem = null
    mockSend.mockImplementation((command) => {
      if (command.constructor.name === 'QueryCommand') {
        return Promise.resolve({ Items: [existingSession] })
      }
      if (command.constructor.name === 'PutCommand') {
        savedItem = command.input.Item
      }
      return Promise.resolve({})
    })

    const event = makeEvent('PUT /action-log/sessions/{id}/hidden', {
      pathParameters: { id: 'session_1' },
      body: { dateKey: '2026-04-17', hidden: true },
    })
    const { statusCode, body } = parseResponse(await handler(event))

    expect(statusCode).toBe(200)
    expect(body.hidden).toBe(true)
    expect(savedItem.hidden).toBe(true)
    expect(savedItem.SK).toBe(existingSession.SK)
  })

  it('DELETE /action-log/range deletes action-log data and creates a deletion request', async () => {
    const commands = []
    mockSend.mockImplementation((command) => {
      commands.push(command)
      if (command.constructor.name === 'QueryCommand') {
        const prefix = command.input.ExpressionAttributeValues[':skFrom']
        if (String(prefix).startsWith('ACTION_LOG#RAW_EVENT#')) {
          return Promise.resolve({
            Items: [
              {
                PK: 'user#test-user-123',
                SK: 'ACTION_LOG#RAW_EVENT#2026-04-16#2026-04-16T09:00:00+09:00#raw_1',
              },
            ],
          })
        }
        if (String(prefix).startsWith('ACTION_LOG#SESSION#')) {
          return Promise.resolve({
            Items: [
              {
                PK: 'user#test-user-123',
                SK: 'ACTION_LOG#SESSION#2026-04-16#2026-04-16T09:00:00+09:00#session_1',
              },
            ],
          })
        }
        if (String(prefix).startsWith('ACTION_LOG#DAILY#')) {
          return Promise.resolve({
            Items: [{ PK: 'user#test-user-123', SK: 'ACTION_LOG#DAILY#2026-04-16' }],
          })
        }
        if (String(prefix).startsWith('ACTION_LOG#OPEN_LOOP#')) {
          return Promise.resolve({
            Items: [
              { PK: 'user#test-user-123', SK: 'ACTION_LOG#OPEN_LOOP#2026-04-16#loop_1' },
            ],
          })
        }
        if (command.input.ExpressionAttributeValues[':prefix'] === 'ACTION_LOG#WEEKLY#') {
          return Promise.resolve({
            Items: [
              {
                PK: 'user#test-user-123',
                SK: 'ACTION_LOG#WEEKLY#2026-W16',
                weekKey: '2026-W16',
              },
            ],
          })
        }
      }
      return Promise.resolve({})
    })

    const event = makeEvent('DELETE /action-log/range')
    event.queryStringParameters = { from: '2026-04-16', to: '2026-04-16' }
    const { statusCode, body } = parseResponse(await handler(event))

    expect(statusCode).toBe(200)
    expect(body.deleted.rawEvents).toBe(1)
    expect(body.deleted.sessions).toBe(1)
    expect(body.deleted.dailyLogs).toBe(1)
    expect(body.deleted.openLoops).toBe(1)
    expect(body.deleted.weeklyReviews).toBe(1)
    const putCommands = commands.filter((command) => command.constructor.name === 'PutCommand')
    expect(
      putCommands.some((command) =>
        String(command.input.Item.SK).startsWith('ACTION_LOG#DELETION_REQUEST#'),
      ),
    ).toBe(true)
  })

  it('deletion request routes list pending requests and ack removes them', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: 'user#test-user-123',
          SK: 'ACTION_LOG#DELETION_REQUEST#delete_1',
          id: 'delete_1',
          from: '2026-04-16',
          to: '2026-04-16',
          createdAt: '2026-04-18T09:00:00+09:00',
        },
      ],
    })

    const getEvent = makeEvent('GET /action-log/deletion-requests')
    const { statusCode: getStatus, body: getBody } = parseResponse(await handler(getEvent))
    expect(getStatus).toBe(200)
    expect(getBody).toEqual([
      {
        id: 'delete_1',
        from: '2026-04-16',
        to: '2026-04-16',
        createdAt: '2026-04-18T09:00:00+09:00',
      },
    ])

    mockSend.mockReset()
    let deletedKey = null
    mockSend.mockImplementation((command) => {
      if (command.constructor.name === 'DeleteCommand') {
        deletedKey = command.input.Key
      }
      return Promise.resolve({})
    })
    const ackEvent = makeEvent('POST /action-log/deletion-requests/{id}/ack', {
      pathParameters: { id: 'delete_1' },
    })
    const { statusCode: ackStatus, body: ackBody } = parseResponse(await handler(ackEvent))
    expect(ackStatus).toBe(200)
    expect(ackBody).toEqual({ acked: 'delete_1' })
    expect(deletedKey).toEqual({
      PK: 'user#test-user-123',
      SK: 'ACTION_LOG#DELETION_REQUEST#delete_1',
    })
  })

  it('returns 400 for unsupported action-log routes', async () => {
    const result = await handler(makeEvent('PATCH /action-log/raw-events'))
    expect(result.statusCode).toBe(400)
  })
})
