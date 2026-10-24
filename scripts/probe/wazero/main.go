// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// The D4 probe's wazero executor (scripts/probe/portability.ts runs it; owner, 2026-10-24: the
// harness is committed). wazero is a Go library, so measuring it takes a Go program: this one runs
// every module in <dir>/index.json, compiler or interpreter, and prints one JSON line per module:
// {"file","s":ok|trap|refused|error,"v"?,"m"?}. The wazero version is go.mod's pin (loader-go's).
//
//	go run . <dir> compiler|interpreter
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
	"github.com/tetratelabs/wazero/experimental"
)

type entry struct {
	File string `json:"file"`
}

type result struct {
	File string `json:"file"`
	S    string `json:"s"`
	V    string `json:"v,omitempty"`
	M    string `json:"m,omitempty"`
}

func main() {
	dir, mode := os.Args[1], os.Args[2]
	raw, err := os.ReadFile(filepath.Join(dir, "index.json"))
	if err != nil {
		panic(err)
	}
	var index []entry
	if err := json.Unmarshal(raw, &index); err != nil {
		panic(err)
	}
	// Every proposal wazero offers: a runtime is measured at its maximum, as its embedder would
	// configure it.
	features := api.CoreFeaturesV2 | experimental.CoreFeaturesThreads | experimental.CoreFeaturesTailCall |
		experimental.CoreFeaturesExtendedConst | experimental.CoreFeaturesExceptionHandling |
		experimental.CoreFeaturesTypedFunctionReferences
	out := json.NewEncoder(os.Stdout)
	for _, e := range index {
		out.Encode(run(dir, mode, features, e.File))
	}
}

func run(dir, mode string, features api.CoreFeatures, file string) (r result) {
	r.File = file
	defer func() {
		if p := recover(); p != nil {
			r = result{File: file, S: "error", M: fmt.Sprint("panic: ", p)}
		}
	}()
	ctx := context.Background()
	cfg := wazero.NewRuntimeConfigCompiler()
	if mode == "interpreter" {
		cfg = wazero.NewRuntimeConfigInterpreter()
	}
	rt := wazero.NewRuntimeWithConfig(ctx, cfg.WithCoreFeatures(features))
	defer rt.Close(ctx)
	bytes, err := os.ReadFile(filepath.Join(dir, "wasm", file))
	if err != nil {
		return result{File: file, S: "error", M: err.Error()}
	}
	mod, err := rt.Instantiate(ctx, bytes)
	if err != nil {
		return result{File: file, S: "refused", M: oneLine(err)}
	}
	res, err := mod.ExportedFunction("t").Call(ctx)
	if err != nil {
		return result{File: file, S: "trap", M: oneLine(err)}
	}
	return result{File: file, S: "ok", V: fmt.Sprintf("%x", res[0])}
}

func oneLine(err error) string {
	return strings.Join(strings.Fields(err.Error()), " ")
}
