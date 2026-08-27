(module
  ;; Import WASI's fd_write for console output
  (import "wasi_snapshot_preview1" "fd_write" (func $fd_write (param i32 i32 i32 i32) (result i32)))

  ;; Define memory for strings and number conversion
  (memory 1)
  (export "memory" (memory 0))

  ;; Data section for strings
  (data (i32.const 0) "Fizz")       ;; "Fizz" at offset 0
  (data (i32.const 5) "Buzz")       ;; "Buzz" at offset 5
  (data (i32.const 10) "FizzBuzz")  ;; "FizzBuzz" at offset 10
  (data (i32.const 19) "0123456789") ;; Digits for number conversion at offset 19
  (data (i32.const 29) "\00\00\00\00") ;; Buffer for number string (no newline) at offset 29
  (data (i32.const 33) "\0a")       ;; Newline for explicit printing at offset 33

  (func $print_string (param $offset i32) (param $length i32)
    ;; Write string to stdout using fd_write
    (i32.store (i32.const 100) (local.get $offset))  ;; Store buffer offset
    (i32.store (i32.const 104) (local.get $length))  ;; Store buffer length
    (call $fd_write
      (i32.const 1)          ;; File descriptor 1 (stdout)
      (i32.const 100)        ;; iovec array offset
      (i32.const 1)          ;; Number of iovecs
      (i32.const 108)        ;; Offset to store number of bytes written
    )
    drop  ;; Ignore fd_write return value
  )

  (func $print_number (param $n i32)
    (local $ptr i32)
    (local $digit i32)
    (local $len i32)
    (local $temp i32)

    ;; Initialize buffer pointer (start writing digits from the end)
    (local.set $ptr (i32.const 32))  ;; End of buffer
    (local.set $len (i32.const 0))   ;; Length of the number string
    (local.set $temp (local.get $n))

    ;; Handle zero case
    (if (i32.eqz (local.get $temp))
      (then
        (i32.store8 (i32.const 31) (i32.const 48)) ;; Write '0'
        (local.set $len (i32.const 1))
        (local.set $ptr (i32.const 31))
      )
      (else
        ;; Convert number to string by extracting digits
        (loop $digit_loop
          (if (i32.gt_u (local.get $temp) (i32.const 0))
            (then
              ;; Extract last digit
              (local.set $digit (i32.rem_u (local.get $temp) (i32.const 10)))
              (local.set $temp (i32.div_u (local.get $temp) (i32.const 10)))
              ;; Store digit as ASCII
              (i32.store8
                (i32.sub (local.get $ptr) (i32.const 1))
                (i32.load8_u (i32.add (i32.const 19) (local.get $digit)))
              )
              (local.set $ptr (i32.sub (local.get $ptr) (i32.const 1)))
              (local.set $len (i32.add (local.get $len) (i32.const 1)))
              (br $digit_loop)
            )
          )
        )
      )
    )

    ;; Print the number string (from $ptr, length $len, no newline)
    (call $print_string (local.get $ptr) (local.get $len))
  )

  (func $display (param $n i32)
    (local $fbFlag i32)

    ;; Check for FizzBuzz (divisible by 15)
    (if (i32.eq (i32.rem_u (local.get $n) (i32.const 15)) (i32.const 0))
      (then
        (call $print_string (i32.const 10) (i32.const 8)) ;; Print "FizzBuzz"
        (local.set $fbFlag (i32.const 1))
      )
    )

    ;; Check for Buzz (divisible by 5, but not 15)
    (if (i32.and
          (i32.eq (i32.rem_u (local.get $n) (i32.const 5)) (i32.const 0))
          (i32.eqz (local.get $fbFlag))
        )
      (then
        (call $print_string (i32.const 5) (i32.const 4)) ;; Print "Buzz"
        (local.set $fbFlag (i32.const 1))
      )
    )

    ;; Check for Fizz (divisible by 3, but not 15)
    (if (i32.and
          (i32.eq (i32.rem_u (local.get $n) (i32.const 3)) (i32.const 0))
          (i32.eqz (local.get $fbFlag))
        )
      (then
        (call $print_string (i32.const 0) (i32.const 4)) ;; Print "Fizz"
        (local.set $fbFlag (i32.const 1))
      )
    )

    ;; If no Fizz/Buzz/FizzBuzz, print the number
    (if (i32.eqz (local.get $fbFlag))
      (then
        (call $print_number (local.get $n))
      )
    )

    ;; Explicitly print a newline
    (call $print_string (i32.const 33) (i32.const 1)) ;; Print "\n"
  )

  (func $main
    (local $i i32)
    (local.set $i (i32.const 0))

    (loop $fizzbuzz_loop
      ;; Increment $i
      (local.set $i (i32.add (local.get $i) (i32.const 1)))

      ;; Call display for current number
      (call $display (local.get $i))

      ;; Continue loop if $i < 100
      (br_if $fizzbuzz_loop
        (i32.lt_s (local.get $i) (i32.const 100))
      )
    )
  )

  ;; Export main function for WASI
  (export "_start" (func $main))
)