import type { CodeDeclaration, CodeSymbol, ScanOperation, ScanSymbol } from '@groma/scanner'
import type { Node } from 'web-tree-sitter'
import {
  argumentsOf, blockStatements, callName, definitionKinds, doBlock, keywords, positional, specialForms, target,
} from './syntax.ts'

/** A call in a function body before cross-file resolution: `module` is absent for a local call. */
export interface RawCall {
  source: string
  module?: string
  name: string
  arity: number
  line: number
  position: number
  dynamic: boolean
}

export interface ElixirSource {
  file: string
  modules: string[]
  symbols: ScanSymbol[]
  declarations: CodeDeclaration[]
  operations: ScanOperation[]
  /** Every arity an operation answers, default arguments included: `Mod.fun/arity` -> operation id. */
  arities: Map<string, string>
  calls: RawCall[]
}

interface Scope {
  module: string
  aliases: Map<string, string>
  members?: CodeSymbol[]
}

interface Head {
  name: string
  arity: number
  defaults: number
  node: Node
}

function expand(name: string, scope: Scope): string {
  const [first, ...rest] = name.split('.')
  if (first === '__MODULE__') return [scope.module, ...rest].join('.')
  const aliased = scope.aliases.get(first!)
  return aliased ? [aliased, ...rest].join('.') : name
}

function moduleName(node: Node | undefined, scope: Scope): string | undefined {
  if (node?.type === 'alias') return expand(node.text, scope)
  if (node?.type === '__MODULE__' || node?.text === '__MODULE__') return scope.module || undefined
  return undefined
}

/** `alias A.B`, `alias A.{B, C}` and `alias A.B, as: C`; other forms stay unresolved. */
function addAlias(node: Node, scope: Scope): void {
  const [subject] = positional(node)
  if (subject?.type === 'dot' && subject.childForFieldName('right')?.type === 'tuple') {
    const base = moduleName(subject.childForFieldName('left') ?? undefined, scope)
    for (const item of subject.childForFieldName('right')!.namedChildren) {
      if (base && item?.type === 'alias') scope.aliases.set(item.text.split('.').at(-1)!, `${base}.${item.text}`)
    }
    return
  }
  const full = moduleName(subject, scope)
  if (!full) return
  const as = keywords(node).get('as')
  scope.aliases.set(as?.type === 'alias' ? as.text : full.split('.').at(-1)!, full)
}

function head(definition: Node): Head | undefined {
  let node: Node | undefined = positional(definition)[0]
  if (node?.type === 'binary_operator' && node.childForFieldName('operator')?.text === 'when') node = node.childForFieldName('left') ?? undefined
  if (node?.type === 'identifier') return { name: node.text, arity: 0, defaults: 0, node }
  if (node?.type !== 'call' || target(node)?.type !== 'identifier') return undefined
  const parameters = argumentsOf(node)
  const defaults = parameters.filter(item => item.type === 'binary_operator' && item.childForFieldName('operator')?.text === '\\\\').length
  return { name: target(node)!.text, arity: parameters.length, defaults, node: target(node)! }
}

function pipedArity(node: Node): number {
  const parent = node.parent
  const piped = parent?.type === 'binary_operator' && parent.childForFieldName('operator')?.text === '|>' &&
    parent.childForFieldName('right')?.id === node.id
  return positional(node).length + argumentsOf(node).filter(item => item.type === 'keywords').length + (piped ? 1 : 0)
}

/** Explicit calls in a body; anonymous functions belong to the enclosing definition, as in Elixir. */
function collectCalls(node: Node, source: string, scope: Scope, output: RawCall[]): void {
  if (node.type === 'call') {
    const call = rawCall(node, source, scope)
    if (call) output.push(call)
  }
  for (const child of node.namedChildren) if (child) collectCalls(child, source, scope, output)
}

function rawCall(node: Node, source: string, scope: Scope): RawCall | undefined {
  const callee = target(node)
  const base = { source, line: node.startPosition.row + 1, position: node.startIndex, arity: pipedArity(node) }
  if (callee?.type === 'identifier') {
    if (specialForms.has(callee.text) || definitionKinds.has(callee.text)) return undefined
    return { ...base, name: callee.text, dynamic: false }
  }
  if (callee?.type !== 'dot') return undefined
  const name = callee.childForFieldName('right')
  if (name?.type !== 'identifier') return undefined
  const module = moduleName(callee.childForFieldName('left') ?? undefined, scope)
  return { ...base, module, name: name.text, dynamic: !module }
}

function addDefinition(node: Node, kind: string, scope: Scope, result: ElixirSource): void {
  const signature = head(node)
  if (!signature || !scope.module) return
  const name = `${scope.module}.${signature.name}/${signature.arity}`
  let id = result.arities.get(name)
  if (!id) {
    id = `${result.file}:${node.startIndex}`
    result.symbols.push({ id, name, kind: kind.startsWith('defmacro') ? 'macro' : 'function' })
    result.operations.push({ id, file: result.file, name, position: node.startIndex })
    for (let arity = signature.arity - signature.defaults; arity <= signature.arity; arity++) {
      result.arities.set(`${scope.module}.${signature.name}/${arity}`, id)
    }
    scope.members?.push({ name: signature.name, line: signature.node.startPosition.row + 1,
      visibility: kind.endsWith('p') ? 'private' : 'public', entry: false })
  }
  if (kind === 'defdelegate') {
    const to = moduleName(keywords(node).get('to'), scope)
    if (to) result.calls.push({ source: id, module: to, name: keywords(node).get('as')?.text.replace(/^:/, '') ?? signature.name,
      arity: signature.arity, line: node.startPosition.row + 1, position: node.startIndex, dynamic: false })
    return
  }
  for (const statement of blockStatements(doBlock(node))) collectCalls(statement, id, scope, result.calls)
}

function addModule(node: Node, scope: Scope, result: ElixirSource): void {
  const alias = positional(node)[0]
  if (alias?.type !== 'alias') return
  const module = scope.module ? `${scope.module}.${alias.text}` : expand(alias.text, scope)
  const aliases = new Map(scope.aliases)
  if (scope.module) aliases.set(alias.text.split('.')[0]!, `${scope.module}.${alias.text.split('.')[0]}`)
  const members: CodeSymbol[] = []
  result.modules.push(module)
  result.symbols.push({ id: `${result.file}:${node.startIndex}`, name: module, kind: 'module' })
  // Nested modules are nested types: their functions remain operations but not outline members.
  visitBlock(doBlock(node), { module, aliases, members: scope.module ? undefined : members }, result)
  if (!scope.module) {
    result.declarations.push({ kind: 'type', name: module, line: alias.startPosition.row + 1, visibility: 'public',
      entry: false, members })
  }
}

function visitBlock(block: Node | undefined, scope: Scope, result: ElixirSource): void {
  for (const statement of blockStatements(block)) {
    const kind = callName(statement)
    if (kind === 'defmodule') addModule(statement, scope, result)
    else if (kind === 'alias') addAlias(statement, scope)
    else if (kind && definitionKinds.has(kind)) addDefinition(statement, kind, scope, result)
  }
}

export function analyzeElixir(root: Node, file: string): ElixirSource {
  const result: ElixirSource = { file, modules: [], symbols: [], declarations: [], operations: [], arities: new Map(), calls: [] }
  for (const statement of root.namedChildren) {
    if (statement && callName(statement) === 'defmodule') addModule(statement, { module: '', aliases: new Map() }, result)
  }
  return result
}

export function markEntries(declarations: CodeDeclaration[], entries: readonly string[]): CodeDeclaration[] {
  return declarations.map(declaration => declaration.kind !== 'type' ? declaration : {
    ...declaration,
    entry: entries.includes(declaration.name),
    members: declaration.members.map(member => ({ ...member,
      entry: entries.some(entry => entry.startsWith(`${declaration.name}.${member.name}/`)) })),
  })
}
