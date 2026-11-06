import assert from 'node:assert/strict'

import { test } from 'bun:test'

import { containerFlow } from '../src/sheet/compose.ts'
import { MARGIN, contains, unionRects } from '../src/sheet/grid.ts'
import { ISLAND_FONT, labelBand } from '../src/sheet/measure.ts'
import { placeWorld } from '../src/sheet/place.ts'
import { sheetScene } from '../src/sheet/scene.ts'
import { ROUTE_SPACING, ROUTE_UNIT, routeReach } from '../src/sheet/route/space.ts'
import type { ArchitectureWorld } from '../src/types.ts'
import { box, uses } from './helpers.ts'

const unit = { x: 0, y: 0, width: 1, height: 1 }
const containerIds = ['entry-a', 'entry-b', 'mid-a', 'mid-b', 'core']

function flowWorld(): ArchitectureWorld {
  const relationships = [
    uses('relationship:0', 'architect', 'entry-a-leaf'),
    uses('relationship:1', 'architect', 'entry-b-leaf'),
    uses('relationship:2', 'entry-a-leaf', 'core-leaf'),
    uses('relationship:3', 'entry-a-second', 'core-leaf'),
    uses('relationship:4', 'entry-a-third', 'core-leaf'),
    uses('relationship:5', 'entry-b-leaf', 'core-leaf'),
    uses('relationship:6', 'entry-a-leaf', 'mid-a-leaf'),
    uses('relationship:7', 'mid-a-leaf', 'mid-b-leaf'),
    uses('relationship:8', 'mid-b-leaf', 'core-leaf'),
    uses('relationship:9', 'core-leaf', 'git'),
  ]
  return {
    flows: [],
    bounds: unit,
    groups: [],
    relationships,
    elements: [
      box('architect', 'actor', unit),
      box('service', 'system', unit),
      ...containerIds.map(id => box(id, 'container', unit, { parent: 'observed:service' })),
      ...containerIds.map(id => box(`${id}-leaf`, 'component', unit, {
        parent: `observed:${id}`,
        ...(id === 'mid-a' ? { group: 'Work' } : {}),
      })),
      ...['entry-a-second', 'entry-a-third'].map(id => box(id, 'component', unit, { parent: 'observed:entry-a' })),
      box('git', 'system', unit, { external: true }),
    ],
  }
}

test.concurrent('leaf relationships derive weighted entry, mediator, and core roles', () => {
  const world = flowWorld()
  const placement = placeWorld(world)
  const flow = containerFlow(placement, 'observed:service', world.relationships)

  assert.ok(flow)
  assert.deepEqual(flow.entries, ['observed:entry-a', 'observed:entry-b'])
  assert.deepEqual(flow.mediators, ['observed:mid-a', 'observed:mid-b'])
  assert.equal(flow.core, 'observed:core')
  assert.equal(flow.ownerByElement.get('observed:entry-a-leaf'), 'observed:entry-a')
  assert.equal(flow.connections.find(connection =>
    connection.source === 'observed:entry-a' && connection.target === 'observed:core')?.weight, 3)
})

test.concurrent('a disconnected edge cannot turn a direct entry fan-out into columns', () => {
  const world = flowWorld()
  world.relationships = [
    uses('entry', 'architect', 'entry-a-leaf'),
    uses('branch-a', 'entry-a-leaf', 'mid-a-leaf'),
    uses('branch-b', 'entry-a-leaf', 'mid-b-leaf'),
    uses('disconnected', 'entry-b-leaf', 'core-leaf'),
  ]

  assert.equal(containerFlow(placeWorld(world), 'observed:service', world.relationships), null)
})

test.concurrent('the composed system reads west to east while complete subtrees remain together', () => {
  const placement = placeWorld(flowWorld())
  const slabs = new Map(placement.slabs.map(slab => [slab.id, slab]))
  const right = (id: string): number => slabs.get(id)!.rect.gx + slabs.get(id)!.rect.w

  for (const entry of ['entry-a', 'entry-b']) {
    assert.ok(right(entry) < slabs.get('mid-a')!.rect.gx)
  }
  // Layered: every flow step stands one column further east (entry -> mid-a -> mid-b -> core).
  assert.ok(right('mid-a') < slabs.get('mid-b')!.rect.gx)
  assert.ok(right('mid-b') < slabs.get('core')!.rect.gx)

  for (const building of placement.buildings.filter(item => item.kind === 'component')) {
    const slab = placement.slabs.find(item => item.representationId === building.surface)
      ?? placement.slabs.find(item => placement.zones.some(zone =>
        zone.key === building.surface && zone.parent === item.representationId))
    assert.ok(slab)
    assert.equal(contains(slab.rect, building.rect), true, `${building.id} left ${slab.id}`)
  }
  for (const zone of placement.zones) {
    const slab = placement.slabs.find(item => item.representationId === zone.parent)
    assert.ok(slab)
    assert.equal(contains(slab.rect, zone.rect), true, `${zone.name} left ${slab.id}`)
  }
})

test.concurrent('final container positions determine the system and sheet bounds', () => {
  const world = flowWorld()
  const original = structuredClone(world)
  const placement = placeWorld(world)
  const island = placement.islands.find(item => item.kind === 'system')!
  const occupied = unionRects(placement.slabs.filter(slab => slab.island === island.key).map(slab => slab.rect))!

  assert.ok(Math.abs(occupied.gx - island.rect.gx - 2) < 0.001)
  assert.ok(Math.abs(occupied.gy - island.rect.gy - 2) < 0.001)
  assert.ok(Math.abs(island.rect.w - occupied.w - 4) < 0.001)
  assert.ok(Math.abs(island.rect.d - occupied.d - 4 - labelBand(ISLAND_FONT)) < 0.001)
  const islands = unionRects(placement.islands.map(item => item.rect))!
  assert.equal(placement.sheet.w, islands.gx + islands.w + MARGIN)
  assert.equal(placement.sheet.d, islands.gy + islands.d + MARGIN)
  assert.deepEqual(placeWorld(world), placement)
  assert.deepEqual(world, original)
})


test.concurrent('mediator composition preserves connection space as the same flow becomes busier', () => {
  const world = flowWorld()
  world.relationships = world.relationships.flatMap(relationship =>
    Array.from({ length: 8 }, (_, index) => ({ ...relationship, id: `${relationship.id}:${index}` })))
  const before = structuredClone(world)
  const scene = sheetScene(world)
  const flow = containerFlow(scene, 'observed:service', world.relationships)!
  const slabs = new Map(scene.slabs.map(slab => [slab.representationId, slab]))
  const reach = routeReach(flow.connections.reduce((count, connection) => count + connection.weight, 0))
  const right = (id: string) => slabs.get(id)!.rect.gx + slabs.get(id)!.rect.w
  const mediatorLeft = Math.min(...flow.mediators.map(id => slabs.get(id)!.rect.gx))
  const mediatorRight = Math.max(...flow.mediators.map(right))
  assert.ok(mediatorLeft - Math.max(...flow.entries.map(right)) >= 2 * reach)
  assert.ok(slabs.get(flow.core)!.rect.gx - mediatorRight >= 2 * reach)
  assert.equal(scene.routes.length, world.relationships.length)
  assert.deepEqual(world, before)
})

test.concurrent('container composition retains the enclosing system port capacity', () => {
  const world = flowWorld()
  world.relationships.push(...Array.from({ length: 96 }, (_, index) => uses(`system:${index}`, 'architect', 'service')))
  const scene = sheetScene(world)
  const island = scene.islands.find(item => item.kind === 'system')!
  assert.ok(Math.min(island.rect.w, island.rect.d) * ROUTE_UNIT / 2 >= 2 * 95 * ROUTE_SPACING)
  assert.equal(scene.routes.length, world.relationships.length)
})

test.concurrent('external systems stand east when called and west when they call in', () => {
  const side = (world: ArchitectureWorld): string => {
    const islands = placeWorld(world).islands
    const x = (kind: string): number => islands.find(island => island.kind === kind)!.rect.gx
    return x('external') < x('system') ? 'west' : 'east'
  }
  const world = flowWorld()
  assert.equal(side(world), 'east')
  world.relationships = world.relationships.map(relationship => relationship.target === 'observed:git'
    ? { ...relationship, source: relationship.target, target: relationship.source } : relationship)
  assert.equal(side(world), 'west')
})

test.concurrent('components that talk to each other stand west to east along their flow', () => {
  const world: ArchitectureWorld = {
    flows: [], bounds: unit, groups: [],
    relationships: [uses('in', 'person', 'c'), uses('cb', 'c', 'b'), uses('ba', 'b', 'a')],
    elements: [
      box('person', 'actor', unit),
      box('service', 'system', unit),
      box('box', 'container', unit, { parent: 'observed:service' }),
      ...['a', 'b', 'c'].map(id => box(id, 'component', unit, { parent: 'observed:box' })),
    ],
  }
  const x = new Map(placeWorld(world).buildings.map(building => [building.id, building.rect.gx]))
  assert.ok(x.get('c')! < x.get('b')! && x.get('b')! < x.get('a')!)
})

test.concurrent('actors face what they talk to once the containers are composed', () => {
  const placement = placeWorld(flowWorld())
  const middle = (id: string): number => {
    const rect = placement.buildings.find(building => building.representationId === `observed:${id}`)!.rect
    return rect.gy + rect.d / 2
  }
  const partners = (middle('entry-a-leaf') + middle('entry-b-leaf')) / 2
  assert.ok(Math.abs(middle('architect') - partners) <= 1, `${middle('architect')} vs ${partners}`)
})

test.concurrent('components in one group share one size and a much longer name keeps its own', () => {
  const titles = { a: 'Api', b: 'Search entities', c: 'Persistence', d: 'An exceptionally long component name that wraps' }
  const world: ArchitectureWorld = {
    flows: [], bounds: unit, groups: [], relationships: [],
    elements: [
      box('service', 'system', unit),
      box('box', 'container', unit, { parent: 'observed:service' }),
      ...Object.entries(titles).map(([id, title]) => ({ ...box(id, 'component', unit, { parent: 'observed:box' }), title })),
    ],
  }
  const size = new Map(placeWorld(world).buildings.map(building => [building.id, `${building.rect.w}x${building.rect.d}`]))
  assert.equal(size.get('a'), size.get('b'))
  assert.equal(size.get('b'), size.get('c'))
  assert.notEqual(size.get('d'), size.get('a'))
})

test.concurrent('actors stand in the order of what they talk to, not of their names', () => {
  const world = flowWorld()
  world.elements.push(box('aa', 'actor', unit), box('zz', 'actor', unit))
  world.relationships.push(uses('aa-uses', 'aa', 'entry-b-leaf'), uses('zz-uses', 'zz', 'entry-a-leaf'))
  const placement = placeWorld(world)
  const y = (id: string): number => {
    const rect = placement.buildings.find(building => building.representationId === `observed:${id}`)!.rect
    return rect.gy + rect.d / 2
  }
  assert.equal(Math.sign(y('aa') - y('zz')), Math.sign(y('entry-b-leaf') - y('entry-a-leaf')))
})

test.concurrent('components of one group trade places to stand nearer what they talk to, and never leave their group', () => {
  const peers = ['p1', 'p2', 'p3', 'p4']
  const world: ArchitectureWorld = {
    flows: [], bounds: unit, groups: [],
    relationships: [uses('p1-calls', 'p1', 'git')],
    elements: [
      box('service', 'system', unit),
      box('box', 'container', unit, { parent: 'observed:service' }),
      ...peers.map(id => box(id, 'component', unit, { parent: 'observed:box', group: 'Peers' })),
      box('git', 'system', unit, { external: true }),
    ],
  }
  const placement = placeWorld(world)
  const centre = (id: string): { x: number; y: number } => {
    const rect = placement.buildings.find(building => building.representationId === `observed:${id}`)!.rect
    return { x: rect.gx + rect.w / 2, y: rect.gy + rect.d / 2 }
  }
  const callee = centre('git')
  const distance = (id: string): number => Math.abs(centre(id).x - callee.x) + Math.abs(centre(id).y - callee.y)
  assert.ok(peers.slice(1).every(id => distance('p1') <= distance(id)), peers.map(distance).join(','))
  const zone = placement.zones.find(candidate => candidate.name === 'Peers')!
  for (const id of peers) assert.ok(contains(zone.rect, placement.buildings.find(building => building.id === id)!.rect), id)
})

test.concurrent('an entry another entry reaches stands behind it and can turn packing into columns', () => {
  // People call a gateway and an administrator calls the API directly, which the gateway also reaches.
  const world = flowWorld()
  world.relationships = [
    uses('gateway', 'architect', 'entry-a-leaf'),
    uses('gateway-second', 'architect', 'entry-a-second'),
    uses('admin', 'architect', 'entry-b-leaf'),
    uses('proxy', 'entry-a-leaf', 'entry-b-leaf'),
    uses('store', 'entry-b-leaf', 'core-leaf'),
  ]

  assert.notEqual(containerFlow(placeWorld(world), 'observed:service', world.relationships), null)
})

test.concurrent('empty containers of one flow column take the column width', () => {
  const ids = ['gate', 'api', 'db', 'a-much-longer-processing-name']
  const world: ArchitectureWorld = {
    flows: [],
    bounds: unit,
    groups: [],
    relationships: [
      uses('enter', 'architect', 'gate'),
      uses('proxy', 'gate', 'api'),
      uses('store', 'api', 'db'),
      uses('launch', 'api', 'a-much-longer-processing-name'),
    ],
    elements: [
      box('architect', 'actor', unit),
      box('service', 'system', unit),
      ...ids.map(id => box(id, 'container', unit, { parent: 'observed:service' })),
    ],
  }
  const slabs = new Map(sheetScene(world).slabs.map(slab => [slab.id, slab.rect]))
  const [db, long] = [slabs.get('db')!, slabs.get('a-much-longer-processing-name')!]
  assert.equal(db.gx, long.gx)
  assert.equal(db.w, long.w)
})
