// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The browser-optimization workload, C version (open-work 32: Emscripten's memory64 output): the
// same algorithm as ../zig/run.zig (a Mandelbrot grid and a sort of pseudo-random numbers, folded
// into one checksum). Any correct ascending sort gives the same sorted array, so qsort reproduces
// Zig's checksum: run(300) = 1892226719, checked on a 32-bit build before the 64-bit ones.

#include <emscripten.h>
#include <stdint.h>
#include <stdlib.h>

#define MAX_ITER 64u

static uint32_t mandelbrot(int32_t n) {
  uint32_t total = 0;
  double size = (double)n;
  for (int32_t y = 0; y < n; y++) {
    for (int32_t x = 0; x < n; x++) {
      double cr = (double)x * 3.0 / size - 2.0;
      double ci = (double)y * 2.0 / size - 1.0;
      double zr = 0.0, zi = 0.0;
      uint32_t i = 0;
      while (i < MAX_ITER && zr * zr + zi * zi < 4.0) {
        double t = zr * zr - zi * zi + cr;
        zi = 2.0 * zr * zi + ci;
        zr = t;
        i++;
      }
      total = total * 31u + i;
    }
  }
  return total;
}

static int asc(const void *a, const void *b) {
  uint32_t x = *(const uint32_t *)a, y = *(const uint32_t *)b;
  return x < y ? -1 : x > y ? 1 : 0;
}

static uint32_t sorted_checksum(int32_t n) {
  size_t count = (size_t)n * 64;
  uint32_t *v = malloc(count * sizeof(uint32_t));
  if (v == NULL) return 0;
  uint32_t seed = 12345;
  for (size_t k = 0; k < count; k++) {
    seed = seed * 1103515245u + 12345u;
    v[k] = seed >> 8;
  }
  qsort(v, count, sizeof(uint32_t), asc);
  uint32_t h = 2166136261u;
  for (size_t i = 0; i < count; i += 7) h = (h ^ v[i]) * 16777619u;
  free(v);
  return h;
}

EMSCRIPTEN_KEEPALIVE int32_t run(int32_t n) {
  return (int32_t)(mandelbrot(n) ^ sorted_checksum(n));
}
