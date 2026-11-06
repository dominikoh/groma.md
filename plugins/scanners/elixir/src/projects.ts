import path from 'node:path'
import type { ScanRoot } from '@groma/scanner'
import type { Node } from 'web-tree-sitter'
import {
  atomName, blockStatements, callName, doBlock, listKeywords, positional, stringList, target,
} from './syntax.ts'

/** What a Mix project file declares literally; the DSL is never evaluated. */
export interface MixProject {
  file: string
  directory: string
  app?: string
  sourcePaths: string[]
  /** Module named by `mod: {Module, args}` in `application/0`. */
  applicationModule?: string
  escriptModule?: string
}

function definitions(root: Node, name: string): Node[] {
  const module = root.namedChildren.find(node => node && callName(node) === 'defmodule')
  return blockStatements(module ? doBlock(module) : undefined).filter(node => {
    const kind = callName(node)
    if (kind !== 'def' && kind !== 'defp') return false
    const signature = positional(node)[0]
    return signature?.text === name || (signature?.type === 'call' && target(signature)?.text === name)
  })
}

/** The keyword list a zero-arity definition returns, such as `def project, do: [...]`. */
function returnedKeywords(definition: Node | undefined): Map<string, Node> {
  const body = definition ? blockStatements(doBlock(definition)).at(-1) : undefined
  return listKeywords(body)
}

/** `elixirc_paths: ["lib"]`, or the union of literal lists a private `elixirc_paths/1` returns. */
function sourcePaths(root: Node, value: Node | undefined): string[] {
  const literal = stringList(value)
  if (literal) return literal
  if (value?.type !== 'call') return ['lib']
  const name = target(value)?.text
  const paths = definitions(root, name ?? '').flatMap(node => stringList(blockStatements(doBlock(node)).at(-1)) ?? [])
  return paths.length ? [...new Set(paths)] : ['lib']
}

function moduleTuple(node: Node | undefined): string | undefined {
  const first = node?.type === 'tuple' ? node.namedChildren[0] : undefined
  return first?.type === 'alias' ? first.text : undefined
}

export function mixProject(root: Node, file: string): MixProject {
  const project = returnedKeywords(definitions(root, 'project')[0])
  const application = returnedKeywords(definitions(root, 'application')[0])
  const escript = project.get('escript')
  return {
    file,
    directory: path.posix.dirname(file),
    app: atomName(project.get('app')),
    sourcePaths: sourcePaths(root, project.get('elixirc_paths')),
    applicationModule: moduleTuple(application.get('mod')),
    escriptModule: escript?.type === 'list' ? listKeywords(escript).get('main_module')?.text : undefined,
  }
}

function inside(file: string, directory: string): boolean {
  return directory === '.' || file.startsWith(`${directory}/`)
}

export function nearestProject(file: string, projects: readonly MixProject[]): MixProject | undefined {
  return projects.filter(project => inside(file, project.directory))
    .sort((a, b) => b.directory.length - a.directory.length)[0]
}

/** A Mix project compiles `.ex` files under its source paths; other `.ex` files belong to no project. */
export function compiled(file: string, projects: readonly MixProject[]): boolean {
  if (!file.endsWith('.ex')) return false
  const project = nearestProject(file, projects)
  if (!project) return true
  return project.sourcePaths.some(source => inside(file, path.posix.join(project.directory, source)))
}

export function elixirRoots(repositoryRoot: string, projects: readonly MixProject[], files: readonly string[]) {
  const roots = new Map<string, ScanRoot>()
  for (const project of projects) {
    roots.set(project.directory, { id: project.directory, kind: 'project', file: project.file,
      name: project.app ?? (project.directory === '.' ? path.basename(repositoryRoot) : path.posix.basename(project.directory)) })
  }
  for (const project of projects) {
    const parent = nearestProject(`${project.directory}/`, projects.filter(item => item !== project))
    if (parent) roots.get(project.directory)!.parent = parent.directory
  }
  const memberships = new Map<string, string>()
  for (const file of files) {
    const owner = nearestProject(file, projects)?.directory ?? '.'
    if (!roots.has(owner)) roots.set(owner, { id: owner, kind: 'source-group', name: path.basename(repositoryRoot) })
    memberships.set(file, owner)
  }
  return { roots: [...roots.values()], memberships }
}
