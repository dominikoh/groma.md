import type { ArchitectureGraph } from '../types.ts'
import { mapRelationships } from './route/relationships.ts'
import { ISLAND_FONT, labelBand, slabBand } from './measure.ts'
import { placeWorld } from './place.ts'
import { routeAll, type Endpoint } from './route/route.ts'
import type { CellRect, SheetScene } from './types.ts'

export interface SheetSceneTimings {
  placementMilliseconds: number
  routingMilliseconds: number
}

export interface MeasuredSheetScene {
  scene: SheetScene
  timings: SheetSceneTimings
}

/**
 * Composes the merged world into one shared sheet: flat islands for
 * actors, external systems and each internal system, container slabs level
 * with the system islands, buildings on the slabs and islands, group zones,
 * and orthogonal ground routes for the visible connections. Pure: the same world gives the same
 * sheet and the world is never touched.
 */
export function measuredSheetScene(world: ArchitectureGraph): MeasuredSheetScene {
  const started = performance.now()
  const placement = placeWorld(world)
  const placed = performance.now()
  const endpoints = new Map<string, Endpoint>()
  // Routes end on the painted surface, not on the label band packing reserves under it, so they meet its walls mid-way.
  const body = (rect: CellRect, font: number): CellRect => ({ ...rect, d: rect.d - labelBand(font) })
  const held = new Set([
    ...placement.slabs.map(slab => slab.island),
    ...placement.buildings.map(building => building.surface),
    ...placement.zones.map(zone => zone.parent),
  ])
  const solid = (key: string) => held.has(key) ? {} : { solid: true as const }
  for (const island of placement.islands) {
    endpoints.set(island.key, { key: island.key, kind: 'island', rect: body(island.rect, ISLAND_FONT), ...solid(island.key) })
  }
  for (const slab of placement.slabs) {
    endpoints.set(slab.representationId, {
      key: slab.representationId,
      kind: 'slab',
      rect: { ...slab.rect, d: slab.rect.d - slabBand(slab) },
      owner: slab.island,
      ...solid(slab.representationId),
    })
  }
  for (const building of placement.buildings) {
    endpoints.set(building.representationId, {
      key: building.representationId,
      kind: 'building',
      rect: building.rect,
      owner: building.surface,
      roof: building.heightUnits,
    })
  }
  const routes = routeAll(endpoints, mapRelationships(world))
  const routed = performance.now()
  return {
    scene: { ...placement, routes },
    timings: {
      placementMilliseconds: placed - started,
      routingMilliseconds: routed - placed,
    },
  }
}

export function sheetScene(world: ArchitectureGraph): SheetScene {
  return measuredSheetScene(world).scene
}
