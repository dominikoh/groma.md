import type { AnnotatedRelationship } from '../types.ts'
import type { Placement } from './place.ts'
import { MARGIN, translate, unionRects } from './grid.ts'
import { ISLAND_FONT, ISLAND_SPACING, labelBand, nameCells } from './measure.ts'
import type { CellRect } from './types.ts'
import { connectionCounts, portSideCells, routeReach } from './route/space.ts'
import { flowRanks } from './rank.ts'

const SURFACE_INSET = 2
const UNIT_GAP = 3
const MIN_COLUMN_GAP = 2
const ACTORS = 'island:actors'

interface Connection {
  source: string
  target: string
  weight: number
  /** Sum of target-minus-source endpoint offsets from their owner centres. */
  alignmentY: number
}

export interface ContainerFlow {
  entries: string[]
  mediators: string[]
  core: string
  connections: Connection[]
  ownerByElement: Map<string, string>
}

function centre(rect: CellRect): { x: number; y: number } {
  return { x: rect.gx + rect.w / 2, y: rect.gy + rect.d / 2 }
}

function islandMembership(placement: Placement): {
  buildingIsland: Map<string, string>
  zoneIsland: Map<string, string>
} {
  const slabIsland = new Map(placement.slabs.map(slab => [slab.representationId, slab.island]))
  return {
    buildingIsland: new Map(placement.buildings.map(building => [
      building.representationId,
      slabIsland.get(building.surface) ?? building.surface,
    ])),
    zoneIsland: new Map(placement.zones.map(zone => [
      zone.key,
      slabIsland.get(zone.parent) ?? zone.parent,
    ])),
  }
}

function moveIsland(
  placement: Placement,
  islandKey: string,
  dx: number,
  dy: number,
  membership: ReturnType<typeof islandMembership>,
): void {
  const island = placement.islands.find(candidate => candidate.key === islandKey)!
  island.rect = translate(island.rect, dx, dy)
  for (const slab of placement.slabs) if (slab.island === islandKey) slab.rect = translate(slab.rect, dx, dy)
  for (const building of placement.buildings) {
    if (membership.buildingIsland.get(building.representationId) === islandKey) {
      building.rect = translate(building.rect, dx, dy)
    }
  }
  for (const zone of placement.zones) {
    if (membership.zoneIsland.get(zone.key) === islandKey) zone.rect = translate(zone.rect, dx, dy)
  }
}

function owners(placement: Placement): Map<string, string> {
  const result = new Map<string, string>()
  for (const island of placement.islands) {
    result.set(island.key, island.key)
    if (island.element) result.set(island.element.representationId, island.key)
  }
  for (const slab of placement.slabs) result.set(slab.representationId, slab.representationId)
  // A grouped building stands on its zone; the zone's parent surface owns it.
  const zoneParent = new Map(placement.zones.map(zone => [zone.key, zone.parent]))
  for (const building of placement.buildings) {
    result.set(building.representationId, zoneParent.get(building.surface) ?? building.surface)
  }
  return result
}

function connections(
  relationships: readonly Pick<AnnotatedRelationship, 'source' | 'target'>[],
  ownerByElement: ReadonlyMap<string, string>,
  rects: ReadonlyMap<string, CellRect>,
): Connection[] {
  const grouped = new Map<string, Connection>()
  for (const relationship of relationships) {
    const source = ownerByElement.get(relationship.source)
    const target = ownerByElement.get(relationship.target)
    if (!source || !target || source === target) continue
    const key = `${source}\0${target}`
    const connection = grouped.get(key) ?? { source, target, weight: 0, alignmentY: 0 }
    connection.weight += 1
    const sourceOffset = centre(rects.get(relationship.source)!).y - centre(rects.get(source)!).y
    const targetOffset = centre(rects.get(relationship.target)!).y - centre(rects.get(target)!).y
    connection.alignmentY += targetOffset - sourceOffset
    grouped.set(key, connection)
  }
  return [...grouped.values()]
    .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target))
}

function incomingWeight(id: string, flow: readonly Connection[]): number {
  return flow
    .filter(connection => connection.target === id && connection.source !== ACTORS)
    .reduce((total, connection) => total + connection.weight, 0)
}

function mediatorScore(id: string, mediators: ReadonlySet<string>, flow: readonly Connection[]): number {
  return flow.reduce((score, connection) => {
    if (!mediators.has(connection.source) || !mediators.has(connection.target)) return score
    if (connection.source === id) return score + connection.weight
    if (connection.target === id) return score - connection.weight
    return score
  }, 0)
}

function entryReachableUnits(
  entries: ReadonlySet<string>,
  units: ReadonlySet<string>,
  flow: readonly Connection[],
): Set<string> {
  const reached = new Set(entries)
  for (const source of reached) {
    for (const connection of flow) {
      if (connection.source === source && units.has(connection.target)) reached.add(connection.target)
    }
  }
  return reached
}

/** Reads the entry, mediator and sink roles of one internal system from its leaf relationships. */
export function containerFlow(
  placement: Placement,
  systemIsland: string,
  relationships: readonly Pick<AnnotatedRelationship, 'source' | 'target'>[],
): ContainerFlow | null {
  // Unknown boundaries retain the measured packing; container-only composition would omit them.
  if (placement.zones.some(zone => zone.parent === systemIsland && zone.unidentifiedContainer)) return null
  const units = placement.slabs.filter(slab => slab.island === systemIsland)
  if (units.length < 2) return null
  const ownerByElement = owners(placement)
  const rects = new Map([
    ...placement.islands.map(island => [island.key, island.rect] as const),
    ...placement.slabs.map(slab => [slab.representationId, slab.rect] as const),
    ...placement.buildings.map(building => [building.representationId, building.rect] as const),
  ])
  const flow = connections(relationships, ownerByElement, rects)
  const unitIds = new Set(units.map(unit => unit.representationId))
  const entries = [...new Set(flow.flatMap(connection => {
    if (connection.source === ACTORS && unitIds.has(connection.target)) return [connection.target]
    if (connection.target === ACTORS && unitIds.has(connection.source)) return [connection.source]
    return []
  }))].sort((a, b) => {
    const left = units.find(unit => unit.representationId === a)!
    const right = units.find(unit => unit.representationId === b)!
    return left.rect.gy - right.rect.gy || a.localeCompare(b)
  })
  if (entries.length === 0) return null
  const entryIds = new Set(entries)
  const reached = entryReachableUnits(entryIds, unitIds, flow)
  // Only an entry-reachable intermediate container can turn packing into columns.
  const onward = flow.filter(connection => reached.has(connection.source) && !entryIds.has(connection.source))
  const core = [...units]
    .filter(unit => !entryIds.has(unit.representationId)
      && onward.some(connection => connection.target === unit.representationId))
    .sort((a, b) => incomingWeight(b.representationId, flow) - incomingWeight(a.representationId, flow)
      || a.representationId.localeCompare(b.representationId))[0]
  if (!core) return null
  const mediatorIds = new Set(units
    .map(unit => unit.representationId)
    .filter(id => !entryIds.has(id) && id !== core.representationId))
  const mediators = [...mediatorIds].sort((a, b) =>
    mediatorScore(b, mediatorIds, flow) - mediatorScore(a, mediatorIds, flow)
    || units.find(unit => unit.representationId === a)!.rect.gy
      - units.find(unit => unit.representationId === b)!.rect.gy
    || a.localeCompare(b))
  return {
    entries,
    mediators,
    core: core.representationId,
    connections: flow,
    ownerByElement,
  }
}

function connectedCentreY(
  id: string,
  partners: ReadonlySet<string>,
  flow: readonly Connection[],
  positions: ReadonlyMap<string, CellRect>,
): { total: number; weight: number } {
  let total = 0
  let weight = 0
  for (const connection of flow) {
    const partner = connection.source === id
      ? connection.target
      : connection.target === id ? connection.source : undefined
    if (!partner || !partners.has(partner)) continue
    const rect = positions.get(partner)
    if (!rect) continue
    const offset = connection.source === id ? connection.alignmentY : -connection.alignmentY
    total += centre(rect).y * connection.weight + offset
    weight += connection.weight
  }
  return { total, weight }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum))
}

function applyPositions(
  placement: Placement,
  units: ReadonlyMap<string, Placement['slabs'][number]>,
  positions: ReadonlyMap<string, CellRect>,
): void {
  for (const [id, target] of positions) {
    const slab = units.get(id)!
    const dx = target.gx - slab.rect.gx
    const dy = target.gy - slab.rect.gy
    slab.rect = target
    for (const building of placement.buildings) {
      if (building.surface === id) building.rect = translate(building.rect, dx, dy)
    }
    for (const zone of placement.zones) {
      if (zone.parent === id) zone.rect = translate(zone.rect, dx, dy)
    }
  }
}

/**
 * Entries in order of the actor traffic they take; an entry another entry already reaches through the
 * system's own containers stands where that flow puts it instead.
 */
function layeredEntries(flow: ContainerFlow, edges: ReadonlyMap<string, readonly string[]>): string[] {
  const actorWeight = (id: string): number => flow.connections
    .filter(connection => connection.source === ACTORS && connection.target === id)
    .reduce((total, connection) => total + connection.weight, 0)
  const ordered = [...flow.entries].sort((a, b) => actorWeight(b) - actorWeight(a))
  const kept: string[] = []
  const reached = new Set<string>()
  for (const entry of ordered) {
    if (reached.has(entry)) continue
    kept.push(entry)
    const pending = [entry]
    while (pending.length > 0) {
      for (const next of edges.get(pending.pop()!) ?? []) {
        if (!reached.has(next) && next !== entry) {
          reached.add(next)
          pending.push(next)
        }
      }
    }
  }
  return kept
}

/**
 * Columns west to east by the longest flow chain from the entries (flowRanks), ordered within a column by the
 * mean row of their neighbours in a few alternating sweeps, the usual crossing reduction of a layered layout.
 * Containers no relationship touches stand in a last column.
 */
function layeredColumns(units: readonly string[], flow: ContainerFlow, initialY: ReadonlyMap<string, number>): string[][] {
  const unitIds = new Set(units)
  const edges = new Map<string, string[]>()
  const neighbours = new Map<string, Map<string, number>>(units.map(id => [id, new Map()]))
  for (const connection of flow.connections) {
    if (!unitIds.has(connection.source) || !unitIds.has(connection.target)) continue
    edges.set(connection.source, [...(edges.get(connection.source) ?? []), connection.target])
    for (const [a, b] of [[connection.source, connection.target], [connection.target, connection.source]] as const) {
      const map = neighbours.get(a)!
      map.set(b, (map.get(b) ?? 0) + connection.weight)
    }
  }
  const order = [...units].sort((a, b) => initialY.get(a)! - initialY.get(b)! || a.localeCompare(b))
  const ranks = flowRanks(order, new Set(layeredEntries(flow, edges)), edges)
  const last = Math.max(-1, ...ranks.values()) + 1
  const columns: string[][] = []
  for (const id of order) {
    const rank = ranks.get(id) ?? last
    ;(columns[rank] ??= []).push(id)
  }
  const dense = columns.filter(column => column !== undefined)
  const row = new Map<string, number>()
  const index = (): void => { for (const column of dense) column.forEach((id, at) => row.set(id, at / Math.max(1, column.length - 1))) }
  index()
  for (let sweep = 0; sweep < 4; sweep++) {
    const sequence = sweep % 2 === 0 ? dense : [...dense].reverse()
    for (const column of sequence) {
      const mean = new Map(column.map(id => {
        let total = 0
        let weight = 0
        for (const [other, w] of neighbours.get(id)!) {
          if (column.includes(other)) continue
          total += row.get(other)! * w
          weight += w
        }
        return [id, weight > 0 ? total / weight : row.get(id)!] as const
      }))
      column.sort((a, b) => mean.get(a)! - mean.get(b)! || row.get(a)! - row.get(b)!)
      index()
    }
  }
  return dense
}

function composeSystem(
  placement: Placement,
  systemIsland: string,
  relationships: readonly Pick<AnnotatedRelationship, 'source' | 'target'>[],
): number {
  const flow = containerFlow(placement, systemIsland, relationships)
  if (!flow) return 0
  const island = placement.islands.find(candidate => candidate.key === systemIsland)!
  const originalWidth = island.rect.w
  const units = new Map(placement.slabs
    .filter(slab => slab.island === systemIsland)
    .map(slab => [slab.representationId, slab]))
  const demand = flow.connections.filter(connection => units.has(connection.source) || units.has(connection.target))
    .reduce((count, connection) => count + connection.weight, 0)
  const ownPorts = connectionCounts(relationships).get(island.key) ?? 0
  const portSide = Math.ceil(portSideCells(ownPorts))
  const reach = routeReach(demand)
  const inset = Math.max(SURFACE_INSET, reach, routeReach(ownPorts))
  const unitGap = Math.max(UNIT_GAP, 2 * reach)
  const columnGap = Math.max(MIN_COLUMN_GAP, 2 * reach)
  const columns = layeredColumns([...units.keys()], flow, new Map([...units].map(([id, unit]) => [id, unit.rect.gy])))

  // Each column centres its containers on one axis; a container sits level with the containers already placed
  // that it talks to, never overlapping the one above it in its column.
  const positions = new Map<string, CellRect>()
  let x = island.rect.gx + inset
  for (const column of columns) {
    const width = Math.max(...column.map(id => units.get(id)!.rect.w))
    let floor = Number.NEGATIVE_INFINITY
    for (const id of column) {
      const rect = units.get(id)!.rect
      const placed = connectedCentreY(id, new Set(positions.keys()), flow.connections, positions)
      const wanted = placed.weight > 0 ? placed.total / placed.weight - rect.d / 2 : floor === Number.NEGATIVE_INFINITY ? 0 : floor
      const gy = floor === Number.NEGATIVE_INFINITY ? wanted : Math.max(wanted, floor)
      positions.set(id, { ...rect, gx: x + (width - rect.w) / 2, gy })
      floor = gy + rect.d + unitGap
    }
    x += width + columnGap
  }

  const occupied = unionRects([...positions.values()])!
  const dx = island.rect.gx + inset - occupied.gx
  const dy = island.rect.gy + inset - occupied.gy
  for (const [id, rect] of positions) positions.set(id, translate(rect, dx, dy))
  island.rect.w = Math.max(occupied.w + 2 * inset, nameCells(island.name.toUpperCase(), ISLAND_FONT, ISLAND_SPACING), portSide)
  island.rect.d = Math.max(occupied.d + 2 * inset + labelBand(ISLAND_FONT), portSide)
  applyPositions(placement, units, positions)
  return island.rect.w - originalWidth
}

/** Composes weighted container flow while preserving measured connection space. */
export function composePlacement(
  placement: Placement,
  relationships: readonly Pick<AnnotatedRelationship, 'source' | 'target'>[],
): Placement {
  const membership = islandMembership(placement)
  let shiftX = 0
  for (const island of [...placement.islands].sort((a, b) => a.rect.gx - b.rect.gx)) {
    if (shiftX !== 0) moveIsland(placement, island.key, shiftX, 0, membership)
    if (island.kind === 'system') {
      shiftX += composeSystem(placement, island.key, relationships)
    }
  }
  const occupied = unionRects(placement.islands.map(island => island.rect))
  if (occupied) {
    placement.sheet.w = occupied.gx + occupied.w + MARGIN
    placement.sheet.d = occupied.gy + occupied.d + MARGIN
  }
  return placement
}
