(module
  (import "wasi_snapshot_preview1" "proc_exit" (func $proc_exit (param i32)))
  (import "wasi_snapshot_preview1" "fd_write" (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (memory (export "memory") 2)
  (global $__heap_ptr (mut i32) (i32.const 260))
  (global $__d4s (mut i32) (i32.const 0))
  (global $__free_list (mut i32) (i32.const 0))
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
  (func $id (param $x f64) (result f64)
    (return (f64.add (local.get $x) (f64.const 0.0)))
  )
  (func $_start (export "_start")
    (local $__iface_tmp i32)
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__f64_to_str (call $mathlib_sin (call $id (f64.const 1.0))) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__f64_to_str (call $mathlib_cos (call $id (f64.const 1.0))) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__f64_to_str (call $mathlib_tan (call $id (f64.const 1.0))) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__f64_to_str (call $mathlib_sin (call $id (f64.const 0.5))) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__f64_to_str (call $mathlib_cos (call $id (f64.const 0.5))) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__f64_to_str (call $mathlib_tan (call $id (f64.const 0.5))) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__f64_to_str (call $mathlib_sin (call $id (f64.const 2.5))) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__f64_to_str (call $mathlib_cos (call $id (f64.const 2.5))) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__f64_to_str (call $mathlib_tan (call $id (f64.const 2.5))) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__f64_to_str (call $mathlib_sin (call $id (f64.const 3.14159))) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__f64_to_str (call $mathlib_cos (call $id (f64.const 3.14159))) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__f64_to_str (call $mathlib_sin (call $id (f64.const 100.0))) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__f64_to_str (call $mathlib_cos (call $id (f64.const 100.0))) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__f64_to_str (call $mathlib_tan (call $id (f64.const 100.0))) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__f64_to_str (call $mathlib_sin (call $id (f64.const 123456789.123))) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__f64_to_str (call $mathlib_cos (call $id (f64.const 123456789.123))) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__f64_to_str (call $mathlib_tan (call $id (f64.const 123456789.123))) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__f64_to_str (call $mathlib_sin (call $id (f64.const 500000000.0))) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__f64_to_str (call $mathlib_cos (call $id (f64.const 500000000.0))) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__f64_to_str (call $mathlib_tan (call $id (f64.const 500000000.0))) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__f64_to_str (call $mathlib_sin (call $id (f64.const 1000000000.0))) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__f64_to_str (call $mathlib_cos (call $id (f64.const 1000000000.0))) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
        (i32.store (i32.const 0) (i32.const 132))
          (i32.store (i32.const 4) (call $__f64_to_str (call $mathlib_tan (call $id (f64.const 1000000000.0))) (i32.const 132)))
          (i32.store8 (i32.add (i32.const 132) (i32.load (i32.const 4))) (i32.const 10))
          (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
          (drop (call $fd_write
            (i32.const 1)
            (i32.const 0)
            (i32.const 1)
            (i32.const 128)))
    (call $proc_exit (i32.const 0))
  )

  ;; globals from mathlib
  (global $mathlib_global0 (mut i64) (i64.const 7809847782465536322))
  (global $mathlib_global1 (mut f64) (f64.const 0x0p+0 (;=0;)))
  (global $mathlib_global2 (mut f64) (f64.const 0x0p+0 (;=0;)))
  ;; functions from mathlib
  (func $mathlib_random (result f64)
    (local i64)
    global.get $mathlib_global0
    local.set 0
    local.get 0
    local.get 0
    i64.const 13
    i64.shl
    i64.xor
    local.set 0
    local.get 0
    local.get 0
    i64.const 7
    i64.shr_u
    i64.xor
    local.set 0
    local.get 0
    local.get 0
    i64.const 17
    i64.shl
    i64.xor
    local.set 0
    local.get 0
    global.set $mathlib_global0
    local.get 0
    i64.const 12
    i64.shr_u
    i64.const 4607182418800017408
    i64.or
    f64.reinterpret_i64
    f64.const 0x1.0p+0 (;=1;)
    f64.sub)
  (func $mathlib__fn1 (param f64) (result i32)
    local.get 0
    i64.reinterpret_f64
    i64.const 32
    i64.shr_u
    i32.wrap_i64
    i32.const 2147483647
    i32.and)
  (func $mathlib__fn2 (param f64 f64) (result f64 f64)
    (local f64) (local f64)
    local.get 0
    local.get 1
    f64.add
    local.set 2
    local.get 2
    local.get 0
    f64.sub
    local.set 3
    local.get 2
    local.get 0
    local.get 2
    local.get 3
    f64.sub
    f64.sub
    local.get 1
    local.get 3
    f64.sub
    f64.add)
  (func $mathlib__fn3 (param f64 f64) (result f64 f64)
    (local f64) (local f64) (local f64) (local f64) (local f64) (local f64)
    local.get 0
    local.get 1
    f64.mul
    local.set 2
    f64.const 0x1.0000002p+27 (;=134217729;)
    local.get 0
    f64.mul
    local.set 3
    local.get 3
    local.get 3
    local.get 0
    f64.sub
    f64.sub
    local.set 4
    local.get 0
    local.get 4
    f64.sub
    local.set 5
    f64.const 0x1.0000002p+27 (;=134217729;)
    local.get 1
    f64.mul
    local.set 3
    local.get 3
    local.get 3
    local.get 1
    f64.sub
    f64.sub
    local.set 6
    local.get 1
    local.get 6
    f64.sub
    local.set 7
    local.get 2
    local.get 4
    local.get 6
    f64.mul
    local.get 2
    f64.sub
    local.get 4
    local.get 7
    f64.mul
    f64.add
    local.get 5
    local.get 6
    f64.mul
    f64.add
    local.get 5
    local.get 7
    f64.mul
    f64.add)
  (func $mathlib__fn4 (param f64 f64 f64 f64) (result f64 f64)
    (local f64) (local f64)
    local.get 0
    local.get 2
    call $mathlib__fn2
    local.set 5
    nop
    nop
    local.set 4
    local.get 5
    local.get 1
    local.get 3
    f64.add
    f64.add
    local.set 5
    local.get 4
    local.get 5
    call $mathlib__fn2)
  (func $mathlib__fn5 (param f64 f64 f64 f64) (result f64 f64)
    (local f64) (local f64)
    local.get 0
    local.get 2
    call $mathlib__fn3
    local.set 5
    nop
    nop
    local.set 4
    local.get 5
    local.get 0
    local.get 3
    f64.mul
    local.get 1
    local.get 2
    f64.mul
    f64.add
    f64.add
    local.set 5
    local.get 4
    local.get 5
    call $mathlib__fn2)
  (func $mathlib__fn6 (param f64) (result f64 f64)
    (local f64) (local f64) (local f64) (local f64)
    f64.const 0x1.0p+0 (;=1;)
    local.get 0
    f64.div
    local.set 1
    local.get 1
    local.get 0
    call $mathlib__fn3
    local.set 3
    nop
    nop
    local.set 2
    f64.const 0x1.0p+0 (;=1;)
    local.get 2
    f64.sub
    local.get 3
    f64.sub
    local.set 4
    local.get 1
    local.get 4
    local.get 1
    f64.mul
    call $mathlib__fn2)
  (func $mathlib__fn7 (param f64 f64 f64) (result f64 f64)
    (local f64) (local f64)
    local.get 0
    local.get 2
    call $mathlib__fn3
    local.set 4
    nop
    nop
    local.set 3
    local.get 4
    local.get 1
    local.get 2
    f64.mul
    f64.add
    local.set 4
    local.get 3
    local.get 4
    call $mathlib__fn2)
  (func $mathlib__fn8 (param f64 f64 f64 f64) (result f64 f64)
    (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64)
    local.get 0
    local.get 2
    f64.div
    local.set 4
    local.get 2
    local.get 3
    local.get 4
    call $mathlib__fn7
    local.set 8
    nop
    nop
    local.set 7
    local.get 0
    local.get 1
    local.get 7
    f64.neg
    local.get 8
    f64.neg
    call $mathlib__fn4
    local.set 10
    nop
    nop
    local.set 9
    local.get 9
    local.get 2
    f64.div
    local.set 5
    local.get 2
    local.get 3
    local.get 5
    call $mathlib__fn7
    local.set 8
    nop
    nop
    local.set 7
    local.get 9
    local.get 10
    local.get 7
    f64.neg
    local.get 8
    f64.neg
    call $mathlib__fn4
    local.set 10
    nop
    nop
    local.set 9
    local.get 9
    local.get 2
    f64.div
    local.set 6
    local.get 4
    local.get 5
    call $mathlib__fn2
    local.set 12
    nop
    nop
    local.set 11
    local.get 12
    local.get 6
    f64.add
    local.set 12
    local.get 11
    local.get 12
    call $mathlib__fn2)
  (func $mathlib__fn9 (param f64 f64) (result f64 f64)
    (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local i32) (local f64)
    local.get 0
    local.get 1
    local.get 0
    local.get 1
    call $mathlib__fn5
    local.set 3
    nop
    nop
    local.set 2
    local.get 0
    local.set 4
    local.get 1
    local.set 5
    local.get 0
    local.set 6
    local.get 1
    local.set 7
    i32.const 1
    local.set 10
    block  ;; label = @1
      loop  ;; label = @2
        local.get 10
        i32.const 11
        i32.gt_u
        br_if 1 (;@1;)
        local.get 4
        local.get 5
        local.get 2
        local.get 3
        call $mathlib__fn5
        local.set 5
        nop
        nop
        local.set 4
        i32.const -1
        i32.const 2
        local.get 10
        i32.mul
        i32.const 2
        local.get 10
        i32.mul
        i32.const 1
        i32.add
        i32.mul
        i32.mul
        f64.convert_i32_s
        local.set 11
        local.get 11
        call $mathlib__fn6
        local.set 9
        nop
        nop
        local.set 8
        local.get 4
        local.get 5
        local.get 8
        local.get 9
        call $mathlib__fn5
        local.set 5
        nop
        nop
        local.set 4
        local.get 6
        local.get 7
        local.get 4
        local.get 5
        call $mathlib__fn4
        local.set 7
        nop
        nop
        local.set 6
        local.get 10
        i32.const 1
        i32.add
        local.set 10
        br 0 (;@2;)
      end
    end
    local.get 6
    local.get 7)
  (func $mathlib__fn10 (param f64 f64) (result f64 f64)
    (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local i32) (local f64)
    local.get 0
    local.get 1
    local.get 0
    local.get 1
    call $mathlib__fn5
    local.set 3
    nop
    nop
    local.set 2
    f64.const 0x1.0p+0 (;=1;)
    local.set 4
    f64.const 0x0p+0 (;=0;)
    local.set 5
    f64.const 0x1.0p+0 (;=1;)
    local.set 6
    f64.const 0x0p+0 (;=0;)
    local.set 7
    i32.const 1
    local.set 10
    block  ;; label = @1
      loop  ;; label = @2
        local.get 10
        i32.const 11
        i32.gt_u
        br_if 1 (;@1;)
        local.get 4
        local.get 5
        local.get 2
        local.get 3
        call $mathlib__fn5
        local.set 5
        nop
        nop
        local.set 4
        i32.const -1
        i32.const 2
        local.get 10
        i32.mul
        i32.const 1
        i32.sub
        i32.const 2
        local.get 10
        i32.mul
        i32.mul
        i32.mul
        f64.convert_i32_s
        local.set 11
        local.get 11
        call $mathlib__fn6
        local.set 9
        nop
        nop
        local.set 8
        local.get 4
        local.get 5
        local.get 8
        local.get 9
        call $mathlib__fn5
        local.set 5
        nop
        nop
        local.set 4
        local.get 6
        local.get 7
        local.get 4
        local.get 5
        call $mathlib__fn4
        local.set 7
        nop
        nop
        local.set 6
        local.get 10
        i32.const 1
        i32.add
        local.set 10
        br 0 (;@2;)
      end
    end
    local.get 6
    local.get 7)
  (func $mathlib__fn11 (param f64) (result i32)
    (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local i32) (local f64)
    local.get 0
    f64.const 0x1.45f306dc9c883p-1 (;=0.6366197723675814;)
    f64.mul
    f64.nearest
    local.set 1
    f64.const 0x1.00000008p+29 (;=536870913;)
    local.get 1
    f64.mul
    local.set 2
    local.get 2
    local.get 2
    local.get 1
    f64.sub
    f64.sub
    local.set 3
    local.get 1
    local.get 3
    f64.sub
    local.set 4
    local.get 0
    local.set 5
    f64.const 0x0p+0 (;=0;)
    local.set 6
    i32.const 0
    local.set 9
    block  ;; label = @1
      loop  ;; label = @2
        local.get 9
        i32.const 7
        i32.ge_u
        br_if 1 (;@1;)
        f64.const 0x1.921fb4p+0 (;=1.570796251296997;)
        f64.const 0x1.4442dp-24 (;=7.549789415861596e-8;)
        f64.const 0x1.846988p-48 (;=5.390302529957765e-15;)
        f64.const 0x1.8cc516p-72 (;=3.282003415807913e-22;)
        f64.const 0x1.01b838p-96 (;=1.270655753080676e-29;)
        f64.const 0x1.a25204p-120 (;=1.2293330898111133e-36;)
        f64.const 0x1.382228p-145 (;=2.7337005381646456e-44;)
        local.get 9
        i32.const 5
        i32.eq
        select
        local.get 9
        i32.const 4
        i32.eq
        select
        local.get 9
        i32.const 3
        i32.eq
        select
        local.get 9
        i32.const 2
        i32.eq
        select
        local.get 9
        i32.const 1
        i32.eq
        select
        local.get 9
        i32.eqz
        select
        local.set 10
        local.get 3
        local.get 10
        f64.mul
        local.set 7
        local.get 5
        local.get 7
        f64.sub
        local.set 8
        local.get 6
        local.get 5
        local.get 8
        f64.sub
        local.get 7
        f64.sub
        f64.add
        local.set 6
        local.get 8
        local.set 5
        local.get 4
        local.get 10
        f64.mul
        local.set 7
        local.get 5
        local.get 7
        f64.sub
        local.set 8
        local.get 6
        local.get 5
        local.get 8
        f64.sub
        local.get 7
        f64.sub
        f64.add
        local.set 6
        local.get 8
        local.set 5
        local.get 9
        i32.const 1
        i32.add
        local.set 9
        br 0 (;@2;)
      end
    end
    local.get 5
    local.get 6
    call $mathlib__fn2
    global.set $mathlib_global2
    nop
    nop
    global.set $mathlib_global1
    local.get 1
    i64.trunc_f64_s
    i32.wrap_i64
    i32.const 3
    i32.and)
  (func $mathlib_sin (param f64) (result f64)
    (local i32) (local i32) (local f64) (local f64)
    local.get 0
    call $mathlib__fn1
    local.set 1
    local.get 1
    i32.const 1072243195
    i32.le_u
    if  ;; label = @1
      local.get 0
      f64.const 0x0p+0 (;=0;)
      call $mathlib__fn9
      local.set 4
      nop
      nop
      local.set 3
      local.get 3
      local.get 4
      f64.add
      return
    end
    local.get 1
    i32.const 2146435072
    i32.ge_u
    if  ;; label = @1
      local.get 0
      local.get 0
      f64.sub
      return
    end
    local.get 0
    call $mathlib__fn11
    local.set 2
    local.get 2
    i32.const 1
    i32.and
    if  ;; label = @1
      global.get $mathlib_global1
      global.get $mathlib_global2
      call $mathlib__fn10
      local.set 4
      nop
      nop
      local.set 3
    else
      global.get $mathlib_global1
      global.get $mathlib_global2
      call $mathlib__fn9
      local.set 4
      nop
      nop
      local.set 3
    end
    local.get 2
    i32.const 2
    i32.ge_u
    if (result f64)  ;; label = @1
      local.get 3
      local.get 4
      f64.add
      f64.neg
    else
      local.get 3
      local.get 4
      f64.add
    end)
  (func $mathlib_cos (param f64) (result f64)
    (local i32) (local i32) (local f64) (local f64)
    local.get 0
    call $mathlib__fn1
    local.set 1
    local.get 1
    i32.const 1072243195
    i32.le_u
    if  ;; label = @1
      local.get 0
      f64.const 0x0p+0 (;=0;)
      call $mathlib__fn10
      local.set 4
      nop
      nop
      local.set 3
      local.get 3
      local.get 4
      f64.add
      return
    end
    local.get 1
    i32.const 2146435072
    i32.ge_u
    if  ;; label = @1
      local.get 0
      local.get 0
      f64.sub
      return
    end
    local.get 0
    call $mathlib__fn11
    local.set 2
    local.get 2
    i32.const 1
    i32.and
    if  ;; label = @1
      global.get $mathlib_global1
      global.get $mathlib_global2
      call $mathlib__fn9
      local.set 4
      nop
      nop
      local.set 3
    else
      global.get $mathlib_global1
      global.get $mathlib_global2
      call $mathlib__fn10
      local.set 4
      nop
      nop
      local.set 3
    end
    local.get 2
    i32.const 1
    i32.eq
    local.get 2
    i32.const 2
    i32.eq
    i32.or
    if (result f64)  ;; label = @1
      local.get 3
      local.get 4
      f64.add
      f64.neg
    else
      local.get 3
      local.get 4
      f64.add
    end)
  (func $mathlib_tan (param f64) (result f64)
    (local i32) (local i32) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64)
    local.get 0
    call $mathlib__fn1
    local.set 1
    local.get 1
    i32.const 2146435072
    i32.ge_u
    if  ;; label = @1
      local.get 0
      local.get 0
      f64.sub
      return
    end
    local.get 1
    i32.const 1072243195
    i32.le_u
    if  ;; label = @1
      local.get 0
      local.set 3
      f64.const 0x0p+0 (;=0;)
      local.set 4
      i32.const 0
      local.set 2
    else
      local.get 0
      call $mathlib__fn11
      local.set 2
      global.get $mathlib_global1
      local.set 3
      global.get $mathlib_global2
      local.set 4
    end
    local.get 3
    local.get 4
    call $mathlib__fn9
    local.set 6
    nop
    nop
    local.set 5
    local.get 3
    local.get 4
    call $mathlib__fn10
    local.set 8
    nop
    nop
    local.set 7
    local.get 2
    i32.const 1
    i32.and
    if (result f64)  ;; label = @1
      local.get 7
      local.get 8
      local.get 5
      local.get 6
      call $mathlib__fn8
      local.set 10
      nop
      nop
      local.set 9
      local.get 9
      local.get 10
      f64.add
      f64.neg
    else
      local.get 5
      local.get 6
      local.get 7
      local.get 8
      call $mathlib__fn8
      local.set 10
      nop
      nop
      local.set 9
      local.get 9
      local.get 10
      f64.add
    end)
  (func $mathlib__fn15 (param f64 f64) (result f64 f64)
    (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64)
    local.get 0
    f64.const 0x0p+0 (;=0;)
    f64.le
    if  ;; label = @1
      f64.const 0x0p+0 (;=0;)
      f64.const 0x0p+0 (;=0;)
      return
    end
    f64.const 0x1.0p+0 (;=1;)
    local.get 0
    f64.sqrt
    f64.div
    local.set 2
    local.get 0
    local.get 2
    f64.mul
    local.set 3
    local.get 3
    f64.const 0x0p+0 (;=0;)
    local.get 3
    f64.const 0x0p+0 (;=0;)
    call $mathlib__fn5
    local.set 5
    nop
    nop
    local.set 4
    local.get 0
    local.get 1
    local.get 4
    f64.neg
    local.get 5
    f64.neg
    call $mathlib__fn4
    local.set 7
    nop
    nop
    local.set 6
    local.get 6
    local.get 2
    f64.mul
    f64.const 0x1.0p-1 (;=0.5;)
    f64.mul
    local.set 8
    local.get 3
    local.get 8
    call $mathlib__fn2)
  (func $mathlib__fn16 (param f64 f64) (result f64 f64)
    (local i32) (local i32) (local i32) (local i32) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64)
    local.get 0
    f64.const 0x0p+0 (;=0;)
    f64.lt
    if  ;; label = @1
      i32.const 1
      local.set 2
      local.get 0
      f64.neg
      local.set 0
      local.get 1
      f64.neg
      local.set 1
    end
    local.get 0
    f64.const 0x1.0p+0 (;=1;)
    f64.gt
    if  ;; label = @1
      f64.const 0x1.0p+0 (;=1;)
      f64.const 0x0p+0 (;=0;)
      local.get 0
      local.get 1
      call $mathlib__fn8
      local.set 1
      nop
      nop
      local.set 0
      i32.const 1
      local.set 3
    end
    local.get 0
    f64.const 0x1.a827999fcef33p-2 (;=0.4142135623730951;)
    f64.gt
    if  ;; label = @1
      local.get 0
      local.get 1
      f64.const -0x1.0p+0 (;=-1;)
      f64.const 0x0p+0 (;=0;)
      call $mathlib__fn4
      local.set 17
      nop
      nop
      local.set 16
      local.get 0
      local.get 1
      f64.const 0x1.0p+0 (;=1;)
      f64.const 0x0p+0 (;=0;)
      call $mathlib__fn4
      local.set 19
      nop
      nop
      local.set 18
      local.get 16
      local.get 17
      local.get 18
      local.get 19
      call $mathlib__fn8
      local.set 1
      nop
      nop
      local.set 0
      i32.const 1
      local.set 4
    end
    local.get 0
    local.get 1
    local.get 0
    local.get 1
    call $mathlib__fn5
    local.set 7
    nop
    nop
    local.set 6
    local.get 0
    local.set 8
    local.get 1
    local.set 9
    local.get 0
    local.set 10
    local.get 1
    local.set 11
    i32.const 1
    local.set 5
    block  ;; label = @1
      loop  ;; label = @2
        local.get 5
        i32.const 50
        i32.gt_u
        br_if 1 (;@1;)
        local.get 8
        local.get 9
        local.get 6
        local.get 7
        call $mathlib__fn5
        local.set 9
        nop
        nop
        local.set 8
        i32.const 2
        local.get 5
        i32.mul
        i32.const 1
        i32.add
        f64.convert_i32_s
        call $mathlib__fn6
        local.set 13
        nop
        nop
        local.set 12
        local.get 8
        local.get 9
        local.get 12
        local.get 13
        call $mathlib__fn5
        local.set 15
        nop
        nop
        local.set 14
        local.get 5
        i32.const 1
        i32.and
        if  ;; label = @3
          local.get 14
          f64.neg
          local.set 14
          local.get 15
          f64.neg
          local.set 15
        end
        local.get 10
        local.get 11
        local.get 14
        local.get 15
        call $mathlib__fn4
        local.set 11
        nop
        nop
        local.set 10
        local.get 5
        i32.const 1
        i32.add
        local.set 5
        br 0 (;@2;)
      end
    end
    local.get 3
    local.get 4
    i32.and
    if  ;; label = @1
      f64.const 0x1.921fb54442d18p-1 (;=0.7853981633974483;)
      f64.const 0x1.1a62633145c07p-55 (;=3.061616997868383e-17;)
      local.get 10
      f64.neg
      local.get 11
      f64.neg
      call $mathlib__fn4
      local.set 11
      nop
      nop
      local.set 10
    else
      local.get 3
      if  ;; label = @2
        f64.const 0x1.921fb54442d18p+0 (;=1.5707963267948966;)
        f64.const 0x1.1a62633145c07p-54 (;=6.123233995736766e-17;)
        local.get 10
        f64.neg
        local.get 11
        f64.neg
        call $mathlib__fn4
        local.set 11
        nop
        nop
        local.set 10
      else
        local.get 4
        if  ;; label = @3
          f64.const 0x1.921fb54442d18p-1 (;=0.7853981633974483;)
          f64.const 0x1.1a62633145c07p-55 (;=3.061616997868383e-17;)
          local.get 10
          local.get 11
          call $mathlib__fn4
          local.set 11
          nop
          nop
          local.set 10
        end
      end
    end
    local.get 2
    if  ;; label = @1
      local.get 10
      f64.neg
      local.set 10
      local.get 11
      f64.neg
      local.set 11
    end
    local.get 10
    local.get 11)
  (func $mathlib_atan (param f64) (result f64)
    (local f64) (local f64)
    local.get 0
    local.get 0
    f64.ne
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.const inf (;=Infinity;)
    f64.eq
    if  ;; label = @1
      f64.const 0x1.921fb54442d18p+0 (;=1.5707963267948966;)
      return
    end
    local.get 0
    f64.const -inf (;=-Infinity;)
    f64.eq
    if  ;; label = @1
      f64.const -0x1.921fb54442d18p+0 (;=-1.5707963267948966;)
      return
    end
    local.get 0
    f64.const 0x0p+0 (;=0;)
    f64.eq
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.const 0x0p+0 (;=0;)
    call $mathlib__fn16
    local.set 2
    nop
    nop
    local.set 1
    local.get 1
    local.get 2
    i32.const 0
    call $mathlib__fn22)
  (func $mathlib_atan2 (param f64 f64) (result f64)
    (local i32) (local f64) (local f64)
    local.get 1
    local.get 1
    f64.ne
    if  ;; label = @1
      local.get 1
      return
    end
    local.get 0
    local.get 0
    f64.ne
    if  ;; label = @1
      local.get 0
      return
    end
    f64.const 0x1.0p+0 (;=1;)
    local.get 0
    f64.copysign
    f64.const 0x0p+0 (;=0;)
    f64.lt
    local.set 2
    local.get 1
    f64.abs
    f64.const inf (;=Infinity;)
    f64.eq
    local.get 0
    f64.abs
    f64.const inf (;=Infinity;)
    f64.eq
    i32.and
    if  ;; label = @1
      f64.const 0x1.2d97c7f3321d2p+1 (;=2.356194490192345;)
      f64.const 0x1.921fb54442d18p-1 (;=0.7853981633974483;)
      local.get 1
      f64.const 0x0p+0 (;=0;)
      f64.lt
      select
      local.get 0
      f64.copysign
      return
    end
    local.get 0
    f64.abs
    f64.const inf (;=Infinity;)
    f64.eq
    if  ;; label = @1
      f64.const 0x1.921fb54442d18p+0 (;=1.5707963267948966;)
      local.get 0
      f64.copysign
      return
    end
    local.get 1
    f64.abs
    f64.const inf (;=Infinity;)
    f64.eq
    if  ;; label = @1
      f64.const 0x1.921fb54442d18p+1 (;=3.141592653589793;)
      f64.const 0x0p+0 (;=0;)
      local.get 1
      f64.const 0x0p+0 (;=0;)
      f64.lt
      select
      local.get 0
      f64.copysign
      return
    end
    local.get 1
    f64.const 0x0p+0 (;=0;)
    f64.eq
    if  ;; label = @1
      local.get 0
      f64.const 0x0p+0 (;=0;)
      f64.ne
      if  ;; label = @2
        f64.const 0x1.921fb54442d18p+0 (;=1.5707963267948966;)
        local.get 0
        f64.copysign
        return
      end
      f64.const 0x1.0p+0 (;=1;)
      local.get 1
      f64.copysign
      f64.const 0x0p+0 (;=0;)
      f64.lt
      if  ;; label = @2
        f64.const 0x1.921fb54442d18p+1 (;=3.141592653589793;)
        local.get 0
        f64.copysign
        return
      end
      f64.const 0x0p+0 (;=0;)
      local.get 0
      f64.copysign
      return
    end
    local.get 0
    f64.const 0x0p+0 (;=0;)
    f64.eq
    if  ;; label = @1
      local.get 1
      f64.const 0x0p+0 (;=0;)
      f64.gt
      if  ;; label = @2
        f64.const 0x0p+0 (;=0;)
        local.get 0
        f64.copysign
        return
      end
      f64.const 0x1.921fb54442d18p+1 (;=3.141592653589793;)
      local.get 0
      f64.copysign
      return
    end
    local.get 0
    f64.const 0x0p+0 (;=0;)
    local.get 1
    f64.const 0x0p+0 (;=0;)
    call $mathlib__fn8
    local.set 4
    nop
    nop
    local.set 3
    local.get 3
    local.get 4
    call $mathlib__fn16
    local.set 4
    nop
    nop
    local.set 3
    local.get 1
    f64.const 0x0p+0 (;=0;)
    f64.lt
    if  ;; label = @1
      local.get 0
      f64.const 0x0p+0 (;=0;)
      f64.ge
      if  ;; label = @2
        local.get 3
        local.get 4
        f64.const 0x1.921fb54442d18p+1 (;=3.141592653589793;)
        f64.const 0x1.1a62633145c07p-53 (;=1.2246467991473532e-16;)
        call $mathlib__fn4
        local.set 4
        nop
        nop
        local.set 3
      else
        local.get 3
        local.get 4
        f64.const -0x1.921fb54442d18p+1 (;=-3.141592653589793;)
        f64.const -0x1.1a62633145c07p-53 (;=-1.2246467991473532e-16;)
        call $mathlib__fn4
        local.set 4
        nop
        nop
        local.set 3
      end
    end
    local.get 3
    local.get 4
    i32.const 0
    call $mathlib__fn22)
  (func $mathlib_asin (param f64) (result f64)
    (local i32) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64)
    local.get 0
    local.get 0
    f64.ne
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.abs
    f64.const 0x1.0p+0 (;=1;)
    f64.gt
    if  ;; label = @1
      f64.const nan (;=NaN;)
      return
    end
    local.get 0
    f64.const 0x1.0p+0 (;=1;)
    f64.eq
    if  ;; label = @1
      f64.const 0x1.921fb54442d18p+0 (;=1.5707963267948966;)
      return
    end
    local.get 0
    f64.const -0x1.0p+0 (;=-1;)
    f64.eq
    if  ;; label = @1
      f64.const -0x1.921fb54442d18p+0 (;=-1.5707963267948966;)
      return
    end
    local.get 0
    f64.const 0x0p+0 (;=0;)
    f64.eq
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    local.set 2
    local.get 0
    f64.const 0x0p+0 (;=0;)
    f64.lt
    if  ;; label = @1
      i32.const 1
      local.set 1
      local.get 0
      f64.neg
      local.set 2
    end
    local.get 2
    f64.const 0x0p+0 (;=0;)
    local.get 2
    f64.const 0x0p+0 (;=0;)
    call $mathlib__fn5
    local.set 5
    nop
    nop
    local.set 4
    f64.const 0x1.0p+0 (;=1;)
    f64.const 0x0p+0 (;=0;)
    local.get 4
    f64.neg
    local.get 5
    f64.neg
    call $mathlib__fn4
    local.set 7
    nop
    nop
    local.set 6
    local.get 6
    local.get 7
    call $mathlib__fn15
    local.set 9
    nop
    nop
    local.set 8
    local.get 2
    f64.const 0x0p+0 (;=0;)
    local.get 8
    local.get 9
    call $mathlib__fn8
    local.set 11
    nop
    nop
    local.set 10
    local.get 10
    local.get 11
    call $mathlib__fn16
    local.set 13
    nop
    nop
    local.set 12
    local.get 12
    local.get 13
    i32.const 0
    call $mathlib__fn22
    local.set 3
    local.get 1
    if (result f64)  ;; label = @1
      local.get 3
      f64.neg
    else
      local.get 3
    end)
  (func $mathlib_acos (param f64) (result f64)
    (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64)
    local.get 0
    local.get 0
    f64.ne
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.abs
    f64.const 0x1.0p+0 (;=1;)
    f64.gt
    if  ;; label = @1
      f64.const nan (;=NaN;)
      return
    end
    local.get 0
    f64.const 0x1.0p+0 (;=1;)
    f64.eq
    if  ;; label = @1
      f64.const 0x0p+0 (;=0;)
      return
    end
    local.get 0
    f64.const -0x1.0p+0 (;=-1;)
    f64.eq
    if  ;; label = @1
      f64.const 0x1.921fb54442d18p+1 (;=3.141592653589793;)
      return
    end
    f64.const 0x1.0p+0 (;=1;)
    f64.const 0x0p+0 (;=0;)
    local.get 0
    f64.neg
    f64.const 0x0p+0 (;=0;)
    call $mathlib__fn4
    local.set 2
    nop
    nop
    local.set 1
    f64.const 0x1.0p+0 (;=1;)
    f64.const 0x0p+0 (;=0;)
    local.get 0
    f64.const 0x0p+0 (;=0;)
    call $mathlib__fn4
    local.set 4
    nop
    nop
    local.set 3
    local.get 1
    local.get 2
    local.get 3
    local.get 4
    call $mathlib__fn8
    local.set 6
    nop
    nop
    local.set 5
    local.get 5
    local.get 6
    call $mathlib__fn15
    local.set 8
    nop
    nop
    local.set 7
    local.get 7
    local.get 8
    call $mathlib__fn16
    local.set 10
    nop
    nop
    local.set 9
    local.get 9
    local.get 10
    f64.const 0x1.0p+1 (;=2;)
    call $mathlib__fn7
    local.set 6
    nop
    nop
    local.set 5
    local.get 5
    local.get 6
    i32.const 0
    call $mathlib__fn22)
  (func $mathlib__fn21 (param f64 i32) (result f64)
    (local f64)
    local.get 0
    local.set 2
    local.get 1
    i32.const 1023
    i32.gt_s
    if  ;; label = @1
      local.get 2
      f64.const 0x1.0p+1023 (;=8.98846567431158e+307;)
      f64.mul
      local.set 2
      local.get 1
      i32.const 1023
      i32.sub
      local.set 1
      local.get 1
      i32.const 1023
      i32.gt_s
      if  ;; label = @2
        local.get 2
        f64.const 0x1.0p+1023 (;=8.98846567431158e+307;)
        f64.mul
        local.set 2
        local.get 1
        i32.const 1023
        i32.sub
        local.set 1
        local.get 1
        i32.const 1023
        i32.gt_s
        if  ;; label = @3
          i32.const 1023
          local.set 1
        end
      end
    end
    local.get 1
    i32.const -1022
    i32.lt_s
    if  ;; label = @1
      local.get 2
      f64.const 0x1.0p-969 (;=2.004168360008973e-292;)
      f64.mul
      local.set 2
      local.get 1
      i32.const 969
      i32.add
      local.set 1
      local.get 1
      i32.const -1022
      i32.lt_s
      if  ;; label = @2
        local.get 2
        f64.const 0x1.0p-969 (;=2.004168360008973e-292;)
        f64.mul
        local.set 2
        local.get 1
        i32.const 969
        i32.add
        local.set 1
        local.get 1
        i32.const -1022
        i32.lt_s
        if  ;; label = @3
          i32.const -1022
          local.set 1
        end
      end
    end
    local.get 2
    local.get 1
    i32.const 1023
    i32.add
    i64.extend_i32_s
    i64.const 52
    i64.shl
    f64.reinterpret_i64
    f64.mul)
  (func $mathlib__fn22 (param f64 f64 i32) (result f64)
    (local i32) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64)
    local.get 0
    f64.const 0x0p+0 (;=0;)
    f64.eq
    if  ;; label = @1
      f64.const 0x0p+0 (;=0;)
      return
    end
    local.get 0
    f64.const 0x0p+0 (;=0;)
    f64.lt
    if  ;; label = @1
      i32.const 1
      local.set 3
      local.get 0
      f64.neg
      local.set 0
      local.get 1
      f64.neg
      local.set 1
    end
    local.get 0
    local.get 2
    call $mathlib__fn21
    local.set 5
    local.get 5
    f64.const inf (;=Infinity;)
    f64.eq
    if  ;; label = @1
      f64.const -inf (;=-Infinity;)
      f64.const inf (;=Infinity;)
      local.get 3
      select
      return
    end
    local.get 5
    f64.const 0x1.0p-1022 (;=2.2250738585072014e-308;)
    f64.ge
    if  ;; label = @1
      local.get 0
      local.get 1
      f64.add
      local.get 2
      call $mathlib__fn21
      local.set 4
    else
      local.get 0
      local.get 2
      i32.const 1074
      i32.add
      call $mathlib__fn21
      local.set 6
      local.get 1
      local.get 2
      i32.const 1074
      i32.add
      call $mathlib__fn21
      local.set 7
      local.get 6
      f64.floor
      local.set 8
      local.get 6
      local.get 8
      f64.sub
      local.get 7
      f64.add
      local.set 9
      block  ;; label = @2
        loop  ;; label = @3
          local.get 9
          f64.const 0x1.0p+0 (;=1;)
          f64.lt
          br_if 1 (;@2;)
          local.get 9
          f64.const 0x1.0p+0 (;=1;)
          f64.sub
          local.set 9
          local.get 8
          f64.const 0x1.0p+0 (;=1;)
          f64.add
          local.set 8
          br 0 (;@3;)
        end
      end
      block  ;; label = @2
        loop  ;; label = @3
          local.get 9
          f64.const 0x0p+0 (;=0;)
          f64.ge
          br_if 1 (;@2;)
          local.get 9
          f64.const 0x1.0p+0 (;=1;)
          f64.add
          local.set 9
          local.get 8
          f64.const 0x1.0p+0 (;=1;)
          f64.sub
          local.set 8
          br 0 (;@3;)
        end
      end
      local.get 8
      local.set 10
      local.get 9
      f64.const 0x1.0p-1 (;=0.5;)
      f64.gt
      if  ;; label = @2
        local.get 8
        f64.const 0x1.0p+0 (;=1;)
        f64.add
        local.set 10
      else
        local.get 9
        f64.const 0x1.0p-1 (;=0.5;)
        f64.eq
        if  ;; label = @3
          local.get 8
          f64.const 0x1.0p-1 (;=0.5;)
          f64.mul
          f64.floor
          f64.const 0x1.0p+1 (;=2;)
          f64.mul
          local.get 8
          f64.ne
          if  ;; label = @4
            local.get 8
            f64.const 0x1.0p+0 (;=1;)
            f64.add
            local.set 10
          end
        end
      end
      local.get 10
      f64.const 0x0.0000000000001p-1022 (;=5e-324;)
      f64.mul
      local.set 4
    end
    local.get 3
    if (result f64)  ;; label = @1
      local.get 4
      f64.neg
    else
      local.get 4
    end)
  (func $mathlib_exp (param f64) (result f64)
    (local i32) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local i32)
    local.get 0
    local.get 0
    f64.ne
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.const inf (;=Infinity;)
    f64.eq
    if  ;; label = @1
      f64.const inf (;=Infinity;)
      return
    end
    local.get 0
    f64.const -inf (;=-Infinity;)
    f64.eq
    if  ;; label = @1
      f64.const 0x0p+0 (;=0;)
      return
    end
    local.get 0
    f64.const 0x1.62e42fefa39fp+9 (;=709.7827128933841;)
    f64.ge
    if  ;; label = @1
      f64.const inf (;=Infinity;)
      return
    end
    local.get 0
    f64.const -0x1.74910d52d3053p+9 (;=-745.1332191019413;)
    f64.le
    if  ;; label = @1
      f64.const 0x0p+0 (;=0;)
      return
    end
    local.get 0
    f64.const 0x1.71547652b82fep+0 (;=1.4426950408889634;)
    f64.mul
    f64.nearest
    local.set 2
    local.get 2
    i32.trunc_f64_s
    local.set 1
    f64.const 0x1.62e42fefa39efp-1 (;=0.6931471805599453;)
    f64.const 0x1.abc9e3b39803fp-56 (;=2.3190468138462996e-17;)
    local.get 2
    call $mathlib__fn7
    local.set 4
    nop
    nop
    local.set 3
    local.get 0
    f64.const 0x0p+0 (;=0;)
    local.get 3
    f64.neg
    local.get 4
    f64.neg
    call $mathlib__fn4
    local.set 6
    nop
    nop
    local.set 5
    f64.const 0x1.0p+0 (;=1;)
    local.set 7
    f64.const 0x0p+0 (;=0;)
    local.set 8
    f64.const 0x1.0p+0 (;=1;)
    local.set 9
    f64.const 0x0p+0 (;=0;)
    local.set 10
    i32.const 1
    local.set 13
    block  ;; label = @1
      loop  ;; label = @2
        local.get 13
        i32.const 22
        i32.gt_u
        br_if 1 (;@1;)
        local.get 7
        local.get 8
        local.get 5
        local.get 6
        call $mathlib__fn5
        local.set 8
        nop
        nop
        local.set 7
        local.get 13
        f64.convert_i32_s
        call $mathlib__fn6
        local.set 12
        nop
        nop
        local.set 11
        local.get 7
        local.get 8
        local.get 11
        local.get 12
        call $mathlib__fn5
        local.set 8
        nop
        nop
        local.set 7
        local.get 9
        local.get 10
        local.get 7
        local.get 8
        call $mathlib__fn4
        local.set 10
        nop
        nop
        local.set 9
        local.get 13
        i32.const 1
        i32.add
        local.set 13
        br 0 (;@2;)
      end
    end
    local.get 9
    local.get 10
    local.get 1
    call $mathlib__fn22)
  (func $mathlib__fn24 (param f64 i32) (result f64 f64)
    (local i32) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local i32)
    local.get 0
    f64.const 0x1.71547652b82fep+0 (;=1.4426950408889634;)
    f64.mul
    f64.nearest
    local.set 3
    local.get 3
    i32.trunc_f64_s
    local.set 2
    f64.const 0x1.62e42fefa39efp-1 (;=0.6931471805599453;)
    f64.const 0x1.abc9e3b39803fp-56 (;=2.3190468138462996e-17;)
    local.get 3
    call $mathlib__fn7
    local.set 5
    nop
    nop
    local.set 4
    local.get 0
    f64.const 0x0p+0 (;=0;)
    local.get 4
    f64.neg
    local.get 5
    f64.neg
    call $mathlib__fn4
    local.set 7
    nop
    nop
    local.set 6
    f64.const 0x1.0p+0 (;=1;)
    local.set 8
    f64.const 0x0p+0 (;=0;)
    local.set 9
    f64.const 0x1.0p+0 (;=1;)
    local.set 10
    f64.const 0x0p+0 (;=0;)
    local.set 11
    i32.const 1
    local.set 14
    block  ;; label = @1
      loop  ;; label = @2
        local.get 14
        i32.const 22
        i32.gt_u
        br_if 1 (;@1;)
        local.get 8
        local.get 9
        local.get 6
        local.get 7
        call $mathlib__fn5
        local.set 9
        nop
        nop
        local.set 8
        local.get 14
        f64.convert_i32_s
        call $mathlib__fn6
        local.set 13
        nop
        nop
        local.set 12
        local.get 8
        local.get 9
        local.get 12
        local.get 13
        call $mathlib__fn5
        local.set 9
        nop
        nop
        local.set 8
        local.get 10
        local.get 11
        local.get 8
        local.get 9
        call $mathlib__fn4
        local.set 11
        nop
        nop
        local.set 10
        local.get 14
        i32.const 1
        i32.add
        local.set 14
        br 0 (;@2;)
      end
    end
    local.get 10
    local.get 2
    local.get 1
    i32.add
    call $mathlib__fn21
    local.get 11
    local.get 2
    local.get 1
    i32.add
    call $mathlib__fn21)
  (func $mathlib__fn25 (param f64) (result f64 f64)
    (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local i32)
    local.get 0
    f64.abs
    f64.const 0x1.0p-1 (;=0.5;)
    f64.lt
    if  ;; label = @1
      f64.const 0x1.0p+0 (;=1;)
      local.set 1
      f64.const 0x0p+0 (;=0;)
      local.set 2
      f64.const 0x0p+0 (;=0;)
      local.set 3
      f64.const 0x0p+0 (;=0;)
      local.set 4
      i32.const 1
      local.set 7
      block  ;; label = @2
        loop  ;; label = @3
          local.get 7
          i32.const 25
          i32.gt_u
          br_if 1 (;@2;)
          local.get 1
          local.get 2
          local.get 0
          f64.const 0x0p+0 (;=0;)
          call $mathlib__fn5
          local.set 2
          nop
          nop
          local.set 1
          local.get 7
          f64.convert_i32_s
          call $mathlib__fn6
          local.set 6
          nop
          nop
          local.set 5
          local.get 1
          local.get 2
          local.get 5
          local.get 6
          call $mathlib__fn5
          local.set 2
          nop
          nop
          local.set 1
          local.get 3
          local.get 4
          local.get 1
          local.get 2
          call $mathlib__fn4
          local.set 4
          nop
          nop
          local.set 3
          local.get 7
          i32.const 1
          i32.add
          local.set 7
          br 0 (;@3;)
        end
      end
      local.get 3
      local.get 4
      return
    end
    local.get 0
    i32.const 0
    call $mathlib__fn24
    local.set 4
    nop
    nop
    local.set 3
    local.get 3
    local.get 4
    f64.const -0x1.0p+0 (;=-1;)
    f64.const 0x0p+0 (;=0;)
    call $mathlib__fn4)
  (func $mathlib__fn26 (param f64) (result f64 f64)
    (local i64) (local i32) (local i32) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local i32) (local f64) (local f64) (local f64) (local f64)
    local.get 0
    i64.reinterpret_f64
    local.set 1
    local.get 1
    i64.const 52
    i64.shr_u
    i64.const 2047
    i64.and
    i32.wrap_i64
    local.set 2
    local.get 2
    i32.eqz
    if  ;; label = @1
      local.get 0
      f64.const 0x1.0p+54 (;=18014398509481984;)
      f64.mul
      local.set 0
      local.get 0
      i64.reinterpret_f64
      local.set 1
      local.get 1
      i64.const 52
      i64.shr_u
      i64.const 2047
      i64.and
      i32.wrap_i64
      local.set 2
      local.get 2
      i32.const 1023
      i32.sub
      i32.const 54
      i32.sub
      local.set 3
    else
      local.get 2
      i32.const 1023
      i32.sub
      local.set 3
    end
    local.get 1
    i64.const -9218868437227405313
    i64.and
    i64.const 4607182418800017408
    i64.or
    f64.reinterpret_i64
    local.set 4
    local.get 4
    f64.const 0x1.6a09e667f3bcdp+0 (;=1.4142135623730951;)
    f64.ge
    if  ;; label = @1
      local.get 4
      f64.const 0x1.0p-1 (;=0.5;)
      f64.mul
      local.set 4
      local.get 3
      i32.const 1
      i32.add
      local.set 3
    end
    local.get 4
    f64.const -0x1.0p+0 (;=-1;)
    call $mathlib__fn2
    local.set 6
    nop
    nop
    local.set 5
    local.get 4
    f64.const 0x1.0p+0 (;=1;)
    call $mathlib__fn2
    local.set 8
    nop
    nop
    local.set 7
    local.get 5
    local.get 6
    local.get 7
    local.get 8
    call $mathlib__fn8
    local.set 10
    nop
    nop
    local.set 9
    local.get 9
    local.get 10
    local.get 9
    local.get 10
    call $mathlib__fn5
    local.set 12
    nop
    nop
    local.set 11
    f64.const 0x1.0p+0 (;=1;)
    local.set 13
    f64.const 0x0p+0 (;=0;)
    local.set 14
    f64.const 0x1.0p+0 (;=1;)
    local.set 15
    f64.const 0x0p+0 (;=0;)
    local.set 16
    i32.const 1
    local.set 17
    block  ;; label = @1
      loop  ;; label = @2
        local.get 17
        i32.const 18
        i32.gt_u
        br_if 1 (;@1;)
        local.get 13
        local.get 14
        local.get 11
        local.get 12
        call $mathlib__fn5
        local.set 14
        nop
        nop
        local.set 13
        i32.const 2
        local.get 17
        i32.mul
        i32.const 1
        i32.add
        f64.convert_i32_s
        call $mathlib__fn6
        local.set 19
        nop
        nop
        local.set 18
        local.get 13
        local.get 14
        local.get 18
        local.get 19
        call $mathlib__fn5
        local.set 19
        nop
        nop
        local.set 18
        local.get 15
        local.get 16
        local.get 18
        local.get 19
        call $mathlib__fn4
        local.set 16
        nop
        nop
        local.set 15
        local.get 17
        i32.const 1
        i32.add
        local.set 17
        br 0 (;@2;)
      end
    end
    local.get 9
    local.get 10
    f64.const 0x1.0p+1 (;=2;)
    call $mathlib__fn7
    local.set 19
    nop
    nop
    local.set 18
    local.get 18
    local.get 19
    local.get 15
    local.get 16
    call $mathlib__fn5
    local.set 19
    nop
    nop
    local.set 18
    f64.const 0x1.62e42fefa39efp-1 (;=0.6931471805599453;)
    f64.const 0x1.abc9e3b39803fp-56 (;=2.3190468138462996e-17;)
    local.get 3
    f64.convert_i32_s
    call $mathlib__fn7
    local.set 21
    nop
    nop
    local.set 20
    local.get 20
    local.get 21
    local.get 18
    local.get 19
    call $mathlib__fn4)
  (func $mathlib__fn27 (param f64 f64) (result f64 f64)
    (local f64) (local f64)
    local.get 0
    call $mathlib__fn26
    local.set 3
    nop
    nop
    local.set 2
    local.get 2
    local.get 3
    local.get 1
    local.get 0
    f64.div
    f64.const 0x0p+0 (;=0;)
    call $mathlib__fn4)
  (func $mathlib_log (param f64) (result f64)
    (local f64) (local f64)
    local.get 0
    local.get 0
    f64.ne
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.const 0x0p+0 (;=0;)
    f64.lt
    if  ;; label = @1
      local.get 0
      local.get 0
      f64.sub
      return
    end
    local.get 0
    f64.const 0x0p+0 (;=0;)
    f64.eq
    if  ;; label = @1
      f64.const -inf (;=-Infinity;)
      return
    end
    local.get 0
    f64.const inf (;=Infinity;)
    f64.eq
    if  ;; label = @1
      f64.const inf (;=Infinity;)
      return
    end
    local.get 0
    call $mathlib__fn26
    local.set 2
    nop
    nop
    local.set 1
    local.get 1
    local.get 2
    f64.add)
  (func $mathlib_log2 (param f64) (result f64)
    (local f64) (local f64)
    local.get 0
    local.get 0
    f64.ne
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.const 0x0p+0 (;=0;)
    f64.lt
    if  ;; label = @1
      local.get 0
      local.get 0
      f64.sub
      return
    end
    local.get 0
    f64.const 0x0p+0 (;=0;)
    f64.eq
    if  ;; label = @1
      f64.const -inf (;=-Infinity;)
      return
    end
    local.get 0
    f64.const inf (;=Infinity;)
    f64.eq
    if  ;; label = @1
      f64.const inf (;=Infinity;)
      return
    end
    local.get 0
    call $mathlib__fn26
    local.set 2
    nop
    nop
    local.set 1
    local.get 1
    local.get 2
    f64.const 0x1.71547652b82fep+0 (;=1.4426950408889634;)
    f64.const 0x1.777d0ffda0d24p-56 (;=2.0355273740931033e-17;)
    call $mathlib__fn5
    local.set 2
    nop
    nop
    local.set 1
    local.get 1
    local.get 2
    f64.add)
  (func $mathlib_log10 (param f64) (result f64)
    (local f64) (local f64)
    local.get 0
    local.get 0
    f64.ne
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.const 0x0p+0 (;=0;)
    f64.lt
    if  ;; label = @1
      local.get 0
      local.get 0
      f64.sub
      return
    end
    local.get 0
    f64.const 0x0p+0 (;=0;)
    f64.eq
    if  ;; label = @1
      f64.const -inf (;=-Infinity;)
      return
    end
    local.get 0
    f64.const inf (;=Infinity;)
    f64.eq
    if  ;; label = @1
      f64.const inf (;=Infinity;)
      return
    end
    local.get 0
    call $mathlib__fn26
    local.set 2
    nop
    nop
    local.set 1
    local.get 1
    local.get 2
    f64.const 0x1.bcb7b1526e50ep-2 (;=0.4342944819032518;)
    f64.const 0x1.95355baaafad3p-57 (;=1.098319650216765e-17;)
    call $mathlib__fn5
    local.set 2
    nop
    nop
    local.set 1
    local.get 1
    local.get 2
    f64.add)
  (func $mathlib_cbrt (param f64) (result f64)
    (local f64) (local i32) (local i64) (local i32) (local i32) (local i32) (local i32) (local f64) (local f64) (local f64) (local i32) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64)
    local.get 0
    local.get 0
    f64.ne
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.const 0x0p+0 (;=0;)
    f64.eq
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.const inf (;=Infinity;)
    f64.eq
    if  ;; label = @1
      f64.const inf (;=Infinity;)
      return
    end
    local.get 0
    f64.const -inf (;=-Infinity;)
    f64.eq
    if  ;; label = @1
      f64.const -inf (;=-Infinity;)
      return
    end
    local.get 0
    i64.reinterpret_f64
    i64.const 63
    i64.shr_u
    i32.wrap_i64
    local.set 2
    local.get 0
    f64.abs
    local.set 1
    local.get 1
    i64.reinterpret_f64
    local.set 3
    local.get 3
    i64.const 52
    i64.shr_u
    i64.const 2047
    i64.and
    i32.wrap_i64
    local.set 4
    local.get 4
    i32.eqz
    if  ;; label = @1
      local.get 1
      f64.const 0x1.0p+54 (;=18014398509481984;)
      f64.mul
      local.set 1
      local.get 1
      i64.reinterpret_f64
      local.set 3
      local.get 3
      i64.const 52
      i64.shr_u
      i64.const 2047
      i64.and
      i32.wrap_i64
      local.set 4
      local.get 4
      i32.const 1023
      i32.sub
      i32.const 54
      i32.sub
      local.set 5
    else
      local.get 4
      i32.const 1023
      i32.sub
      local.set 5
    end
    local.get 3
    i64.const -9218868437227405313
    i64.and
    i64.const 4607182418800017408
    i64.or
    f64.reinterpret_i64
    local.set 8
    local.get 5
    i32.const 3
    i32.div_s
    local.set 6
    local.get 5
    local.get 6
    i32.const 3
    i32.mul
    i32.sub
    local.set 7
    local.get 7
    i32.const 0
    i32.lt_s
    if  ;; label = @1
      local.get 7
      i32.const 3
      i32.add
      local.set 7
      local.get 6
      i32.const 1
      i32.sub
      local.set 6
    end
    local.get 8
    local.get 7
    i32.const 1023
    i32.add
    i64.extend_i32_s
    i64.const 52
    i64.shl
    f64.reinterpret_i64
    f64.mul
    local.set 9
    f64.const 0x1.8p+0 (;=1.5;)
    local.set 10
    i32.const 0
    local.set 11
    block  ;; label = @1
      loop  ;; label = @2
        local.get 11
        i32.const 7
        i32.ge_u
        br_if 1 (;@1;)
        f64.const 0x1.0p+1 (;=2;)
        local.get 10
        f64.mul
        local.get 9
        local.get 10
        local.get 10
        f64.mul
        f64.div
        f64.add
        f64.const 0x1.5555555555555p-2 (;=0.3333333333333333;)
        f64.mul
        local.set 10
        local.get 11
        i32.const 1
        i32.add
        local.set 11
        br 0 (;@2;)
      end
    end
    local.get 10
    local.set 12
    f64.const 0x0p+0 (;=0;)
    local.set 13
    local.get 12
    local.get 13
    local.get 12
    local.get 13
    call $mathlib__fn5
    local.set 15
    nop
    nop
    local.set 14
    local.get 14
    local.get 15
    local.get 12
    local.get 13
    call $mathlib__fn5
    local.set 17
    nop
    nop
    local.set 16
    local.get 16
    local.get 17
    local.get 9
    f64.neg
    f64.const 0x0p+0 (;=0;)
    call $mathlib__fn4
    local.set 19
    nop
    nop
    local.set 18
    local.get 14
    local.get 15
    f64.const 0x1.8p+1 (;=3;)
    call $mathlib__fn7
    local.set 21
    nop
    nop
    local.set 20
    local.get 18
    local.get 19
    local.get 20
    local.get 21
    call $mathlib__fn8
    local.set 23
    nop
    nop
    local.set 22
    local.get 12
    local.get 13
    local.get 22
    f64.neg
    local.get 23
    f64.neg
    call $mathlib__fn4
    local.set 25
    nop
    nop
    local.set 24
    local.get 24
    local.get 25
    local.get 6
    call $mathlib__fn22
    local.set 10
    local.get 2
    if (result f64)  ;; label = @1
      local.get 10
      f64.neg
    else
      local.get 10
    end)
  (func $mathlib_sinh (param f64) (result f64)
    (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64)
    local.get 0
    local.get 0
    f64.ne
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.abs
    f64.const inf (;=Infinity;)
    f64.eq
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.const 0x0p+0 (;=0;)
    f64.eq
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.abs
    local.set 1
    local.get 1
    f64.const 0x1.0p-27 (;=7.450580596923828e-9;)
    f64.lt
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 1
    f64.const 0x1.2cp+8 (;=300;)
    f64.gt
    if  ;; label = @1
      local.get 1
      i32.const -1
      call $mathlib__fn24
      local.set 8
      nop
      nop
      local.set 7
    else
      local.get 1
      i32.const 0
      call $mathlib__fn24
      local.set 4
      nop
      nop
      local.set 3
      f64.const 0x1.0p+0 (;=1;)
      f64.const 0x0p+0 (;=0;)
      local.get 3
      local.get 4
      call $mathlib__fn8
      local.set 6
      nop
      nop
      local.set 5
      local.get 3
      local.get 4
      local.get 5
      f64.neg
      local.get 6
      f64.neg
      call $mathlib__fn4
      local.set 8
      nop
      nop
      local.set 7
      local.get 7
      local.get 8
      f64.const 0x1.0p-1 (;=0.5;)
      call $mathlib__fn7
      local.set 8
      nop
      nop
      local.set 7
    end
    local.get 7
    local.get 8
    i32.const 0
    call $mathlib__fn22
    local.set 2
    local.get 2
    local.get 0
    f64.copysign)
  (func $mathlib_cosh (param f64) (result f64)
    (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64)
    local.get 0
    local.get 0
    f64.ne
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.abs
    f64.const inf (;=Infinity;)
    f64.eq
    if  ;; label = @1
      f64.const inf (;=Infinity;)
      return
    end
    local.get 0
    f64.abs
    local.set 1
    local.get 1
    f64.const 0x1.2cp+8 (;=300;)
    f64.gt
    if  ;; label = @1
      local.get 1
      i32.const -1
      call $mathlib__fn24
      local.set 7
      nop
      nop
      local.set 6
    else
      local.get 1
      i32.const 0
      call $mathlib__fn24
      local.set 3
      nop
      nop
      local.set 2
      f64.const 0x1.0p+0 (;=1;)
      f64.const 0x0p+0 (;=0;)
      local.get 2
      local.get 3
      call $mathlib__fn8
      local.set 5
      nop
      nop
      local.set 4
      local.get 2
      local.get 3
      local.get 4
      local.get 5
      call $mathlib__fn4
      local.set 7
      nop
      nop
      local.set 6
      local.get 6
      local.get 7
      f64.const 0x1.0p-1 (;=0.5;)
      call $mathlib__fn7
      local.set 7
      nop
      nop
      local.set 6
    end
    local.get 6
    local.get 7
    i32.const 0
    call $mathlib__fn22)
  (func $mathlib_tanh (param f64) (result f64)
    (local f64) (local f64) (local f64) (local f64) (local f64) (local f64)
    local.get 0
    local.get 0
    f64.ne
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.const 0x0p+0 (;=0;)
    f64.eq
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.abs
    f64.const inf (;=Infinity;)
    f64.eq
    if  ;; label = @1
      f64.const 0x1.0p+0 (;=1;)
      local.get 0
      f64.copysign
      return
    end
    local.get 0
    f64.abs
    local.set 1
    local.get 1
    f64.const 0x1.0p-27 (;=7.450580596923828e-9;)
    f64.lt
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 1
    f64.const 0x1.6p+4 (;=22;)
    f64.ge
    if  ;; label = @1
      f64.const 0x1.0p+0 (;=1;)
      local.set 2
    else
      f64.const 0x1.0p+1 (;=2;)
      local.get 1
      f64.mul
      call $mathlib__fn25
      local.set 4
      nop
      nop
      local.set 3
      local.get 3
      local.get 4
      f64.const 0x1.0p+1 (;=2;)
      f64.const 0x0p+0 (;=0;)
      call $mathlib__fn4
      local.set 6
      nop
      nop
      local.set 5
      local.get 3
      local.get 4
      local.get 5
      local.get 6
      call $mathlib__fn8
      local.set 6
      nop
      nop
      local.set 5
      local.get 5
      local.get 6
      i32.const 0
      call $mathlib__fn22
      local.set 2
    end
    local.get 2
    local.get 0
    f64.copysign)
  (func $mathlib_asinh (param f64) (result f64)
    (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64)
    local.get 0
    local.get 0
    f64.ne
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.abs
    f64.const inf (;=Infinity;)
    f64.eq
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.const 0x0p+0 (;=0;)
    f64.eq
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.abs
    local.set 1
    local.get 1
    f64.const 0x1.0p-27 (;=7.450580596923828e-9;)
    f64.lt
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 1
    f64.const 0x1.38d352e5096afp+498 (;=1e+150;)
    f64.gt
    if  ;; label = @1
      local.get 1
      call $mathlib__fn26
      local.set 8
      nop
      nop
      local.set 7
      local.get 7
      local.get 8
      f64.const 0x1.62e42fefa39efp-1 (;=0.6931471805599453;)
      f64.const 0x1.abc9e3b39803fp-56 (;=2.3190468138462996e-17;)
      call $mathlib__fn4
      local.set 8
      nop
      nop
      local.set 7
    else
      local.get 1
      f64.const 0x0p+0 (;=0;)
      local.get 1
      f64.const 0x0p+0 (;=0;)
      call $mathlib__fn5
      local.set 4
      nop
      nop
      local.set 3
      local.get 3
      local.get 4
      f64.const 0x1.0p+0 (;=1;)
      f64.const 0x0p+0 (;=0;)
      call $mathlib__fn4
      local.set 4
      nop
      nop
      local.set 3
      local.get 3
      local.get 4
      call $mathlib__fn15
      local.set 4
      nop
      nop
      local.set 3
      local.get 1
      f64.const 0x0p+0 (;=0;)
      local.get 3
      local.get 4
      call $mathlib__fn4
      local.set 6
      nop
      nop
      local.set 5
      local.get 5
      local.get 6
      call $mathlib__fn27
      local.set 8
      nop
      nop
      local.set 7
    end
    local.get 7
    local.get 8
    i32.const 0
    call $mathlib__fn22
    local.set 2
    local.get 2
    local.get 0
    f64.copysign)
  (func $mathlib_acosh (param f64) (result f64)
    (local f64) (local f64) (local f64) (local f64) (local f64) (local f64)
    local.get 0
    local.get 0
    f64.ne
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.const 0x1.0p+0 (;=1;)
    f64.lt
    if  ;; label = @1
      f64.const nan (;=NaN;)
      return
    end
    local.get 0
    f64.const 0x1.0p+0 (;=1;)
    f64.eq
    if  ;; label = @1
      f64.const 0x0p+0 (;=0;)
      return
    end
    local.get 0
    f64.const inf (;=Infinity;)
    f64.eq
    if  ;; label = @1
      f64.const inf (;=Infinity;)
      return
    end
    local.get 0
    f64.const 0x1.38d352e5096afp+498 (;=1e+150;)
    f64.gt
    if  ;; label = @1
      local.get 0
      call $mathlib__fn26
      local.set 6
      nop
      nop
      local.set 5
      local.get 5
      local.get 6
      f64.const 0x1.62e42fefa39efp-1 (;=0.6931471805599453;)
      f64.const 0x1.abc9e3b39803fp-56 (;=2.3190468138462996e-17;)
      call $mathlib__fn4
      local.set 6
      nop
      nop
      local.set 5
    else
      local.get 0
      f64.const 0x0p+0 (;=0;)
      local.get 0
      f64.const 0x0p+0 (;=0;)
      call $mathlib__fn5
      local.set 2
      nop
      nop
      local.set 1
      local.get 1
      local.get 2
      f64.const -0x1.0p+0 (;=-1;)
      f64.const 0x0p+0 (;=0;)
      call $mathlib__fn4
      local.set 2
      nop
      nop
      local.set 1
      local.get 1
      local.get 2
      call $mathlib__fn15
      local.set 2
      nop
      nop
      local.set 1
      local.get 0
      f64.const 0x0p+0 (;=0;)
      local.get 1
      local.get 2
      call $mathlib__fn4
      local.set 4
      nop
      nop
      local.set 3
      local.get 3
      local.get 4
      call $mathlib__fn27
      local.set 6
      nop
      nop
      local.set 5
    end
    local.get 5
    local.get 6
    i32.const 0
    call $mathlib__fn22)
  (func $mathlib_atanh (param f64) (result f64)
    (local f64) (local f64) (local f64) (local f64) (local f64) (local f64)
    local.get 0
    local.get 0
    f64.ne
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.abs
    f64.const 0x1.0p+0 (;=1;)
    f64.gt
    if  ;; label = @1
      f64.const nan (;=NaN;)
      return
    end
    local.get 0
    f64.const 0x1.0p+0 (;=1;)
    f64.eq
    if  ;; label = @1
      f64.const inf (;=Infinity;)
      return
    end
    local.get 0
    f64.const -0x1.0p+0 (;=-1;)
    f64.eq
    if  ;; label = @1
      f64.const -inf (;=-Infinity;)
      return
    end
    local.get 0
    f64.abs
    f64.const 0x1.0p-27 (;=7.450580596923828e-9;)
    f64.lt
    if  ;; label = @1
      local.get 0
      return
    end
    f64.const 0x1.0p+0 (;=1;)
    f64.const 0x0p+0 (;=0;)
    local.get 0
    f64.const 0x0p+0 (;=0;)
    call $mathlib__fn4
    local.set 2
    nop
    nop
    local.set 1
    f64.const 0x1.0p+0 (;=1;)
    f64.const 0x0p+0 (;=0;)
    local.get 0
    f64.neg
    f64.const 0x0p+0 (;=0;)
    call $mathlib__fn4
    local.set 4
    nop
    nop
    local.set 3
    local.get 1
    local.get 2
    local.get 3
    local.get 4
    call $mathlib__fn8
    local.set 6
    nop
    nop
    local.set 5
    local.get 5
    local.get 6
    call $mathlib__fn27
    local.set 6
    nop
    nop
    local.set 5
    local.get 5
    local.get 6
    f64.const 0x1.0p-1 (;=0.5;)
    call $mathlib__fn7
    local.set 6
    nop
    nop
    local.set 5
    local.get 5
    local.get 6
    i32.const 0
    call $mathlib__fn22)
  (func $mathlib_expm1 (param f64) (result f64)
    (local f64) (local f64)
    local.get 0
    local.get 0
    f64.ne
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.const inf (;=Infinity;)
    f64.eq
    if  ;; label = @1
      f64.const inf (;=Infinity;)
      return
    end
    local.get 0
    f64.const -inf (;=-Infinity;)
    f64.eq
    if  ;; label = @1
      f64.const -0x1.0p+0 (;=-1;)
      return
    end
    local.get 0
    f64.abs
    f64.const 0x1.0p-54 (;=5.551115123125783e-17;)
    f64.lt
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.const 0x1.62e42fefa39efp+9 (;=709.782712893384;)
    f64.ge
    if  ;; label = @1
      f64.const inf (;=Infinity;)
      return
    end
    local.get 0
    call $mathlib__fn25
    local.set 2
    nop
    nop
    local.set 1
    local.get 1
    local.get 2
    i32.const 0
    call $mathlib__fn22)
  (func $mathlib_log1p (param f64) (result f64)
    (local f64) (local f64) (local f64) (local f64)
    local.get 0
    local.get 0
    f64.ne
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.const -0x1.0p+0 (;=-1;)
    f64.lt
    if  ;; label = @1
      f64.const nan (;=NaN;)
      return
    end
    local.get 0
    f64.const -0x1.0p+0 (;=-1;)
    f64.eq
    if  ;; label = @1
      f64.const -inf (;=-Infinity;)
      return
    end
    local.get 0
    f64.const inf (;=Infinity;)
    f64.eq
    if  ;; label = @1
      f64.const inf (;=Infinity;)
      return
    end
    local.get 0
    f64.abs
    f64.const 0x1.0p-54 (;=5.551115123125783e-17;)
    f64.lt
    if  ;; label = @1
      local.get 0
      return
    end
    f64.const 0x1.0p+0 (;=1;)
    local.get 0
    call $mathlib__fn2
    local.set 2
    nop
    nop
    local.set 1
    local.get 1
    local.get 2
    call $mathlib__fn27
    local.set 4
    nop
    nop
    local.set 3
    local.get 3
    local.get 4
    i32.const 0
    call $mathlib__fn22)
  (func $mathlib__fn40 (param f64) (result i32)
    local.get 0
    f64.floor
    local.get 0
    f64.eq
    local.get 0
    f64.const 0x1.0p-1 (;=0.5;)
    f64.mul
    f64.floor
    f64.const 0x1.0p+1 (;=2;)
    f64.mul
    local.get 0
    f64.ne
    i32.and)
  (func $mathlib__fn41 (param f64 f64) (result f64 f64 i32)
    (local i32) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local i32)
    local.get 0
    f64.const 0x1.71547652b82fep+0 (;=1.4426950408889634;)
    f64.mul
    f64.nearest
    local.set 3
    local.get 3
    i32.trunc_f64_s
    local.set 2
    f64.const 0x1.62e42fefa39efp-1 (;=0.6931471805599453;)
    f64.const 0x1.abc9e3b39803fp-56 (;=2.3190468138462996e-17;)
    local.get 3
    call $mathlib__fn7
    local.set 5
    nop
    nop
    local.set 4
    local.get 0
    local.get 1
    local.get 4
    f64.neg
    local.get 5
    f64.neg
    call $mathlib__fn4
    local.set 7
    nop
    nop
    local.set 6
    f64.const 0x1.0p+0 (;=1;)
    local.set 8
    f64.const 0x0p+0 (;=0;)
    local.set 9
    f64.const 0x1.0p+0 (;=1;)
    local.set 10
    f64.const 0x0p+0 (;=0;)
    local.set 11
    i32.const 1
    local.set 14
    block  ;; label = @1
      loop  ;; label = @2
        local.get 14
        i32.const 25
        i32.gt_u
        br_if 1 (;@1;)
        local.get 8
        local.get 9
        local.get 6
        local.get 7
        call $mathlib__fn5
        local.set 9
        nop
        nop
        local.set 8
        local.get 14
        f64.convert_i32_s
        call $mathlib__fn6
        local.set 13
        nop
        nop
        local.set 12
        local.get 8
        local.get 9
        local.get 12
        local.get 13
        call $mathlib__fn5
        local.set 9
        nop
        nop
        local.set 8
        local.get 10
        local.get 11
        local.get 8
        local.get 9
        call $mathlib__fn4
        local.set 11
        nop
        nop
        local.set 10
        local.get 14
        i32.const 1
        i32.add
        local.set 14
        br 0 (;@2;)
      end
    end
    local.get 10
    local.get 11
    local.get 2)
  (func $mathlib_pow (param f64 f64) (result f64)
    (local i32) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local f64) (local i32)
    local.get 1
    f64.const 0x0p+0 (;=0;)
    f64.eq
    if  ;; label = @1
      f64.const 0x1.0p+0 (;=1;)
      return
    end
    local.get 0
    f64.const 0x1.0p+0 (;=1;)
    f64.eq
    if  ;; label = @1
      f64.const 0x1.0p+0 (;=1;)
      return
    end
    local.get 0
    local.get 0
    f64.ne
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 1
    local.get 1
    f64.ne
    if  ;; label = @1
      local.get 1
      return
    end
    local.get 1
    f64.const 0x1.0p+0 (;=1;)
    f64.eq
    if  ;; label = @1
      local.get 0
      return
    end
    local.get 0
    f64.const 0x0p+0 (;=0;)
    f64.eq
    if  ;; label = @1
      local.get 1
      f64.const 0x0p+0 (;=0;)
      f64.lt
      if  ;; label = @2
        f64.const inf (;=Infinity;)
        local.get 0
        f64.copysign
        f64.const inf (;=Infinity;)
        local.get 1
        call $mathlib__fn40
        select
        return
      end
      local.get 0
      f64.const 0x0p+0 (;=0;)
      local.get 1
      call $mathlib__fn40
      select
      return
    end
    local.get 0
    f64.abs
    local.set 3
    local.get 1
    f64.abs
    f64.const inf (;=Infinity;)
    f64.eq
    if  ;; label = @1
      local.get 3
      f64.const 0x1.0p+0 (;=1;)
      f64.eq
      if  ;; label = @2
        f64.const 0x1.0p+0 (;=1;)
        return
      end
      f64.const inf (;=Infinity;)
      f64.const 0x0p+0 (;=0;)
      local.get 3
      f64.const 0x1.0p+0 (;=1;)
      f64.gt
      local.get 1
      f64.const 0x0p+0 (;=0;)
      f64.gt
      i32.eq
      select
      return
    end
    local.get 3
    f64.const inf (;=Infinity;)
    f64.eq
    if  ;; label = @1
      local.get 0
      f64.const 0x0p+0 (;=0;)
      f64.lt
      local.get 1
      call $mathlib__fn40
      i32.and
      local.set 2
      local.get 1
      f64.const 0x0p+0 (;=0;)
      f64.gt
      if  ;; label = @2
        f64.const -inf (;=-Infinity;)
        f64.const inf (;=Infinity;)
        local.get 2
        select
        return
      end
      f64.const 0x0p+0 (;=0;)
      f64.const 0x0p+0 (;=0;)
      local.get 2
      select
      return
    end
    i32.const 0
    local.set 2
    local.get 0
    f64.const 0x0p+0 (;=0;)
    f64.lt
    if  ;; label = @1
      local.get 1
      f64.floor
      local.get 1
      f64.ne
      if  ;; label = @2
        f64.const nan (;=NaN;)
        return
      end
      local.get 1
      call $mathlib__fn40
      local.set 2
    end
    local.get 3
    call $mathlib__fn26
    local.set 6
    nop
    nop
    local.set 5
    local.get 5
    local.get 6
    local.get 1
    call $mathlib__fn7
    local.set 8
    nop
    nop
    local.set 7
    local.get 7
    local.get 8
    call $mathlib__fn41
    local.set 11
    nop
    nop
    local.set 10
    nop
    nop
    local.set 9
    local.get 9
    local.get 10
    local.get 11
    call $mathlib__fn22
    local.set 4
    local.get 2
    if (result f64)  ;; label = @1
      local.get 4
      f64.neg
    else
      local.get 4
    end)
)