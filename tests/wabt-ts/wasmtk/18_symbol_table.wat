(module
  (memory (export "memory") 1)
  (global $free_ptr (mut i32) (i32.const 0))

  ;; [Insert function remains unchanged here...]
  (func $insert_symbol (param $name_ptr i32) (param $type_id i32) (param $scope_id i32) (result i32)
    (local $current_addr i32)
    global.get $free_ptr
    local.set $current_addr
    local.get $current_addr
    local.get $name_ptr
    i32.store offset=0
    local.get $current_addr
    local.get $type_id
    i32.store offset=4
    local.get $current_addr
    local.get $scope_id
    i32.store offset=8
    local.get $current_addr
    i32.const 12
    i32.add
    global.set $free_ptr
    local.get $current_addr
  )

  ;; New Function: lookup_symbol
  ;; Scans backward from the current heap pointer to find a matching name pointer.
  (func $lookup_symbol (param $name_ptr i32) (result i32)
    (local $scan_ptr i32)

    ;; Start scanning backward from the last filled slot
    global.get $free_ptr
    i32.const 12
    i32.sub
    local.set $scan_ptr

    (block $exit
      (loop $loop
        ;; Break loop if pointer goes negative (not found)
        local.get $scan_ptr
        i32.const 0
        i32.lt_s
        br_if $exit

        ;; Compare stored name pointer with requested name pointer
        local.get $scan_ptr
        i32.load offset=0
        local.get $name_ptr
        i32.eq
        if
          ;; Found! Return the base memory address of the matching symbol block
          local.get $scan_ptr
          return
        end

        ;; Move backward 12 bytes to the previous symbol record
        local.get $scan_ptr
        i32.const 12
        i32.sub
        local.set $scan_ptr
        br $loop
      )
    )
    ;; Return -1 if variable name does not exist in any accessible scope
    i32.const -1
  )

  (export "insert_symbol" (func $insert_symbol))
  (export "lookup_symbol" (func $lookup_symbol))
)