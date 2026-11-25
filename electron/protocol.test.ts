import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createEidoProtocolHandler, isEidoProviderRequest } from './protocol'

const scratchDirectories: string[] = []

afterEach(async () => {
  await Promise.all(scratchDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe('eido application protocol', () => {
  it.each([
    ['POST', 'https://openrouter.ai/api/v1/chat/completions'],
    ['GET', 'https://openrouter.ai/api/v1/models'],
    ['POST', 'https://api.linkup.so/v1/search'],
    ['POST', 'https://api.linkup.so/v1/fetch'],
    ['POST', 'https://api.linkup.so/v1/research'],
    ['GET', 'https://api.linkup.so/v1/research/job-id'],
  ])('allows %s to %s and its CORS preflight', (method, url) => {
    expect(isEidoProviderRequest(url, method)).toBe(true)
    expect(isEidoProviderRequest(url, 'OPTIONS')).toBe(true)
  })

  it.each([
    ['GET', 'https://updates.eido.so/eido-update.json'],
    ['GET', 'https://example.com/thumbnail.png'],
    ['POST', 'https://openrouter.ai.example.com/api/v1/chat/completions'],
    ['POST', 'http://openrouter.ai/api/v1/chat/completions'],
    ['GET', 'wss://openrouter.ai/api/v1/models'],
    ['GET', 'https://openrouter.ai:444/api/v1/models'],
    ['GET', 'https://user@openrouter.ai/api/v1/models'],
    ['OPTIONS', 'https://openrouter.ai/'],
    ['POST', 'https://openrouter.ai/api/v1/models'],
    ['GET', 'https://api.linkup.so/v1/research/job-id/extra'],
    ['GET', 'malformed'],
  ])('blocks %s to %s', (method, url) => {
    expect(isEidoProviderRequest(url, method)).toBe(false)
  })

  it('serves the renderer entry only from eido://app with a restrictive CSP', async () => {
    const rendererRoot = await mkdtemp(path.join(os.tmpdir(), 'eido-protocol-'))
    scratchDirectories.push(rendererRoot)
    await writeFile(path.join(rendererRoot, 'index.html'), '<main>Eido shell</main>', 'utf8')

    const handle = createEidoProtocolHandler(rendererRoot)
    const response = await handle(new Request('eido://app/'))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('<main>Eido shell</main>')
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://openrouter.ai https://api.linkup.so",
    )
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('serves GET and HEAD renderer assets with explicit content types', async () => {
    const rendererRoot = await mkdtemp(path.join(os.tmpdir(), 'eido-protocol-'))
    scratchDirectories.push(rendererRoot)
    await mkdir(path.join(rendererRoot, 'assets'))
    await writeFile(path.join(rendererRoot, 'assets', 'app.js'), 'console.log("eido")', 'utf8')

    const handle = createEidoProtocolHandler(rendererRoot)
    const getResponse = await handle(new Request('eido://app/assets/app.js'))
    const headResponse = await handle(new Request('eido://app/assets/app.js', { method: 'HEAD' }))

    expect(getResponse.status).toBe(200)
    expect(getResponse.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(await getResponse.text()).toBe('console.log("eido")')
    expect(headResponse.status).toBe(200)
    expect(headResponse.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(await headResponse.text()).toBe('')
  })

  it('fails closed for wrong origins, methods, encoded separators, traversal, and NUL input', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'eido-protocol-attacks-'))
    scratchDirectories.push(parent)
    const rendererRoot = path.join(parent, 'renderer')
    await mkdir(path.join(rendererRoot, 'assets'), { recursive: true })
    await writeFile(path.join(rendererRoot, 'assets', 'app.js'), 'trusted asset', 'utf8')
    await writeFile(path.join(parent, 'secret.txt'), 'must never escape', 'utf8')
    const handle = createEidoProtocolHandler(rendererRoot)

    const rejectedRequests = [
      new Request('https://app/assets/app.js'),
      new Request('eido://other/assets/app.js'),
      { url: 'eido://user@app/assets/app.js', method: 'GET' } as Request,
      new Request('eido://app/assets/app.js', { method: 'POST' }),
      new Request('eido://app/assets%2fapp.js'),
      new Request('eido://app/assets%5capp.js'),
      new Request('eido://app/%2f..%2fsecret.txt'),
      new Request('eido://app/%5c..%5csecret.txt'),
      new Request('eido://app/a%00b.js'),
      new Request('eido://app/%ZZ'),
      new Request('eido://app/%252e%252e%252fsecret.txt'),
    ]

    const responses = await Promise.all(rejectedRequests.map((request) => handle(request)))

    expect(responses.map((response) => response.status)).toEqual([
      404, 404, 404, 405, 404, 404, 404, 404, 404, 404, 404,
    ])
    for (const response of responses) {
      const body = await response.text()
      expect(body).not.toContain('must never escape')
      expect(body).not.toContain(parent)
    }
  })

  it('rejects an asset whose canonical target escapes through a symlink or junction', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'eido-protocol-link-'))
    scratchDirectories.push(parent)
    const rendererRoot = path.join(parent, 'renderer')
    const linkedAsset = path.join(rendererRoot, 'assets', 'linked.js')
    const outsideAsset = path.join(parent, 'outside.js')
    await mkdir(path.dirname(linkedAsset), { recursive: true })
    await writeFile(linkedAsset, 'lexically inside but canonically outside', 'utf8')
    await writeFile(outsideAsset, 'outside secret', 'utf8')

    const canonicalize = async (candidate: string) => {
      if (candidate === path.resolve(rendererRoot)) return path.resolve(rendererRoot)
      if (candidate === path.resolve(linkedAsset)) return path.resolve(outsideAsset)
      throw new Error(`Unexpected canonical path: ${candidate}`)
    }
    const handle = createEidoProtocolHandler(rendererRoot, { canonicalize })

    const response = await handle(new Request('eido://app/assets/linked.js'))

    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('outside secret')
  })
})
