import type { AnnotatedElement, AnnotatedRelationship, ArchitectureFlow, ArchitectureGraph, C4Kind } from './types.ts'

/**
 * C4 diagram levels drawn from one world. `context` keeps people and software systems (System Context),
 * `container` adds containers (Container), `component` is the full world (Component).
 */
export type MapLevel = 'context' | 'container' | 'component'

const kept: Record<MapLevel, ReadonlySet<C4Kind>> = {
  context: new Set<C4Kind>(['actor', 'system']),
  container: new Set<C4Kind>(['actor', 'system', 'container']),
  component: new Set<C4Kind>(['actor', 'system', 'container', 'component']),
}

export function isMapLevel(value: unknown): value is MapLevel {
  return value === 'context' || value === 'container' || value === 'component'
}

export interface LevelWorld<World extends ArchitectureGraph> {
  world: World
  /** Every element id of the full world -> the kept element that stands for it at this level. */
  owner: ReadonlyMap<string, string>
}

function owners(elements: readonly AnnotatedElement[], level: MapLevel): Map<string, string> {
  const byId = new Map(elements.map(element => [element.id, element]))
  const result = new Map<string, string>()
  for (const element of elements) {
    let current: AnnotatedElement | undefined = element
    while (current && !kept[level].has(current.kind)) current = current.parent === null ? undefined : byId.get(current.parent)
    if (current) result.set(element.id, current.id)
  }
  return result
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(value => value.length > 0))]
}

/** Relationships promoted to their kept ends; a pair keeps one route, self-routes inside a collapsed element vanish. */
function promote(relationships: readonly AnnotatedRelationship[], owner: ReadonlyMap<string, string>) {
  const pairs = new Map<string, AnnotatedRelationship[]>()
  const ids = new Map<string, string>()
  for (const relationship of relationships) {
    const source = owner.get(relationship.source)
    const target = owner.get(relationship.target)
    if (source === undefined || target === undefined || source === target) continue
    const key = `${source}\0${target}`
    pairs.set(key, [...(pairs.get(key) ?? []), { ...relationship, source, target }])
  }
  const result: AnnotatedRelationship[] = []
  for (const members of pairs.values()) {
    const first = members[0]!
    const id = members.length === 1 ? first.id : `${first.id}+${members.length - 1}`
    for (const member of members) ids.set(member.id, id)
    result.push({
      ...first,
      id,
      connections: members.flatMap(member => member.connections ?? []),
      description: unique(members.map(member => member.description)).join('; '),
      technology: unique(members.flatMap(member => member.technology.split(/,\s*/))).join(', '),
      origin: members.some(member => member.origin === 'observed') ? 'observed' : first.origin,
      // A merged route is a draft only while every relationship it stands for is one.
      draft: members.every(member => member.draft !== undefined) ? first.draft : undefined,
    })
  }
  return { relationships: result, ids }
}

function promoteFlows(flows: readonly ArchitectureFlow[], owner: ReadonlyMap<string, string>, ids: ReadonlyMap<string, string>) {
  return flows.flatMap(flow => {
    const steps = flow.steps.flatMap(step => {
      const source = owner.get(step.source)
      const target = owner.get(step.target)
      const relationshipId = ids.get(step.relationshipId)
      if (source === undefined || target === undefined || source === target || relationshipId === undefined) return []
      return [{ ...step, source, target, relationshipId }]
    })
    // Consecutive steps that collapse onto the same pair read as one step at this level.
    const merged = steps.filter((step, index) => index === 0 || step.relationshipId !== steps[index - 1]!.relationshipId)
    return merged.length === 0 ? [] : [{ ...flow, steps: merged }]
  })
}

/** The world as one C4 level draws it; pure, the full world is never touched. */
export function levelWorld<World extends ArchitectureGraph>(world: World, level: MapLevel): LevelWorld<World> {
  const owner = owners(world.elements, level)
  if (level === 'component') return { world, owner }
  const keptIds = new Set(owner.values())
  const elements = world.elements.filter(element => keptIds.has(element.id)).map(element => {
    const collapsed = element.children.some(child => !keptIds.has(child))
    return {
      ...element,
      children: element.children.filter(child => keptIds.has(child)),
      // A collapsed element keeps no Code of its own: its parts are not drawn at this level.
      ...(collapsed ? { code: [], codeLines: 0 } : {}),
    }
  })
  const { relationships, ids } = promote(world.relationships, owner)
  return {
    world: { ...world, elements, relationships, flows: promoteFlows(world.flows, owner, ids), findings: [] },
    owner,
  }
}
