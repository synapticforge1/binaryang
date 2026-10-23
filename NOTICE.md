# NOTICE

## License

binaryang is dual-licensed under either:

- **MIT License** — see [LICENSE-MIT](LICENSE-MIT) for the full text.
- **Apache License, Version 2.0** — see [LICENSE-APACHE](LICENSE-APACHE) for the full text.

at your option.

binaryang is a TypeScript port of two Apache-2.0 projects, WebAssembly/wabt and
WebAssembly/binaryen. The Apache 2.0 license is included to satisfy their redistribution
requirements. Attribution notices for the derived portions are retained below and in each
derived source file, as their license requires.

## Attribution — WebAssembly/wabt

binaryang is in part a derivative work of [WebAssembly/wabt](https://github.com/WebAssembly/wabt).

```text
Copyright 2016 WebAssembly Community Group participants

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

Each source file ported from wabt carries an attribution comment —
`// Ported from WebAssembly/wabt` — naming the originating wabt source file and its copyright
notice.

## Attribution — WebAssembly/binaryen

binaryang is in part a derivative work of
[WebAssembly/binaryen](https://github.com/WebAssembly/binaryen).

```text
Copyright 2015-2024 WebAssembly Community Group participants

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

Each source file derived from Binaryen carries an attribution comment naming the originating
Binaryen source files and their copyright years: `// Ported from WebAssembly/binaryen` where the
file is a port, `// Based on WebAssembly/binaryen` where it was written against a named upstream
source.

## Original Contributions

The `wasm2ts` module and all other additions with no upstream counterpart are original work:

```text
Copyright (c) 2026 Jon Marcum
Licensed under the MIT License
```
