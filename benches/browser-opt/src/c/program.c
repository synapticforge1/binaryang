// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The workload as a PROGRAM, for Emscripten's own JavaScript glue (open-work 32). It first GROWS
// the heap (64 MiB on a 16 MiB start, built with -sALLOW_MEMORY_GROWTH), so the glue's growth path
// runs too, then prints run(300) and a byte of the grown region: "1892226719 7". The glue loads
// the .wasm beside it, so swapping in a lowered one tests the unchanged glue.

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int32_t run(int32_t n);

int main(void) {
  size_t big = 64u << 20;
  unsigned char *p = malloc(big);
  if (p == NULL) {
    printf("malloc failed\n");
    return 1;
  }
  memset(p, 7, big);
  printf("%u %u\n", (uint32_t)run(300), (unsigned)p[big - 1]);
  free(p);
  return 0;
}
