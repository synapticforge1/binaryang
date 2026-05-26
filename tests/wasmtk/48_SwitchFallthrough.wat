(module
  (import "wasi_snapshot_preview1" "proc_exit" (func $proc_exit (param i32)))
  (import "wasi_snapshot_preview1" "fd_write" (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (memory (export "memory") 2)
  (global $__heap_ptr (mut i32) (i32.const 309))
  ;; Bump allocator — advances __heap_ptr and returns the old value
  (func $__malloc (param $size i32) (result i32)
    (local $ptr i32)
    (local.set $ptr (global.get $__heap_ptr))
    (global.set $__heap_ptr (i32.add (local.get $ptr) (local.get $size)))
    (local.get $ptr)
  )
  ;; Canonical ABI allocator — fresh allocation (ptr==0) delegates to $__malloc;
  ;; realloc requests (ptr!=0) return ptr unchanged (bump allocator has no free).
  (func $cabi_realloc (param $ptr i32) (param $old_size i32) (param $align i32) (param $new_size i32) (result i32)
    (select
      (call $__malloc (local.get $new_size))
      (local.get $ptr)
      (i32.eqz (local.get $ptr))
    )
  )
  (func $test (param $x i32) 
    (local $__iface_tmp i32)
    (block $switch_exit_0
      (block $case_default_0
        (block $case_0_3
          (block $case_0_2
            (block $case_0_1
              (block $case_0_0
                (br_if $case_0_0 (i32.eq (local.get $x) (i32.const 1)))
                (br_if $case_0_1 (i32.eq (local.get $x) (i32.const 2)))
                (br_if $case_0_2 (i32.eq (local.get $x) (i32.const 3)))
                (br_if $case_0_3 (i32.eq (local.get $x) (i32.const 4)))
                (br $case_default_0)
              )
            )
                  (i32.store (i32.const 0) (i32.const 260))
          (i32.store (i32.const 4) (i32.const 11))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
              (br $switch_exit_0)
          )
                (i32.store (i32.const 0) (i32.const 271))
          (i32.store (i32.const 4) (i32.const 6))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        )
              (i32.store (i32.const 0) (i32.const 277))
          (i32.store (i32.const 4) (i32.const 14))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
          (br $switch_exit_0)
      )
            (i32.store (i32.const 0) (i32.const 291))
          (i32.store (i32.const 4) (i32.const 6))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
    )
  )

  (func $testDefault (param $x i32) 
    (local $__iface_tmp i32)
    (block $switch_exit_1
      (block $case_default_1
        (block $case_1_0
          (br_if $case_1_0 (i32.eq (local.get $x) (i32.const 10)))
          (br $case_default_1)
        )
              (i32.store (i32.const 0) (i32.const 297))
          (i32.store (i32.const 4) (i32.const 4))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
          (br $switch_exit_1)
      )
            (i32.store (i32.const 0) (i32.const 301))
          (i32.store (i32.const 4) (i32.const 8))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
    )
  )

  (func $main  
    (call $test (i32.const 1))
    (call $test (i32.const 2))
    (call $test (i32.const 3))
    (call $test (i32.const 4))
    (call $test (i32.const 5))
    (call $testDefault (i32.const 10))
    (call $testDefault (i32.const 99))
  )
  (func $_start (export "_start")
    (call $main)
    (call $proc_exit (i32.const 0))
  )
  (data (i32.const 260) "\6f\6e\65\20\6f\72\20\74\77\6f\0a")
  (data (i32.const 271) "\74\68\72\65\65\0a")
  (data (i32.const 277) "\74\68\72\65\65\20\6f\72\20\66\6f\75\72\0a")
  (data (i32.const 291) "\6f\74\68\65\72\0a")
  (data (i32.const 297) "\74\65\6e\0a")
  (data (i32.const 301) "\6e\6f\74\20\74\65\6e\0a")
)