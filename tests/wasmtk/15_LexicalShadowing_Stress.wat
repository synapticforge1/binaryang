(module
  (import "wasi_snapshot_preview1" "proc_exit" (func $proc_exit (param i32)))
  (import "wasi_snapshot_preview1" "fd_write" (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (memory (export "memory") 2)
  (global $__heap_ptr (mut i32) (i32.const 331))
  (tag $__exn_tag (export "__exn_tag") (param i32 i32))
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
  (func $testLexicalShadowing (export "testLexicalShadowing")  
    (local $e_ptr i32)
    (local $e_len i32)
    (local $__catch_e_ptr i32)
    (local $__catch_e_len i32)
    (local $outerError_ptr i32)
    (local $outerError_len i32)
    (local $__iface_tmp i32)
    (local.set $e_ptr (i32.const 260))
      (local.set $e_len (i32.const 12))
    (try
      (do
        (try
          (do
            (throw $__exn_tag (i32.const 272) (i32.const 19))
          )
          (catch $__exn_tag
            (local.set $__catch_e_len)
            (local.set $__catch_e_ptr)
                (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (i32.const 0))
          (i32.store8 (i32.const 132) (i32.const 73))
          (i32.store8 (i32.const 133) (i32.const 110))
          (i32.store8 (i32.const 134) (i32.const 110))
          (i32.store8 (i32.const 135) (i32.const 101))
          (i32.store8 (i32.const 136) (i32.const 114))
          (i32.store8 (i32.const 137) (i32.const 32))
          (i32.store8 (i32.const 138) (i32.const 67))
          (i32.store8 (i32.const 139) (i32.const 97))
          (i32.store8 (i32.const 140) (i32.const 116))
          (i32.store8 (i32.const 141) (i32.const 99))
          (i32.store8 (i32.const 142) (i32.const 104))
          (i32.store8 (i32.const 143) (i32.const 58))
          (i32.store8 (i32.const 144) (i32.const 32))
          (call $__str_gather (local.get $__catch_e_ptr) (local.get $__catch_e_len) (i32.const 145))
          (i32.store (i32.const 4) (i32.add (i32.const 13) (local.get $__catch_e_len)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
            (throw $__exn_tag (local.get $__catch_e_ptr) (local.get $__catch_e_len))
          )
        )
      )
      (catch $__exn_tag
        (local.set $outerError_len)
        (local.set $outerError_ptr)
            (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (i32.const 0))
          (i32.store8 (i32.const 132) (i32.const 79))
          (i32.store8 (i32.const 133) (i32.const 117))
          (i32.store8 (i32.const 134) (i32.const 116))
          (i32.store8 (i32.const 135) (i32.const 101))
          (i32.store8 (i32.const 136) (i32.const 114))
          (i32.store8 (i32.const 137) (i32.const 32))
          (i32.store8 (i32.const 138) (i32.const 67))
          (i32.store8 (i32.const 139) (i32.const 97))
          (i32.store8 (i32.const 140) (i32.const 116))
          (i32.store8 (i32.const 141) (i32.const 99))
          (i32.store8 (i32.const 142) (i32.const 104))
          (i32.store8 (i32.const 143) (i32.const 58))
          (i32.store8 (i32.const 144) (i32.const 32))
          (call $__str_gather (local.get $outerError_ptr) (local.get $outerError_len) (i32.const 145))
          (i32.store (i32.const 4) (i32.add (i32.const 13) (local.get $outerError_len)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
            (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (i32.const 0))
          (i32.store8 (i32.const 132) (i32.const 83))
          (i32.store8 (i32.const 133) (i32.const 104))
          (i32.store8 (i32.const 134) (i32.const 97))
          (i32.store8 (i32.const 135) (i32.const 100))
          (i32.store8 (i32.const 136) (i32.const 111))
          (i32.store8 (i32.const 137) (i32.const 119))
          (i32.store8 (i32.const 138) (i32.const 32))
          (i32.store8 (i32.const 139) (i32.const 67))
          (i32.store8 (i32.const 140) (i32.const 104))
          (i32.store8 (i32.const 141) (i32.const 101))
          (i32.store8 (i32.const 142) (i32.const 99))
          (i32.store8 (i32.const 143) (i32.const 107))
          (i32.store8 (i32.const 144) (i32.const 58))
          (i32.store8 (i32.const 145) (i32.const 32))
          (call $__str_gather (local.get $e_ptr) (local.get $e_len) (i32.const 146))
          (i32.store (i32.const 4) (i32.add (i32.const 14) (local.get $e_len)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
      )
    )
  )
  (func $_start (export "_start")
    (local $__iface_tmp i32)
        (i32.store (i32.const 0) (i32.const 291))
          (i32.store (i32.const 4) (i32.const 40))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
    (call $testLexicalShadowing )
    (call $proc_exit (i32.const 0))
  )
  (data (i32.const 260) "\4f\75\74\65\72\20\53\74\72\69\6e\67")
  (data (i32.const 272) "\49\6e\6e\65\72\20\4c\69\74\65\72\61\6c\20\45\72\72\6f\72")
  (data (i32.const 291) "\2d\2d\2d\20\54\65\73\74\20\32\3a\20\4c\65\78\69\63\61\6c\20\53\63\6f\70\65\20\53\68\61\64\6f\77\69\6e\67\20\2d\2d\2d\0a")
)