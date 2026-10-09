// A WASI program with static data, built as `wasm32-wasip1` with
// `-C link-arg=--emit-relocs` so its linked binary keeps `linking` + `reloc.*`.
static GREETING: &[u8] = b"hello from strlib\n";
static TABLE: [i32; 4] = [10, 20, 30, 40];
static NAMES: [&[u8]; 2] = [b"alpha", b"beta"];
static mut COUNTER: i32 = 0;

#[no_mangle]
pub extern "C" fn greeting_ptr() -> *const u8 {
    GREETING.as_ptr()
}

#[no_mangle]
pub extern "C" fn greeting_len() -> usize {
    GREETING.len()
}

#[no_mangle]
pub extern "C" fn table_at(i: usize) -> i32 {
    TABLE[i & 3]
}

#[no_mangle]
pub extern "C" fn name_ptr(i: usize) -> *const u8 {
    NAMES[i & 1].as_ptr()
}

#[no_mangle]
pub extern "C" fn name_len(i: usize) -> usize {
    NAMES[i & 1].len()
}

#[no_mangle]
pub extern "C" fn bump() -> i32 {
    unsafe {
        COUNTER += 1;
        COUNTER
    }
}

fn main() {
    let s = unsafe { std::str::from_utf8_unchecked(GREETING) };
    print!("{}", s);
}
