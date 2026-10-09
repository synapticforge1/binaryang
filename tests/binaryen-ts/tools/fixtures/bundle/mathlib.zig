// A Zig library with a static table and a string, built as an object and
// linked by `zig wasm-ld --emit-relocs` so the binary keeps `linking` + `reloc.*`.
const squares = [_]i32{ 1, 4, 9, 16, 25 };
const label: [*:0]const u8 = "zig says hi";
var calls: i32 = 0;

export fn square_at(i: u32) i32 {
    calls += 1;
    return squares[i % squares.len];
}

export fn label_ptr() [*:0]const u8 {
    return label;
}

export fn label_len() u32 {
    var n: u32 = 0;
    while (label[n] != 0) : (n += 1) {}
    return n;
}

export fn call_count() i32 {
    return calls;
}
