// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The browser-optimization workload (open-work 28.6), Zig version: the same algorithm as
// ../rust/lib.rs and ../tinygo/main.go (a Mandelbrot grid and a sort of pseudo-random numbers,
// folded into one checksum).

const std = @import("std");

const max_iter: u32 = 64;

fn mandelbrot(n: i32) u32 {
    var total: u32 = 0;
    const size: f64 = @floatFromInt(n);
    var y: i32 = 0;
    while (y < n) : (y += 1) {
        var x: i32 = 0;
        while (x < n) : (x += 1) {
            const cr = @as(f64, @floatFromInt(x)) * 3.0 / size - 2.0;
            const ci = @as(f64, @floatFromInt(y)) * 2.0 / size - 1.0;
            var zr: f64 = 0.0;
            var zi: f64 = 0.0;
            var i: u32 = 0;
            while (i < max_iter and zr * zr + zi * zi < 4.0) : (i += 1) {
                const t = zr * zr - zi * zi + cr;
                zi = 2.0 * zr * zi + ci;
                zr = t;
            }
            total = total *% 31 +% i;
        }
    }
    return total;
}

fn sortedChecksum(n: i32) u32 {
    const count: usize = @as(usize, @intCast(n)) * 64;
    const allocator = std.heap.wasm_allocator;
    const v = allocator.alloc(u32, count) catch return 0;
    defer allocator.free(v);
    var seed: u32 = 12345;
    for (v) |*slot| {
        seed = seed *% 1103515245 +% 12345;
        slot.* = seed >> 8;
    }
    std.mem.sort(u32, v, {}, std.sort.asc(u32));
    var h: u32 = 2166136261;
    var i: usize = 0;
    while (i < v.len) : (i += 7) {
        h = (h ^ v[i]) *% 16777619;
    }
    return h;
}

export fn run(n: i32) i32 {
    return @bitCast(mandelbrot(n) ^ sortedChecksum(n));
}
