/**
 * The zen-remote bridge declaration, derived from a representative dispatch
 * table. These assertions pin the shapes a remote re-router depends on: the
 * per-method overrides (childId threads, rootSessionId-located topology
 * surfaces, the minted id of sidechat.start, the whole-answer rewrites, the
 * open.external refusal, the per-machine skips), the static routes including
 * the frame-level sidechat push socket, and the ceiling zen-remote itself
 * enforces (64 routes per declaration).
 */
import { describe, expect, it } from 'vitest'

/** cordis Context shapes are strict; the stubs cast to the parameter type. */
type BridgeCtx = Parameters<typeof registerZenRemoteBridge>[0]
import { buildZenRemoteRoutes, registerZenRemoteBridge } from '../src/zen-remote-bridge.ts'

/** A table covering every override class plus a plain default method. */
const fakeApi: Record<string, () => unknown> = {
  'fs.read': () => ({}),
  'fs.readPage': () => ({}),
  'git.graph': () => ({}),
  'changes.ops': () => ({}),
  'open.external': () => ({}),
  'session.cwd': () => ({}),
  'subagents.live': () => ({}),
  'workflows.list': () => ({}),
  'teams.taskCreate': () => ({}),
  'teams.taskUpdate': () => ({}),
  'sidechat.start': () => ({}),
  'sidechat.prompt': () => ({}),
  'sidechat.model': () => ({}),
  'sidechat.models': () => ({}),
  'settings.get': () => ({}),
  'settings.update': () => ({}),
}

describe('buildZenRemoteRoutes', () => {
  const routes = buildZenRemoteRoutes(fakeApi)
  const byPath = new Map(routes.map((route) => [route.path, route]))

  it('stays under zen-remote\'s 64-route cap even with the full static set', () => {
    expect(routes.length).toBeLessThanOrEqual(64)
  })

  it('declares every non-skipped API method as a POST json-body route', () => {
    for (const method of Object.keys(fakeApi)) {
      const declared = byPath.has(`/sidebar/api/${method}`)
      const skipped = method === 'settings.get' || method === 'settings.update' || method === 'sidechat.models'
      expect(declared).toBe(!skipped)
    }
    const plain = byPath.get('/sidebar/api/fs.read')
    expect(plain?.scope).toBe('server')
    expect(plain?.methods).toEqual(['POST'])
    expect(plain?.locator).toEqual({ in: 'json-body', fields: ['sessionId'] })
  })

  it('locates side-chat thread methods on childId', () => {
    expect(byPath.get('/sidebar/api/sidechat.prompt')?.locator).toEqual({ in: 'json-body', fields: ['childId'] })
  })

  it('locates the topology-rooted methods on rootSessionId', () => {
    for (const method of ['subagents.live', 'workflows.list', 'teams.taskCreate', 'teams.taskUpdate']) {
      expect(byPath.get(`/sidebar/api/${method}`)?.locator).toEqual({ in: 'json-body', fields: ['rootSessionId'] })
    }
  })

  it("marks sidechat.start's minted child id for the virtual rewrite", () => {
    expect(byPath.get('/sidebar/api/sidechat.start')?.rewriteIds).toEqual({ fields: ['value.childId'] })
  })

  it('rewrites the whole answer where session ids ride outside named fields', () => {
    expect(byPath.get('/sidebar/api/session.cwd')?.rewriteIds).toBe(true)
    expect(byPath.get('/sidebar/api/subagents.live')?.rewriteIds).toBe(true)
    expect(byPath.get('/sidebar/api/workflows.list')?.rewriteIds).toBe(true)
    expect(byPath.get('/sidebar/api/teams.taskCreate')?.rewriteIds).toBeUndefined()
    expect(byPath.get('/sidebar/api/teams.taskUpdate')?.rewriteIds).toBeUndefined()
  })

  it('refuses open.external for remote sessions', () => {
    expect(byPath.get('/sidebar/api/open.external')?.deny).toBe(true)
  })

  it('carries the static routes: query-located POST/GET, the html prefix segment, the three upgrades', () => {
    expect(byPath.get('/sidebar/file')?.methods).toEqual(['GET'])
    expect(byPath.get('/sidebar/upload')?.methods).toEqual(['POST'])
    const html = byPath.get('/sidebar/html')
    expect(html?.prefix).toBe(true)
    expect(html?.locator).toEqual({ in: 'path-segment', index: 0 })
    expect(byPath.get('/sidebar/ws/fs-watch')?.upgrade).toBe(true)
    expect(byPath.get('/sidebar/ws/agent-opens')?.upgrade).toBe(true)
  })

  it('declares the sidechat push socket with frame-body locating and downstream rewriting', () => {
    const sidechat = byPath.get('/sidebar/ws/sidechat')
    expect(sidechat).toBeDefined()
    expect(sidechat?.upgrade).toBe(true)
    expect(sidechat?.locator).toEqual({ in: 'json-body', fields: ['threadIds'] })
    expect(sidechat?.rewriteIds).toEqual({ fields: ['threadId'] })
  })
})

describe('registerZenRemoteBridge', () => {
  it('registers only when the host provides the service, and withdraws via effect', () => {
    const disposed: string[] = []
    let registered: { plugin: string; version: string } | undefined
    const makeCtx = (withService: boolean) => ({
      inject(names: readonly string[], body: (sctx: unknown) => void): void {
        if (withService) body({ zenRemote: { bridge: (d: { plugin: string; version: string }) => { registered = d; return () => disposed.push('bridge') } } })
      },
      effect: (fn: () => () => void, label?: string) => { disposed.push(label ?? 'effect'); const ret = fn(); if (typeof ret === 'function') disposed.push('dispose-registered') },
      logger: { warn: (m: string) => disposed.push(m) },
    })
    registerZenRemoteBridge(makeCtx(true) as unknown as BridgeCtx, fakeApi, '0.29.0-test')
    expect(registered?.plugin).toBe('dsh-better-sidebar')
    expect(registered?.version).toBe('0.29.0-test')
    registerZenRemoteBridge(makeCtx(false) as unknown as BridgeCtx, fakeApi, '0.29.0-test')
    expect(disposed).toContain('dsh-better-sidebar: zen-remote bridge declaration')
  })

  it('survives a throwing bridge() (logged, not thrown)', () => {
    const ctx = {
      inject(_names: readonly string[], body: (sctx: unknown) => void): void { body({ zenRemote: { bridge: () => { throw new Error('shape') } } }) },
      effect: () => (() => {}) as never,
      logger: { warn: (m: string) => { expect(m).toContain('refused') } },
    }
    expect(() => registerZenRemoteBridge(ctx as unknown as BridgeCtx, fakeApi, '0.29.0-test')).not.toThrow()
  })
})
