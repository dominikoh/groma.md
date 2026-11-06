import type { AnnotatedRelationship } from '../../types.ts'
import { ROOF_SHADOW } from '../grid.ts'
import type { CellRect, Route } from '../types.ts'
import { ROUTE_UNIT } from './space.ts'

export interface Point {
  x: number
  y: number
}

export type PortSide = 'north' | 'east' | 'south' | 'west'

export interface RoutePort {
  side: PortSide
  wall: Point
  guard: Point
}

export interface PortPair {
  source: RoutePort
  target: RoutePort
}

/** Anything a route may start or end on, with its direct enclosing surface. */
export interface Endpoint {
  key: string
  kind: 'building' | 'slab' | 'island'
  rect: CellRect
  owner?: string
  roof?: number
  /** A slab or island that holds nothing is painted as a plain box: routes go round it as they go round a building. */
  solid?: true
}

/** Whether routes must go round an endpoint rather than across it. */
export function isObstacle(endpoint: Endpoint): boolean {
  return endpoint.kind === 'building' || endpoint.solid === true
}

export type RouteRequest = Pick<AnnotatedRelationship, 'id' | 'source' | 'target' | 'description' | 'origin'> & { relationshipIds?: string[] }
export type FlatRoute = Omit<Route, 'points'> & { points: Point[] }

/** Plane units within which two coordinates count as the same. */
export const EPSILON = 0.001

export function rectOf(rect: CellRect): { x: number; y: number; width: number; height: number } {
  return {
    x: rect.gx * ROUTE_UNIT,
    y: rect.gy * ROUTE_UNIT,
    width: rect.w * ROUTE_UNIT,
    height: rect.d * ROUTE_UNIT,
  }
}

export function visibleObstacle(endpoint: Endpoint, clearance = 0): Point[] {
  const { x, y, width, height } = rectOf(endpoint.rect)
  const shadow = (endpoint.roof ?? 0) * ROOF_SHADOW * ROUTE_UNIT
  return [
    { x: x - shadow - clearance, y: y - shadow - clearance },
    { x: x + width - shadow + clearance, y: y - shadow - clearance },
    { x: x + width + clearance, y: y - clearance },
    { x: x + width + clearance, y: y + height + clearance },
    { x: x - clearance, y: y + height + clearance },
    { x: x - shadow - clearance, y: y + height - shadow + clearance },
  ]
}

export function inside(point: Point, polygon: readonly Point[]): boolean {
  let contained = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]!
    const b = polygon[previous]!
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) contained = !contained
  }
  return contained
}

/**
 * The actors and external islands a route between `source` and `target` should not cross: those holding neither end.
 * Their buildings are obstacles anyway; this keeps a route from threading between them. In plane units.
 */
export function foreignIslands(endpoints: ReadonlyMap<string, Endpoint>, source: string, target: string)
  : { x: number; y: number; width: number; height: number }[] {
  const own = new Set([source, target].flatMap(id => [id, endpoints.get(id)?.owner ?? id]))
  return [...endpoints.values()]
    .filter(endpoint => endpoint.kind === 'island' && !endpoint.solid && !own.has(endpoint.key)
      && (endpoint.key === 'island:actors' || endpoint.key === 'island:external'))
    .map(endpoint => rectOf(endpoint.rect))
}

/** How much of a route runs inside islands it should not cross (see foreignIslands), in plane units. */
export function foreignLength(endpoints: ReadonlyMap<string, Endpoint>, route: Pick<FlatRoute, 'source' | 'target' | 'points'>): number {
  let total = 0
  for (const island of foreignIslands(endpoints, route.source, route.target)) {
    for (let index = 1; index < route.points.length; index += 1) {
      const [a, b] = [route.points[index - 1]!, route.points[index]!]
      const [x0, x1] = [Math.max(Math.min(a.x, b.x), island.x), Math.min(Math.max(a.x, b.x), island.x + island.width)]
      const [y0, y1] = [Math.max(Math.min(a.y, b.y), island.y), Math.min(Math.max(a.y, b.y), island.y + island.height)]
      if (a.y === b.y && a.y > island.y && a.y < island.y + island.height) total += Math.max(0, x1 - x0)
      else if (a.x === b.x && a.x > island.x && a.x < island.x + island.width) total += Math.max(0, y1 - y0)
    }
  }
  return total
}
