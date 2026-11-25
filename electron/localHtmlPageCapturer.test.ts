import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { createElectronLocalHtmlPageCapturer } from './localHtmlPageCapturer'

describe('local HTML page capturer', () => {
  it('uses an isolated static-render window, blocks network, and destroys it after capture', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'eido-local-capture-'))
    const sourcePath = path.join(root, 'review.html')
    const stylePath = path.join(root, 'style.css')
    const outsidePath = path.join(os.tmpdir(), `eido-local-capture-outside-${process.pid}.txt`)
    const escapedLink = path.join(root, 'escaped.txt')
    writeFileSync(sourcePath, '<!doctype html>')
    writeFileSync(stylePath, 'body {}')
    writeFileSync(outsidePath, 'outside')
    symlinkSync(outsidePath, escapedLink)
    let requestPolicy!: (details: { url: string }, callback: (decision: { cancel: boolean }) => void) => void
    const destroy = vi.fn()
    const enableNetworkEmulation = vi.fn()
    const capturePage = vi.fn(async () => ({
      getSize: () => ({ width: 1200, height: 675 }),
      toJPEG: () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    }))
    const optionsSeen: unknown[] = []
    const createWindow = vi.fn((options: unknown) => {
      optionsSeen.push(options)
      return {
        webContents: {
          session: {
            enableNetworkEmulation,
            setPermissionCheckHandler: vi.fn(),
            setPermissionRequestHandler: vi.fn(),
            webRequest: {
              onBeforeRequest: vi.fn((_filter, listener) => { requestPolicy = listener }),
            },
          },
          on: vi.fn(),
          setWindowOpenHandler: vi.fn(),
          capturePage,
          getTitle: () => 'Visual Review',
        },
        loadFile: vi.fn(async () => undefined),
        isDestroyed: () => false,
        destroy,
      }
    })
    const capture = createElectronLocalHtmlPageCapturer({ createWindow })

    await expect(capture(realpathSync.native(sourcePath))).resolves.toEqual({
      bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
      title: 'Visual Review',
      width: 1200,
      height: 675,
    })
    expect(optionsSeen[0]).toMatchObject({
      show: false,
      width: 1200,
      height: 675,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: false,
        spellcheck: false,
        webSecurity: true,
      },
    })
    expect(enableNetworkEmulation).toHaveBeenCalledWith({ offline: true })
    const decisions = new Map<string, { cancel: boolean }>()
    const inspectRequest = (url: string) => {
      requestPolicy({ url }, (decision) => decisions.set(url, decision))
    }
    const networkUrl = 'https://tracker.example/pixel'
    const styleUrl = pathToFileURL(stylePath).href
    const outsideUrl = pathToFileURL(outsidePath).href
    const escapedLinkUrl = pathToFileURL(escapedLink).href
    inspectRequest(networkUrl)
    inspectRequest(styleUrl)
    inspectRequest(outsideUrl)
    inspectRequest(escapedLinkUrl)
    await vi.waitFor(() => expect(decisions.size).toBe(4))
    expect(decisions.get(networkUrl)).toEqual({ cancel: true })
    expect(decisions.get(styleUrl)).toEqual({ cancel: false })
    expect(decisions.get(outsideUrl)).toEqual({ cancel: true })
    expect(decisions.get(escapedLinkUrl)).toEqual({ cancel: true })
    expect(destroy).toHaveBeenCalledOnce()
    rmSync(root, { recursive: true, force: true })
    rmSync(outsidePath, { force: true })
  })
})
