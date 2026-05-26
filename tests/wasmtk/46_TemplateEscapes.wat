(module
  (import "wasi_snapshot_preview1" "proc_exit" (func $proc_exit (param i32)))
  (import "wasi_snapshot_preview1" "fd_write" (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (memory (export "memory") 2)
  (global $__heap_ptr (mut i32) (i32.const 578))
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
  (func $assert (param $condition i32) (param $msg_ptr i32) (param $msg_len i32) 
    (if (i32.eqz (local.get $condition))
      (then
      (call $proc_exit (i32.const 0))
      (unreachable)
      )
    )
  )
  (func $_start (export "_start")
    (local $nl_ptr i32)
    (local $nl_len i32)
    (local $tab_ptr i32)
    (local $tab_len i32)
    (local $bksl_ptr i32)
    (local $bksl_len i32)
    (local $cr_ptr i32)
    (local $cr_len i32)
    (local $bs_ptr i32)
    (local $bs_len i32)
    (local $multi_ptr i32)
    (local $multi_len i32)
    (local $name_ptr i32)
    (local $name_len i32)
    (local $tmpl_ptr i32)
    (local $tmpl_len i32)
    (local $prefix_ptr i32)
    (local $prefix_len i32)
    (local $tmpl2_ptr i32)
    (local $tmpl2_len i32)
    (local $__iface_tmp i32)
    (local $__tmpl_num_ptr i32)
    (local $__tmpl_num_len i32)
    (local.set $nl_ptr (i32.const 267))
      (local.set $nl_len (i32.const 11))
    (call $assert (i32.eq (local.get $nl_len) (i32.const 11)) (i32.const 278) (i32.const 31))
    (local.set $tab_ptr (i32.const 309))
      (local.set $tab_len (i32.const 3))
    (call $assert (i32.eq (local.get $tab_len) (i32.const 3)) (i32.const 312) (i32.const 31))
    (local.set $bksl_ptr (i32.const 343))
      (local.set $bksl_len (i32.const 9))
    (call $assert (i32.eq (local.get $bksl_len) (i32.const 9)) (i32.const 352) (i32.const 31))
    (local.set $cr_ptr (i32.const 383))
      (local.set $cr_len (i32.const 3))
    (call $assert (i32.eq (local.get $cr_len) (i32.const 3)) (i32.const 386) (i32.const 31))
    (local.set $bs_ptr (i32.const 417))
      (local.set $bs_len (i32.const 3))
    (call $assert (i32.eq (local.get $bs_len) (i32.const 3)) (i32.const 420) (i32.const 31))
    (local.set $multi_ptr (i32.const 451))
      (local.set $multi_len (i32.const 5))
    (call $assert (i32.eq (local.get $multi_len) (i32.const 5)) (i32.const 456) (i32.const 28))
    (local.set $name_ptr (i32.const 260))
      (local.set $name_len (i32.const 5))
    (local.set $tmpl_ptr (i32.const 484))
      (local.set $tmpl_len (i32.const 6))
      (call $__str_concat (local.get $tmpl_ptr) (local.get $tmpl_len) (local.get $name_ptr) (local.get $name_len))
      (local.set $tmpl_len)
      (local.set $tmpl_ptr)
    (call $assert (i32.eq (local.get $tmpl_len) (i32.const 11)) (i32.const 490) (i32.const 32))
    (local.set $prefix_ptr (i32.const 265))
      (local.set $prefix_len (i32.const 2))
    (local.set $tmpl2_ptr (local.get $prefix_ptr))
      (local.set $tmpl2_len (local.get $prefix_len))
      (call $__str_concat (local.get $tmpl2_ptr) (local.get $tmpl2_len) (i32.const 522) (i32.const 6))
      (local.set $tmpl2_len)
      (local.set $tmpl2_ptr)
    (call $assert (i32.eq (local.get $tmpl2_len) (i32.const 8)) (i32.const 528) (i32.const 31))
        (i32.store (i32.const 0) (i32.const 559))
          (i32.store (i32.const 4) (i32.const 19))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
    (call $proc_exit (i32.const 0))
  )
  (data (i32.const 260) "\77\6f\72\6c\64")
  (data (i32.const 265) "\68\69")
  (data (i32.const 267) "\6c\69\6e\65\31\0a\6c\69\6e\65\32")
  (data (i32.const 278) "\5c\6e\20\69\6e\20\74\65\6d\70\6c\61\74\65\20\73\68\6f\75\6c\64\20\62\65\20\31\20\62\79\74\65")
  (data (i32.const 309) "\41\09\42")
  (data (i32.const 312) "\5c\74\20\69\6e\20\74\65\6d\70\6c\61\74\65\20\73\68\6f\75\6c\64\20\62\65\20\31\20\62\79\74\65")
  (data (i32.const 343) "\70\61\74\68\5c\66\69\6c\65")
  (data (i32.const 352) "\5c\5c\20\69\6e\20\74\65\6d\70\6c\61\74\65\20\73\68\6f\75\6c\64\20\62\65\20\31\20\62\79\74\65")
  (data (i32.const 383) "\61\0d\62")
  (data (i32.const 386) "\5c\72\20\69\6e\20\74\65\6d\70\6c\61\74\65\20\73\68\6f\75\6c\64\20\62\65\20\31\20\62\79\74\65")
  (data (i32.const 417) "\61\08\62")
  (data (i32.const 420) "\5c\62\20\69\6e\20\74\65\6d\70\6c\61\74\65\20\73\68\6f\75\6c\64\20\62\65\20\31\20\62\79\74\65")
  (data (i32.const 451) "\61\09\62\0a\63")
  (data (i32.const 456) "\6d\75\6c\74\69\70\6c\65\20\65\73\63\61\70\65\73\20\69\6e\20\74\65\6d\70\6c\61\74\65")
  (data (i32.const 484) "\68\65\6c\6c\6f\0a")
  (data (i32.const 490) "\5c\6e\20\62\65\66\6f\72\65\20\65\78\70\72\65\73\73\69\6f\6e\20\69\6e\20\74\65\6d\70\6c\61\74\65")
  (data (i32.const 522) "\0a\74\68\65\72\65")
  (data (i32.const 528) "\5c\6e\20\61\66\74\65\72\20\65\78\70\72\65\73\73\69\6f\6e\20\69\6e\20\74\65\6d\70\6c\61\74\65")
  (data (i32.const 559) "\54\65\6d\70\6c\61\74\65\45\73\63\61\70\65\73\20\6f\6b\0a")
)