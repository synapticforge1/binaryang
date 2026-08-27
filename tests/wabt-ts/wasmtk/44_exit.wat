(module
  (import "wasi_snapshot_preview1" "proc_exit" (func $proc_exit (param i32)))
  (import "wasi_snapshot_preview1" "fd_write" (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (memory (export "memory") 2)
  (global $__heap_ptr (mut i32) (i32.const 276))
  (global $__d4s (mut i32) (i32.const 0))
  (global $__free_list (mut i32) (i32.const 0))
  (global $deferred (mut i32) (i32.const 0))
  (type $ftype_i32_r_void (func (param i32)))
  ;; Free-list + bump allocator (auto-grows). GC Part 1+2.
  (func $__malloc (param $size i32) (result i32)
    (local $ptr i32)
    (local $cur i32)
    (local $prev i32)
    (local.set $cur (global.get $__free_list))
    (local.set $prev (i32.const 0))
    (block $done
      (loop $scan
        (br_if $done (i32.eqz (local.get $cur)))
        (if (i32.ge_u (i32.load (local.get $cur)) (local.get $size))
          (then
            (if (i32.eqz (local.get $prev))
              (then (global.set $__free_list (i32.load offset=4 (local.get $cur))))
              (else (i32.store offset=4 (local.get $prev) (i32.load offset=4 (local.get $cur)))))
            (return (local.get $cur))))
        (local.set $prev (local.get $cur))
        (local.set $cur (i32.load offset=4 (local.get $cur)))
        (br $scan)))
    (local.set $ptr (global.get $__heap_ptr))
    (global.set $__heap_ptr (i32.add (local.get $ptr) (local.get $size)))
    (if (i32.gt_u (global.get $__heap_ptr) (i32.shl (memory.size) (i32.const 16)))
      (then
        (drop (memory.grow
          (i32.shr_u
            (i32.add
              (i32.sub (global.get $__heap_ptr) (i32.shl (memory.size) (i32.const 16)))
              (i32.const 65535))
            (i32.const 16))))))
    (local.get $ptr)
  )
  ;; Return a block (>= 8 bytes) to the free list. Smaller blocks are leaked (can't hold the header).
  (func $__free (param $ptr i32) (param $size i32)
    (if (i32.ge_u (local.get $size) (i32.const 8))
      (then
        (i32.store (local.get $ptr) (local.get $size))
        (i32.store offset=4 (local.get $ptr) (global.get $__free_list))
        (global.set $__free_list (local.get $ptr))))
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
  ;; Dynamic array grow_i32: malloc new block of newcap elements, copy data, return new ptr.
  (func $__dynarr_grow_i32 (param $arr i32) (param $newcap i32) (result i32)
    (local $newptr i32)
    (local $len i32)
    (local $i i32)
    (local.set $len (i32.load (local.get $arr)))
    (local.set $newptr (call $__malloc (i32.add (i32.const 8) (i32.shl (local.get $newcap) (i32.const 2)))))
    (i32.store (local.get $newptr) (local.get $len))
    (i32.store offset=4 (local.get $newptr) (local.get $newcap))
    (local.set $i (i32.const 0))
    (block $brk
      (loop $lp
        (br_if $brk (i32.ge_u (local.get $i) (local.get $len)))
        (i32.store
          (i32.add (i32.add (local.get $newptr) (i32.const 8)) (i32.shl (local.get $i) (i32.const 2)))
          (i32.load
            (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (local.get $i) (i32.const 2)))
          )
        )
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $lp)
      )
    )
    (local.get $newptr)
  )

  ;; Dynamic array push_i32: grow if full, store val at end, increment length, return new arr ptr.
  (func $__dynarr_push_i32 (param $arr i32) (param $val i32) (result i32)
    (local $len i32)
    (local $cap i32)
    (local.set $len (i32.load (local.get $arr)))
    (local.set $cap (i32.load offset=4 (local.get $arr)))
    (if (i32.ge_u (local.get $len) (local.get $cap))
      (then
        (local.set $arr (call $__dynarr_grow_i32 (local.get $arr) (select (i32.const 8) (i32.shl (local.get $cap) (i32.const 1)) (i32.eqz (local.get $cap)))))
      )
    )
    (i32.store
      (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (local.get $len) (i32.const 2)))
      (local.get $val)
    )
    (local.set $len (i32.add (local.get $len) (i32.const 1)))
    (i32.store (local.get $arr) (local.get $len))
    (local.get $arr)
  )
  (func $defer (param $fn i32) 
    (local $__iface_tmp i32)
    (global.set $deferred (call $__dynarr_push_i32 (global.get $deferred) (local.get $fn)))
  )

  (func $runDeferred  
    (local $i f64)
    (local $__fn_tmp i32)
    (local.set $i (f64.sub (f64.convert_i32_s (i32.load (global.get $deferred))) (f64.const 1)))
    (block $break_0
      (loop $loop_0
        (br_if $break_0 (i32.eqz (f64.ge (local.get $i) (f64.const 0))))
        (block $cont_0
          (local.set $__fn_tmp (i32.load (i32.add (i32.add (global.get $deferred) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $i)) (i32.const 2)))))
      (call_indirect (type $ftype_i32_r_void) (local.get $__fn_tmp) (i32.load (local.get $__fn_tmp)))
        )
        (local.set $i (f64.sub (local.get $i) (f64.const 1)))
        (br $loop_0)
      )
    )
  )

  (func $__anon_0  
    (local $__iface_tmp i32)
        (i32.store (i32.const 0) (i32.const 260))
          (i32.store (i32.const 4) (i32.const 2))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
  )
  (func $_start (export "_start")
    (local $__iface_tmp i32)
    (global.set $deferred (call $__malloc (i32.const 40)))
      (i32.store (global.get $deferred) (i32.const 0))
      (i32.store offset=4 (global.get $deferred) (i32.const 8))
    (call $defer (i32.const 0))
        (i32.store (i32.const 0) (i32.const 262))
          (i32.store (i32.const 4) (i32.const 14))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
    (call $proc_exit (i32.const 0))
  )
  (table 1 funcref)
  (elem (i32.const 0) $__anon_0)
  (data (i32.const 260) "\21\0a")
  (data (i32.const 262) "\65\78\69\74\20\73\74\61\74\75\73\20\33\0a")
)