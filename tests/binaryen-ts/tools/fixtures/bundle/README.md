# `wasm-bundle` fixtures — linked modules that keep their relocations

Real producer output, so the bundler is tested against what `wasm-ld --emit-relocs` writes, not
against our own assembler alone. Each binary sits beside its source; the commands that made them
(2026-10-08, this machine) are below. Rebuild only to change a fixture; the tests pin behaviour,
not bytes.

| binary             | source        | producer                                                     |
| ------------------ | ------------- | ------------------------------------------------------------ |
| `strbin_rust.wasm` | `strbin.rs`   | rustc (`wasm32-wasip1`, std): a WASI program with `_start`   |
| `strlib_rust.wasm` | `strlib.rs`   | rustc (`wasm32-wasip1`, `no_std` cdylib): `__memory_base`    |
| `mathlib_zig.wasm` | `mathlib.zig` | zig 0.16 `build-obj` + `zig wasm-ld --emit-relocs`           |

```
rustc --target wasm32-wasip1 -C opt-level=z -C debuginfo=0 -C panic=abort -C lto=fat
      -C link-arg=--emit-relocs -C link-arg=--strip-debug
      -C link-arg=--export=greeting_ptr -C link-arg=--export=greeting_len
      -C link-arg=--export=table_at -C link-arg=--export=name_ptr
      -C link-arg=--export=name_len -C link-arg=--export=bump
      strbin.rs -o strbin_rust.wasm

rustc --target wasm32-wasip1 --crate-type=cdylib -O -C panic=abort -C link-arg=--emit-relocs
      strlib.rs -o strlib_rust.wasm

zig build-obj -target wasm32-freestanding -O ReleaseSmall mathlib.zig
zig wasm-ld --emit-relocs --no-entry --export=square_at --export=label_ptr --export=label_len
            --export=call_count mathlib.o -o mathlib_zig.wasm
```

What each carries (`wasm-objdump -x -j linking`, `-j reloc.CODE`, `-j reloc.DATA`):

- `strbin_rust.wasm`: 1049 code entries of eight types (`MEMORY_ADDR_LEB` on load/store offsets,
  `MEMORY_ADDR_SLEB` on `i32.const`, two `MEMORY_ADDR_REL_SLEB` against `__memory_base`, the index
  kinds), 110 data entries (`MEMORY_ADDR_I32` pointer words, `TABLE_INDEX_I32` slots), absolute
  symbols `__heap_base` / `__heap_end`, `__stack_pointer` at 1048576, 17 pages, four WASI imports.
- `strlib_rust.wasm`: `__memory_base`-relative addressing beside absolute, `_initialize`, no imports.
- `mathlib_zig.wasm`: five code entries, two segments, `__stack_pointer`, no imports.
