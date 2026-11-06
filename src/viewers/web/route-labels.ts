import type { Camera } from './iso/camera/camera.ts'
import type { LayeredScene } from './iso/projection/separation.ts'
import { groundAxes, type SurfaceLabel } from './iso/projection/project.ts'
import type { Point } from '../../types.ts'

interface Box { x1: number; x2: number; y1: number; y2: number }

function boxOf(points: readonly Point[]): Box {
  const xs = points.map(point => point.x)
  const ys = points.map(point => point.y)
  return { x1: Math.min(...xs), x2: Math.max(...xs), y1: Math.min(...ys), y2: Math.max(...ys) }
}

const overlaps = (a: Box, b: Box): boolean => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2

/** Label text in screen pixels: its size, an average glyph width, and the shortest label worth drawing. */
const SIZE = 11
const GLYPH = SIZE * 0.6
const MIN_CHARS = 6
const PADDING = 10

export const routeLabelsCss = `
  #route-labels { position: absolute; inset: 0; transform-origin: 0 0; will-change: transform; pointer-events: none; }
  #route-labels .route-label {
    position: absolute; left: 0; top: 0; font-size: ${SIZE}px; line-height: 1; white-space: nowrap; color: var(--muted);
    letter-spacing: 0.02em; text-shadow: 0 0 3px var(--paper), 0 0 3px var(--paper), 0 0 2px var(--paper);
  }
  body.hud-hidden #route-labels { display: none; }
`

interface Label {
  node: HTMLElement
  /** Midpoint of the route's longest run, in scene units. */
  at: { x: number; y: number }
  /** That run's length in scene units. */
  length: number
  text: string
}

export interface RouteLabelLayer {
  /** Chooses where each drawn route names itself; call after the map painted the scene. */
  paint(scene: LayeredScene): void
  /** Fits each label to its run at this zoom, hiding labels that would not fit or would cover a longer run's label. */
  place(camera: Camera): void
}

/**
 * C4 reads arrows by their words. Each route names what it does at the middle of its longest run that reads
 * across the screen, at a constant screen size; a route without room keeps only its tooltip.
 */
export function createRouteLabels(host: HTMLElement): RouteLabelLayer {
  const layer = document.createElement('div')
  layer.id = 'route-labels'
  host.append(layer)
  let labels: Label[] = []
  /** Element bodies and name bands in scene units; a label never covers them. */
  let obstacles: Box[] = []
  let camera: Camera | undefined

  const place = (): void => {
    if (camera === undefined) return
    const { k } = camera
    layer.style.transform = `translate(${camera.x}px, ${camera.y}px)`
    const taken: Box[] = obstacles.map(box => ({ x1: box.x1 * k, x2: box.x2 * k, y1: box.y1 * k, y2: box.y2 * k }))
    for (const label of labels) {
      const fits = Math.floor((label.length * k - PADDING) / GLYPH)
      const text = fits >= label.text.length ? label.text : `${label.text.slice(0, Math.max(0, fits - 1)).trimEnd()}…`
      const width = text.length * GLYPH
      const box = { x1: label.at.x * k - width / 2, x2: label.at.x * k + width / 2, y1: label.at.y * k - SIZE - 3, y2: label.at.y * k }
      const covered = taken.some(other => overlaps(box, other))
      label.node.hidden = fits < MIN_CHARS || covered
      if (label.node.hidden) continue
      taken.push(box)
      label.node.textContent = text
      label.node.style.transform = `translate(${box.x1}px, ${box.y1}px)`
    }
  }

  return {
    paint(scene) {
      layer.replaceChildren()
      const [u, v] = groundAxes(scene.view)
      const band = (text: SurfaceLabel): Box => {
        const o = text.origin
        const w = text.band.width
        const h = text.band.height
        return boxOf([o, { x: o.x + u.x * w, y: o.y + u.y * w }, { x: o.x + v.x * h, y: o.y + v.y * h },
          { x: o.x + u.x * w + v.x * h, y: o.y + u.y * w + v.y * h }])
      }
      const zoneParent = new Map(scene.zones.map(({ zone }) => [zone.key, zone.parent]))
      const occupied = new Set(scene.buildings.flatMap(({ building }) => [building.surface, zoneParent.get(building.surface) ?? '']))
      obstacles = [
        // A slab with buildings on it is ground the routes cross; only an empty slab is a body to keep clear.
        ...scene.slabs.flatMap(slab => occupied.has(slab.slab.representationId)
          ? [band(slab.text)]
          : [boxOf(slab.faces.flatMap(face => face.points)), band(slab.text)]),
        ...scene.buildings.map(building => boxOf(building.floors.flat().flatMap(face => face.points))),
        ...scene.islands.map(island => band(island.text)),
        ...scene.zones.map(zone => band(zone.text)),
      ]
      labels = scene.routes.flatMap(({ route, points }) => {
        let best: { length: number; at: { x: number; y: number } } | undefined
        for (let index = 1; index < points.length; index++) {
          const a = points[index - 1]!
          const b = points[index]!
          const dx = b.x - a.x
          const dy = b.y - a.y
          const length = Math.hypot(dx, dy)
          // Text runs across the screen, so it sits along runs that do too.
          if (Math.abs(dx) < Math.abs(dy) || length <= (best?.length ?? 0)) continue
          best = { length, at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
        }
        if (best === undefined || route.description.length === 0) return []
        const node = document.createElement('div')
        node.className = 'route-label'
        layer.append(node)
        return [{ node, ...best, text: route.description }]
      }).sort((a, b) => b.length - a.length)
      place()
    },
    place(current) {
      camera = current
      place()
    },
  }
}
