import { rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export default function cleanupProductionDataFile() {
  const port = Number(process.env.EIDO_PRODUCTION_TEST_PORT ?? 5175)
  const dataFile = process.env.EIDO_PRODUCTION_TEST_DATA_FILE
    ?? path.join(os.tmpdir(), `eido-production-interaction-${port}.json`)

  rmSync(dataFile, { force: true })
  rmSync(`${dataFile}.boards`, { force: true, recursive: true })
}
