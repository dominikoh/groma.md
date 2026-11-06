import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { joinedRoutes, sharedPathMeasure } from '../src/sheet/route/checks.ts'
import { assignFixedPorts } from '../src/sheet/route/ports.ts'
import { alignFacingRoutes, mergeJoinedRuns } from '../src/sheet/route/finish.ts'
import { ROUTE_UNIT } from '../src/sheet/route/space.ts'

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

test.concurrent('a route each way between two boxes uses one port on each wall and may run as one line', () => {
  const building = (key: string, gx: number) => ({ key, kind: 'building' as const, rect: { gx, gy: 0, w: 4, d: 4 }, owner: 'slab' })
  const endpoints = new Map([building('gate', 0), building('front', 20)].map(endpoint => [endpoint.key, endpoint]))
  const request = (id: string, source: string, target: string) => ({ id, source, target, description: '', origin: 'observed' as const })
  const ports = assignFixedPorts(endpoints, [request('1', 'gate', 'front'), request('2', 'front', 'gate')])
  assert.deepEqual(ports.get('1')!.source, ports.get('2')!.target)
  assert.deepEqual(ports.get('1')!.target, ports.get('2')!.source)
  assert.equal(joinedRoutes(route('a', 'gate', 'front'), route('b', 'front', 'gate')), true)
})

test.concurrent('two routes into one box that run side by side a bundle gap apart become one line', () => {
  const building = (key: string, gx: number, gy: number) => [key, { key, kind: 'building' as const, rect: { gx, gy, w: 4, d: 4 } }] as const
  const endpoints = new Map([building('a', 0, 0), building('b', 0, 10), building('t', 40, 20)])
  const u = ROUTE_UNIT
  const routes = [
    { id: 'a', source: 'a', target: 't', description: '', origin: 'observed' as const, points: [{ x: 4 * u, y: 2 * u }, { x: 30 * u, y: 2 * u }, { x: 30 * u, y: 22 * u }, { x: 40 * u, y: 22 * u }] },
    { id: 'b', source: 'b', target: 't', description: '', origin: 'observed' as const, points: [{ x: 4 * u, y: 12 * u }, { x: 29.8 * u, y: 12 * u }, { x: 29.8 * u, y: 22 * u }, { x: 40 * u, y: 22 * u }] },
  ]
  mergeJoinedRuns(endpoints as never, routes)
  assert.equal(routes[0]!.points[1]!.x, routes[1]!.points[1]!.x)
})

test.concurrent('a route each way between facing boxes straightens onto the port more routes share', () => {
  const slab = (key: string, gx: number, gy: number, w: number) => [key, { key, kind: 'slab' as const, rect: { gx, gy, w, d: 13 } }] as const
  const endpoints = new Map([slab('app', 22, 24, 19), slab('map', 19, 41, 14), slab('worker', 45, 41, 14)])
  const u = ROUTE_UNIT
  const at = (x: number, y: number) => ({ x: x * u, y: y * u })
  const flat = (id: string, source: string, target: string, points: { x: number, y: number }[]) =>
    ({ id, source, target, description: '', origin: 'observed' as const, points })
  const routes = [
    flat('down', 'app', 'map', [at(31, 37), at(31, 39), at(26, 39), at(26, 41)]),
    flat('up', 'map', 'app', [at(26, 41), at(26, 39), at(31, 39), at(31, 37)]),
    flat('side', 'app', 'worker', [at(31, 37), at(31, 39.5), at(50, 39.5), at(50, 41)]),
  ]
  alignFacingRoutes(endpoints as never, routes)
  assert.deepEqual(routes[0]!.points, [at(31, 37), at(31, 41)])
  assert.deepEqual(routes[1]!.points, [at(31, 41), at(31, 37)])
})
