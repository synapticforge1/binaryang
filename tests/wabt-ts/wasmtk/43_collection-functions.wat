(module
  (import "wasi_snapshot_preview1" "proc_exit" (func $proc_exit (param i32)))
  (import "wasi_snapshot_preview1" "fd_write" (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (memory (export "memory") 2)
  (global $__heap_ptr (mut i32) (i32.const 336))
  (global $__d4s (mut i32) (i32.const 0))
  (global $__free_list (mut i32) (i32.const 0))
  (global $__str_ret_ptr (mut i32) (i32.const 0))
  (global $__str_ret_len (mut i32) (i32.const 0))
  (type $ftype_i32_i32_r_i32 (func (param i32) (param i32) (result i32)))
  (type $ftype_i32_i32_r_void (func (param i32) (param i32)))
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

  ;; ── str_trim: remove leading and trailing ASCII whitespace ─────────────────
  ;; Whitespace = 0x09 (tab), 0x0a (LF), 0x0d (CR), 0x20 (space).
  ;; Returns (new_ptr, new_len) which is a sub-range of the original buffer.
  (func $__str_trim
    (param $ptr i32) (param $len i32)
    (result i32 i32)
    (local $s i32) (local $e i32) (local $b i32)
    (local.set $s (i32.const 0))
    (local.set $e (local.get $len))
    ;; advance $s past leading whitespace
    (block $done_s
      (loop $loop_s
        (br_if $done_s (i32.ge_u (local.get $s) (local.get $e)))
        (local.set $b (i32.load8_u (i32.add (local.get $ptr) (local.get $s))))
        (br_if $done_s (i32.and
          (i32.and (i32.ne (local.get $b) (i32.const 0x20)) (i32.ne (local.get $b) (i32.const 0x09)))
          (i32.and (i32.ne (local.get $b) (i32.const 0x0a)) (i32.ne (local.get $b) (i32.const 0x0d)))
        ))
        (local.set $s (i32.add (local.get $s) (i32.const 1)))
        (br $loop_s)
      )
    )
    ;; retreat $e past trailing whitespace
    (block $done_e
      (loop $loop_e
        (br_if $done_e (i32.le_u (local.get $e) (local.get $s)))
        (local.set $b (i32.load8_u (i32.add (local.get $ptr) (i32.sub (local.get $e) (i32.const 1)))))
        (br_if $done_e (i32.and
          (i32.and (i32.ne (local.get $b) (i32.const 0x20)) (i32.ne (local.get $b) (i32.const 0x09)))
          (i32.and (i32.ne (local.get $b) (i32.const 0x0a)) (i32.ne (local.get $b) (i32.const 0x0d)))
        ))
        (local.set $e (i32.sub (local.get $e) (i32.const 1)))
        (br $loop_e)
      )
    )
    (i32.add (local.get $ptr) (local.get $s))
    (i32.sub (local.get $e) (local.get $s))
  )

  ;; ── str_trim_start: remove leading ASCII whitespace ──────────────────────────
  (func $__str_trim_start
    (param $ptr i32) (param $len i32)
    (result i32 i32)
    (local $s i32) (local $b i32)
    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (local.get $s) (local.get $len)))
        (local.set $b (i32.load8_u (i32.add (local.get $ptr) (local.get $s))))
        (br_if $done (i32.and
          (i32.and (i32.ne (local.get $b) (i32.const 0x20)) (i32.ne (local.get $b) (i32.const 0x09)))
          (i32.and (i32.ne (local.get $b) (i32.const 0x0a)) (i32.ne (local.get $b) (i32.const 0x0d)))
        ))
        (local.set $s (i32.add (local.get $s) (i32.const 1)))
        (br $loop)
      )
    )
    (i32.add (local.get $ptr) (local.get $s))
    (i32.sub (local.get $len) (local.get $s))
  )

  ;; ── str_trim_end: remove trailing ASCII whitespace ───────────────────────────
  (func $__str_trim_end
    (param $ptr i32) (param $len i32)
    (result i32 i32)
    (local $e i32) (local $b i32)
    (local.set $e (local.get $len))
    (block $done
      (loop $loop
        (br_if $done (i32.eqz (local.get $e)))
        (local.set $b (i32.load8_u (i32.add (local.get $ptr) (i32.sub (local.get $e) (i32.const 1)))))
        (br_if $done (i32.and
          (i32.and (i32.ne (local.get $b) (i32.const 0x20)) (i32.ne (local.get $b) (i32.const 0x09)))
          (i32.and (i32.ne (local.get $b) (i32.const 0x0a)) (i32.ne (local.get $b) (i32.const 0x0d)))
        ))
        (local.set $e (i32.sub (local.get $e) (i32.const 1)))
        (br $loop)
      )
    )
    (local.get $ptr)
    (local.get $e)
  )

  ;; ── str_char_code_at: char code at index i, or -1 if out of bounds ───────────
  (func $__str_char_code_at
    (param $ptr i32) (param $len i32) (param $i i32)
    (result i32)
    (if (i32.lt_s (local.get $i) (i32.const 0)) (then (return (i32.const -1))))
    (if (i32.ge_u (local.get $i) (local.get $len)) (then (return (i32.const -1))))
    (i32.load8_u (i32.add (local.get $ptr) (local.get $i)))
  )

  ;; ── str_char_at: single-char sub-string at index i ───────────────────────────
  ;; Returns (ptr+i, 1) if in bounds, (ptr, 0) if out of bounds.
  (func $__str_char_at
    (param $ptr i32) (param $len i32) (param $i i32)
    (result i32 i32)
    (if (i32.lt_s (local.get $i) (i32.const 0))
      (then (return (local.get $ptr) (i32.const 0)))
    )
    (if (i32.ge_u (local.get $i) (local.get $len))
      (then (return (local.get $ptr) (i32.const 0)))
    )
    (i32.add (local.get $ptr) (local.get $i))
    (i32.const 1)
  )

  ;; ── str_starts_with: true if str begins with sub ─────────────────────────────
  (func $__str_starts_with
    (param $ptr i32) (param $len i32) (param $subptr i32) (param $sublen i32)
    (result i32)
    (local $j i32)
    (if (i32.gt_u (local.get $sublen) (local.get $len)) (then (return (i32.const 0))))
    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (local.get $j) (local.get $sublen)))
        (if (i32.ne
          (i32.load8_u (i32.add (local.get $ptr) (local.get $j)))
          (i32.load8_u (i32.add (local.get $subptr) (local.get $j)))
        ) (then (return (i32.const 0))))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $loop)
      )
    )
    (i32.const 1)
  )

  ;; ── str_ends_with: true if str ends with sub ─────────────────────────────────
  (func $__str_ends_with
    (param $ptr i32) (param $len i32) (param $subptr i32) (param $sublen i32)
    (result i32)
    (local $j i32) (local $off i32)
    (if (i32.gt_u (local.get $sublen) (local.get $len)) (then (return (i32.const 0))))
    (local.set $off (i32.sub (local.get $len) (local.get $sublen)))
    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (local.get $j) (local.get $sublen)))
        (if (i32.ne
          (i32.load8_u (i32.add (local.get $ptr) (i32.add (local.get $off) (local.get $j))))
          (i32.load8_u (i32.add (local.get $subptr) (local.get $j)))
        ) (then (return (i32.const 0))))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $loop)
      )
    )
    (i32.const 1)
  )

  ;; ── str_to_upper: ASCII uppercase into a new heap buffer ────────────────────
  (func $__str_to_upper
    (param $ptr i32) (param $len i32)
    (result i32 i32)
    (local $newptr i32) (local $i i32) (local $b i32)
    (local.set $newptr (call $__malloc (local.get $len)))
    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
        (local.set $b (i32.load8_u (i32.add (local.get $ptr) (local.get $i))))
        (if (i32.and (i32.ge_u (local.get $b) (i32.const 97)) (i32.le_u (local.get $b) (i32.const 122)))
          (then (local.set $b (i32.sub (local.get $b) (i32.const 32))))
        )
        (i32.store8 (i32.add (local.get $newptr) (local.get $i)) (local.get $b))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )
    (local.get $newptr)
    (local.get $len)
  )

  ;; ── str_to_lower: ASCII lowercase into a new heap buffer ────────────────────
  (func $__str_to_lower
    (param $ptr i32) (param $len i32)
    (result i32 i32)
    (local $newptr i32) (local $i i32) (local $b i32)
    (local.set $newptr (call $__malloc (local.get $len)))
    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
        (local.set $b (i32.load8_u (i32.add (local.get $ptr) (local.get $i))))
        (if (i32.and (i32.ge_u (local.get $b) (i32.const 65)) (i32.le_u (local.get $b) (i32.const 90)))
          (then (local.set $b (i32.add (local.get $b) (i32.const 32))))
        )
        (i32.store8 (i32.add (local.get $newptr) (local.get $i)) (local.get $b))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )
    (local.get $newptr)
    (local.get $len)
  )

  ;; ── str_replace: replace first occurrence of old with new ───────────────────
  ;; Returns new heap string (or original ptr/len if old not found).
  (func $__str_replace
    (param $ptr i32) (param $len i32)
    (param $oldptr i32) (param $oldlen i32)
    (param $newptr i32) (param $newlen i32)
    (result i32 i32)
    (local $pos i32) (local $outlen i32) (local $out i32) (local $wi i32)
    (local.set $pos (call $__str_indexof (local.get $ptr) (local.get $len) (local.get $oldptr) (local.get $oldlen)))
    (if (i32.eq (local.get $pos) (i32.const -1))
      (then (return (local.get $ptr) (local.get $len)))
    )
    (local.set $outlen (i32.add (i32.sub (local.get $len) (local.get $oldlen)) (local.get $newlen)))
    (local.set $out (call $__malloc (local.get $outlen)))
    ;; copy prefix [0, pos)
    (local.set $wi (i32.const 0))
    (block $d0 (loop $l0
      (br_if $d0 (i32.ge_u (local.get $wi) (local.get $pos)))
      (i32.store8 (i32.add (local.get $out) (local.get $wi))
        (i32.load8_u (i32.add (local.get $ptr) (local.get $wi))))
      (local.set $wi (i32.add (local.get $wi) (i32.const 1)))
      (br $l0)
    ))
    ;; copy new string
    (block $d1 (loop $l1
      (br_if $d1 (i32.ge_u (local.get $wi) (i32.add (local.get $pos) (local.get $newlen))))
      (i32.store8 (i32.add (local.get $out) (local.get $wi))
        (i32.load8_u (i32.add (local.get $newptr) (i32.sub (local.get $wi) (local.get $pos)))))
      (local.set $wi (i32.add (local.get $wi) (i32.const 1)))
      (br $l1)
    ))
    ;; copy suffix [pos+oldlen, len)
    (block $d2 (loop $l2
      (br_if $d2 (i32.ge_u (local.get $wi) (local.get $outlen)))
      (i32.store8 (i32.add (local.get $out) (local.get $wi))
        (i32.load8_u (i32.add (local.get $ptr) (i32.sub (i32.add (local.get $wi) (local.get $oldlen)) (local.get $newlen)))))
      (local.set $wi (i32.add (local.get $wi) (i32.const 1)))
      (br $l2)
    ))
    (local.get $out)
    (local.get $outlen)
  )

  ;; ── str_replace_all: replace all occurrences of old with new ────────────────
  (func $__str_replace_all
    (param $ptr i32) (param $len i32)
    (param $oldptr i32) (param $oldlen i32)
    (param $newptr i32) (param $newlen i32)
    (result i32 i32)
    (local $cur i32) (local $pos i32) (local $buf i32) (local $blen i32)
    (local $wi i32) (local $ri i32) (local $seglen i32)
    ;; worst-case capacity: outlen <= len * (newlen/oldlen + 1) — allocate generously
    ;; simple heuristic: (len + 1) * (newlen + 1)
    (local.set $blen (i32.mul (i32.add (local.get $len) (i32.const 1)) (i32.add (local.get $newlen) (i32.const 1))))
    (local.set $buf (call $__malloc (local.get $blen)))
    (local.set $cur (i32.const 0))
    (local.set $wi (i32.const 0))
    (block $done
      (loop $loop
        ;; find next occurrence from $cur
        (local.set $pos (call $__str_indexof
          (i32.add (local.get $ptr) (local.get $cur))
          (i32.sub (local.get $len) (local.get $cur))
          (local.get $oldptr) (local.get $oldlen)
        ))
        (if (i32.eq (local.get $pos) (i32.const -1)) (then (br $done)))
        (local.set $pos (i32.add (local.get $pos) (local.get $cur)))
        ;; copy segment before match
        (local.set $seglen (i32.sub (local.get $pos) (local.get $cur)))
        (local.set $ri (i32.const 0))
        (block $ds (loop $ls
          (br_if $ds (i32.ge_u (local.get $ri) (local.get $seglen)))
          (i32.store8 (i32.add (local.get $buf) (local.get $wi))
            (i32.load8_u (i32.add (local.get $ptr) (i32.add (local.get $cur) (local.get $ri)))))
          (local.set $wi (i32.add (local.get $wi) (i32.const 1)))
          (local.set $ri (i32.add (local.get $ri) (i32.const 1)))
          (br $ls)
        ))
        ;; copy new string
        (local.set $ri (i32.const 0))
        (block $dn (loop $ln
          (br_if $dn (i32.ge_u (local.get $ri) (local.get $newlen)))
          (i32.store8 (i32.add (local.get $buf) (local.get $wi))
            (i32.load8_u (i32.add (local.get $newptr) (local.get $ri))))
          (local.set $wi (i32.add (local.get $wi) (i32.const 1)))
          (local.set $ri (i32.add (local.get $ri) (i32.const 1)))
          (br $ln)
        ))
        (local.set $cur (i32.add (local.get $pos) (i32.add (local.get $oldlen) (i32.const 0))))
        ;; guard against zero-length old (avoid infinite loop)
        (if (i32.eqz (local.get $oldlen))
          (then
            (local.set $cur (i32.add (local.get $cur) (i32.const 1)))
            (if (i32.gt_u (local.get $cur) (local.get $len)) (then (br $done)))
          )
        )
        (br $loop)
      )
    )
    ;; copy remaining tail
    (local.set $ri (local.get $cur))
    (block $dt (loop $lt
      (br_if $dt (i32.ge_u (local.get $ri) (local.get $len)))
      (i32.store8 (i32.add (local.get $buf) (local.get $wi))
        (i32.load8_u (i32.add (local.get $ptr) (local.get $ri))))
      (local.set $wi (i32.add (local.get $wi) (i32.const 1)))
      (local.set $ri (i32.add (local.get $ri) (i32.const 1)))
      (br $lt)
    ))
    (local.get $buf)
    (local.get $wi)
  )

  ;; ── str_pad_start: pad string to targetLen with pad chars on the left ────────
  (func $__str_pad_start
    (param $ptr i32) (param $len i32) (param $target i32) (param $padptr i32) (param $padlen i32)
    (result i32 i32)
    (local $out i32) (local $need i32) (local $wi i32) (local $pi i32)
    (if (i32.le_s (local.get $target) (local.get $len))
      (then (return (local.get $ptr) (local.get $len)))
    )
    (local.set $need (i32.sub (local.get $target) (local.get $len)))
    (local.set $out (call $__malloc (local.get $target)))
    ;; fill pad chars cycling through padstr
    (if (i32.eqz (local.get $padlen)) (then (local.set $padlen (i32.const 1))))
    (block $dp (loop $lp
      (br_if $dp (i32.ge_u (local.get $wi) (local.get $need)))
      (local.set $pi (i32.rem_u (local.get $wi) (local.get $padlen)))
      (i32.store8 (i32.add (local.get $out) (local.get $wi))
        (i32.load8_u (i32.add (local.get $padptr) (local.get $pi))))
      (local.set $wi (i32.add (local.get $wi) (i32.const 1)))
      (br $lp)
    ))
    ;; copy original string
    (local.set $pi (i32.const 0))
    (block $ds (loop $ls
      (br_if $ds (i32.ge_u (local.get $pi) (local.get $len)))
      (i32.store8 (i32.add (local.get $out) (i32.add (local.get $need) (local.get $pi)))
        (i32.load8_u (i32.add (local.get $ptr) (local.get $pi))))
      (local.set $pi (i32.add (local.get $pi) (i32.const 1)))
      (br $ls)
    ))
    (local.get $out)
    (local.get $target)
  )

  ;; ── str_pad_end: pad string to targetLen with pad chars on the right ─────────
  (func $__str_pad_end
    (param $ptr i32) (param $len i32) (param $target i32) (param $padptr i32) (param $padlen i32)
    (result i32 i32)
    (local $out i32) (local $need i32) (local $wi i32) (local $pi i32)
    (if (i32.le_s (local.get $target) (local.get $len))
      (then (return (local.get $ptr) (local.get $len)))
    )
    (local.set $need (i32.sub (local.get $target) (local.get $len)))
    (local.set $out (call $__malloc (local.get $target)))
    ;; copy original string first
    (block $ds (loop $ls
      (br_if $ds (i32.ge_u (local.get $wi) (local.get $len)))
      (i32.store8 (i32.add (local.get $out) (local.get $wi))
        (i32.load8_u (i32.add (local.get $ptr) (local.get $wi))))
      (local.set $wi (i32.add (local.get $wi) (i32.const 1)))
      (br $ls)
    ))
    ;; fill pad chars
    (if (i32.eqz (local.get $padlen)) (then (local.set $padlen (i32.const 1))))
    (block $dp (loop $lp
      (br_if $dp (i32.ge_u (local.get $wi) (local.get $target)))
      (local.set $pi (i32.rem_u (i32.sub (local.get $wi) (local.get $len)) (local.get $padlen)))
      (i32.store8 (i32.add (local.get $out) (local.get $wi))
        (i32.load8_u (i32.add (local.get $padptr) (local.get $pi))))
      (local.set $wi (i32.add (local.get $wi) (i32.const 1)))
      (br $lp)
    ))
    (local.get $out)
    (local.get $target)
  )

  ;; ── str_repeat: concatenate the string n times ───────────────────────────────
  (func $__str_repeat
    (param $ptr i32) (param $len i32) (param $n i32)
    (result i32 i32)
    (local $out i32) (local $outlen i32) (local $i i32) (local $j i32)
    (if (i32.le_s (local.get $n) (i32.const 0))
      (then (return (local.get $ptr) (i32.const 0)))
    )
    (local.set $outlen (i32.mul (local.get $len) (local.get $n)))
    (local.set $out (call $__malloc (local.get $outlen)))
    (block $done
      (loop $outer
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $j (i32.const 0))
        (block $di (loop $li
          (br_if $di (i32.ge_u (local.get $j) (local.get $len)))
          (i32.store8
            (i32.add (local.get $out) (i32.add (i32.mul (local.get $i) (local.get $len)) (local.get $j)))
            (i32.load8_u (i32.add (local.get $ptr) (local.get $j)))
          )
          (local.set $j (i32.add (local.get $j) (i32.const 1)))
          (br $li)
        ))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $outer)
      )
    )
    (local.get $out)
    (local.get $outlen)
  )

  ;; ── str_split: split string by delimiter, return string-array ptr ────────────
  ;; String array layout: [count i32][capacity i32][{ptr i32, len i32} × count]
  ;; Each element is 8 bytes. The returned i32 is a pointer to this array.
  (func $__str_split
    (param $ptr i32) (param $len i32) (param $dptr i32) (param $dlen i32)
    (result i32)
    (local $arr i32) (local $cap i32) (local $count i32)
    (local $cur i32) (local $pos i32) (local $segptr i32) (local $seglen i32)
    (local $newarr i32) (local $newsz i32)
    ;; initial capacity 8 parts
    (local.set $cap (i32.const 8))
    (local.set $arr (call $__malloc (i32.add (i32.const 8) (i32.mul (local.get $cap) (i32.const 8)))))
    (i32.store (local.get $arr) (i32.const 0))
    (i32.store offset=4 (local.get $arr) (local.get $cap))
    ;; special case: empty delimiter → each char is a part (not implemented; treat as no-split)
    (if (i32.eqz (local.get $dlen))
      (then
        ;; store the whole string as single part
        (i32.store offset=8 (local.get $arr) (local.get $ptr))
        (i32.store offset=12 (local.get $arr) (local.get $len))
        (i32.store (local.get $arr) (i32.const 1))
        (return (local.get $arr))
      )
    )
    (block $done
      (loop $loop
        ;; find next delimiter from $cur
        (local.set $pos (call $__str_indexof
          (i32.add (local.get $ptr) (local.get $cur))
          (i32.sub (local.get $len) (local.get $cur))
          (local.get $dptr) (local.get $dlen)
        ))
        (if (i32.eq (local.get $pos) (i32.const -1))
          (then
            ;; last segment: from $cur to end
            (local.set $segptr (i32.add (local.get $ptr) (local.get $cur)))
            (local.set $seglen (i32.sub (local.get $len) (local.get $cur)))
            (br $done)
          )
        )
        (local.set $pos (i32.add (local.get $pos) (local.get $cur)))
        (local.set $segptr (i32.add (local.get $ptr) (local.get $cur)))
        (local.set $seglen (i32.sub (local.get $pos) (local.get $cur)))
        ;; grow array if full
        (if (i32.ge_u (local.get $count) (local.get $cap))
          (then
            (local.set $cap (i32.mul (local.get $cap) (i32.const 2)))
            (local.set $newsz (i32.add (i32.const 8) (i32.mul (local.get $cap) (i32.const 8))))
            (local.set $newarr (call $__malloc (local.get $newsz)))
            (call $__str_gather (local.get $arr) (i32.add (i32.const 8) (i32.mul (local.get $count) (i32.const 8))) (local.get $newarr))
            (local.set $arr (local.get $newarr))
            (i32.store offset=4 (local.get $arr) (local.get $cap))
          )
        )
        ;; store segment
        (i32.store
          (i32.add (local.get $arr) (i32.add (i32.const 8) (i32.mul (local.get $count) (i32.const 8))))
          (local.get $segptr)
        )
        (i32.store offset=4
          (i32.add (local.get $arr) (i32.add (i32.const 8) (i32.mul (local.get $count) (i32.const 8))))
          (local.get $seglen)
        )
        (local.set $count (i32.add (local.get $count) (i32.const 1)))
        (local.set $cur (i32.add (local.get $pos) (local.get $dlen)))
        (if (i32.gt_u (local.get $cur) (local.get $len)) (then (br $done)))
        (br $loop)
      )
    )
    ;; store last segment
    (if (i32.ge_u (local.get $count) (local.get $cap))
      (then
        (local.set $cap (i32.mul (local.get $cap) (i32.const 2)))
        (local.set $newsz (i32.add (i32.const 8) (i32.mul (local.get $cap) (i32.const 8))))
        (local.set $newarr (call $__malloc (local.get $newsz)))
        (call $__str_gather (local.get $arr) (i32.add (i32.const 8) (i32.mul (local.get $count) (i32.const 8))) (local.get $newarr))
        (local.set $arr (local.get $newarr))
        (i32.store offset=4 (local.get $arr) (local.get $cap))
      )
    )
    (i32.store
      (i32.add (local.get $arr) (i32.add (i32.const 8) (i32.mul (local.get $count) (i32.const 8))))
      (local.get $segptr)
    )
    (i32.store offset=4
      (i32.add (local.get $arr) (i32.add (i32.const 8) (i32.mul (local.get $count) (i32.const 8))))
      (local.get $seglen)
    )
    (local.set $count (i32.add (local.get $count) (i32.const 1)))
    (i32.store (local.get $arr) (local.get $count))
    (local.get $arr)
  )

  ;; ── str_from_codepoint: UTF-8 encode a single code point into a fresh buffer ──
  ;; Returns (ptr, len). Handles the full U+0000..U+10FFFF range (1–4 bytes).
  (func $__str_from_codepoint (param $cp i32) (result i32 i32)
    (local $p i32)
    (local.set $p (call $__malloc (i32.const 4)))
    (if (i32.lt_u (local.get $cp) (i32.const 0x80))
      (then
        (i32.store8 (local.get $p) (local.get $cp))
        (return (local.get $p) (i32.const 1))))
    (if (i32.lt_u (local.get $cp) (i32.const 0x800))
      (then
        (i32.store8 (local.get $p)
          (i32.or (i32.const 0xC0) (i32.shr_u (local.get $cp) (i32.const 6))))
        (i32.store8 offset=1 (local.get $p)
          (i32.or (i32.const 0x80) (i32.and (local.get $cp) (i32.const 0x3F))))
        (return (local.get $p) (i32.const 2))))
    (if (i32.lt_u (local.get $cp) (i32.const 0x10000))
      (then
        (i32.store8 (local.get $p)
          (i32.or (i32.const 0xE0) (i32.shr_u (local.get $cp) (i32.const 12))))
        (i32.store8 offset=1 (local.get $p)
          (i32.or (i32.const 0x80) (i32.and (i32.shr_u (local.get $cp) (i32.const 6)) (i32.const 0x3F))))
        (i32.store8 offset=2 (local.get $p)
          (i32.or (i32.const 0x80) (i32.and (local.get $cp) (i32.const 0x3F))))
        (return (local.get $p) (i32.const 3))))
    (i32.store8 (local.get $p)
      (i32.or (i32.const 0xF0) (i32.shr_u (local.get $cp) (i32.const 18))))
    (i32.store8 offset=1 (local.get $p)
      (i32.or (i32.const 0x80) (i32.and (i32.shr_u (local.get $cp) (i32.const 12)) (i32.const 0x3F))))
    (i32.store8 offset=2 (local.get $p)
      (i32.or (i32.const 0x80) (i32.and (i32.shr_u (local.get $cp) (i32.const 6)) (i32.const 0x3F))))
    (i32.store8 offset=3 (local.get $p)
      (i32.or (i32.const 0x80) (i32.and (local.get $cp) (i32.const 0x3F))))
    (local.get $p) (i32.const 4)
  )

  ;; ── i32 → decimal string ──────────────────────────────────────────────────
  ;; Writes the decimal representation of $val at $buf, returns byte count.
  (func $__i32_to_str (param $val i32) (param $buf i32) (result i32)
    (local $start i32)
    (local $end i32)
    (local $tmp i32)
    (local $ch i32)
    (local $neg i32)
    (local $orig i32)
    (local.set $orig (local.get $buf))
    (local.set $start (local.get $buf))
    ;; Zero
    (if (i32.eqz (local.get $val))
      (then
        (i32.store8 (local.get $buf) (i32.const 48))
        (return (i32.const 1))
      )
    )
    ;; Negative
    (if (i32.lt_s (local.get $val) (i32.const 0))
      (then
        (i32.store8 (local.get $buf) (i32.const 45))
        (local.set $buf (i32.add (local.get $buf) (i32.const 1)))
        (local.set $start (local.get $buf))
        (local.set $neg (i32.const 1))
        (local.set $val (i32.sub (i32.const 0) (local.get $val)))
      )
    )
    (local.set $end (local.get $buf))
    ;; Write digits in reverse
    (block $done
      (loop $loop
        (br_if $done (i32.eqz (local.get $val)))
        (i32.store8
          (local.get $end)
          (i32.add (i32.const 48) (i32.rem_u (local.get $val) (i32.const 10)))
        )
        (local.set $val (i32.div_u (local.get $val) (i32.const 10)))
        (local.set $end (i32.add (local.get $end) (i32.const 1)))
        (br $loop)
      )
    )
    ;; Reverse digit bytes in-place
    (local.set $tmp (local.get $start))
    (local.set $ch (i32.sub (local.get $end) (i32.const 1)))
    (block $rdone
      (loop $rloop
        (br_if $rdone (i32.ge_u (local.get $tmp) (local.get $ch)))
        (local.set $neg (i32.load8_u (local.get $tmp)))
        (i32.store8 (local.get $tmp) (i32.load8_u (local.get $ch)))
        (i32.store8 (local.get $ch) (local.get $neg))
        (local.set $tmp (i32.add (local.get $tmp) (i32.const 1)))
        (local.set $ch (i32.sub (local.get $ch) (i32.const 1)))
        (br $rloop)
      )
    )
    ;; Return total length (including leading '-' if any)
    (i32.sub (local.get $end) (local.get $orig))
  )

  ;; ── i32 → string in an arbitrary radix (2..36), e.g. (14).toString(2) = "1110" ──
  ;; Mirrors $__i32_to_str but with a parameterised base + digit→char (0-9→'0'+d, 10-35→'a'+d-10).
  ;; Negative values get a leading '-' and unsigned magnitude digits (JS sign-magnitude semantics).
  (func $__i32_to_str_radix (param $val i32) (param $radix i32) (param $buf i32) (result i32)
    (local $start i32)
    (local $end i32)
    (local $tmp i32)
    (local $ch i32)
    (local $swap i32)
    (local $orig i32)
    (local $d i32)
    (local.set $orig (local.get $buf))
    (local.set $start (local.get $buf))
    ;; clamp radix to [2,36] (JS RangeError otherwise; fall back to base 10)
    (if (i32.or (i32.lt_s (local.get $radix) (i32.const 2)) (i32.gt_s (local.get $radix) (i32.const 36)))
      (then (local.set $radix (i32.const 10)))
    )
    ;; Zero
    (if (i32.eqz (local.get $val))
      (then
        (i32.store8 (local.get $buf) (i32.const 48))
        (return (i32.const 1))
      )
    )
    ;; Negative → leading '-' then magnitude
    (if (i32.lt_s (local.get $val) (i32.const 0))
      (then
        (i32.store8 (local.get $buf) (i32.const 45))
        (local.set $buf (i32.add (local.get $buf) (i32.const 1)))
        (local.set $start (local.get $buf))
        (local.set $val (i32.sub (i32.const 0) (local.get $val)))
      )
    )
    (local.set $end (local.get $buf))
    ;; Write digits in reverse
    (block $done
      (loop $loop
        (br_if $done (i32.eqz (local.get $val)))
        (local.set $d (i32.rem_u (local.get $val) (local.get $radix)))
        (i32.store8
          (local.get $end)
          (if (result i32) (i32.lt_u (local.get $d) (i32.const 10))
            (then (i32.add (i32.const 48) (local.get $d)))
            (else (i32.add (i32.const 87) (local.get $d)))
          )
        )
        (local.set $val (i32.div_u (local.get $val) (local.get $radix)))
        (local.set $end (i32.add (local.get $end) (i32.const 1)))
        (br $loop)
      )
    )
    ;; Reverse digit bytes in-place
    (local.set $tmp (local.get $start))
    (local.set $ch (i32.sub (local.get $end) (i32.const 1)))
    (block $rdone
      (loop $rloop
        (br_if $rdone (i32.ge_u (local.get $tmp) (local.get $ch)))
        (local.set $swap (i32.load8_u (local.get $tmp)))
        (i32.store8 (local.get $tmp) (i32.load8_u (local.get $ch)))
        (i32.store8 (local.get $ch) (local.get $swap))
        (local.set $tmp (i32.add (local.get $tmp) (i32.const 1)))
        (local.set $ch (i32.sub (local.get $ch) (i32.const 1)))
        (br $rloop)
      )
    )
    (i32.sub (local.get $end) (local.get $orig))
  )

  ;; -- Dragon4 (Burger-Dybvig) shortest + correctly-rounded f64 -> decimal ------
  ;; Fixed-size limb bignums (48 x u32 = 1536 bits) in a lazily-malloc'd scratch
  ;; region ($__d4s). Produces the shortest decimal digit string that round-trips
  ;; to the exact f64 (round-to-even ties), then formats per ECMAScript
  ;; Number.prototype.toString rules (fixed-point for pointPos in (-6,21], else
  ;; scientific). 100% byte-exact parity with V8 across normal + subnormal range.
  (func $__bz (param $p i32)
    (local $i i32)
    (loop $l
      (i32.store (i32.add (local.get $p) (i32.shl (local.get $i) (i32.const 2))) (i32.const 0))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $l (i32.lt_u (local.get $i) (i32.const 48)))
    )
  )
  (func $__bset64 (param $p i32) (param $v i64)
    (call $__bz (local.get $p))
    (i32.store (local.get $p) (i32.wrap_i64 (i64.and (local.get $v) (i64.const 0xffffffff))))
    (i32.store offset=4 (local.get $p) (i32.wrap_i64 (i64.shr_u (local.get $v) (i64.const 32))))
  )
  (func $__bmul_u32 (param $p i32) (param $m i32)
    (local $i i32) (local $carry i64) (local $prod i64) (local $addr i32)
    (loop $l
      (local.set $addr (i32.add (local.get $p) (i32.shl (local.get $i) (i32.const 2))))
      (local.set $prod
        (i64.add
          (i64.mul (i64.extend_i32_u (i32.load (local.get $addr))) (i64.extend_i32_u (local.get $m)))
          (local.get $carry)))
      (i32.store (local.get $addr) (i32.wrap_i64 (i64.and (local.get $prod) (i64.const 0xffffffff))))
      (local.set $carry (i64.shr_u (local.get $prod) (i64.const 32)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $l (i32.lt_u (local.get $i) (i32.const 48)))
    )
  )
  (func $__bshl (param $p i32) (param $bits i32)
    (local $limbShift i32) (local $bitShift i32) (local $i i32) (local $src i32)
    (local $lo i32) (local $hi i32) (local $val i32)
    (local.set $limbShift (i32.div_u (local.get $bits) (i32.const 32)))
    (local.set $bitShift  (i32.rem_u (local.get $bits) (i32.const 32)))
    (local.set $i (i32.const 47))
    (loop $l
      (local.set $src (i32.sub (local.get $i) (local.get $limbShift)))
      (local.set $val (i32.const 0))
      (if (i32.ge_s (local.get $src) (i32.const 0))
        (then
          (local.set $lo (i32.load (i32.add (local.get $p) (i32.shl (local.get $src) (i32.const 2)))))
          (if (i32.eqz (local.get $bitShift))
            (then (local.set $val (local.get $lo)))
            (else
              (local.set $val (i32.shl (local.get $lo) (local.get $bitShift)))
              (if (i32.gt_s (local.get $src) (i32.const 0))
                (then
                  (local.set $hi (i32.load (i32.add (local.get $p) (i32.shl (i32.sub (local.get $src) (i32.const 1)) (i32.const 2)))))
                  (local.set $val (i32.or (local.get $val)
                    (i32.shr_u (local.get $hi) (i32.sub (i32.const 32) (local.get $bitShift)))))
                ))
            ))
        ))
      (i32.store (i32.add (local.get $p) (i32.shl (local.get $i) (i32.const 2))) (local.get $val))
      (local.set $i (i32.sub (local.get $i) (i32.const 1)))
      (br_if $l (i32.ge_s (local.get $i) (i32.const 0)))
    )
  )
  (func $__bcmp (param $a i32) (param $b i32) (result i32)
    (local $i i32) (local $va i32) (local $vb i32)
    (local.set $i (i32.const 47))
    (loop $l
      (local.set $va (i32.load (i32.add (local.get $a) (i32.shl (local.get $i) (i32.const 2)))))
      (local.set $vb (i32.load (i32.add (local.get $b) (i32.shl (local.get $i) (i32.const 2)))))
      (if (i32.ne (local.get $va) (local.get $vb))
        (then (return (select (i32.const 1) (i32.const -1) (i32.gt_u (local.get $va) (local.get $vb))))))
      (local.set $i (i32.sub (local.get $i) (i32.const 1)))
      (br_if $l (i32.ge_s (local.get $i) (i32.const 0)))
    )
    (i32.const 0)
  )
  (func $__badd (param $d i32) (param $a i32) (param $b i32)
    (local $i i32) (local $carry i64) (local $sum i64)
    (loop $l
      (local.set $sum
        (i64.add
          (i64.add
            (i64.extend_i32_u (i32.load (i32.add (local.get $a) (i32.shl (local.get $i) (i32.const 2)))))
            (i64.extend_i32_u (i32.load (i32.add (local.get $b) (i32.shl (local.get $i) (i32.const 2))))))
          (local.get $carry)))
      (i32.store (i32.add (local.get $d) (i32.shl (local.get $i) (i32.const 2)))
        (i32.wrap_i64 (i64.and (local.get $sum) (i64.const 0xffffffff))))
      (local.set $carry (i64.shr_u (local.get $sum) (i64.const 32)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $l (i32.lt_u (local.get $i) (i32.const 48)))
    )
  )
  (func $__bsub (param $d i32) (param $a i32) (param $b i32)
    (local $i i32) (local $borrow i64) (local $diff i64)
    (loop $l
      (local.set $diff
        (i64.sub
          (i64.sub
            (i64.extend_i32_u (i32.load (i32.add (local.get $a) (i32.shl (local.get $i) (i32.const 2)))))
            (i64.extend_i32_u (i32.load (i32.add (local.get $b) (i32.shl (local.get $i) (i32.const 2))))))
          (local.get $borrow)))
      (i32.store (i32.add (local.get $d) (i32.shl (local.get $i) (i32.const 2)))
        (i32.wrap_i64 (i64.and (local.get $diff) (i64.const 0xffffffff))))
      (local.set $borrow (i64.and (i64.shr_u (local.get $diff) (i64.const 63)) (i64.const 1)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $l (i32.lt_u (local.get $i) (i32.const 48)))
    )
  )
  (func $__f64_to_str (param $val f64) (param $buf i32) (result i32)
    (local $bits i64) (local $e i32) (local $f i64)
    (local $even i32) (local $isMin i32)
    (local $R i32) (local $S i32) (local $MP i32) (local $MM i32) (local $TMP i32) (local $DIG i32)
    (local $k i32) (local $ndig i32) (local $i i32) (local $dg i32)
    (local $ptr i32) (local $sign i32) (local $cmp i32) (local $low i32) (local $high i32)
    (local $pp i32)
    (local.set $ptr (local.get $buf))
    ;; NaN
    (if (f64.ne (local.get $val) (local.get $val))
      (then
        (i32.store8 (local.get $ptr) (i32.const 78))
        (i32.store8 offset=1 (local.get $ptr) (i32.const 97))
        (i32.store8 offset=2 (local.get $ptr) (i32.const 78))
        (return (i32.const 3))))
    ;; sign (-0 -> lt is false -> prints "0")
    (if (f64.lt (local.get $val) (f64.const 0))
      (then
        (i32.store8 (local.get $ptr) (i32.const 45))
        (local.set $ptr (i32.add (local.get $ptr) (i32.const 1)))
        (local.set $val (f64.neg (local.get $val)))
        (local.set $sign (i32.const 1))))
    ;; Infinity
    (if (f64.eq (local.get $val) (f64.const inf))
      (then
        (i32.store8 (local.get $ptr) (i32.const 73))
        (i32.store8 offset=1 (local.get $ptr) (i32.const 110))
        (i32.store8 offset=2 (local.get $ptr) (i32.const 102))
        (i32.store8 offset=3 (local.get $ptr) (i32.const 105))
        (i32.store8 offset=4 (local.get $ptr) (i32.const 110))
        (i32.store8 offset=5 (local.get $ptr) (i32.const 105))
        (i32.store8 offset=6 (local.get $ptr) (i32.const 116))
        (i32.store8 offset=7 (local.get $ptr) (i32.const 121))
        (return (i32.add (i32.sub (local.get $ptr) (local.get $buf)) (i32.const 8)))))
    ;; zero
    (if (f64.eq (local.get $val) (f64.const 0))
      (then
        (i32.store8 (local.get $ptr) (i32.const 48))
        (return (i32.add (i32.sub (local.get $ptr) (local.get $buf)) (i32.const 1)))))
    ;; lazily allocate bignum scratch
    (if (i32.eqz (global.get $__d4s))
      (then (global.set $__d4s (call $__malloc (i32.const 1024)))))
    (local.set $R   (global.get $__d4s))
    (local.set $S   (i32.add (global.get $__d4s) (i32.const 192)))
    (local.set $MP  (i32.add (global.get $__d4s) (i32.const 384)))
    (local.set $MM  (i32.add (global.get $__d4s) (i32.const 576)))
    (local.set $TMP (i32.add (global.get $__d4s) (i32.const 768)))
    (local.set $DIG (i32.add (global.get $__d4s) (i32.const 960)))
    ;; decompose f64 -> f (mantissa integer) x 2^e
    (local.set $bits (i64.reinterpret_f64 (local.get $val)))
    (local.set $e (i32.wrap_i64 (i64.and (i64.shr_u (local.get $bits) (i64.const 52)) (i64.const 0x7ff))))
    (local.set $f (i64.and (local.get $bits) (i64.const 0xfffffffffffff)))
    (if (i32.eqz (local.get $e))
      (then (local.set $e (i32.const -1074)))
      (else
        (local.set $f (i64.or (local.get $f) (i64.shl (i64.const 1) (i64.const 52))))
        (local.set $e (i32.sub (local.get $e) (i32.const 1075)))))
    (local.set $even (i32.eqz (i32.wrap_i64 (i64.and (local.get $f) (i64.const 1)))))
    (local.set $isMin (i64.eq (local.get $f) (i64.shl (i64.const 1) (i64.const 52))))
    ;; build R, S, m+, m-
    (if (i32.ge_s (local.get $e) (i32.const 0))
      (then
        (call $__bset64 (local.get $TMP) (i64.const 1))
        (call $__bshl (local.get $TMP) (local.get $e))
        (if (i32.eqz (local.get $isMin))
          (then
            (call $__bset64 (local.get $R) (local.get $f))
            (call $__bshl (local.get $R) (i32.add (local.get $e) (i32.const 1)))
            (call $__bset64 (local.get $S) (i64.const 2))
            (memory.copy (local.get $MP) (local.get $TMP) (i32.const 192))
            (memory.copy (local.get $MM) (local.get $TMP) (i32.const 192)))
          (else
            (call $__bset64 (local.get $R) (local.get $f))
            (call $__bshl (local.get $R) (i32.add (local.get $e) (i32.const 2)))
            (call $__bset64 (local.get $S) (i64.const 4))
            (memory.copy (local.get $MP) (local.get $TMP) (i32.const 192))
            (call $__bshl (local.get $MP) (i32.const 1))
            (memory.copy (local.get $MM) (local.get $TMP) (i32.const 192)))))
      (else
        (if (i32.or (i32.eq (local.get $e) (i32.const -1074)) (i32.eqz (local.get $isMin)))
          (then
            (call $__bset64 (local.get $R) (local.get $f))
            (call $__bshl (local.get $R) (i32.const 1))
            (call $__bset64 (local.get $S) (i64.const 1))
            (call $__bshl (local.get $S) (i32.add (i32.sub (i32.const 0) (local.get $e)) (i32.const 1)))
            (call $__bset64 (local.get $MP) (i64.const 1))
            (call $__bset64 (local.get $MM) (i64.const 1)))
          (else
            (call $__bset64 (local.get $R) (local.get $f))
            (call $__bshl (local.get $R) (i32.const 2))
            (call $__bset64 (local.get $S) (i64.const 1))
            (call $__bshl (local.get $S) (i32.add (i32.sub (i32.const 0) (local.get $e)) (i32.const 2)))
            (call $__bset64 (local.get $MP) (i64.const 2))
            (call $__bset64 (local.get $MM) (i64.const 1))))))
    ;; k estimate from binary magnitude (bidirectional fixup corrects any error)
    (local.set $k
      (i32.trunc_f64_s
        (f64.ceil
          (f64.mul (f64.convert_i32_s (i32.add (local.get $e) (i32.const 52)))
                   (f64.const 0.30102999566398114)))))
    ;; initial scale by 10^k
    (if (i32.ge_s (local.get $k) (i32.const 0))
      (then
        (local.set $i (i32.const 0))
        (block $se (loop $sl
          (br_if $se (i32.ge_s (local.get $i) (local.get $k)))
          (call $__bmul_u32 (local.get $S) (i32.const 10))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br $sl))))
      (else
        (local.set $i (local.get $k))
        (block $re (loop $rl
          (br_if $re (i32.ge_s (local.get $i) (i32.const 0)))
          (call $__bmul_u32 (local.get $R)  (i32.const 10))
          (call $__bmul_u32 (local.get $MP) (i32.const 10))
          (call $__bmul_u32 (local.get $MM) (i32.const 10))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br $rl)))))
    ;; too-small fixup: while high(R+m+, S) -> S*=10; k++
    (block $fse (loop $fsl
      (call $__badd (local.get $TMP) (local.get $R) (local.get $MP))
      (local.set $cmp (call $__bcmp (local.get $TMP) (local.get $S)))
      (br_if $fse (i32.eqz
        (select (i32.ge_s (local.get $cmp) (i32.const 0))
                (i32.gt_s (local.get $cmp) (i32.const 0))
                (local.get $even))))
      (call $__bmul_u32 (local.get $S) (i32.const 10))
      (local.set $k (i32.add (local.get $k) (i32.const 1)))
      (br $fsl)))
    ;; too-big fixup: while NOT high(10*(R+m+), S) -> R,m+,m- *=10; k--
    (block $fbe (loop $fbl
      (call $__badd (local.get $TMP) (local.get $R) (local.get $MP))
      (call $__bmul_u32 (local.get $TMP) (i32.const 10))
      (local.set $cmp (call $__bcmp (local.get $TMP) (local.get $S)))
      (br_if $fbe (i32.eqz
        (select (i32.lt_s (local.get $cmp) (i32.const 0))
                (i32.le_s (local.get $cmp) (i32.const 0))
                (local.get $even))))
      (call $__bmul_u32 (local.get $R)  (i32.const 10))
      (call $__bmul_u32 (local.get $MP) (i32.const 10))
      (call $__bmul_u32 (local.get $MM) (i32.const 10))
      (local.set $k (i32.sub (local.get $k) (i32.const 1)))
      (br $fbl)))
    ;; digit generation
    (local.set $ndig (i32.const 0))
    (loop $dl
      (call $__bmul_u32 (local.get $R)  (i32.const 10))
      (call $__bmul_u32 (local.get $MP) (i32.const 10))
      (call $__bmul_u32 (local.get $MM) (i32.const 10))
      ;; dg = R/S ; R = R%S  (repeated subtract, dg in [0,9])
      (local.set $dg (i32.const 0))
      (block $sube (loop $subl
        (br_if $sube (i32.lt_s (call $__bcmp (local.get $R) (local.get $S)) (i32.const 0)))
        (call $__bsub (local.get $R) (local.get $R) (local.get $S))
        (local.set $dg (i32.add (local.get $dg) (i32.const 1)))
        (br $subl)))
      ;; low
      (local.set $cmp (call $__bcmp (local.get $R) (local.get $MM)))
      (local.set $low
        (select (i32.le_s (local.get $cmp) (i32.const 0))
                (i32.lt_s (local.get $cmp) (i32.const 0))
                (local.get $even)))
      ;; high
      (call $__badd (local.get $TMP) (local.get $R) (local.get $MP))
      (local.set $cmp (call $__bcmp (local.get $TMP) (local.get $S)))
      (local.set $high
        (select (i32.ge_s (local.get $cmp) (i32.const 0))
                (i32.gt_s (local.get $cmp) (i32.const 0))
                (local.get $even)))
      ;; continue when neither boundary reached
      (if (i32.and (i32.eqz (local.get $low)) (i32.eqz (local.get $high)))
        (then
          (i32.store8 (i32.add (local.get $DIG) (local.get $ndig)) (i32.add (i32.const 48) (local.get $dg)))
          (local.set $ndig (i32.add (local.get $ndig) (i32.const 1)))
          (br $dl)))
      ;; terminate: choose final digit (default keep dg)
      (if (i32.and (local.get $high) (i32.eqz (local.get $low)))
        (then (local.set $dg (i32.add (local.get $dg) (i32.const 1))))
        (else
          (if (i32.and (local.get $high) (local.get $low))
            (then
              (call $__badd (local.get $TMP) (local.get $R) (local.get $R))
              (local.set $cmp (call $__bcmp (local.get $TMP) (local.get $S)))
              (if (i32.gt_s (local.get $cmp) (i32.const 0))
                (then (local.set $dg (i32.add (local.get $dg) (i32.const 1))))
                (else
                  (if (i32.eqz (local.get $cmp))
                    (then (if (i32.and (local.get $dg) (i32.const 1))
                            (then (local.set $dg (i32.add (local.get $dg) (i32.const 1)))))))))))))
      (i32.store8 (i32.add (local.get $DIG) (local.get $ndig)) (i32.add (i32.const 48) (local.get $dg)))
      (local.set $ndig (i32.add (local.get $ndig) (i32.const 1)))
    )
    ;; format per ECMAScript Number.prototype.toString (pointPos == k)
    (local.set $pp (local.get $k))
    ;; pp > 21 -> scientific "d[.ddd]e+E"
    (if (i32.gt_s (local.get $pp) (i32.const 21))
      (then
        (i32.store8 (local.get $ptr) (i32.load8_u (local.get $DIG)))
        (local.set $ptr (i32.add (local.get $ptr) (i32.const 1)))
        (if (i32.gt_s (local.get $ndig) (i32.const 1))
          (then
            (i32.store8 (local.get $ptr) (i32.const 46))
            (local.set $ptr (i32.add (local.get $ptr) (i32.const 1)))
            (memory.copy (local.get $ptr) (i32.add (local.get $DIG) (i32.const 1)) (i32.sub (local.get $ndig) (i32.const 1)))
            (local.set $ptr (i32.add (local.get $ptr) (i32.sub (local.get $ndig) (i32.const 1))))))
        (i32.store8 (local.get $ptr) (i32.const 101))
        (i32.store8 offset=1 (local.get $ptr) (i32.const 43))
        (local.set $ptr (i32.add (local.get $ptr) (i32.const 2)))
        (local.set $ptr (i32.add (local.get $ptr) (call $__i32_to_str (i32.sub (local.get $pp) (i32.const 1)) (local.get $ptr))))
        (return (i32.sub (local.get $ptr) (local.get $buf)))))
    ;; pp <= -6 -> scientific "d[.ddd]e-E"
    (if (i32.le_s (local.get $pp) (i32.const -6))
      (then
        (i32.store8 (local.get $ptr) (i32.load8_u (local.get $DIG)))
        (local.set $ptr (i32.add (local.get $ptr) (i32.const 1)))
        (if (i32.gt_s (local.get $ndig) (i32.const 1))
          (then
            (i32.store8 (local.get $ptr) (i32.const 46))
            (local.set $ptr (i32.add (local.get $ptr) (i32.const 1)))
            (memory.copy (local.get $ptr) (i32.add (local.get $DIG) (i32.const 1)) (i32.sub (local.get $ndig) (i32.const 1)))
            (local.set $ptr (i32.add (local.get $ptr) (i32.sub (local.get $ndig) (i32.const 1))))))
        (i32.store8 (local.get $ptr) (i32.const 101))
        (i32.store8 offset=1 (local.get $ptr) (i32.const 45))
        (local.set $ptr (i32.add (local.get $ptr) (i32.const 2)))
        (local.set $ptr (i32.add (local.get $ptr) (call $__i32_to_str (i32.sub (i32.const 1) (local.get $pp)) (local.get $ptr))))
        (return (i32.sub (local.get $ptr) (local.get $buf)))))
    ;; pp <= 0 -> "0." + (-pp) zeros + digits
    (if (i32.le_s (local.get $pp) (i32.const 0))
      (then
        (i32.store8 (local.get $ptr) (i32.const 48))
        (i32.store8 offset=1 (local.get $ptr) (i32.const 46))
        (local.set $ptr (i32.add (local.get $ptr) (i32.const 2)))
        (local.set $i (i32.const 0))
        (block $ze (loop $zl
          (br_if $ze (i32.ge_s (local.get $i) (i32.sub (i32.const 0) (local.get $pp))))
          (i32.store8 (local.get $ptr) (i32.const 48))
          (local.set $ptr (i32.add (local.get $ptr) (i32.const 1)))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br $zl)))
        (memory.copy (local.get $ptr) (local.get $DIG) (local.get $ndig))
        (local.set $ptr (i32.add (local.get $ptr) (local.get $ndig)))
        (return (i32.sub (local.get $ptr) (local.get $buf)))))
    ;; pp >= ndig -> digits + (pp-ndig) zeros
    (if (i32.ge_s (local.get $pp) (local.get $ndig))
      (then
        (memory.copy (local.get $ptr) (local.get $DIG) (local.get $ndig))
        (local.set $ptr (i32.add (local.get $ptr) (local.get $ndig)))
        (local.set $i (i32.const 0))
        (block $ze2 (loop $zl2
          (br_if $ze2 (i32.ge_s (local.get $i) (i32.sub (local.get $pp) (local.get $ndig))))
          (i32.store8 (local.get $ptr) (i32.const 48))
          (local.set $ptr (i32.add (local.get $ptr) (i32.const 1)))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br $zl2)))
        (return (i32.sub (local.get $ptr) (local.get $buf)))))
    ;; else split at pp: digits[0..pp) "." digits[pp..]
    (memory.copy (local.get $ptr) (local.get $DIG) (local.get $pp))
    (local.set $ptr (i32.add (local.get $ptr) (local.get $pp)))
    (i32.store8 (local.get $ptr) (i32.const 46))
    (local.set $ptr (i32.add (local.get $ptr) (i32.const 1)))
    (memory.copy (local.get $ptr) (i32.add (local.get $DIG) (local.get $pp)) (i32.sub (local.get $ndig) (local.get $pp)))
    (local.set $ptr (i32.add (local.get $ptr) (i32.sub (local.get $ndig) (local.get $pp))))
    (i32.sub (local.get $ptr) (local.get $buf))
  )

  ;; ── i64 → decimal string ──────────────────────────────────────────────────
  ;; Writes the decimal representation of $val at $buf, returns byte count.
  (func $__i64_to_str (param $val i64) (param $buf i32) (result i32)
    (local $start i32)
    (local $end i32)
    (local $tmp i32)
    (local $ch i32)
    (local $neg i32)
    (local $digit i32)
    (local $orig i32)
    (local.set $orig (local.get $buf))
    (local.set $start (local.get $buf))
    ;; Zero
    (if (i64.eqz (local.get $val))
      (then
        (i32.store8 (local.get $buf) (i32.const 48))
        (i32.store8 (i32.add (local.get $buf) (i32.const 1)) (i32.const 110))
        (return (i32.const 2))
      )
    )
    ;; Negative
    (if (i64.lt_s (local.get $val) (i64.const 0))
      (then
        (i32.store8 (local.get $buf) (i32.const 45))
        (local.set $buf (i32.add (local.get $buf) (i32.const 1)))
        (local.set $start (local.get $buf))
        (local.set $neg (i32.const 1))
        (local.set $val (i64.sub (i64.const 0) (local.get $val)))
      )
    )
    (local.set $end (local.get $buf))
    ;; Write digits in reverse
    (block $done
      (loop $loop
        (br_if $done (i64.eqz (local.get $val)))
        (local.set $digit (i32.wrap_i64 (i64.rem_u (local.get $val) (i64.const 10))))
        (i32.store8
          (local.get $end)
          (i32.add (i32.const 48) (local.get $digit))
        )
        (local.set $val (i64.div_u (local.get $val) (i64.const 10)))
        (local.set $end (i32.add (local.get $end) (i32.const 1)))
        (br $loop)
      )
    )
    ;; Reverse digit bytes in-place
    (local.set $tmp (local.get $start))
    (local.set $ch (i32.sub (local.get $end) (i32.const 1)))
    (block $rdone
      (loop $rloop
        (br_if $rdone (i32.ge_u (local.get $tmp) (local.get $ch)))
        (local.set $neg (i32.load8_u (local.get $tmp)))
        (i32.store8 (local.get $tmp) (i32.load8_u (local.get $ch)))
        (i32.store8 (local.get $ch) (local.get $neg))
        (local.set $tmp (i32.add (local.get $tmp) (i32.const 1)))
        (local.set $ch (i32.sub (local.get $ch) (i32.const 1)))
        (br $rloop)
      )
    )
    ;; Append 'n' suffix for bigint display
    (i32.store8 (local.get $end) (i32.const 110))
    (local.set $end (i32.add (local.get $end) (i32.const 1)))
    ;; Return total length (including leading '-' and trailing 'n')
    (i32.sub (local.get $end) (local.get $orig))
  )
  ;; Dynamic array grow_string: malloc new block of newcap elements, copy data, return new ptr.
  (func $__dynarr_grow_string (param $arr i32) (param $newcap i32) (result i32)
    (local $newptr i32)
    (local $len i32)
    (local $i i32)
    (local.set $len (i32.load (local.get $arr)))
    (local.set $newptr (call $__malloc (i32.add (i32.const 8) (i32.shl (local.get $newcap) (i32.const 3)))))
    (i32.store (local.get $newptr) (local.get $len))
    (i32.store offset=4 (local.get $newptr) (local.get $newcap))
    (local.set $i (i32.const 0))
    (block $brk
      (loop $lp
        (br_if $brk (i32.ge_u (local.get $i) (local.get $len)))
        (f64.store
          (i32.add (i32.add (local.get $newptr) (i32.const 8)) (i32.shl (local.get $i) (i32.const 3)))
          (f64.load
            (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (local.get $i) (i32.const 3)))
          )
        )
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $lp)
      )
    )
    (local.get $newptr)
  )

  ;; Dynamic string array push_string: grow if full, store (ptr,len) at end, return new arr ptr.
  (func $__dynarr_push_string (param $arr i32) (param $ptr i32) (param $len i32) (result i32)
    (local $elemLen i32)
    (local $cap i32)
    (local $base i32)
    (local.set $elemLen (i32.load (local.get $arr)))
    (local.set $cap (i32.load offset=4 (local.get $arr)))
    (if (i32.ge_u (local.get $elemLen) (local.get $cap))
      (then
        (local.set $arr (call $__dynarr_grow_string (local.get $arr) (select (i32.const 8) (i32.shl (local.get $cap) (i32.const 1)) (i32.eqz (local.get $cap)))))
      )
    )
    (local.set $base (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (local.get $elemLen) (i32.const 3))))
    (i32.store (local.get $base) (local.get $ptr))
    (i32.store offset=4 (local.get $base) (local.get $len))
    (i32.store (local.get $arr) (i32.add (local.get $elemLen) (i32.const 1)))
    (local.get $arr)
  )
  (func $indexOf (param $arr i32) (param $v_ptr i32) (param $v_len i32) (result f64)
    (local $i f64)
    (local.set $i (f64.const 0))
    (block $break_0
      (loop $loop_0
        (br_if $break_0 (i32.eqz (f64.lt (local.get $i) (f64.convert_i32_s (i32.load (local.get $arr))))))
        (block $cont_0
          (if (i32.eqz (call $__str_cmp (i32.load (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $i)) (i32.const 3)))) (i32.load offset=4 (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $i)) (i32.const 3)))) (local.get $v_ptr) (local.get $v_len)))
            (then
            (return (local.get $i))
            )
          )
        )
        (local.set $i (f64.add (local.get $i) (f64.const 1)))
        (br $loop_0)
      )
    )
    (return (f64.const -1))
  )

  (func $includes (param $arr i32) (param $v_ptr i32) (param $v_len i32) (result i32)
    (return (f64.ge (call $indexOf (local.get $arr) (local.get $v_ptr) (local.get $v_len)) (f64.const 0)))
  )

  (func $some (param $arr i32) (param $pred i32) (result i32)
    (local $i f64)
    (local.set $i (f64.const 0))
    (block $break_1
      (loop $loop_1
        (br_if $break_1 (i32.eqz (f64.lt (local.get $i) (f64.convert_i32_s (i32.load (local.get $arr))))))
        (block $cont_1
          (if (call_indirect (type $ftype_i32_i32_r_i32) (i32.load (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $i)) (i32.const 3)))) (i32.load offset=4 (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $i)) (i32.const 3)))) (local.get $pred))
            (then
            (return (i32.const 1))
            )
          )
        )
        (local.set $i (f64.add (local.get $i) (f64.const 1)))
        (br $loop_1)
      )
    )
    (return (i32.const 0))
  )

  (func $every (param $arr i32) (param $pred i32) (result i32)
    (local $i f64)
    (local.set $i (f64.const 0))
    (block $break_2
      (loop $loop_2
        (br_if $break_2 (i32.eqz (f64.lt (local.get $i) (f64.convert_i32_s (i32.load (local.get $arr))))))
        (block $cont_2
          (if (i32.eqz (call_indirect (type $ftype_i32_i32_r_i32) (i32.load (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $i)) (i32.const 3)))) (i32.load offset=4 (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $i)) (i32.const 3)))) (local.get $pred)))
            (then
            (return (i32.const 0))
            )
          )
        )
        (local.set $i (f64.add (local.get $i) (f64.const 1)))
        (br $loop_2)
      )
    )
    (return (i32.const 1))
  )

  (func $filter (param $arr i32) (param $pred i32) (result i32)
    (local $result i32)
    (local $i f64)
    (local $__iface_tmp i32)
    (local.set $result (call $__malloc (i32.const 72)))
      (i32.store (local.get $result) (i32.const 0))
      (i32.store offset=4 (local.get $result) (i32.const 8))
    (local.set $i (f64.const 0))
    (block $break_3
      (loop $loop_3
        (br_if $break_3 (i32.eqz (f64.lt (local.get $i) (f64.convert_i32_s (i32.load (local.get $arr))))))
        (block $cont_3
          (if (call_indirect (type $ftype_i32_i32_r_i32) (i32.load (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $i)) (i32.const 3)))) (i32.load offset=4 (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $i)) (i32.const 3)))) (local.get $pred))
            (then
            (local.set $result (call $__dynarr_push_string (local.get $result) (i32.load (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $i)) (i32.const 3)))) (i32.load offset=4 (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $i)) (i32.const 3))))))
            )
          )
        )
        (local.set $i (f64.add (local.get $i) (f64.const 1)))
        (br $loop_3)
      )
    )
    (return (local.get $result))
  )

  (func $mapStr (param $arr i32) (param $fn i32) (result i32)
    (local $result i32)
    (local $i f64)
    (local $__str_push_ptr i32)
    (local $__str_push_len i32)
    (local $__iface_tmp i32)
    (local.set $result (call $__malloc (i32.const 72)))
      (i32.store (local.get $result) (i32.const 0))
      (i32.store offset=4 (local.get $result) (i32.const 8))
    (local.set $i (f64.const 0))
    (block $break_4
      (loop $loop_4
        (br_if $break_4 (i32.eqz (f64.lt (local.get $i) (f64.convert_i32_s (i32.load (local.get $arr))))))
        (block $cont_4
          (call_indirect (type $ftype_i32_i32_r_void) (i32.load (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $i)) (i32.const 3)))) (i32.load offset=4 (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $i)) (i32.const 3)))) (local.get $fn))
(local.set $__str_push_ptr (global.get $__str_ret_ptr))
      (local.set $__str_push_len (global.get $__str_ret_len))
      (local.set $result (call $__dynarr_push_string (local.get $result) (local.get $__str_push_ptr) (local.get $__str_push_len)))
        )
        (local.set $i (f64.add (local.get $i) (f64.const 1)))
        (br $loop_4)
      )
    )
    (return (local.get $result))
  )

  (func $strArrStr (param $arr i32) 
    (local $s_ptr i32)
    (local $s_len i32)
    (local $i f64)
    (local $__ret_str_ptr i32)
    (local $__ret_str_len i32)
    (local $__str_op_ptr i32)
    (local $__str_op_len i32)
    (local.set $s_ptr (i32.const 260))
      (local.set $s_len (i32.const 1))
    (local.set $i (f64.const 0))
    (block $break_5
      (loop $loop_5
        (br_if $break_5 (i32.eqz (f64.lt (local.get $i) (f64.convert_i32_s (i32.load (local.get $arr))))))
        (block $cont_5
          (if (f64.gt (local.get $i) (f64.const 0))
            (then
            (local.set $s_ptr (local.get $s_ptr))
      (local.set $s_len (local.get $s_len))
      (call $__str_concat (local.get $s_ptr) (local.get $s_len) (i32.const 261) (i32.const 1))
      (local.set $s_len)
      (local.set $s_ptr)
            )
          )
          (local.set $s_ptr (local.get $s_ptr))
      (local.set $s_len (local.get $s_len))
      (call $__str_concat (local.get $s_ptr) (local.get $s_len) (i32.load (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $i)) (i32.const 3)))) (i32.load offset=4 (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (i32.trunc_f64_s (local.get $i)) (i32.const 3)))))
      (local.set $s_len)
      (local.set $s_ptr)
        )
        (local.set $i (f64.add (local.get $i) (f64.const 1)))
        (br $loop_5)
      )
    )
    (local.set $__ret_str_ptr (local.get $s_ptr))
      (local.set $__ret_str_len (local.get $s_len))
      (call $__str_concat (local.get $__ret_str_ptr) (local.get $__ret_str_len) (i32.const 262) (i32.const 1))
      (local.set $__ret_str_len)
      (local.set $__ret_str_ptr)
      (global.set $__str_ret_ptr (local.get $__ret_str_ptr))
      (global.set $__str_ret_len (local.get $__ret_str_len))
      (return)
  )

  (func $__anon_0 (param $v_ptr i32) (param $v_len i32) (result i32)
    (return (i32.eq (call $__str_char_code_at (local.get $v_ptr) (local.get $v_len) (i32.const 0)) (i32.const 112)))
  )

  (func $__anon_1 (param $v_ptr i32) (param $v_len i32) (result i32)
    (return (i32.eq (call $__str_char_code_at (local.get $v_ptr) (local.get $v_len) (i32.const 0)) (i32.const 112)))
  )

  (func $__anon_2 (param $v_ptr i32) (param $v_len i32) (result i32)
    (return (i32.eq (call $__str_char_code_at (local.get $v_ptr) (local.get $v_len) (i32.const 0)) (i32.const 112)))
  )

  (func $__anon_3 (param $v_ptr i32) (param $v_len i32) 
    (local $__iface_tmp i32)
    (local $__ret_str_ptr i32)
    (local $__ret_str_len i32)
    (local $__str_op_ptr i32)
    (local $__str_op_len i32)
    (call $__str_to_upper (local.get $v_ptr) (local.get $v_len))
      (local.set $__ret_str_len)
      (local.set $__ret_str_ptr)
      (global.set $__str_ret_ptr (local.get $__ret_str_ptr))
      (global.set $__str_ret_len (local.get $__ret_str_len))
      (return)
  )
  (func $_start (export "_start")
    (local $strs i32)
    (local $__iface_tmp i32)
    (local.set $strs (i32.const 281))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__f64_to_str (call $indexOf (local.get $strs) (i32.const 273) (i32.const 4)) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (if (result i32) (call $includes (local.get $strs) (i32.const 321) (i32.const 5)) (then (i32.const 326)) (else (i32.const 330))))
          (i32.store (i32.const 4) (if (result i32) (call $includes (local.get $strs) (i32.const 321) (i32.const 5)) (then (i32.const 4)) (else (i32.const 5))))
          (i32.store (i32.const 8) (i32.const 335))
          (i32.store (i32.const 12) (i32.const 1))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 2)
            (i32.const 128)))
        (i32.store (i32.const 0) (if (result i32) (call $some (local.get $strs) (i32.const 0)) (then (i32.const 326)) (else (i32.const 330))))
          (i32.store (i32.const 4) (if (result i32) (call $some (local.get $strs) (i32.const 0)) (then (i32.const 4)) (else (i32.const 5))))
          (i32.store (i32.const 8) (i32.const 335))
          (i32.store (i32.const 12) (i32.const 1))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 2)
            (i32.const 128)))
        (i32.store (i32.const 0) (if (result i32) (call $every (local.get $strs) (i32.const 1)) (then (i32.const 326)) (else (i32.const 330))))
          (i32.store (i32.const 4) (if (result i32) (call $every (local.get $strs) (i32.const 1)) (then (i32.const 4)) (else (i32.const 5))))
          (i32.store (i32.const 8) (i32.const 335))
          (i32.store (i32.const 12) (i32.const 1))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 2)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (i32.const 0))
          (call $strArrStr (call $filter (local.get $strs) (i32.const 2)))
          (call $__str_gather (global.get $__str_ret_ptr) (global.get $__str_ret_len) (i32.const 132))
          (i32.store (i32.const 4) (i32.add (i32.const 0) (global.get $__str_ret_len)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (i32.const 0))
          (call $strArrStr (call $mapStr (local.get $strs) (i32.const 3)))
          (call $__str_gather (global.get $__str_ret_ptr) (global.get $__str_ret_len) (i32.const 132))
          (i32.store (i32.const 4) (i32.add (i32.const 0) (global.get $__str_ret_len)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
    (call $proc_exit (i32.const 0))
  )
  (table 4 funcref)
  (elem (i32.const 0) $__anon_0 $__anon_1 $__anon_2 $__anon_3)
  (data (i32.const 260) "\5b")
  (data (i32.const 261) "\20")
  (data (i32.const 262) "\5d")
  (data (i32.const 263) "\70\65\61\63\68")
  (data (i32.const 268) "\61\70\70\6c\65")
  (data (i32.const 273) "\70\65\61\72")
  (data (i32.const 277) "\70\6c\75\6d")
  (data (i32.const 321) "\67\72\61\70\65")
  (data (i32.const 326) "\74\72\75\65")
  (data (i32.const 330) "\66\61\6c\73\65")
  (data (i32.const 335) "\0a")
  (data (i32.const 281) "\04\00\00\00\04\00\00\00\07\01\00\00\05\00\00\00\0c\01\00\00\05\00\00\00\11\01\00\00\04\00\00\00\15\01\00\00\04\00\00\00")
)