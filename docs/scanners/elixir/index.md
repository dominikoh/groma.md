# Elixir scanner

The experimental `@groma/scanner-elixir` plugin uses
[tree-sitter-elixir 0.3.5](https://github.com/elixir-lang/tree-sitter-elixir) with web-tree-sitter 0.27.1.
The package carries its WebAssembly parser. Scanning needs no Elixir, Erlang or Mix installation, no
dependency fetch and no build, and it never evaluates application or project code.

## Install and scan

Build a local package from the Groma repository:

```sh
bun plugins/scanners/elixir/build.ts /tmp/elixir-scanner
```

Then add it to the consumer repository:

```sh
groma plugin add /tmp/elixir-scanner
groma scan
```

## Inputs and project membership

The manifest selects `**/*.ex` and `**/mix.exs`. Default exclusions omit `deps/`, `_build/`, `cover/`,
`test/`, `priv/` and `.elixir_ls/`.

Every selected `mix.exs` declares a project at its directory, named by the literal `app:` in `project/0`.
A project compiles the `.ex` files under its source paths: a literal `elixirc_paths:` list, or the union of
the literal lists a private `elixirc_paths/1` returns, else `lib`. Nested projects keep parent links.
`.exs` scripts other than `mix.exs` are not source.

## Execution entries

`mod: {Module, args}` in `application/0` and `escript: [main_module: Module]` in `project/0` name the
module that starts the project. The file that defines that module is the entry, and the entry's unit is
every file the project compiles.

## Declarations and calls

Each top-level `defmodule` is a type in the source outline; its `def`, `defp`, `defmacro`, `defmacrop` and
`defdelegate` heads are members (`defp`/`defmacrop` private). Multi-clause functions are one operation per
name and arity; default arguments make the function answer every arity in its range. Nested modules keep
their functions as operations but are not outline members.

A call resolves only to a function this scan declares with a matching arity: a local call to the
enclosing module, a remote call through a literal alias (`alias A.B`, `alias A.{B, C}`,
`alias A.B, as: C`, `__MODULE__`), a pipe adding one argument, and `defdelegate ... to:`. Imports,
`use`/`__using__` injection, macros, dynamic dispatch, behaviours and anonymous function captures stay
unresolved. No HTTP evidence is reported yet; Phoenix routes are a follow-up.
