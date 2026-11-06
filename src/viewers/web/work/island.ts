import type { WorkPin } from '../../../work/pins.ts'
import type { WorkSnapshot } from '../../../types.ts'
import type { Tip } from '../organisms/tip.ts'
import { BACKLOG_MARK } from './backlog-mark.ts'
import { preservedWorkStatuses, toggleWorkStatus, workStatusFilters } from '../../../work/status-filter.ts'
import type { WorkStatusFilterState } from '../../../work/status-filter.ts'
import { createWorkSummary, workSummaryCss } from './summary.ts'

const icon = (paths: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
const EYE_MARK = icon('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>')
/** Points up while folded, the way the island opens; the open island turns it down. */
const CHEVRON = icon('<path d="M6 15l6-6 6 6"/>')

export const workCss = `
  ${workSummaryCss}
  /*
   * Centred by margins, not by a translate: a fractional transform would resample the blurred layer and soften the text.
   * Placed from the map, which fills the window, so the island adds an embedding page's chrome inset itself.
   */
  #work {
    --window-inset: var(--chrome-inset, 0px);
    position: absolute; left: 0; right: 0; bottom: calc(12px + var(--window-inset)); margin: 0 auto; width: fit-content; box-sizing: border-box; max-width: calc(100% - 24px);
    gap: 10px; padding: 6px 12px; overflow: hidden;
  }
  #work[hidden] { display: none; }
  #work .content { display: contents; }
  #work svg { width: 18px; height: 18px; flex: none; }
  #work .label .backlog-mark { filter: grayscale(1); }
  #work .divider { width: 1px; height: 24px; background: var(--hairline); flex: none; }
  #work button { display: flex; align-items: center; gap: 6px; border: 0; background: transparent; padding: 4px; border-radius: 14px; }
  #work .label { display: flex; align-items: center; gap: 8px; margin-right: 4px; padding-left: 8px; font-weight: 600; }
  #work .label .backlog-mark { width: 29px; height: 36px; }
  #work .toggle { height: 38px; border-radius: 20px; }
  #work .toggle { padding: 4px 10px; border: 1px solid var(--hairline); color: var(--muted); }
  #work .toggle[aria-pressed="true"] { color: var(--highlight-text); border-color: var(--highlight); }
  #work .fold svg { transition: transform 0.3s ease; }
  #work.open .fold svg { transform: rotate(180deg); }
  @media (prefers-reduced-motion: reduce) {
    #work .fold svg { transition: none; }
  }
`

export interface WorkIsland {
  /** Rebuilds the island for these pins; it stays visible while Backlog has a configured workflow. */
  paint(pins: readonly WorkPin[], work: WorkSnapshot): void
}

function button(className: string, html: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement('button')
  node.type = 'button'
  node.className = className
  node.innerHTML = html
  node.addEventListener('click', onClick)
  return node
}

/**
 * The Backlog task island at the map's bottom centre: a pill that unfolds into
 * the label and the configured statuses that have pins, which filter the map's
 * pins. It starts folded with every status but the final one shown, and keeps
 * its fold and filters across repaints. The persistent fold control turns while
 * final-size content is clipped out and back in, so text is never scaled.
 */
export function createWorkIsland(
  host: HTMLElement,
  onShow: (statuses: readonly string[]) => void,
  tip: Tip,
): WorkIsland {
  const island = document.createElement('div')
  island.id = 'work'
  island.className = 'floating-map-bar'
  island.hidden = true
  const content = document.createElement('div')
  content.className = 'content'
  let pins: readonly WorkPin[] = []
  let work: WorkSnapshot = { statuses: [], defaultStatus: '', items: [] }
  const summary = createWorkSummary(tip)
  let statusFilters: WorkStatusFilterState | undefined
  let open = false
  let foldRevision = 0
  let foldAnimation: Animation | undefined

  const toggle = (status: string): HTMLButtonElement => {
    const pressed = statusFilters?.enabled.includes(status) ?? false
    const node = button('toggle', `${EYE_MARK}${status}`, () => {
      statusFilters = toggleWorkStatus(statusFilters!, status)
      onShow(statusFilters.enabled)
      rebuild()
    })
    node.setAttribute('aria-pressed', String(pressed))
    return node
  }
  /** The island's changing content for the folded pill or open row. */
  const parts = (): Node[] => {
    const divider = document.createElement('span')
    divider.className = 'divider'
    if (!open) return [summary.element, divider]
    const label = document.createElement('span')
    label.className = 'label'
    label.innerHTML = `${BACKLOG_MARK}<span>Backlog.md<br>Tasks</span>`
    // Statuses filter the map's pins; each element's task list opens from its pin.
    return [label, ...statusFilters!.available.map(toggle)]
  }
  /** Rebuilds only changing content; the disclosure control remains the same DOM node. */
  const rebuild = (): void => {
    foldAnimation?.cancel()
    foldAnimation = undefined
    foldRevision += 1
    content.replaceChildren(...parts())
    island.hidden = work.statuses.length === 0
    island.classList.toggle('open', open)
    summary.update(pins, work, statusFilters?.enabled ?? [], !open)
  }
  const fold = button('fold', CHEVRON, () => {
    open = !open
    island.classList.toggle('open', open)
    fold.setAttribute('aria-expanded', String(open))
    const revision = ++foldRevision
    foldAnimation?.cancel()
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      rebuild()
      return
    }
    const cover = island.animate(
      [
        { clipPath: 'inset(0 round 28px)', opacity: 1 },
        { clipPath: 'inset(0 46% round 28px)', opacity: 0.25 },
      ],
      { duration: 120, easing: 'ease-in', fill: 'forwards' },
    )
    foldAnimation = cover
    cover.finished.then(() => {
      if (revision !== foldRevision) return
      content.replaceChildren(...parts())
      cover.cancel()
      foldAnimation = island.animate(
        [
          { clipPath: 'inset(0 46% round 28px)', opacity: 0.25 },
          { clipPath: 'inset(0 round 28px)', opacity: 1 },
        ],
        { duration: 160, easing: 'ease-out' },
      )
    }).catch(() => undefined)
  })
  fold.setAttribute('aria-expanded', 'false')
  island.append(content, fold)
  host.append(island)
  return {
    paint(nextPins, nextWork) {
      const enabled = preservedWorkStatuses(work.statuses, statusFilters?.enabled)
      pins = nextPins
      work = nextWork
      statusFilters = workStatusFilters(
        work.statuses,
        work.defaultStatus,
        pins.map(pin => pin.status),
        enabled,
      )
      onShow(statusFilters.enabled)
      rebuild()
    },
  }
}
