(module
  (import "wasi_snapshot_preview1" "proc_exit" (func $proc_exit (param i32)))
  (import "wasi_snapshot_preview1" "fd_write" (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (memory (export "memory") 2)
  (global $__heap_ptr (mut i32) (i32.const 337))
  (global $__str_ret_ptr (mut i32) (i32.const 0))
  (global $__str_ret_len (mut i32) (i32.const 0))
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

  ;; ── str_cmp: lexicographic byte comparison ─────────────────────────────────
  ;; Returns negative if a<b, 0 if a==b, positive if a>b.
  (func $__str_cmp
    (param $aptr i32) (param $alen i32) (param $bptr i32) (param $blen i32)
    (result i32)
    (local $i i32)
    (local $minlen i32)
    (local $ca i32)
    (local $cb i32)
    (local.set $minlen
      (if (result i32) (i32.lt_s (local.get $alen) (local.get $blen))
        (then (local.get $alen))
        (else (local.get $blen))
      )
    )
    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (local.get $i) (local.get $minlen)))
        (local.set $ca (i32.load8_u (i32.add (local.get $aptr) (local.get $i))))
        (local.set $cb (i32.load8_u (i32.add (local.get $bptr) (local.get $i))))
        (if (i32.ne (local.get $ca) (local.get $cb))
          (then (return (i32.sub (local.get $ca) (local.get $cb))))
        )
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )
    (i32.sub (local.get $alen) (local.get $blen))
  )

  ;; ── str_gather: copy len bytes from src to dst (byte-copy loop, no bulk-memory) ──
  ;; Used by gather-buffer mode in console.log for strvar/boolvar segments.
  (func $__str_gather (param $src i32) (param $slen i32) (param $dst i32)
    (local $i i32)
    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (local.get $i) (local.get $slen)))
        (i32.store8
          (i32.add (local.get $dst) (local.get $i))
          (i32.load8_u (i32.add (local.get $src) (local.get $i)))
        )
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )
  )

  ;; ── str_concat: heap-allocate new string = a ++ b ───────────────────────────
  ;; Copies bytes of a then b into a malloc'd buffer. Returns (ptr, len).
  ;; Old buffers become dead memory (bump allocator has no free).
  (func $__str_concat
    (param $aptr i32) (param $alen i32) (param $bptr i32) (param $blen i32)
    (result i32 i32)
    (local $newptr i32) (local $newlen i32) (local $i i32)
    (local.set $newlen (i32.add (local.get $alen) (local.get $blen)))
    (local.set $newptr (call $__malloc (local.get $newlen)))
    ;; copy a
    (local.set $i (i32.const 0))
    (block $done_a
      (loop $copy_a
        (br_if $done_a (i32.ge_u (local.get $i) (local.get $alen)))
        (i32.store8
          (i32.add (local.get $newptr) (local.get $i))
          (i32.load8_u (i32.add (local.get $aptr) (local.get $i)))
        )
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $copy_a)
      )
    )
    ;; copy b
    (local.set $i (i32.const 0))
    (block $done_b
      (loop $copy_b
        (br_if $done_b (i32.ge_u (local.get $i) (local.get $blen)))
        (i32.store8
          (i32.add (local.get $newptr) (i32.add (local.get $alen) (local.get $i)))
          (i32.load8_u (i32.add (local.get $bptr) (local.get $i)))
        )
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $copy_b)
      )
    )
    (local.get $newptr)
    (local.get $newlen)
  )

  ;; ── str_slice: return sub-range of existing string (no allocation) ───────────
  ;; Clamps start/end to [0, len]. Returns (ptr+start, end-start).
  (func $__str_slice
    (param $ptr i32) (param $len i32) (param $start i32) (param $end i32)
    (result i32 i32)
    (local $cs i32) (local $ce i32)
    ;; clamp start to [0, len]
    (local.set $cs
      (select (i32.const 0) (local.get $start) (i32.lt_s (local.get $start) (i32.const 0)))
    )
    (if (i32.gt_s (local.get $cs) (local.get $len))
      (then (local.set $cs (local.get $len)))
    )
    ;; clamp end to [cs, len]
    (local.set $ce
      (select (local.get $len) (local.get $end) (i32.gt_s (local.get $end) (local.get $len)))
    )
    (if (i32.lt_s (local.get $ce) (local.get $cs))
      (then (local.set $ce (local.get $cs)))
    )
    (i32.add (local.get $ptr) (local.get $cs))
    (i32.sub (local.get $ce) (local.get $cs))
  )

  ;; ── str_indexof: first occurrence of sub in str, or -1 ──────────────────────
  (func $__str_indexof
    (param $ptr i32) (param $len i32) (param $subptr i32) (param $sublen i32)
    (result i32)
    (local $i i32) (local $j i32) (local $max i32) (local $ok i32)
    ;; empty substring always found at position 0
    (if (i32.eqz (local.get $sublen)) (then (return (i32.const 0))))
    ;; if sub is longer than str, impossible
    (local.set $max (i32.sub (local.get $len) (local.get $sublen)))
    (if (i32.lt_s (local.get $max) (i32.const 0)) (then (return (i32.const -1))))
    (block $found_none
      (loop $outer
        (br_if $found_none (i32.gt_s (local.get $i) (local.get $max)))
        (local.set $j (i32.const 0))
        (local.set $ok (i32.const 1))
        (block $inner_done
          (loop $inner
            (br_if $inner_done (i32.ge_u (local.get $j) (local.get $sublen)))
            (if (i32.ne
              (i32.load8_u (i32.add (local.get $ptr) (i32.add (local.get $i) (local.get $j))))
              (i32.load8_u (i32.add (local.get $subptr) (local.get $j)))
            )
              (then
                (local.set $ok (i32.const 0))
                (br $inner_done)
              )
            )
            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br $inner)
          )
        )
        (if (local.get $ok) (then (return (local.get $i))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $outer)
      )
    )
    (i32.const -1)
  )

  ;; ── str_indexof_from: first occurrence of sub in str starting at 'from', or -1 ─
  (func $__str_indexof_from
    (param $ptr i32) (param $len i32) (param $subptr i32) (param $sublen i32) (param $from i32)
    (result i32)
    (local $i i32) (local $j i32) (local $max i32) (local $ok i32)
    (if (i32.eqz (local.get $sublen)) (then (return (local.get $from))))
    (local.set $max (i32.sub (local.get $len) (local.get $sublen)))
    (if (i32.lt_s (local.get $max) (i32.const 0)) (then (return (i32.const -1))))
    (local.set $i (select (i32.const 0) (local.get $from) (i32.lt_s (local.get $from) (i32.const 0))))
    (block $found_none
      (loop $outer
        (br_if $found_none (i32.gt_s (local.get $i) (local.get $max)))
        (local.set $j (i32.const 0))
        (local.set $ok (i32.const 1))
        (block $inner_done
          (loop $inner
            (br_if $inner_done (i32.ge_u (local.get $j) (local.get $sublen)))
            (if (i32.ne
              (i32.load8_u (i32.add (local.get $ptr) (i32.add (local.get $i) (local.get $j))))
              (i32.load8_u (i32.add (local.get $subptr) (local.get $j)))
            )
              (then
                (local.set $ok (i32.const 0))
                (br $inner_done)
              )
            )
            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br $inner)
          )
        )
        (if (local.get $ok) (then (return (local.get $i))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $outer)
      )
    )
    (i32.const -1)
  )
  (func $sortStrings (param $arr i32) 
    (local $i f64)
    (local $j f64)
    (local $tmp_ptr i32)
    (local $tmp_len i32)
    (local.set $i (f64.const 0))
    (block $break_0
      (loop $loop_0
        (br_if $break_0 (i32.eqz (f64.lt (local.get $i) (f64.sub (f64.convert_i32_s (i32.load (local.get $arr))) (f64.const 1)))))
        (block $cont_0
          (local.set $j (f64.const 0))
          (block $break_1
            (loop $loop_1
              (br_if $break_1 (i32.eqz (f64.lt (local.get $j) (f64.sub (f64.sub (f64.convert_i32_s (i32.load (local.get $arr))) (f64.const 1)) (local.get $i)))))
              (block $cont_1
                (if (i32.gt_s (call $__str_cmp (i32.load (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $j)) (i32.const 3)))) (i32.load offset=4 (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $j)) (i32.const 3)))) (i32.load (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (f64.add (local.get $j) (f64.const 1))) (i32.const 3)))) (i32.load offset=4 (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (f64.add (local.get $j) (f64.const 1))) (i32.const 3))))) (i32.const 0))
                  (then
                  (local.set $tmp_ptr (i32.load (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $j)) (i32.const 3)))))
      (local.set $tmp_len (i32.load offset=4 (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $j)) (i32.const 3)))))
                  (i32.store (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $j)) (i32.const 3))) (i32.load (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (f64.add (local.get $j) (f64.const 1))) (i32.const 3)))))
      (i32.store offset=4 (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $j)) (i32.const 3))) (i32.load offset=4 (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (f64.add (local.get $j) (f64.const 1))) (i32.const 3)))))
                  (i32.store (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (f64.add (local.get $j) (f64.const 1))) (i32.const 3))) (local.get $tmp_ptr))
      (i32.store offset=4 (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (f64.add (local.get $j) (f64.const 1))) (i32.const 3))) (local.get $tmp_len))
                  )
                )
              )
              (local.set $j (f64.add (local.get $j) (f64.const 1)))
              (br $loop_1)
            )
          )
        )
        (local.set $i (f64.add (local.get $i) (f64.const 1)))
        (br $loop_0)
      )
    )
  )

  (func $sortNums (param $arr i32) 
    (local $i f64)
    (local $j f64)
    (local $tmp f64)
    (local.set $i (f64.const 0))
    (block $break_2
      (loop $loop_2
        (br_if $break_2 (i32.eqz (f64.lt (local.get $i) (f64.sub (f64.convert_i32_s (i32.load (local.get $arr))) (f64.const 1)))))
        (block $cont_2
          (local.set $j (f64.const 0))
          (block $break_3
            (loop $loop_3
              (br_if $break_3 (i32.eqz (f64.lt (local.get $j) (f64.sub (f64.sub (f64.convert_i32_s (i32.load (local.get $arr))) (f64.const 1)) (local.get $i)))))
              (block $cont_3
                (if (f64.gt (f64.load (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $j)) (i32.const 3)))) (f64.load (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (f64.add (local.get $j) (f64.const 1))) (i32.const 3)))))
                  (then
                  (local.set $tmp (f64.load (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $j)) (i32.const 3)))))
                  (f64.store (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $j)) (i32.const 3))) (f64.load (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (f64.add (local.get $j) (f64.const 1))) (i32.const 3)))))
                  (f64.store (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (f64.add (local.get $j) (f64.const 1))) (i32.const 3))) (local.get $tmp))
                  )
                )
              )
              (local.set $j (f64.add (local.get $j) (f64.const 1)))
              (br $loop_3)
            )
          )
        )
        (local.set $i (f64.add (local.get $i) (f64.const 1)))
        (br $loop_2)
      )
    )
  )

  (func $strArrStr (param $arr i32) 
    (local $s_ptr i32)
    (local $s_len i32)
    (local $__ret_str_ptr i32)
    (local $__ret_str_len i32)
    (local.set $s_ptr (i32.const 260))
      (local.set $s_len (i32.const 1))
  )

  (func $numArrStr (param $arr i32) 
    (local $s_ptr i32)
    (local $s_len i32)
    (local $__ret_str_ptr i32)
    (local $__ret_str_len i32)
    (local $__tmpl_num_ptr i32)
    (local $__tmpl_num_len i32)
    (local.set $s_ptr (i32.const 260))
      (local.set $s_len (i32.const 1))
  )
  (func $_start (export "_start")
    (local $strs i32)
    (local $ints i32)
    (local $isSorted i32)
    (local $i f64)
    (local $__iface_tmp i32)
    (local.set $strs (i32.const 264))
    (call $sortStrings (local.get $strs))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (i32.const 0))
          (i32.store8 (i32.const 132) (i32.const 83))
          (i32.store8 (i32.const 133) (i32.const 116))
          (i32.store8 (i32.const 134) (i32.const 114))
          (i32.store8 (i32.const 135) (i32.const 105))
          (i32.store8 (i32.const 136) (i32.const 110))
          (i32.store8 (i32.const 137) (i32.const 103))
          (i32.store8 (i32.const 138) (i32.const 115))
          (i32.store8 (i32.const 139) (i32.const 58))
          (i32.store8 (i32.const 140) (i32.const 32))
          (call $strArrStr (local.get $strs))
          (call $__str_gather (global.get $__str_ret_ptr) (global.get $__str_ret_len) (i32.const 141))
          (i32.store (i32.const 4) (i32.add (i32.const 9) (global.get $__str_ret_len)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
    (local.set $ints (i32.const 296))
    (call $sortNums (local.get $ints))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (i32.const 0))
          (i32.store8 (i32.const 132) (i32.const 73))
          (i32.store8 (i32.const 133) (i32.const 110))
          (i32.store8 (i32.const 134) (i32.const 116))
          (i32.store8 (i32.const 135) (i32.const 115))
          (i32.store8 (i32.const 136) (i32.const 58))
          (i32.store8 (i32.const 137) (i32.const 32))
          (i32.store8 (i32.const 138) (i32.const 32))
          (i32.store8 (i32.const 139) (i32.const 32))
          (i32.store8 (i32.const 140) (i32.const 32))
          (call $numArrStr (local.get $ints))
          (call $__str_gather (global.get $__str_ret_ptr) (global.get $__str_ret_len) (i32.const 141))
          (i32.store (i32.const 4) (i32.add (i32.const 9) (global.get $__str_ret_len)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
    (local.set $isSorted (i32.const 1))
    (local.set $i (f64.const 1))
    (block $break_4
      (loop $loop_4
        (br_if $break_4 (i32.eqz (f64.lt (local.get $i) (f64.convert_i32_s (i32.const 3)))))
        (block $cont_4
          (if (f64.gt (f64.load (i32.add (i32.add (i32.const 296) (i32.const 8)) (i32.shl (i32.trunc_f64_s (f64.sub (local.get $i) (f64.const 1))) (i32.const 3)))) (f64.load (i32.add (i32.add (i32.const 296) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $i)) (i32.const 3)))))
            (then
            (local.set $isSorted (i32.const 0))
            (br $break_4)
            )
          )
        )
        (local.set $i (f64.add (local.get $i) (f64.const 1)))
        (br $loop_4)
      )
    )
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (i32.const 0))
          (i32.store8 (i32.const 132) (i32.const 83))
          (i32.store8 (i32.const 133) (i32.const 111))
          (i32.store8 (i32.const 134) (i32.const 114))
          (i32.store8 (i32.const 135) (i32.const 116))
          (i32.store8 (i32.const 136) (i32.const 101))
          (i32.store8 (i32.const 137) (i32.const 100))
          (i32.store8 (i32.const 138) (i32.const 58))
          (i32.store8 (i32.const 139) (i32.const 32))
          (i32.store8 (i32.const 140) (i32.const 32))
          (call $__str_gather (if (result i32) (local.get $isSorted) (then (i32.const 328)) (else (i32.const 332))) (if (result i32) (local.get $isSorted) (then (i32.const 4)) (else (i32.const 5))) (i32.const 141))
          (i32.store (i32.const 4) (i32.add (i32.const 9) (if (result i32) (local.get $isSorted) (then (i32.const 4)) (else (i32.const 5)))))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
    (call $proc_exit (i32.const 0))
  )
  (data (i32.const 260) "\5d")
  (data (i32.const 261) "\63")
  (data (i32.const 262) "\61")
  (data (i32.const 263) "\62")
  (data (i32.const 328) "\74\72\75\65")
  (data (i32.const 332) "\66\61\6c\73\65")
  (data (i32.const 264) "\03\00\00\00\03\00\00\00\05\01\00\00\01\00\00\00\06\01\00\00\01\00\00\00\07\01\00\00\01\00\00\00")
  (data (i32.const 296) "\03\00\00\00\03\00\00\00\00\00\00\00\00\00\1c\40\00\00\00\00\00\00\00\40\00\00\00\00\00\00\10\40")
)