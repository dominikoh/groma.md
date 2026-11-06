import type { Node } from 'web-tree-sitter'

export const definitionKinds = new Set(['def', 'defp', 'defmacro', 'defmacrop', 'defdelegate'])

/** Special forms and Kernel macros that read like local calls but never name a module function. */
export const specialForms = new Set([
  'alias', 'import', 'require', 'use', 'quote', 'unquote', 'unquote_splicing', 'if', 'unless', 'case', 'cond', 'with',
  'for', 'try', 'receive', 'raise', 'reraise', 'throw', 'super', 'fn', 'defstruct', 'defexception', 'defimpl',
  'defprotocol', 'defoverridable', 'defguard', 'defguardp', '__MODULE__', '__ENV__', '__CALLER__', '__DIR__',
  '__STACKTRACE__', 'binding', 'is_nil', 'not', 'and', 'or', 'in',
])

export function target(node: Node): Node | null {
  return node.childForFieldName('target')
}

export function callName(node: Node): string | undefined {
  if (node.type !== 'call') return undefined
  const name = target(node)
  return name?.type === 'identifier' ? name.text : undefined
}

export function argumentsOf(node: Node): Node[] {
  return node.namedChildren.find(child => child?.type === 'arguments')?.namedChildren.filter(child => !!child) as Node[] ?? []
}

export function positional(node: Node): Node[] {
  return argumentsOf(node).filter(child => child.type !== 'keywords')
}

/** Keyword pairs of a call's trailing keyword list, such as `do:` or `as:`. */
export function keywords(node: Node): Map<string, Node> {
  const result = new Map<string, Node>()
  const list = argumentsOf(node).find(child => child.type === 'keywords')
  for (const pair of list?.namedChildren ?? []) pairInto(pair, result)
  return result
}

export function pairInto(pair: Node | null, result: Map<string, Node>): void {
  const key = pair?.childForFieldName('key')?.text.replace(/:\s*$/, '')
  const value = pair?.childForFieldName('value')
  if (key && value) result.set(key, value)
}

/** Keyword pairs of a literal keyword list `[app: :demo, ...]`. */
export function listKeywords(node: Node | null | undefined): Map<string, Node> {
  const result = new Map<string, Node>()
  for (const child of node?.namedChildren ?? []) {
    if (child?.type === 'keywords') for (const pair of child.namedChildren) pairInto(pair, result)
  }
  return result
}

export function doBlock(node: Node): Node | undefined {
  return node.namedChildren.find(child => child?.type === 'do_block') ?? keywords(node).get('do')
}

export function blockStatements(node: Node | undefined): Node[] {
  if (!node) return []
  if (node.type !== 'do_block') return [node]
  return node.namedChildren.filter(child => !!child && !['else_block', 'rescue_block', 'catch_block', 'after_block'].includes(child.type)) as Node[]
}

export function stringLiteral(node: Node | null | undefined): string | undefined {
  if (node?.type !== 'string' || node.namedChildren.some(child => child?.type === 'interpolation')) return undefined
  return node.namedChildren.filter(child => child?.type === 'quoted_content').map(child => child!.text).join('')
}

export function stringList(node: Node | null | undefined): string[] | undefined {
  if (node?.type !== 'list') return undefined
  const values = node.namedChildren.map(stringLiteral)
  return values.every(value => value !== undefined) ? values as string[] : undefined
}

export function atomName(node: Node | null | undefined): string | undefined {
  return node?.type === 'atom' ? node.text.replace(/^:/, '') : undefined
}
