(module
 (type $0 (func (param i32 i32 i32 i32) (result i32)))
 (type $1 (func))
 (import "wasi_snapshot_preview1" "fd_write" (func $fimport$0 (param i32 i32 i32 i32) (result i32)))
 (memory $0 32)
 (data $0 (i32.const 8) "Hello world!\n")
 (export "_start" (func $0))
 (export "memory" (memory $0))
 (func $0
  (i32.store
   (i32.const 0)
   (i32.const 8)
  )
  (i32.store
   (i32.const 4)
   (i32.const 13)
  )
  (drop
   (call $fimport$0
    (i32.const 1)
    (i32.const 0)
    (i32.const 1)
    (i32.const 24)
   )
  )
 )
)
