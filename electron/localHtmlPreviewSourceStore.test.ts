import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createLocalHtmlPreviewSourceStore } from './localHtmlPreviewSourceStore'
import { openNoWaitSqliteRuntime } from './sqliteRuntime'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('local HTML preview source store', () => {
  it('persists only device-local path authority and returns an opaque source', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'eido-local-html-source-'))
    roots.push(root)
    const htmlPath = path.join(root, 'Visual Review.html')
    await writeFile(htmlPath, '<!doctype html><title>Review</title>', 'utf8')

    const first = createLocalHtmlPreviewSourceStore({
      userDataRoot: root,
      createId: () => 'source-fixed',
      now: () => '2026-08-14T10:00:00.000Z',
      openRuntime: (databasePath) => {
        const runtime = openNoWaitSqliteRuntime(databasePath)
        expect(runtime.settings.busyTimeoutMs).toBe(0)
        return runtime
      },
    })
    await expect(first.recognize(htmlPath)).resolves.toEqual({
      id: 'source-fixed',
      name: 'Visual Review.html',
    })
    first.close()

    const reopened = createLocalHtmlPreviewSourceStore({ userDataRoot: root })
    await expect(reopened.resolve('source-fixed')).resolves.toMatchObject({
      path: await realpath(htmlPath),
      source: { id: 'source-fixed', name: 'Visual Review.html' },
    })
    reopened.close()
  })

  it('rejects missing, non-HTML, directory, and oversized sources', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'eido-local-html-source-'))
    roots.push(root)
    await mkdir(path.join(root, 'folder.html'))
    await writeFile(path.join(root, 'note.txt'), 'text', 'utf8')
    const store = createLocalHtmlPreviewSourceStore({ userDataRoot: root, maxSourceBytes: 8 })

    await expect(store.recognize(path.join(root, 'missing.html'))).resolves.toBeNull()
    await expect(store.recognize(path.join(root, 'folder.html'))).resolves.toBeNull()
    await expect(store.recognize(path.join(root, 'note.txt'))).resolves.toBeNull()
    await writeFile(path.join(root, 'large.html'), '123456789', 'utf8')
    await expect(store.recognize(path.join(root, 'large.html'))).resolves.toBeNull()
    store.close()
  })
})
