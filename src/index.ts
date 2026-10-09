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
 * The source is ONE tree by concept, around ONE IR, reached through ONE
 * subpath, `./ir` (open-work 21, 2026-10-09). The root stays empty: the package
 * root is the CLI (`main.ts`), and the libraries are named subpaths, so an
 * import says which part of the toolchain it wants.
 *
 * ## Where the surface actually is
 *
 * | subpath | what |
 * | ------- | ---- |
 * | `./ir` | the IR under both sets of names, its builder and factories, and the result vocabulary (`./ir/binaryen-ts`, `./ir/wabt-ts`, `./core/wabt-ts`: deprecated aliases since 1.11.0) |
 * | `./compat/binaryen`, `./compat/wabt` | the two upstream API shapes |
 * | `./wat2wasm`, `./wasm2wat`, `./wasm-validate`, … | the WABT tools |
 * | `./passes`, `./api`, `./wasm` | the Binaryen side (`./encoder` and `./binary` went at 1.6.0, `./interop` at 1.7.0) |
 *
 * In `./ir`, `Type` is the value-type enum (`Type.I32`) and the type a node's
 * `type` field holds is `ExprType` — binaryen-ts's `Type`, under the IR's name.
 *
 * @license MIT
 */

export {};
