(module
  (import "wasi_snapshot_preview1" "proc_exit" (func $proc_exit (param i32)))
  (import "wasi_snapshot_preview1" "fd_write" (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (memory (export "memory") 2)
  (global $__heap_ptr (mut i32) (i32.const 297))
  (global $__nullable_ret_flag (mut i32) (i32.const 0))
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
  (func $maybeGet (param $flag i32) (result i32)
    (if (local.get $flag)
      (then
      (global.set $__nullable_ret_flag (i32.const 1))
      (return (i32.const 100))
      )
    )
    (global.set $__nullable_ret_flag (i32.const 0))
      (return (i32.const 0))
  )
  (func $_start (export "_start")
    (local $a i32)
    (local $a__null i32)
    (local $b i32)
    (local $b__null i32)
    (local $c i32)
    (local $c__null i32)
    (local $d i32)
    (local $d__null i32)
    (local $e i32)
    (local $e__null i32)
    (local $fv f64)
    (local $fv__null i32)
    (local $gv f64)
    (local $gv__null i32)
    (local $r1 i32)
    (local $r1__null i32)
    (local $r2 i32)
    (local $r2__null i32)
    (local $__iface_tmp i32)
    (local.set $a__null (i32.const 1))
    (if (local.get $a__null)
      (then
          (i32.store (i32.const 0) (i32.const 260))
          (i32.store (i32.const 4) (i32.const 10))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
      )
    )
    (local.set $b (i32.const 99))
      (local.set $b__null (i32.const 0))
    (if (i32.eqz (local.get $b__null))
      (then
          (if (local.get $b__null)
      (then
        (i32.store (i32.const 0) (i32.const 270))
        (i32.store (i32.const 4) (i32.const 5))
        (drop (call $fd_write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 128)))
      )
      (else
        (i32.store (i32.const 0) (i32.const 132))
        (i32.store (i32.const 4) (call $__i32_to_str (local.get $b) (i32.const 132)))
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
    )
    (local.set $c__null (i32.const 1))
        (if (local.get $c__null)
      (then
        (i32.store (i32.const 0) (i32.const 270))
        (i32.store (i32.const 4) (i32.const 5))
        (drop (call $fd_write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 128)))
      )
      (else
        (i32.store (i32.const 0) (i32.const 132))
        (i32.store (i32.const 4) (call $__i32_to_str (local.get $c) (i32.const 132)))
        (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
        (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
        (drop (call $fd_write
          (i32.const 1)
          (i32.const 0)
          (i32.const 1)
          (i32.const 128)))
      )
    )
    (local.set $d (i32.const 7))
      (local.set $d__null (i32.const 0))
        (if (local.get $d__null)
      (then
        (i32.store (i32.const 0) (i32.const 270))
        (i32.store (i32.const 4) (i32.const 5))
        (drop (call $fd_write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 128)))
      )
      (else
        (i32.store (i32.const 0) (i32.const 132))
        (i32.store (i32.const 4) (call $__i32_to_str (local.get $d) (i32.const 132)))
        (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
        (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
        (drop (call $fd_write
          (i32.const 1)
          (i32.const 0)
          (i32.const 1)
          (i32.const 128)))
      )
    )
    (local.set $e (i32.const 5))
      (local.set $e__null (i32.const 0))
        (if (local.get $e__null)
      (then
        (i32.store (i32.const 0) (i32.const 270))
        (i32.store (i32.const 4) (i32.const 5))
        (drop (call $fd_write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 128)))
      )
      (else
        (i32.store (i32.const 0) (i32.const 132))
        (i32.store (i32.const 4) (call $__i32_to_str (local.get $e) (i32.const 132)))
        (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
        (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
        (drop (call $fd_write
          (i32.const 1)
          (i32.const 0)
          (i32.const 1)
          (i32.const 128)))
      )
    )
    (local.set $e__null (i32.const 1))
        (if (local.get $e__null)
      (then
        (i32.store (i32.const 0) (i32.const 270))
        (i32.store (i32.const 4) (i32.const 5))
        (drop (call $fd_write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 128)))
      )
      (else
        (i32.store (i32.const 0) (i32.const 132))
        (i32.store (i32.const 4) (call $__i32_to_str (local.get $e) (i32.const 132)))
        (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
        (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
        (drop (call $fd_write
          (i32.const 1)
          (i32.const 0)
          (i32.const 1)
          (i32.const 128)))
      )
    )
    (local.set $e (i32.const 42))
      (local.set $e__null (i32.const 0))
        (if (local.get $e__null)
      (then
        (i32.store (i32.const 0) (i32.const 270))
        (i32.store (i32.const 4) (i32.const 5))
        (drop (call $fd_write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 128)))
      )
      (else
        (i32.store (i32.const 0) (i32.const 132))
        (i32.store (i32.const 4) (call $__i32_to_str (local.get $e) (i32.const 132)))
        (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
        (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
        (drop (call $fd_write
          (i32.const 1)
          (i32.const 0)
          (i32.const 1)
          (i32.const 128)))
      )
    )
    (local.set $fv__null (i32.const 1))
    (if (local.get $fv__null)
      (then
          (i32.store (i32.const 0) (i32.const 275))
          (i32.store (i32.const 4) (i32.const 11))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
      )
    )
    (local.set $gv (f64.const 3.14))
      (local.set $gv__null (i32.const 0))
    (if (i32.eqz (local.get $gv__null))
      (then
          (if (local.get $gv__null)
      (then
        (i32.store (i32.const 0) (i32.const 270))
        (i32.store (i32.const 4) (i32.const 5))
        (drop (call $fd_write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 128)))
      )
      (else
        (i32.store (i32.const 0) (i32.const 132))
        (i32.store (i32.const 4) (call $__f64_to_str (local.get $gv) (i32.const 132)))
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
    )
    (local.set $r1 (call $maybeGet (i32.const 1)))
      (local.set $r1__null (i32.eqz (global.get $__nullable_ret_flag)))
    (if (i32.eqz (local.get $r1__null))
      (then
          (if (local.get $r1__null)
      (then
        (i32.store (i32.const 0) (i32.const 270))
        (i32.store (i32.const 4) (i32.const 5))
        (drop (call $fd_write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 128)))
      )
      (else
        (i32.store (i32.const 0) (i32.const 132))
        (i32.store (i32.const 4) (call $__i32_to_str (local.get $r1) (i32.const 132)))
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
    )
    (local.set $r2 (call $maybeGet (i32.const 0)))
      (local.set $r2__null (i32.eqz (global.get $__nullable_ret_flag)))
    (if (local.get $r2__null)
      (then
          (i32.store (i32.const 0) (i32.const 286))
          (i32.store (i32.const 4) (i32.const 11))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
      )
    )
    (call $proc_exit (i32.const 0))
  )
  (data (i32.const 260) "\61\20\69\73\20\6e\75\6c\6c\0a")
  (data (i32.const 270) "\6e\75\6c\6c\0a")
  (data (i32.const 275) "\66\76\20\69\73\20\6e\75\6c\6c\0a")
  (data (i32.const 286) "\72\32\20\69\73\20\6e\75\6c\6c\0a")
)