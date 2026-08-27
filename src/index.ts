/**
 * @module
 * binaryang — the merged WebAssembly toolchain: a TypeScript port of Binaryen
 * and of WABT in one package, replacing `@jrmarcum/binaryen-ts` and
 * `@jrmarcum/wabt-ts`.
 *
 * ## This root is deliberately narrow, and starts empty
 *
 * Two IRs are retained on purpose — they do different jobs, and wabt's
 * round-trip fidelity is load-bearing. **56 exported type names currently
 * collide across the two trees** (`Type`, `ValueType`, `WasmModule`, `Token`,
 * and ~52 expression nodes). A root barrel spanning both would surface all of
 * them at one specifier.
 *
 * So the root carries only what is genuinely shared by both halves, and today
 * that is nothing. That is the accurate state rather than an oversight: it is
 * what "two IRs are retained" means at the export surface. Modules arrive here
 * as convergence makes them genuinely common — a module earns promotion when
 * nothing in either namespaced tree still imports it from the other side.
 *
 * This makes the root the visible scoreboard of convergence: the narrow root
 * and the 56-collision count are the same measurement from two directions. A
 * root still empty in a year is an accurate report, not a broken export map.
 *
 * ## Where the surface actually is
 *
 * | subpath | what |
 * | ------- | ---- |
 * | `./ir/binaryen-ts`, `./ir/wabt-ts` | the two IRs, each explicitly named |
 * | `./compat/binaryen`, `./compat/wabt` | the two upstream API shapes |
 * | `./wat2wasm`, `./wasm2wat`, `./wasm-validate`, … | the WABT tools |
 * | `./encoder`, `./binary`, `./passes`, `./api`, `./wasm` | the Binaryen side |
 *
 * There is deliberately **no `./ir`**. With both IRs retained it would read as
 * "the IR" while meaning one of them, and an alias would resolve to one of the
 * two silently — worse than the import error a missing subpath gives you.
 *
 * @license MIT
 */

export {};
