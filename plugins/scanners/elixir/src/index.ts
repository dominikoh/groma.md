import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  createScanObservation, type CodeFile, type ScanEntryPoint, type ScanInvocation, type ScannerPlugin,
} from '@groma/scanner'
import { elixirLanguage, parseElixir } from './parser.ts'
import { compiled, elixirRoots, mixProject, type MixProject } from './projects.ts'
import { analyzeElixir, markEntries, type ElixirSource } from './source.ts'

const isMix = (file: string) => path.posix.basename(file) === 'mix.exs'

async function readProjects(root: string, files: readonly string[]): Promise<MixProject[]> {
  const projects = []
  for (const file of [...files].filter(isMix).sort()) {
    projects.push(await parseElixir(file, await readFile(path.join(root, file), 'utf8'), node => mixProject(node, file)))
  }
  return projects
}

async function sourceFiles(root: string, candidates: readonly string[]): Promise<string[]> {
  const projects = await readProjects(root, candidates)
  return [...new Set(candidates.filter(file => compiled(file, projects)))].sort()
}

async function readSource(root: string, file: string): Promise<ElixirSource> {
  return parseElixir(file, await readFile(path.join(root, file), 'utf8'), node => analyzeElixir(node, file))
}

/** Calls resolve only to a module function this scan declares with a matching arity; the rest stay unresolved. */
function invocations(sources: readonly ElixirSource[]): ScanInvocation[] {
  const arities = new Map(sources.flatMap(source => [...source.arities]))
  const owners = new Map(sources.flatMap(source => source.operations.map(operation =>
    [operation.id, operation.name.slice(0, operation.name.lastIndexOf('.', operation.name.lastIndexOf('/')))] as const)))
  return sources.flatMap(source => source.calls.map(call => {
    const module = call.module ?? owners.get(call.source)
    const resolved = call.dynamic ? undefined : arities.get(`${module}.${call.name}/${call.arity}`)
    return { source: call.source, targets: resolved ? [resolved] : [], unresolved: !resolved,
      line: call.line, position: call.position, member: call.name }
  }))
}

/** An OTP application callback module or an escript main module starts the project's compiled source. */
function entryPoints(projects: readonly MixProject[], sources: readonly ElixirSource[],
  memberships: Map<string, string>): ScanEntryPoint[] {
  const definedIn = new Map(sources.flatMap(source => source.modules.map(module => [module, source.file] as const)))
  return projects.flatMap(project => {
    const files = sources.map(source => source.file).filter(file => memberships.get(file) === project.directory)
    return [[project.applicationModule, 'application'], [project.escriptModule, 'escript']].flatMap(([module, kind]) => {
      const file = module ? definedIn.get(module) : undefined
      if (!file || memberships.get(file) !== project.directory) return []
      return [{ file, declaration: project.file, name: kind === 'application' ? (project.app ?? module!) : `${project.app ?? module} escript`, files }]
    })
  })
}

export default {
  id: 'elixir',
  listSourceFiles: async (root, _settings, candidates) => sourceFiles(root, candidates),
  async checkReadiness(root, _settings, files) {
    if (!(await sourceFiles(root, files)).length) throw new Error('elixir: No selected Elixir source files were found.')
    await elixirLanguage()
  },
  async scan(root, _settings, selected) {
    const files = await sourceFiles(root, selected)
    if (!files.length) return undefined
    const projects = await readProjects(root, selected)
    const sources: ElixirSource[] = []
    for (const file of files) sources.push(await readSource(root, file))
    const { roots, memberships } = elixirRoots(root, projects, files)
    return createScanObservation({
      scanner: { id: 'elixir', technology: 'elixir', engine: 'tree-sitter-elixir', engineVersion: '0.3.5' },
      roots,
      files: sources.map(({ file, symbols }) => ({ file, roots: [memberships.get(file)!], symbols })),
      entryPoints: entryPoints(projects, sources, memberships),
      operations: sources.flatMap(source => source.operations),
      invocations: invocations(sources),
      diagnostics: [{ severity: 'info', code: 'ELIXIR_SOURCE_SCOPE',
        message: 'Elixir syntax evidence only. Calls resolve through literal aliases to functions this scan declares with a matching arity; imports, use/__using__ injection, macros, dynamic dispatch and behaviours remain unresolved. Mix projects are read without evaluating the DSL.' }],
    })
  },
  async readCodeStructure(root, references): Promise<CodeFile[]> {
    const result = []
    for (const reference of references) {
      if (!reference.file.endsWith('.ex')) continue
      const { declarations } = await readSource(root, reference.file)
      if (declarations.length) result.push({ file: reference.file, declarations: markEntries(declarations, reference.symbols) })
    }
    return result
  },
} satisfies ScannerPlugin
