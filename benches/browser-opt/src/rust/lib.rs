// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The browser-optimization workload (open-work 28.6), Rust version. The same algorithm is in
// ../zig/run.zig and ../tinygo/main.go: a Mandelbrot grid (floating point) and a sort of
// pseudo-random numbers (integer work, memory), folded into one checksum. The checksum is how the
// measurement proves an optimized module still computes what the original did.

const MAX_ITER: u32 = 64;

fn mandelbrot(n: i32) -> u32 {
    let mut total: u32 = 0;
    let size = n as f64;
    for y in 0..n {
        for x in 0..n {
            let cr = (x as f64) * 3.0 / size - 2.0;
            let ci = (y as f64) * 2.0 / size - 1.0;
            let (mut zr, mut zi) = (0.0f64, 0.0f64);
            let mut i: u32 = 0;
            while i < MAX_ITER && zr * zr + zi * zi < 4.0 {
                let t = zr * zr - zi * zi + cr;
                zi = 2.0 * zr * zi + ci;
                zr = t;
                i += 1;
            }
            total = total.wrapping_mul(31).wrapping_add(i);
        }
    }
    total
}

fn sorted_checksum(n: i32) -> u32 {
    let count = (n as usize) * 64;
    let mut seed: u32 = 12345;
    let mut v: Vec<u32> = Vec::with_capacity(count);
    for _ in 0..count {
        seed = seed.wrapping_mul(1103515245).wrapping_add(12345);
        v.push(seed >> 8);
    }
    v.sort_unstable();
    let mut h: u32 = 2166136261;
    for x in v.iter().step_by(7) {
        h = (h ^ x).wrapping_mul(16777619);
    }
    h
}

#[no_mangle]
pub extern "C" fn run(n: i32) -> i32 {
    (mandelbrot(n) ^ sorted_checksum(n)) as i32
}
