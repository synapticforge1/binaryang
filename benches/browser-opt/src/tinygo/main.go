// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The browser-optimization workload (open-work 28.6), TinyGo version: the same algorithm as
// ../rust/lib.rs and ../zig/run.zig (a Mandelbrot grid and a sort of pseudo-random numbers,
// folded into one checksum).

package main

import "sort"

const maxIter = 64

func mandelbrot(n int32) uint32 {
	var total uint32
	size := float64(n)
	for y := int32(0); y < n; y++ {
		for x := int32(0); x < n; x++ {
			cr := float64(x)*3.0/size - 2.0
			ci := float64(y)*2.0/size - 1.0
			zr, zi := 0.0, 0.0
			var i uint32
			for i < maxIter && zr*zr+zi*zi < 4.0 {
				t := zr*zr - zi*zi + cr
				zi = 2.0*zr*zi + ci
				zr = t
				i++
			}
			total = total*31 + i
		}
	}
	return total
}

func sortedChecksum(n int32) uint32 {
	count := int(n) * 64
	seed := uint32(12345)
	v := make([]uint32, count)
	for k := range v {
		seed = seed*1103515245 + 12345
		v[k] = seed >> 8
	}
	sort.Slice(v, func(a, b int) bool { return v[a] < v[b] })
	h := uint32(2166136261)
	for k := 0; k < len(v); k += 7 {
		h = (h ^ v[k]) * 16777619
	}
	return h
}

//export run
func run(n int32) int32 {
	return int32(mandelbrot(n) ^ sortedChecksum(n))
}

func main() {}
