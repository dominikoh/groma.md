import { expect, test } from 'bun:test'
import { loadAnnotatedArchitecture } from '../src/core.ts'
import { levelWorld } from '../src/level-world.ts'
import { sheetScene } from '../src/sheet/scene.ts'
import { viewerFixtureRoot } from './helpers.ts'

test.concurrent('C4 levels keep their kinds, promote relationships to kept ends and lay out on their own', async () => {
  const world = await loadAnnotatedArchitecture(viewerFixtureRoot)
  const byId = new Map(world.elements.map(element => [element.id, element]))
  const ancestor = (id: string, kinds: readonly string[]): string => {
    let current = byId.get(id)!
    while (!kinds.includes(current.kind)) current = byId.get(current.parent!)!
    return current.id
  }
  for (const [level, kinds] of [['context', ['actor', 'system']], ['container', ['actor', 'system', 'container']]] as const) {
    const { world: drawn, owner } = levelWorld(world, level)
    const kept = new Set(drawn.elements.map(element => element.id))
    expect(drawn.elements.every(element => (kinds as readonly string[]).includes(element.kind))).toBe(true)
    expect(drawn.elements.every(element => element.children.every(child => kept.has(child)))).toBe(true)
    for (const element of world.elements) expect(owner.get(element.id)).toBe(ancestor(element.id, kinds))
    // Every full-world relationship that crosses kept ends is represented once, by its promoted pair.
    const expected = new Set(world.relationships
      .map(relationship => `${owner.get(relationship.source)}>${owner.get(relationship.target)}`)
      .filter(pair => pair.split('>')[0] !== pair.split('>')[1]))
    expect(new Set(drawn.relationships.map(relationship => `${relationship.source}>${relationship.target}`))).toEqual(expected)
    expect(drawn.relationships.length).toBe(expected.size)
    for (const flow of drawn.flows) {
      for (const step of flow.steps) {
        expect(kept.has(step.source) && kept.has(step.target) && step.source !== step.target).toBe(true)
        expect(drawn.relationships.some(relationship => relationship.id === step.relationshipId)).toBe(true)
      }
    }
    const scene = sheetScene(drawn)
    expect(scene.buildings.every(building => kept.has(building.representationId))).toBe(true)
  }
  expect(levelWorld(world, 'component').world).toBe(world)
})
