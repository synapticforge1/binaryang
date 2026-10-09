/**
 * @module
 * binaryang — the merged WebAssembly toolchain: a TypeScript port of Binaryen
 * and of WABT in one package, replacing `@jrmarcum/binaryen-ts` and
 * `@jrmarcum/wabt-ts`.
 *
 * The package ROOT is `main.ts` since 1.6.1 — the CLI — and re-exports this
 * module, so what is below still describes the root's library surface.
 *
 * ## This root is deliberately narrow, and starts empty
 *
 * The source is ONE tree by concept since open-work 21 (2026-10-09), around
 * ONE IR. But that IR is still reached through two sets of names — binaryen-ts's
 * view (`Expression`, `WasmModule`, …) and wabt-ts's (`Expr`, `Module`, …) —
 * and **88 exported type names are declared in more than one file**
 * (`deno task collisions`: `Type`, `ValueType`, `Token`, and the expression
 * nodes). A root barrel would surface both declarations of each at one
 * specifier.
 *
 * So the root carries nothing yet. That is the accurate state rather than an
 * oversight: names arrive here as they converge to one declaration each, and
 * the narrow root and the collision count are the same measurement from two
 * directions.
 *
 * ## Where the surface actually is
 *
 * | subpath | what |
 * | ------- | ---- |
 * | `./ir/binaryen-ts`, `./ir/wabt-ts` | the two IRs, each explicitly named |
 * | `./compat/binaryen`, `./compat/wabt` | the two upstream API shapes |
 * | `./wat2wasm`, `./wasm2wat`, `./wasm-validate`, … | the WABT tools |
 * | `./passes`, `./api`, `./wasm` | the Binaryen side (`./encoder` and `./binary` went at 1.6.0, `./interop` at 1.7.0) |
 *
 * There is deliberately **no `./ir`**. While the IR has two sets of names it
 * would read as "the IR" while meaning one of them, and an alias would resolve
 * to one of the two silently — worse than the import error a missing subpath
 * gives you.
 *
 * @license MIT
 */

export {};
