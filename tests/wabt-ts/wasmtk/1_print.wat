(module
  (type (;0;) (func (param i32 i32)))
  (type (;1;) (func (param i32)))
  (import "env" "print" (func $host_print (type 0)))
  (func $print (type 0) (param $str_ptr i32) (param $str_len i32)
    local.get 0
    local.get 1
    call 0)
  (func $println (type 0) (param $str_ptr i32) (param $str_len i32)
    local.get 0
    local.get 1
    call 0
    i32.const 0
    i32.const 10
    i32.store8
    i32.const 0
    i32.const 1
    call 0)
  (func $print_i32 (type 1) (param $value i32)
    i32.const 0
    i32.const 0
    call 0)
  (memory (;0;) 1)
  (export "memory" (memory 0))
  (export "print" (func 1))
  (export "println" (func 2))
  (export "print_i32" (func 3)))
