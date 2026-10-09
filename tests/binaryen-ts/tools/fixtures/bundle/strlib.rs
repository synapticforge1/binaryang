#![no_std]
#![no_main]

static GREETING: &[u8] = b"hello from strlib";
static TABLE: [i32; 4] = [10, 20, 30, 40];
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
pub extern "C" fn bump() -> i32 {
    unsafe {
        COUNTER += 1;
        COUNTER
    }
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    loop {}
}
