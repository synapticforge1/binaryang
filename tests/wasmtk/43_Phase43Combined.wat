(module
  (import "wasi_snapshot_preview1" "proc_exit" (func $proc_exit (param i32)))
  (import "wasi_snapshot_preview1" "fd_write" (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (memory (export "memory") 2)
  (global $__heap_ptr (mut i32) (i32.const 344))
  (type $ftype_i32_i32_r_i32 (func (param i32) (param i32) (result i32)))
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

  ;; ── f64 powers of 10 helper (used by $__f64_to_str shortening loop) ─────────
  (func $__pow10_f64 (param $n i32) (result f64)
    (if (i32.le_s (local.get $n) (i32.const 0))  (then (return (f64.const 1))))
    (if (i32.eq  (local.get $n) (i32.const 1))   (then (return (f64.const 10))))
    (if (i32.eq  (local.get $n) (i32.const 2))   (then (return (f64.const 100))))
    (if (i32.eq  (local.get $n) (i32.const 3))   (then (return (f64.const 1000))))
    (if (i32.eq  (local.get $n) (i32.const 4))   (then (return (f64.const 10000))))
    (if (i32.eq  (local.get $n) (i32.const 5))   (then (return (f64.const 100000))))
    (if (i32.eq  (local.get $n) (i32.const 6))   (then (return (f64.const 1000000))))
    (if (i32.eq  (local.get $n) (i32.const 7))   (then (return (f64.const 10000000))))
    (if (i32.eq  (local.get $n) (i32.const 8))   (then (return (f64.const 100000000))))
    (if (i32.eq  (local.get $n) (i32.const 9))   (then (return (f64.const 1000000000))))
    (if (i32.eq  (local.get $n) (i32.const 10))  (then (return (f64.const 10000000000))))
    (if (i32.eq  (local.get $n) (i32.const 11))  (then (return (f64.const 100000000000))))
    (if (i32.eq  (local.get $n) (i32.const 12))  (then (return (f64.const 1000000000000))))
    (if (i32.eq  (local.get $n) (i32.const 13))  (then (return (f64.const 10000000000000))))
    (if (i32.eq  (local.get $n) (i32.const 14))  (then (return (f64.const 100000000000000))))
    (f64.const 1000000000000000)
  )

  ;; ── f64 → decimal string ──────────────────────────────────────────────────
  ;; Writes the shortest decimal representation of $val at $buf, returns byte count.
  ;; Step 1: ×1e15 + f64.nearest gives up to 15 fractional digits.
  ;; Step 2: "shortest round-trip" loop strips any digit whose removal still
  ;;         reconstructs the exact same f64 via f64(ipart)+f64(trial)/f64(10^k).
  ;;         This eliminates spurious trailing digits caused by ×1e15 rounding.
  ;; Values outside [-2147483648, 2147483647] for the integer part are clamped.
  (func $__f64_to_str (param $val f64) (param $buf i32) (result i32)
    (local $len i32)
    (local $ipart i64)
    (local $fpart i64)
    (local $flen i32)
    (local $fdigits i64)
    (local $ptr i32)
    (local $cur_fpart i64)
    (local $cur_len i32)
    (local $trial i64)
    (local $recon f64)
    (local.set $ptr (local.get $buf))
    ;; Handle negative
    (if (f64.lt (local.get $val) (f64.const 0))
      (then
        (i32.store8 (local.get $ptr) (i32.const 45))
        (local.set $ptr (i32.add (local.get $ptr) (i32.const 1)))
        (local.set $val (f64.neg (local.get $val)))
      )
    )
    ;; Integer part — use i64 to support values beyond i32 range (up to ~9.2e18)
    ;; Subtract 1 from i64_to_str result to exclude the 'n' bigint suffix it appends.
    (local.set $ipart (i64.trunc_f64_s (local.get $val)))
    (local.set $len (i32.sub (call $__i64_to_str (local.get $ipart) (local.get $ptr)) (i32.const 1)))
    (local.set $ptr (i32.add (local.get $ptr) (local.get $len)))
    ;; Step 1: ×1e15, round to nearest integer → up to 15 fractional digits.
    (local.set $fpart
      (i64.trunc_f64_s
        (f64.nearest
          (f64.mul
            (f64.sub (local.get $val) (f64.convert_i64_s (local.get $ipart)))
            (f64.const 1000000000000000)
          )
        )
      )
    )
    ;; Step 2: shorten — strip digits from the right as long as the decimal
    ;; still round-trips to the original f64.  Powers of 10 in [1,1e15] are
    ;; exact in f64 (≤50 significant bits), so the reconstruction arithmetic
    ;; is reliable and the loop never produces a false positive.
    (local.set $cur_fpart (local.get $fpart))
    (local.set $cur_len   (i32.const 15))
    (block $shorten_done
      (loop $shorten_loop
        (br_if $shorten_done (i32.le_s (local.get $cur_len) (i32.const 1)))
        (local.set $trial (i64.div_u (local.get $cur_fpart) (i64.const 10)))
        (local.set $recon
          (f64.add
            (f64.convert_i64_s (local.get $ipart))
            (f64.div
              (f64.convert_i64_s (local.get $trial))
              (call $__pow10_f64 (i32.sub (local.get $cur_len) (i32.const 1)))
            )
          )
        )
        (if (f64.ne (local.get $recon) (local.get $val))
          (then (br $shorten_done))
        )
        (local.set $cur_fpart (local.get $trial))
        (local.set $cur_len   (i32.sub (local.get $cur_len) (i32.const 1)))
        (br $shorten_loop)
      )
    )
    (local.set $fpart (local.get $cur_fpart))
    (if (i64.ne (local.get $fpart) (i64.const 0))
      (then
        ;; Decimal point
        (i32.store8 (local.get $ptr) (i32.const 46))
        (local.set $ptr (i32.add (local.get $ptr) (i32.const 1)))
        ;; Write $cur_len-digit fractional string (least significant digit first)
        (local.set $fdigits (local.get $fpart))
        (local.set $flen    (local.get $cur_len))
        (block $fdone
          (loop $floop
            (br_if $fdone (i32.eqz (local.get $flen)))
            (i32.store8
              (i32.add (local.get $ptr) (i32.sub (local.get $flen) (i32.const 1)))
              (i32.add (i32.const 48) (i32.wrap_i64 (i64.rem_u (local.get $fdigits) (i64.const 10))))
            )
            (local.set $fdigits (i64.div_u (local.get $fdigits) (i64.const 10)))
            (local.set $flen    (i32.sub   (local.get $flen)    (i32.const 1)))
            (br $floop)
          )
        )
        ;; Strip trailing zeros
        (local.set $flen (local.get $cur_len))
        (block $strip
          (loop $striploop
            (br_if $strip (i32.eqz (local.get $flen)))
            (br_if $strip
              (i32.ne
                (i32.load8_u (i32.add (local.get $ptr) (i32.sub (local.get $flen) (i32.const 1))))
                (i32.const 48)
              )
            )
            (local.set $flen (i32.sub (local.get $flen) (i32.const 1)))
            (br $striploop)
          )
        )
        (local.set $ptr (i32.add (local.get $ptr) (local.get $flen)))
      )
    )
    ;; Return total length written
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
        (local.set $arr (call $__dynarr_grow_string (local.get $arr) (i32.shl (local.get $cap) (i32.const 1))))
      )
    )
    (local.set $base (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (local.get $elemLen) (i32.const 3))))
    (i32.store (local.get $base) (local.get $ptr))
    (i32.store offset=4 (local.get $base) (local.get $len))
    (i32.store (local.get $arr) (i32.add (local.get $elemLen) (i32.const 1)))
    (local.get $arr)
  )
  (func $strIndexOf (param $arr i32) (param $v_ptr i32) (param $v_len i32) (result i32)
    (local $i i32)
    (local.set $i (i32.const 0))
    (block $break_0
      (loop $loop_0
        (br_if $break_0 (i32.eqz (i32.lt_s (local.get $i) (i32.load (local.get $arr)))))
        (block $cont_0
          (if (i32.eqz (call $__str_cmp (i32.load (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (local.get $i) (i32.const 3)))) (i32.load offset=4 (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (local.get $i) (i32.const 3)))) (local.get $v_ptr) (local.get $v_len)))
            (then
            (return (local.get $i))
            )
          )
        )
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop_0)
      )
    )
    (return (i32.const -1))
  )

  (func $strSome (param $arr i32) (param $pred i32) (result i32)
    (local $i i32)
    (local.set $i (i32.const 0))
    (block $break_1
      (loop $loop_1
        (br_if $break_1 (i32.eqz (i32.lt_s (local.get $i) (i32.load (local.get $arr)))))
        (block $cont_1
          (if (call_indirect (type $ftype_i32_i32_r_i32) (i32.load (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (local.get $i) (i32.const 3)))) (i32.load offset=4 (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (local.get $i) (i32.const 3)))) (local.get $pred))
            (then
            (return (i32.const 1))
            )
          )
        )
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop_1)
      )
    )
    (return (i32.const 0))
  )

  (func $strEvery (param $arr i32) (param $pred i32) (result i32)
    (local $i i32)
    (local.set $i (i32.const 0))
    (block $break_2
      (loop $loop_2
        (br_if $break_2 (i32.eqz (i32.lt_s (local.get $i) (i32.load (local.get $arr)))))
        (block $cont_2
          (if (i32.eqz (call_indirect (type $ftype_i32_i32_r_i32) (i32.load (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (local.get $i) (i32.const 3)))) (i32.load offset=4 (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (local.get $i) (i32.const 3)))) (local.get $pred)))
            (then
            (return (i32.const 0))
            )
          )
        )
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop_2)
      )
    )
    (return (i32.const 1))
  )

  (func $strFilter (param $arr i32) (param $pred i32) (result i32)
    (local $result i32)
    (local $i i32)
    (local $__iface_tmp i32)
    (local.set $result (call $__malloc (i32.const 72)))
      (i32.store (local.get $result) (i32.const 0))
      (i32.store offset=4 (local.get $result) (i32.const 8))
    (local.set $i (i32.const 0))
    (block $break_3
      (loop $loop_3
        (br_if $break_3 (i32.eqz (i32.lt_s (local.get $i) (i32.load (local.get $arr)))))
        (block $cont_3
          (if (call_indirect (type $ftype_i32_i32_r_i32) (i32.load (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (local.get $i) (i32.const 3)))) (i32.load offset=4 (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (local.get $i) (i32.const 3)))) (local.get $pred))
            (then
            (local.set $result (call $__dynarr_push_string (local.get $result) (i32.load (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (local.get $i) (i32.const 3)))) (i32.load offset=4 (i32.add (i32.add (local.get $arr) (i32.const 8)) (i32.shl (local.get $i) (i32.const 3))))))
            )
          )
        )
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop_3)
      )
    )
    (return (local.get $result))
  )

  (func $startsWithB (param $s_ptr i32) (param $s_len i32) (result i32)
    (return (i32.eq (call $__str_char_code_at (local.get $s_ptr) (local.get $s_len) (i32.const 0)) (i32.const 98)))
  )

  (func $longerThan4 (param $s_ptr i32) (param $s_len i32) (result i32)
    (return (i32.gt_s (local.get $s_len) (i32.const 4)))
  )
  (func $_start (export "_start")
    (local $vegs i32)
    (local $bVegs i32)
    (local $longVegs i32)
    (local $__iface_tmp i32)
    (local.set $vegs (i32.const 286))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__i32_to_str (call $strIndexOf (local.get $vegs) (i32.const 266) (i32.const 4)) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (if (result i32) (call $strSome (local.get $vegs) (i32.const 0)) (then (i32.const 334)) (else (i32.const 338))))
          (i32.store (i32.const 4) (if (result i32) (call $strSome (local.get $vegs) (i32.const 0)) (then (i32.const 4)) (else (i32.const 5))))
          (i32.store (i32.const 8) (i32.const 343))
          (i32.store (i32.const 12) (i32.const 1))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 2)
            (i32.const 128)))
        (i32.store (i32.const 0) (if (result i32) (call $strEvery (local.get $vegs) (i32.const 0)) (then (i32.const 334)) (else (i32.const 338))))
          (i32.store (i32.const 4) (if (result i32) (call $strEvery (local.get $vegs) (i32.const 0)) (then (i32.const 4)) (else (i32.const 5))))
          (i32.store (i32.const 8) (i32.const 343))
          (i32.store (i32.const 12) (i32.const 1))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 2)
            (i32.const 128)))
    (local.set $bVegs (call $strFilter (local.get $vegs) (i32.const 0)))
    (local.set $longVegs (call $strFilter (local.get $vegs) (i32.const 1)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__i32_to_str (i32.load (local.get $bVegs)) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__i32_to_str (i32.load (local.get $longVegs)) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (if (result i32) (i32.eqz (call $__str_cmp (i32.load (i32.add (i32.add (local.get $bVegs) (i32.const 8)) (i32.shl (i32.const 0) (i32.const 3)))) (i32.load offset=4 (i32.add (i32.add (local.get $bVegs) (i32.const 8)) (i32.shl (i32.const 0) (i32.const 3)))) (i32.const 266) (i32.const 4))) (then (i32.const 334)) (else (i32.const 338))))
          (i32.store (i32.const 4) (if (result i32) (i32.eqz (call $__str_cmp (i32.load (i32.add (i32.add (local.get $bVegs) (i32.const 8)) (i32.shl (i32.const 0) (i32.const 3)))) (i32.load offset=4 (i32.add (i32.add (local.get $bVegs) (i32.const 8)) (i32.shl (i32.const 0) (i32.const 3)))) (i32.const 266) (i32.const 4))) (then (i32.const 4)) (else (i32.const 5))))
          (i32.store (i32.const 8) (i32.const 343))
          (i32.store (i32.const 12) (i32.const 1))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 2)
            (i32.const 128)))
    (call $proc_exit (i32.const 0))
  )
  (table 2 funcref)
  (elem (i32.const 0) $startsWithB $longerThan4)
  (data (i32.const 260) "\63\61\72\72\6f\74")
  (data (i32.const 266) "\62\65\61\6e")
  (data (i32.const 270) "\62\72\6f\63\63\6f\6c\69")
  (data (i32.const 278) "\62\65\65\74")
  (data (i32.const 282) "\63\6f\72\6e")
  (data (i32.const 334) "\74\72\75\65")
  (data (i32.const 338) "\66\61\6c\73\65")
  (data (i32.const 343) "\0a")
  (data (i32.const 286) "\05\00\00\00\05\00\00\00\04\01\00\00\06\00\00\00\0a\01\00\00\04\00\00\00\0e\01\00\00\08\00\00\00\16\01\00\00\04\00\00\00\1a\01\00\00\04\00\00\00")
)