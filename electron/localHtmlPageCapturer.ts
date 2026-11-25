import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow } from 'electron'
import type { LocalHtmlPageCapturer } from './localHtmlPreviewService'

const WIDTH = 1200
const HEIGHT = 675
const CAPTURE_TIMEOUT_MS = 8_000

type CaptureWindow = Readonly<{
  webContents: Readonly<{
    session: Readonly<{
      enableNetworkEmulation(options: { offline: boolean }): void
      setPermissionCheckHandler(handler: () => boolean): void
      setPermissionRequestHandler(handler: (
        contents: unknown,
        permission: string,
        callback: (allowed: boolean) => void,
      ) => void): void
      webRequest: Readonly<{
        onBeforeRequest(
          filter: { urls: string[] },
          listener: (details: { url: string }, callback: (decision: { cancel: boolean }) => void) => void,
        ): void
      }>
    }>
    on(event: 'will-navigate', listener: (event: { preventDefault(): void }) => void): void
    setWindowOpenHandler(handler: () => { action: 'deny' }): void
    capturePage(): Promise<Readonly<{
      getSize(): { width: number; height: number }
      toJPEG(quality: number): Buffer
    }>>
    getTitle(): string
  }>
  loadFile(path: string): Promise<void>
  isDestroyed(): boolean
  destroy(): void
}>

export function createElectronLocalHtmlPageCapturer({
  createWindow = (options) => new BrowserWindow(options as Electron.BrowserWindowConstructorOptions) as unknown as CaptureWindow,
  deadlineMs = CAPTURE_TIMEOUT_MS,
}: Readonly<{
  createWindow?: (options: unknown) => CaptureWindow
  deadlineMs?: number
}> = {}): LocalHtmlPageCapturer {
  return async (sourcePath) => {
    const resourceRoot = path.dirname(sourcePath)
    const allowedResourceCache = new Map<string, Promise<boolean>>()
    const window = createWindow({
      show: false,
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: '#ffffff',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: false,
        spellcheck: false,
        webSecurity: true,
        offscreen: true,
        backgroundThrottling: false,
        partition: `local-html-preview-${randomUUID()}`,
      },
    })
    const isolatedSession = window.webContents.session
    isolatedSession.enableNetworkEmulation({ offline: true })
    isolatedSession.setPermissionCheckHandler(() => false)
    isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    isolatedSession.webRequest.onBeforeRequest({ urls: ['<all_urls>', 'file:///*'] }, (details, callback) => {
      let decision = allowedResourceCache.get(details.url)
      if (!decision) {
        decision = allowedCaptureResource(details.url, resourceRoot)
        allowedResourceCache.set(details.url, decision)
      }
      void decision.then(
        (allowed) => callback({ cancel: !allowed }),
        () => callback({ cancel: true }),
      )
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())

    try {
      const image = await withinDeadline((async () => {
        await window.loadFile(sourcePath)
        return window.webContents.capturePage()
      })(), deadlineMs)
      const size = image.getSize()
      const bytes = boundedJpeg(image)
      return Object.freeze({
        bytes: Uint8Array.from(bytes),
        ...(window.webContents.getTitle().trim()
          ? { title: window.webContents.getTitle().trim() }
          : {}),
        width: size.width,
        height: size.height,
      })
    } finally {
      if (!window.isDestroyed()) window.destroy()
    }
  }
}

function boundedJpeg(image: Readonly<{ toJPEG(quality: number): Buffer }>): Buffer {
  let bytes = image.toJPEG(82)
  for (const quality of [70, 55, 40]) {
    if (bytes.byteLength <= 700_000) break
    bytes = image.toJPEG(quality)
  }
  return bytes
}

async function allowedCaptureResource(value: string, resourceRoot: string): Promise<boolean> {
  try {
    const url = new URL(value)
    if (url.protocol === 'data:' || url.protocol === 'about:') return true
    if (url.protocol !== 'file:') return false
    const canonicalPath = await realpath(fileURLToPath(url))
    const relative = path.relative(resourceRoot, canonicalPath)
    return relative === ''
      || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  } catch {
    return false
  }
}

async function withinDeadline<T>(request: Promise<T>, deadlineMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      request,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Local HTML preview capture timed out')), deadlineMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
