import type { Point } from '../../../types.ts'
import type { WorkPin } from '../../../work/pins.ts'
import type { Camera } from '../iso/camera/camera.ts'
import type { Tip } from '../organisms/tip.ts'
import { BACKLOG_MARK } from './backlog-mark.ts'

/** Screen pixels from the foot up to the badge of a pin. */
const STEM = 22
/** The ring's radius and stroke in the badge's 40 px box. */
const RING_RADIUS = 17
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

/** How a task's status reads on the map, in ring order. */
export type WorkStage = 'todo' | 'progress' | 'blocked' | 'done'
const STAGES: readonly { stage: WorkStage; label: string }[] = [
  { stage: 'progress', label: 'In progress' },
  { stage: 'blocked', label: 'Blocked' },
  { stage: 'todo', label: 'To do' },
  { stage: 'done', label: 'Done' },
]

/** The default status is planned work, the final one finished; a status named like "blocked" is blocked, the rest in progress. */
export function stageOf(pin: Pick<WorkPin, 'status' | 'draft' | 'terminal'>): WorkStage {
  if (pin.terminal) return 'done'
  if (/block/i.test(pin.status)) return 'blocked'
  if (pin.draft) return 'todo'
  return 'progress'
}

/** Tasks per stage on one element, each task once whatever its assignees. */
export function stageCounts(pins: readonly WorkPin[]): Record<WorkStage, number> {
  const counts: Record<WorkStage, number> = { todo: 0, progress: 0, blocked: 0, done: 0 }
  const seen = new Set<string>()
  for (const pin of pins) {
    if (seen.has(pin.taskId)) continue
    seen.add(pin.taskId)
    counts[stageOf(pin)] += 1
  }
  return counts
}

export const pinsCss = `
  #pins { position: absolute; inset: 0; transform-origin: 0 0; will-change: transform; pointer-events: none; }
  .pin { position: absolute; width: 0; height: 0; pointer-events: auto; will-change: translate; }
  .pin .foot { position: absolute; left: -2.5px; top: -2.5px; width: 5px; height: 5px; border-radius: 50%; background: var(--ink); opacity: 0.7; }
  .pin .stem { position: absolute; left: -0.5px; bottom: 0; width: 1px; height: ${STEM}px; background: var(--ink); opacity: 0.5; }
  .pin .head { position: absolute; left: -20px; bottom: ${STEM}px; width: 40px; height: 40px; cursor: pointer; }
  .pin .ring { position: absolute; inset: 0; transform: rotate(-90deg); }
  .pin .ring circle { fill: none; stroke-width: 4; }
  .pin .ring .todo { stroke: #8b93a1; }
  .pin .ring .progress { stroke: #3b82f6; }
  .pin .ring .blocked { stroke: #ef4444; }
  .pin .ring .done { stroke: #22c55e; }
  .pin .face {
    position: absolute; inset: 6px; border-radius: 50%; display: grid; place-items: center;
    background: color-mix(in srgb, var(--paper) 82%, transparent);
  }
  .pin .face .backlog-mark { width: 16px; height: 20px; filter: grayscale(1); }
  .pin .count {
    position: absolute; right: -6px; top: -4px; min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box;
    border-radius: 8px; background: var(--ink); color: var(--paper); font-size: 10px; font-weight: 600; line-height: 16px; text-align: center;
  }
  .pin.active .face { box-shadow: 0 0 0 3px var(--highlight); }
  .pin.active .face .backlog-mark { filter: none; }
`

export interface PinLayer {
  /** One pin per element with work: its ring shows the share of each stage among the element's tasks. */
  paint(pins: readonly WorkPin[]): void
  /** Moves every pin to the surface point it stands on under the camera. */
  place(camera: Camera): void
  /** Shows the pins of elements with a task in one of these statuses. */
  show(statuses: readonly string[]): void
  /** Marks the pins of elements that an active task touches. */
  activate(active: readonly string[], selected: string | undefined): void
}

/** The ring's arcs: each stage's share of the circle, in stage order, starting at the top. */
function ringArcs(counts: Record<WorkStage, number>): string {
  const total = STAGES.reduce((sum, { stage }) => sum + counts[stage], 0)
  let offset = 0
  return STAGES.filter(({ stage }) => counts[stage] > 0).map(({ stage }) => {
    const length = counts[stage] / total * RING_LENGTH
    const arc = `<circle class="${stage}" cx="20" cy="20" r="${RING_RADIUS}" stroke-dasharray="${length} ${RING_LENGTH - length}" stroke-dashoffset="${-offset}"/>`
    offset += length
    return arc
  }).join('')
}

/**
 * The work over the map: one pin per element with Backlog tasks, standing on its surface. The ring around the Backlog
 * mark splits by stage (in progress, blocked, to do, done); the tip counts each stage; clicking opens the element's
 * task list.
 */
export function createPins(host: HTMLElement, anchorOf: (id: string) => Point | undefined, tip: Tip,
  onOpen: (elementId: string) => void): PinLayer {
  const layer = document.createElement('div')
  layer.id = 'pins'
  host.append(layer)
  const pinned = new Map<string, { node: HTMLElement; anchor: Point; tasks: Set<string>; statuses: Set<string> }>()
  let enabledStatuses: readonly string[] = []
  let camera: Camera | undefined

  const place = (): void => {
    if (camera === undefined) return
    layer.style.transform = `translate(${camera.x}px, ${camera.y}px)`
    for (const pin of pinned.values()) pin.node.style.translate = `${pin.anchor.x * camera.k}px ${pin.anchor.y * camera.k}px`
  }
  const filter = (): void => {
    for (const pin of pinned.values()) pin.node.hidden = ![...pin.statuses].some(status => enabledStatuses.includes(status))
  }

  return {
    paint(pins) {
      const byElement = Map.groupBy(pins, pin => pin.elementId)
      for (const [elementId, pin] of pinned) {
        if (byElement.has(elementId)) continue
        pin.node.remove()
        pinned.delete(elementId)
      }
      for (const [elementId, group] of byElement) {
        const anchor = anchorOf(elementId)
        if (anchor === undefined) continue
        let pin = pinned.get(elementId)
        if (pin === undefined) {
          const node = document.createElement('div')
          node.className = 'pin'
          node.innerHTML = `<div class="foot"></div><div class="stem"></div><div class="head"><svg class="ring" viewBox="0 0 40 40"></svg><div class="face">${BACKLOG_MARK}</div><span class="count"></span></div>`
          const head = node.querySelector<HTMLElement>('.head')!
          head.addEventListener('click', () => onOpen(elementId))
          tip.attach(head)
          layer.append(node)
          pin = { node, anchor, tasks: new Set(), statuses: new Set() }
          pinned.set(elementId, pin)
        }
        const counts = stageCounts(group)
        pin.anchor = anchor
        pin.tasks = new Set(group.map(item => item.taskId))
        pin.statuses = new Set(group.map(item => item.status))
        pin.node.querySelector('.ring')!.innerHTML = ringArcs(counts)
        pin.node.querySelector('.count')!.textContent = String(pin.tasks.size)
        pin.node.querySelector<HTMLElement>('.head')!.dataset.tip = STAGES
          .filter(({ stage }) => counts[stage] > 0)
          .map(({ stage, label }) => `${label} ${counts[stage]}`).join(' · ')
      }
      filter()
      place()
    },
    place(current) {
      camera = current
      place()
    },
    show(statuses) {
      enabledStatuses = statuses
      filter()
    },
    activate(active) {
      for (const pin of pinned.values()) pin.node.classList.toggle('active', active.some(task => pin.tasks.has(task)))
    },
  }
}
