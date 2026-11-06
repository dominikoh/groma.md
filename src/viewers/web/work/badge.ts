/** How long a visible work badge takes to turn into its Done face. */
export const WORK_BADGE_FLIP_MS = 500
export const WORK_BADGE_HOLD_MS = 2500
export const WORK_BADGE_FADE_MS = 300
export const WORK_BADGE_FINISH_MS = WORK_BADGE_FLIP_MS + WORK_BADGE_HOLD_MS + WORK_BADGE_FADE_MS

export const workBadgeCss = `
  .badge { position: relative; width: 40px; height: 40px; perspective: 200px; }
  .badge .ring { position: absolute; inset: 0; transform: rotate(-90deg); }
  .badge .ring circle { fill: none; stroke-width: 3; }
  .badge .ring .track { stroke: var(--hairline); }
  .badge .ring .done { stroke: var(--pin); transition: stroke-dasharray 0.4s; }
  .badge .card { position: absolute; inset: 5px; transform-style: preserve-3d; transition: transform 0.5s; }
  .badge .face {
    position: absolute; inset: 0; border-radius: 50%; display: grid; place-items: center;
    backface-visibility: hidden; font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
  }
  .badge .face svg { width: 18px; height: 18px; }
  .badge .face.front { background: color-mix(in srgb, var(--paper) 78%, transparent); color: var(--ink); border: 1px solid var(--pin); }
  .badge .face.back { background: color-mix(in srgb, var(--accent) 85%, transparent); color: var(--on-colour); transform: rotateY(180deg); font-size: 14px; }
  .work-done .badge .card { transform: rotateY(180deg); }
  .work-finishing .badge .card { animation: work-badge-finish ${WORK_BADGE_FLIP_MS}ms ease var(--work-finish-delay, 0ms) both; }
  .work-disappearing { animation: work-badge-disappear ${WORK_BADGE_FINISH_MS}ms linear var(--work-finish-delay, 0ms) both; }
  @keyframes work-badge-disappear {
    0%, ${(WORK_BADGE_FLIP_MS + WORK_BADGE_HOLD_MS) / WORK_BADGE_FINISH_MS * 100}% { opacity: 1; }
    100% { opacity: 0; }
  }
  @keyframes work-badge-finish {
    from { transform: rotateY(0); }
    to { transform: rotateY(180deg); }
  }
`
