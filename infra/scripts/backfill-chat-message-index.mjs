import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export function buildBackfillPayload({ limit, lastEvaluatedKey = null }) {
  const payload = {
    mode: 'chat-message-index-backfill',
    limit,
  }

  if (lastEvaluatedKey) {
    payload.lastEvaluatedKey = lastEvaluatedKey
  }

  return JSON.stringify(payload)
}

export function buildAwsInvokeArgs({
  region,
  functionName,
  payloadPath,
  responsePath,
  profile = '',
}) {
  const args = ['lambda', 'invoke', '--region', region]

  if (profile) {
    args.push('--profile', profile)
  }

  args.push(
    '--function-name',
    functionName,
    '--cli-binary-format',
    'raw-in-base64-out',
    '--payload',
    `fileb://${payloadPath}`,
    responsePath,
  )

  return args
}

export function parseBackfillInvokeResponse(rawText) {
  const invokeResult = JSON.parse(rawText)
  const body = typeof invokeResult.body === 'string'
    ? JSON.parse(invokeResult.body)
    : invokeResult.body

  if (!body || typeof body.updated !== 'number') {
    throw new Error('Backfill response did not include a numeric updated count.')
  }

  return body
}

export function runBackfill({
  region = 'ap-northeast-1',
  functionName = 'jibun-ikusei-migrateState',
  limit = 100,
  profile = '',
  awsCommand = 'aws',
  log = console.log,
} = {}) {
  let lastEvaluatedKey = null
  let totalUpdated = 0
  const tempDir = mkdtempSync(path.join(tmpdir(), 'chat-message-index-backfill-'))
  const payloadPath = path.join(tempDir, 'payload.json')
  const responsePath = path.join(tempDir, 'response.json')

  try {
    do {
      writeFileSync(
        payloadPath,
        buildBackfillPayload({ limit, lastEvaluatedKey }),
        'utf8',
      )

      const result = spawnSync(
        awsCommand,
        buildAwsInvokeArgs({
          region,
          functionName,
          payloadPath,
          responsePath,
          profile,
        }),
        { encoding: 'utf8' },
      )

      if (result.error) {
        throw result.error
      }

      if (result.status !== 0) {
        throw new Error(
          [
            'Backfill invocation failed.',
            result.stderr?.trim(),
            result.stdout?.trim(),
          ]
            .filter(Boolean)
            .join('\n'),
        )
      }

      if (!existsSync(responsePath)) {
        throw new Error('AWS CLI did not create the Lambda response file.')
      }

      const body = parseBackfillInvokeResponse(readFileSync(responsePath, 'utf8'))
      totalUpdated += body.updated
      lastEvaluatedKey = body.lastEvaluatedKey ?? null
      log(`updated=${body.updated}`)
    } while (lastEvaluatedKey)

    log(`done totalUpdated=${totalUpdated}`)
    return totalUpdated
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

export function parseCliArgs(argv) {
  const options = {
    region: 'ap-northeast-1',
    functionName: 'jibun-ikusei-migrateState',
    limit: 100,
    profile: '',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = argv[i + 1]

    if (arg === '--region' && value) {
      options.region = value
      i += 1
      continue
    }

    if (arg === '--function-name' && value) {
      options.functionName = value
      i += 1
      continue
    }

    if (arg === '--limit' && value) {
      options.limit = Number.parseInt(value, 10)
      i += 1
      continue
    }

    if (arg === '--profile' && value) {
      options.profile = value
      i += 1
    }
  }

  return options
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv)
  runBackfill(options)
}

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
