import { createHash } from 'node:crypto'

import { isReservedDocument } from './architecture-path.ts'

export function kebabCase(name: string): string {
  return name.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu)?.join('-') ?? ''
}

/**
 * An element id is its file name, and filesystems cap names at 255 bytes. Keep generated ids well under that,
 * leaving room for ".md" and the atomic-write temporary suffix. A longer id keeps its readable start and ends
 * in a hash of the whole id, so distinct long ids stay distinct and the same source keeps the same id.
 */
const MAX_ID_BYTES = 160

export function fitId(id: string): string {
  if (Buffer.byteLength(id) <= MAX_ID_BYTES) return id
  const hash = createHash('sha256').update(id).digest('hex').slice(0, 8)
  let start = id
  while (Buffer.byteLength(start) > MAX_ID_BYTES - hash.length - 1) start = start.slice(0, -1)
  return `${start.replace(/-+$/, '')}-${hash}`
}

/** Architecture identities use the same Unicode word format that new names receive. */
export function isArchitectureId(id: string): boolean {
  return id !== '' && id === kebabCase(id)
}

export function displayName(kebab: string): string {
  const words = kebab.split('-').filter(Boolean)
  if (words.length === 0) return kebab
  const [first, ...rest] = words
  return [first[0].toUpperCase() + first.slice(1), ...rest].join(' ')
}

/** The text a flag must carry; a missing or blank value names the flag. */
export function requireText(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim().length === 0) throw new Error(`${flag} is required`)
  return value
}

/** A group has no id of its own: it is addressed as <container-id>/<group-kebab>. */
export function groupAddress(container: string, name: string): string {
  return `${container}/${kebabCase(name)}`
}

/** The slash of a group address tells it apart from an element id. */
export function isGroupAddress(id: string): boolean {
  return id.includes('/')
}

/** IDs no element may take: a reserved document name, or a word the CLI reads as a relation or group address. */
export function isReservedId(id: string): boolean {
  return isReservedDocument(`${id}.md`) || id === 'relation' || id === 'group'
}
