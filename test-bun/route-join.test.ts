import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { joinedRoutes, sharedPathMeasure } from '../src/sheet/route/checks.ts'
import { assignFixedPorts } from '../src/sheet/route/ports.ts'

const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }]
const route = (id: string, source: string, target: string) => ({ id, source, target, description: '', points: line })

test.concurrent('routes sharing a source or a target may run on one line; unrelated routes may not', () => {
  const fanIn = [route('a', 'web', 'api'), route('b', 'app', 'api')]
  const fanOut = [route('a', 'api', 'db'), route('b', 'api', 'store')]
  const unrelated = [route('a', 'web', 'api'), route('b', 'app', 'db')]
  assert.equal(joinedRoutes(fanIn[0]!, fanIn[1]!), true)
  assert.equal(joinedRoutes(fanOut[0]!, fanOut[1]!), true)
  assert.equal(joinedRoutes(unrelated[0]!, unrelated[1]!), false)
  for (const routes of [fanIn, fanOut]) {
    assert.equal(sharedPathMeasure(routes as never, new Set(routes.map(item => item.id)))(routes as never), 0)
  }
  assert.ok(sharedPathMeasure(unrelated as never, new Set(['a', 'b']))(unrelated as never) > 0)
})

test.concurrent('routes leaving one wall share a port, and so do routes arriving; the two ports differ', () => {
  const building = (key: string, gx: number, gy: number) => ({ key, kind: 'building' as const, rect: { gx, gy, w: 4, d: 4 }, owner: 'slab' })
  // Two callers west of the hub, two callees east of it: each side of the hub has one direction of traffic.
  const endpoints = new Map([
    building('a', 0, 0), building('b', 0, 10), building('hub', 20, 5), building('x', 40, 0), building('y', 40, 10),
  ].map(endpoint => [endpoint.key, endpoint]))
  const request = (id: string, source: string, target: string) => ({ id, source, target, description: '', origin: 'observed' as const })
  const ports = assignFixedPorts(endpoints, [request('1', 'a', 'hub'), request('2', 'b', 'hub'), request('3', 'hub', 'x'), request('4', 'hub', 'y')])
  assert.deepEqual(ports.get('1')!.target, ports.get('2')!.target)
  assert.deepEqual(ports.get('3')!.source, ports.get('4')!.source)
  assert.notDeepEqual(ports.get('1')!.target!.wall, ports.get('3')!.source!.wall)
})
