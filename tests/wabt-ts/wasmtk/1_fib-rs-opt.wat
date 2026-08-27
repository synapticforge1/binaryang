(module
  (type $0 (func (param i32 i32) (result i32)))
  (type $1 (func (param i32 i32 i32) (result i32)))
  (type $2 (func (param i32)))
  (type $3 (func (param i32 i32)))
  (type $4 (func (param i32 i32 i32 i32)))
  (type $5 (func (param i32) (result i32)))
  (type $6 (func (param i32 i32 i32)))
  (type $7 (func))
  (type $8 (func (param i32 i32 i32 i32 i32) (result i32)))
  (type $9 (func (param i32 i32 i32 i32) (result i32)))
  (type $10 (func (result i32)))
  (type $11 (func (param i32 i32 i32 i32 i32 i32) (result i32)))
  (type $12 (func (param i32 i32 i32 i32 i32)))
  (import "wasi_snapshot_preview1" "fd_write" (func $fimport$0 (type 9)))
  (import "wasi_snapshot_preview1" "environ_get" (func $fimport$1 (type 0)))
  (import "wasi_snapshot_preview1" "environ_sizes_get" (func $fimport$2 (type 0)))
  (import "wasi_snapshot_preview1" "proc_exit" (func $fimport$3 (type 2)))
  (func $0 (type 7)
    (local $0 i32)
    block  ;; label = @1
      i32.const 1055032
      i32.load
      i32.eqz
      if  ;; label = @2
        i32.const 1055032
        i32.const 1
        i32.store
        call 14
        local.tee 0
        br_if 1 (;@1;)
        return
      end
      unreachable
    end
    local.get 0
    call 83
    unreachable)
  (func $1 (type 7)
    (local $0 i32) (local $1 i32) (local $2 i32) (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i64) (local $7 i64) (local $8 i64)
    global.get 0
    i32.const 112
    i32.sub
    local.tee 0
    global.set 0
    local.get 0
    i32.const 2
    i32.store offset=16
    local.get 0
    i32.const 1048600
    i32.store offset=12
    local.get 0
    i64.const 1
    i64.store offset=24 align=4
    local.get 0
    i32.const 1
    i32.store offset=40
    local.get 0
    i32.const 55
    i32.store offset=44
    local.get 0
    local.get 0
    i32.const 36
    i32.add
    i32.store offset=20
    local.get 0
    local.get 0
    i32.const 44
    i32.add
    i32.store offset=36
    local.get 0
    i32.const 6
    i32.store offset=52
    local.get 0
    i32.const 1051264
    i32.store offset=48
    block  ;; label = @1
      block  ;; label = @2
        block  ;; label = @3
          block  ;; label = @4
            block  ;; label = @5
              block  ;; label = @6
                block  ;; label = @7
                  block  ;; label = @8
                    i32.const 1055080
                    i32.load8_u
                    i32.const 2
                    i32.sub
                    br_table 3 (;@5;) 1 (;@7;) 0 (;@8;)
                  end
                  i32.const 1055080
                  i32.const 2
                  i32.store8
                  i32.const 1024
                  call 79
                  local.tee 1
                  i32.eqz
                  br_if 1 (;@6;)
                  i32.const 1055080
                  i32.const 3
                  i32.store8
                  i32.const 1055064
                  local.get 1
                  i32.store
                  i32.const 1055056
                  i64.const 4398046511104
                  i64.store
                  i32.const 1055040
                  i64.const 0
                  i64.store
                  i32.const 1055072
                  i32.const 0
                  i32.store8
                  i32.const 1055068
                  i32.const 0
                  i32.store
                  i32.const 1055052
                  i32.const 0
                  i32.store8
                  i32.const 1055048
                  i32.const 0
                  i32.store
                end
                i32.const 1055104
                i64.load
                local.tee 7
                i64.eqz
                if  ;; label = @7
                  i32.const 1055112
                  i64.load
                  local.set 6
                  loop  ;; label = @8
                    local.get 6
                    i64.const -1
                    i64.eq
                    br_if 4 (;@4;)
                    i32.const 1055112
                    local.get 6
                    i64.const 1
                    i64.add
                    local.tee 7
                    i32.const 1055112
                    i64.load
                    local.tee 8
                    local.get 6
                    local.get 8
                    i64.eq
                    local.tee 1
                    select
                    i64.store
                    local.get 8
                    local.set 6
                    local.get 1
                    i32.eqz
                    br_if 0 (;@8;)
                  end
                  i32.const 1055104
                  local.get 7
                  i64.store
                end
                block  ;; label = @7
                  i32.const 1055040
                  i64.load
                  local.get 7
                  i64.ne
                  if  ;; label = @8
                    i32.const 1055052
                    i32.load8_u
                    local.set 2
                    i32.const 1
                    local.set 1
                    i32.const 1055052
                    i32.const 1
                    i32.store8
                    local.get 0
                    local.get 2
                    i32.store8 offset=72
                    local.get 2
                    br_if 5 (;@3;)
                    i32.const 1055040
                    local.get 7
                    i64.store
                    br 1 (;@7;)
                  end
                  i32.const 1055048
                  i32.load
                  local.tee 1
                  i32.const -1
                  i32.eq
                  br_if 5 (;@2;)
                  local.get 1
                  i32.const 1
                  i32.add
                  local.set 1
                end
                i32.const 1055048
                local.get 1
                i32.store
                local.get 0
                i32.const 1055040
                i32.store offset=64
                local.get 0
                i32.const 4
                i32.store8 offset=72
                local.get 0
                local.get 0
                i32.const -64
                i32.sub
                i32.store offset=80
                block  ;; label = @7
                  block  ;; label = @8
                    local.get 0
                    i32.const 72
                    i32.add
                    i32.const 1050380
                    local.get 0
                    i32.const 12
                    i32.add
                    call 7
                    if  ;; label = @9
                      local.get 0
                      i32.load8_u offset=72
                      i32.const 4
                      i32.ne
                      br_if 1 (;@8;)
                      local.get 0
                      i32.const 0
                      i32.store offset=104
                      local.get 0
                      i32.const 1
                      i32.store offset=92
                      local.get 0
                      i32.const 1050356
                      i32.store offset=88
                      local.get 0
                      i64.const 4
                      i64.store offset=96 align=4
                      local.get 0
                      i32.const 88
                      i32.add
                      i32.const 1050364
                      call 8
                      unreachable
                    end
                    local.get 0
                    i32.const 4
                    i32.store8 offset=56
                    i32.const 1
                    local.set 1
                    i32.const 23
                    local.get 0
                    i32.load8_u offset=72
                    i32.shr_u
                    i32.const 1
                    i32.and
                    br_if 1 (;@7;)
                    local.get 0
                    i32.load offset=76
                    local.tee 2
                    i32.load
                    local.set 3
                    local.get 2
                    i32.const 4
                    i32.add
                    i32.load
                    local.tee 4
                    i32.load
                    local.tee 5
                    if  ;; label = @9
                      local.get 3
                      local.get 5
                      call_indirect (type 2)
                    end
                    local.get 4
                    i32.load offset=4
                    if  ;; label = @9
                      local.get 3
                      call 80
                    end
                    local.get 2
                    call 80
                    br 1 (;@7;)
                  end
                  local.get 0
                  local.get 0
                  i64.load offset=72
                  local.tee 6
                  i64.store offset=56
                  local.get 6
                  i64.const 255
                  i64.and
                  i64.const 4
                  i64.eq
                  local.set 1
                end
                local.get 0
                i32.load offset=64
                local.tee 2
                local.get 2
                i32.load offset=8
                i32.const 1
                i32.sub
                local.tee 3
                i32.store offset=8
                local.get 3
                i32.eqz
                if  ;; label = @7
                  local.get 2
                  i32.const 0
                  i32.store8 offset=12
                  local.get 2
                  i64.const 0
                  i64.store
                end
                local.get 1
                i32.eqz
                br_if 5 (;@1;)
                local.get 0
                i32.const 112
                i32.add
                global.set 0
                return
              end
              i32.const 1024
              call 9
              unreachable
            end
            local.get 0
            i32.const 0
            i32.store offset=104
            local.get 0
            i32.const 1
            i32.store offset=92
            local.get 0
            i32.const 1051772
            i32.store offset=88
            local.get 0
            i64.const 4
            i64.store offset=96 align=4
            local.get 0
            i32.const 88
            i32.add
            i32.const 1052068
            call 8
            unreachable
          end
          call 10
          unreachable
        end
        local.get 0
        i64.const 0
        i64.store offset=100 align=4
        local.get 0
        i64.const 17179869185
        i64.store offset=92 align=4
        local.get 0
        i32.const 1051988
        i32.store offset=88
        local.get 0
        i32.const 72
        i32.add
        local.get 0
        i32.const 88
        i32.add
        call 11
        unreachable
      end
      global.get 0
      i32.const 48
      i32.sub
      local.tee 0
      global.set 0
      local.get 0
      i32.const 38
      i32.store offset=12
      local.get 0
      i32.const 1052012
      i32.store offset=8
      local.get 0
      i32.const 1
      i32.store offset=20
      local.get 0
      i32.const 1050232
      i32.store offset=16
      local.get 0
      i64.const 1
      i64.store offset=28 align=4
      local.get 0
      local.get 0
      i32.const 8
      i32.add
      i64.extend_i32_u
      i64.const 12884901888
      i64.or
      i64.store offset=40
      local.get 0
      local.get 0
      i32.const 40
      i32.add
      i32.store offset=24
      local.get 0
      i32.const 16
      i32.add
      i32.const 1052052
      call 8
      unreachable
    end
    local.get 0
    local.get 0
    i64.load offset=56
    i64.store offset=64
    local.get 0
    i32.const 2
    i32.store offset=92
    local.get 0
    i32.const 1051308
    i32.store offset=88
    local.get 0
    i64.const 2
    i64.store offset=100 align=4
    local.get 0
    local.get 0
    i32.const -64
    i32.sub
    i64.extend_i32_u
    i64.const 8589934592
    i64.or
    i64.store offset=80
    local.get 0
    local.get 0
    i32.const 48
    i32.add
    i64.extend_i32_u
    i64.const 12884901888
    i64.or
    i64.store offset=72
    local.get 0
    local.get 0
    i32.const 72
    i32.add
    i32.store offset=96
    local.get 0
    i32.const 88
    i32.add
    i32.const 1051324
    call 8
    unreachable)
  (func $2 (type 0) (param $0 i32) (param $1 i32) (result i32)
    (local $2 i32) (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i32) (local $7 i32) (local $8 i32) (local $scratch i32) (local $scratch_10 i32)
    global.get 0
    i32.const 16
    i32.sub
    local.tee 4
    global.set 0
    i32.const 10
    local.set 2
    block  ;; label = @1
      local.get 0
      i32.load
      local.tee 5
      local.get 5
      i32.const 31
      i32.shr_s
      local.tee 0
      i32.xor
      local.get 0
      i32.sub
      local.tee 0
      i32.const 1000
      i32.lt_u
      if  ;; label = @2
        local.get 0
        local.set 3
        br 1 (;@1;)
      end
      loop  ;; label = @2
        local.get 4
        i32.const 6
        i32.add
        local.get 2
        i32.add
        local.tee 6
        i32.const 4
        i32.sub
        local.get 0
        local.get 0
        i32.const 10000
        i32.div_u
        local.tee 3
        i32.const 10000
        i32.mul
        i32.sub
        local.tee 7
        i32.const 65535
        i32.and
        i32.const 100
        i32.div_u
        local.tee 8
        i32.const 1
        i32.shl
        i32.load16_u offset=1048653 align=1
        i32.store16 align=1
        local.get 6
        i32.const 2
        i32.sub
        local.get 7
        local.get 8
        i32.const 100
        i32.mul
        i32.sub
        i32.const 65535
        i32.and
        i32.const 1
        i32.shl
        i32.load16_u offset=1048653 align=1
        i32.store16 align=1
        local.get 2
        i32.const 4
        i32.sub
        local.set 2
        block (result i32)  ;; label = @3
          local.get 0
          i32.const 9999999
          i32.gt_u
          local.set 9
          local.get 3
          local.set 0
          local.get 9
        end
        br_if 0 (;@2;)
      end
    end
    block  ;; label = @1
      local.get 3
      i32.const 9
      i32.le_u
      if  ;; label = @2
        local.get 3
        local.set 0
        br 1 (;@1;)
      end
      local.get 2
      i32.const 2
      i32.sub
      local.tee 2
      local.get 4
      i32.const 6
      i32.add
      i32.add
      local.get 3
      local.get 3
      i32.const 65535
      i32.and
      i32.const 100
      i32.div_u
      local.tee 0
      i32.const 100
      i32.mul
      i32.sub
      i32.const 65535
      i32.and
      i32.const 1
      i32.shl
      i32.load16_u offset=1048653 align=1
      i32.store16 align=1
    end
    i32.const 0
    local.get 5
    local.get 0
    select
    i32.eqz
    if  ;; label = @1
      local.get 2
      i32.const 1
      i32.sub
      local.tee 2
      local.get 4
      i32.const 6
      i32.add
      i32.add
      local.get 0
      i32.const 1
      i32.shl
      i32.load8_u offset=1048654
      i32.store8
    end
    local.get 1
    local.get 5
    i32.const -1
    i32.xor
    i32.const 31
    i32.shr_u
    i32.const 1
    i32.const 0
    local.get 4
    i32.const 6
    i32.add
    local.get 2
    i32.add
    i32.const 10
    local.get 2
    i32.sub
    call 21
    local.set 10
    local.get 4
    i32.const 16
    i32.add
    global.set 0
    local.get 10)
  (func $3 (type 1) (param $0 i32) (param $1 i32) (param $2 i32) (result i32)
    (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i32) (local $7 i32) (local $8 i32) (local $9 i32) (local $10 i32) (local $scratch i32)
    global.get 0
    i32.const 16
    i32.sub
    local.tee 3
    global.set 0
    local.get 3
    local.get 1
    i32.store offset=4
    local.get 3
    local.get 0
    i32.store
    local.get 3
    i64.const 3758096416
    i64.store offset=8 align=4
    block (result i32)  ;; label = @1
      block  ;; label = @2
        block  ;; label = @3
          block  ;; label = @4
            local.get 2
            i32.load offset=16
            local.tee 9
            if  ;; label = @5
              local.get 2
              i32.load offset=20
              local.tee 0
              br_if 1 (;@4;)
              br 2 (;@3;)
            end
            local.get 2
            i32.load offset=12
            local.tee 0
            i32.eqz
            br_if 1 (;@3;)
            local.get 2
            i32.load offset=8
            local.tee 1
            local.get 0
            i32.const 3
            i32.shl
            local.tee 0
            i32.add
            local.set 4
            local.get 0
            i32.const 8
            i32.sub
            i32.const 3
            i32.shr_u
            i32.const 1
            i32.add
            local.set 6
            local.get 2
            i32.load
            local.set 0
            loop  ;; label = @5
              block  ;; label = @6
                local.get 0
                i32.const 4
                i32.add
                i32.load
                local.tee 5
                i32.eqz
                br_if 0 (;@6;)
                local.get 3
                i32.load
                local.get 0
                i32.load
                local.get 5
                local.get 3
                i32.load offset=4
                i32.load offset=12
                call_indirect (type 1)
                i32.eqz
                br_if 0 (;@6;)
                i32.const 1
                br 5 (;@1;)
              end
              i32.const 1
              local.get 1
              i32.load
              local.get 3
              local.get 1
              i32.const 4
              i32.add
              i32.load
              call_indirect (type 0)
              br_if 4 (;@1;)
              drop
              local.get 0
              i32.const 8
              i32.add
              local.set 0
              local.get 4
              local.get 1
              i32.const 8
              i32.add
              local.tee 1
              i32.ne
              br_if 0 (;@5;)
            end
            br 2 (;@2;)
          end
          local.get 0
          i32.const 24
          i32.mul
          local.set 10
          local.get 0
          i32.const 1
          i32.sub
          i32.const 536870911
          i32.and
          i32.const 1
          i32.add
          local.set 6
          local.get 2
          i32.load offset=8
          local.set 4
          local.get 2
          i32.load
          local.set 0
          loop  ;; label = @4
            block  ;; label = @5
              local.get 0
              i32.const 4
              i32.add
              i32.load
              local.tee 1
              i32.eqz
              br_if 0 (;@5;)
              local.get 3
              i32.load
              local.get 0
              i32.load
              local.get 1
              local.get 3
              i32.load offset=4
              i32.load offset=12
              call_indirect (type 1)
              i32.eqz
              br_if 0 (;@5;)
              i32.const 1
              br 4 (;@1;)
            end
            i32.const 0
            local.set 7
            i32.const 0
            local.set 8
            block  ;; label = @5
              block  ;; label = @6
                block  ;; label = @7
                  local.get 5
                  local.get 9
                  i32.add
                  local.tee 1
                  i32.const 8
                  i32.add
                  i32.load16_u
                  i32.const 1
                  i32.sub
                  br_table 1 (;@6;) 2 (;@5;) 0 (;@7;)
                end
                local.get 1
                i32.const 10
                i32.add
                i32.load16_u
                local.set 8
                br 1 (;@5;)
              end
              local.get 4
              local.get 1
              i32.const 12
              i32.add
              i32.load
              i32.const 3
              i32.shl
              i32.add
              i32.load16_u offset=4
              local.set 8
            end
            block  ;; label = @5
              block  ;; label = @6
                block  ;; label = @7
                  local.get 1
                  i32.load16_u
                  i32.const 1
                  i32.sub
                  br_table 1 (;@6;) 2 (;@5;) 0 (;@7;)
                end
                local.get 1
                i32.const 2
                i32.add
                i32.load16_u
                local.set 7
                br 1 (;@5;)
              end
              local.get 4
              local.get 1
              i32.const 4
              i32.add
              i32.load
              i32.const 3
              i32.shl
              i32.add
              i32.load16_u offset=4
              local.set 7
            end
            local.get 3
            local.get 7
            i32.store16 offset=14
            local.get 3
            local.get 8
            i32.store16 offset=12
            local.get 3
            local.get 1
            i32.const 20
            i32.add
            i32.load
            i32.store offset=8
            i32.const 1
            local.get 4
            local.get 1
            i32.const 16
            i32.add
            i32.load
            i32.const 3
            i32.shl
            i32.add
            local.tee 1
            i32.load
            local.get 3
            local.get 1
            i32.load offset=4
            call_indirect (type 0)
            br_if 3 (;@1;)
            drop
            local.get 0
            i32.const 8
            i32.add
            local.set 0
            local.get 5
            i32.const 24
            i32.add
            local.tee 5
            local.get 10
            i32.ne
            br_if 0 (;@4;)
          end
          br 1 (;@2;)
        end
      end
      block  ;; label = @2
        local.get 6
        local.get 2
        i32.load offset=4
        i32.ge_u
        br_if 0 (;@2;)
        local.get 3
        i32.load
        local.get 2
        i32.load
        local.get 6
        i32.const 3
        i32.shl
        i32.add
        local.tee 0
        i32.load
        local.get 0
        i32.load offset=4
        local.get 3
        i32.load offset=4
        i32.load offset=12
        call_indirect (type 1)
        i32.eqz
        br_if 0 (;@2;)
        i32.const 1
        br 1 (;@1;)
      end
      i32.const 0
    end
    local.set 11
    local.get 3
    i32.const 16
    i32.add
    global.set 0
    local.get 11)
  (func $4 (type 3) (param $0 i32) (param $1 i32)
    (local $2 i32) (local $3 i32) (local $4 i64)
    global.get 0
    i32.const 16
    i32.sub
    local.tee 2
    global.set 0
    local.get 2
    i32.const 1
    i32.store16 offset=12
    local.get 2
    local.get 1
    i32.store offset=8
    local.get 2
    local.get 0
    i32.store offset=4
    global.get 0
    i32.const 16
    i32.sub
    local.tee 1
    global.set 0
    local.get 2
    i32.const 4
    i32.add
    local.tee 0
    i64.load align=4
    local.set 4
    local.get 1
    local.get 0
    i32.store offset=12
    local.get 1
    local.get 4
    i64.store offset=4 align=4
    global.get 0
    i32.const 16
    i32.sub
    local.tee 0
    global.set 0
    local.get 1
    i32.const 4
    i32.add
    local.tee 1
    i32.load
    local.tee 2
    i32.load offset=12
    local.set 3
    block  ;; label = @1
      block  ;; label = @2
        block  ;; label = @3
          block  ;; label = @4
            local.get 2
            i32.load offset=4
            br_table 0 (;@4;) 1 (;@3;) 2 (;@2;)
          end
          local.get 3
          br_if 1 (;@2;)
          i32.const 1
          local.set 2
          i32.const 0
          local.set 3
          br 2 (;@1;)
        end
        local.get 3
        br_if 0 (;@2;)
        local.get 2
        i32.load
        local.tee 2
        i32.load offset=4
        local.set 3
        local.get 2
        i32.load
        local.set 2
        br 1 (;@1;)
      end
      local.get 0
      i32.const -2147483648
      i32.store
      local.get 0
      local.get 1
      i32.store offset=12
      local.get 0
      i32.const 1052512
      local.get 1
      i32.load offset=4
      local.get 1
      i32.load offset=8
      local.tee 0
      i32.load8_u offset=8
      local.get 0
      i32.load8_u offset=9
      call 32
      unreachable
    end
    local.get 0
    local.get 3
    i32.store offset=4
    local.get 0
    local.get 2
    i32.store
    local.get 0
    i32.const 1052484
    local.get 1
    i32.load offset=4
    local.get 1
    i32.load offset=8
    local.tee 0
    i32.load8_u offset=8
    local.get 0
    i32.load8_u offset=9
    call 32
    unreachable)
  (func $5 (type 2) (param $0 i32)
    (local $1 i32) (local $2 i32) (local $3 i32) (local $4 i32)
    global.get 0
    i32.const 48
    i32.sub
    local.tee 1
    global.set 0
    local.get 1
    i32.const 2
    i32.store offset=12
    local.get 1
    i32.const 1052120
    i32.store offset=8
    local.get 1
    i64.const 1
    i64.store offset=20 align=4
    local.get 1
    local.get 1
    i32.const 40
    i32.add
    i64.extend_i32_u
    i64.const 25769803776
    i64.or
    i64.store offset=32
    local.get 1
    local.get 0
    i32.store offset=40
    local.get 1
    local.get 1
    i32.const 32
    i32.add
    i32.store offset=16
    local.get 1
    local.get 1
    i32.const 47
    i32.add
    local.get 1
    i32.const 8
    i32.add
    call 33
    local.get 1
    i32.load offset=4
    local.set 0
    local.get 1
    i32.load8_u
    local.tee 2
    i32.const 4
    i32.le_u
    local.get 2
    i32.const 3
    i32.ne
    i32.and
    i32.eqz
    if  ;; label = @1
      local.get 0
      i32.load
      local.set 2
      local.get 0
      i32.const 4
      i32.add
      i32.load
      local.tee 3
      i32.load
      local.tee 4
      if  ;; label = @2
        local.get 2
        local.get 4
        call_indirect (type 2)
      end
      local.get 3
      i32.load offset=4
      if  ;; label = @2
        local.get 2
        call 80
      end
      local.get 0
      call 80
    end
    local.get 1
    i32.const 48
    i32.add
    global.set 0
    unreachable)
  (func $6 (type 7)
    (local $0 i32)
    global.get 0
    i32.const 32
    i32.sub
    local.tee 0
    global.set 0
    local.get 0
    i32.const 0
    i32.store offset=24
    local.get 0
    i32.const 1
    i32.store offset=12
    local.get 0
    i32.const 1052212
    i32.store offset=8
    local.get 0
    i64.const 4
    i64.store offset=16 align=4
    local.get 0
    i32.const 8
    i32.add
    i32.const 1052220
    call 8
    unreachable)
  (func $7 (type 3) (param $0 i32) (param $1 i32)
    (local $2 i32)
    global.get 0
    i32.const 16
    i32.sub
    local.tee 2
    global.set 0
    local.get 2
    i32.const 1049985
    i32.store offset=12
    local.get 2
    local.get 0
    i32.store offset=8
    global.get 0
    i32.const 112
    i32.sub
    local.tee 0
    global.set 0
    local.get 0
    i32.const 1052748
    i32.store offset=12
    local.get 0
    local.get 2
    i32.const 8
    i32.add
    i32.store offset=8
    local.get 0
    i32.const 1052748
    i32.store offset=20
    local.get 0
    local.get 2
    i32.const 12
    i32.add
    i32.store offset=16
    local.get 0
    i32.const 2
    i32.store offset=28
    local.get 0
    i32.const 1050036
    i32.store offset=24
    block  ;; label = @1
      local.get 1
      i32.load
      if  ;; label = @2
        local.get 0
        i32.const 48
        i32.add
        local.get 1
        i32.const 16
        i32.add
        i64.load align=4
        i64.store
        local.get 0
        i32.const 40
        i32.add
        local.get 1
        i32.const 8
        i32.add
        i64.load align=4
        i64.store
        local.get 0
        local.get 1
        i64.load align=4
        i64.store offset=32
        local.get 0
        i32.const 4
        i32.store offset=92
        local.get 0
        i32.const 1050140
        i32.store offset=88
        local.get 0
        i64.const 4
        i64.store offset=100 align=4
        local.get 0
        local.get 0
        i32.const 16
        i32.add
        i64.extend_i32_u
        i64.const 30064771072
        i64.or
        i64.store offset=80
        local.get 0
        local.get 0
        i32.const 8
        i32.add
        i64.extend_i32_u
        i64.const 30064771072
        i64.or
        i64.store offset=72
        local.get 0
        local.get 0
        i32.const 32
        i32.add
        i64.extend_i32_u
        i64.const 34359738368
        i64.or
        i64.store offset=64
        br 1 (;@1;)
      end
      local.get 0
      i32.const 3
      i32.store offset=92
      local.get 0
      i32.const 1050088
      i32.store offset=88
      local.get 0
      i64.const 3
      i64.store offset=100 align=4
      local.get 0
      local.get 0
      i32.const 16
      i32.add
      i64.extend_i32_u
      i64.const 30064771072
      i64.or
      i64.store offset=72
      local.get 0
      local.get 0
      i32.const 8
      i32.add
      i64.extend_i32_u
      i64.const 30064771072
      i64.or
      i64.store offset=64
    end
    local.get 0
    local.get 0
    i32.const 24
    i32.add
    i64.extend_i32_u
    i64.const 12884901888
    i64.or
    i64.store offset=56
    local.get 0
    local.get 0
    i32.const 56
    i32.add
    i32.store offset=96
    local.get 0
    i32.const 88
    i32.add
    i32.const 1051996
    call 8
    unreachable)
  (func $8 (type 0) (param $0 i32) (param $1 i32) (result i32)
    (local $2 i32) (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i32) (local $7 i32) (local $8 i32) (local $9 i32) (local $scratch i32) (local $scratch_11 i32)
    global.get 0
    i32.const 1072
    i32.sub
    local.tee 2
    global.set 0
    block  ;; label = @1
      block  ;; label = @2
        block  ;; label = @3
          block  ;; label = @4
            block  ;; label = @5
              block  ;; label = @6
                block  ;; label = @7
                  block  ;; label = @8
                    block  ;; label = @9
                      local.get 0
                      i32.load8_u
                      i32.const 1
                      i32.sub
                      br_table 3 (;@6;) 2 (;@7;) 1 (;@8;) 0 (;@9;)
                    end
                    local.get 2
                    local.get 0
                    i32.load offset=4
                    local.tee 4
                    i32.store offset=4
                    local.get 2
                    i32.const 24
                    i32.add
                    local.tee 0
                    i32.const 0
                    i32.const 1024
                    memory.fill
                    block (result i32)  ;; label = @9
                      i32.const 1055664
                      i32.load
                      local.tee 3
                      if (result i32)  ;; label = @10
                        local.get 3
                      else
                        i32.const 1055664
                        i32.const 1055640
                        i32.store
                        i32.const 1055640
                      end
                      i32.load offset=20
                      drop
                      local.get 4
                      i32.const 0
                      local.get 4
                      i32.const 76
                      i32.le_u
                      select
                      i32.const 1
                      i32.shl
                      i32.const 1054864
                      i32.add
                      i32.load16_u
                      i32.const 1053312
                      i32.add
                      local.tee 4
                      call 86
                      local.tee 3
                      i32.const 1024
                      i32.ge_u
                      if  ;; label = @10
                        local.get 0
                        local.get 4
                        i32.const 1023
                        memory.copy
                        local.get 0
                        i32.const 1023
                        i32.add
                        i32.const 0
                        i32.store8
                        i32.const 68
                        br 1 (;@9;)
                      end
                      local.get 3
                      i32.const 1
                      i32.add
                      local.tee 3
                      if  ;; label = @10
                        local.get 0
                        local.get 4
                        local.get 3
                        memory.copy
                      end
                      i32.const 0
                    end
                    i32.const 0
                    i32.ge_s
                    if  ;; label = @9
                      local.get 0
                      call 86
                      local.tee 4
                      i32.eqz
                      if  ;; label = @10
                        i32.const 1
                        local.set 0
                        br 6 (;@4;)
                      end
                      local.get 4
                      i32.const 7
                      i32.sub
                      local.tee 0
                      i32.const 0
                      local.get 0
                      local.get 4
                      i32.le_u
                      select
                      local.set 8
                      local.get 2
                      i32.const 27
                      i32.add
                      i32.const -4
                      i32.and
                      local.get 2
                      i32.const 24
                      i32.add
                      i32.sub
                      local.set 9
                      i32.const 0
                      local.set 0
                      loop  ;; label = @10
                        block  ;; label = @11
                          block  ;; label = @12
                            block  ;; label = @13
                              local.get 2
                              i32.const 24
                              i32.add
                              local.get 0
                              i32.add
                              i32.load8_u
                              local.tee 5
                              i32.extend8_s
                              local.tee 6
                              i32.const 0
                              i32.ge_s
                              if  ;; label = @14
                                local.get 9
                                local.get 0
                                i32.sub
                                i32.const 3
                                i32.and
                                br_if 1 (;@13;)
                                local.get 0
                                local.get 8
                                i32.ge_u
                                br_if 2 (;@12;)
                                loop  ;; label = @15
                                  local.get 2
                                  i32.const 24
                                  i32.add
                                  local.get 0
                                  i32.add
                                  local.tee 3
                                  i32.const 4
                                  i32.add
                                  i32.load
                                  local.get 3
                                  i32.load
                                  i32.or
                                  i32.const -2139062144
                                  i32.and
                                  br_if 3 (;@12;)
                                  local.get 0
                                  i32.const 8
                                  i32.add
                                  local.tee 0
                                  local.get 8
                                  i32.lt_u
                                  br_if 0 (;@15;)
                                end
                                br 2 (;@12;)
                              end
                              i32.const 256
                              local.set 7
                              i32.const 1
                              local.set 3
                              block  ;; label = @14
                                block  ;; label = @15
                                  block (result i32)  ;; label = @16
                                    block  ;; label = @17
                                      block  ;; label = @18
                                        block  ;; label = @19
                                          block  ;; label = @20
                                            block  ;; label = @21
                                              block  ;; label = @22
                                                block  ;; label = @23
                                                  block  ;; label = @24
                                                    block  ;; label = @25
                                                      local.get 5
                                                      i32.load8_u offset=1048929
                                                      i32.const 2
                                                      i32.sub
                                                      br_table 0 (;@25;) 1 (;@24;) 2 (;@23;) 10 (;@15;)
                                                    end
                                                    local.get 0
                                                    i32.const 1
                                                    i32.add
                                                    local.tee 5
                                                    local.get 4
                                                    i32.lt_u
                                                    br_if 2 (;@22;)
                                                    i32.const 0
                                                    local.set 7
                                                    i32.const 0
                                                    local.set 3
                                                    br 9 (;@15;)
                                                  end
                                                  i32.const 0
                                                  local.set 7
                                                  local.get 0
                                                  i32.const 1
                                                  i32.add
                                                  local.tee 3
                                                  local.get 4
                                                  i32.lt_u
                                                  br_if 2 (;@21;)
                                                  i32.const 0
                                                  local.set 3
                                                  br 8 (;@15;)
                                                end
                                                i32.const 0
                                                local.set 7
                                                local.get 0
                                                i32.const 1
                                                i32.add
                                                local.tee 3
                                                local.get 4
                                                i32.lt_u
                                                br_if 2 (;@20;)
                                                i32.const 0
                                                local.set 3
                                                br 7 (;@15;)
                                              end
                                              local.get 2
                                              i32.const 24
                                              i32.add
                                              local.get 5
                                              i32.add
                                              i32.load8_s
                                              i32.const -65
                                              i32.gt_s
                                              br_if 6 (;@15;)
                                              br 7 (;@14;)
                                            end
                                            local.get 2
                                            i32.const 24
                                            i32.add
                                            local.get 3
                                            i32.add
                                            i32.load8_s
                                            local.set 3
                                            block  ;; label = @21
                                              block  ;; label = @22
                                                block  ;; label = @23
                                                  local.get 5
                                                  i32.const 224
                                                  i32.sub
                                                  br_table 0 (;@23;) 2 (;@21;) 2 (;@21;) 2 (;@21;) 2 (;@21;) 2 (;@21;) 2 (;@21;) 2 (;@21;) 2 (;@21;) 2 (;@21;) 2 (;@21;) 2 (;@21;) 2 (;@21;) 1 (;@22;) 2 (;@21;)
                                                end
                                                local.get 3
                                                i32.const -32
                                                i32.and
                                                i32.const -96
                                                i32.eq
                                                br_if 4 (;@18;)
                                                br 3 (;@19;)
                                              end
                                              local.get 3
                                              i32.const -97
                                              i32.gt_s
                                              br_if 2 (;@19;)
                                              br 3 (;@18;)
                                            end
                                            local.get 6
                                            i32.const 31
                                            i32.add
                                            i32.const 255
                                            i32.and
                                            i32.const 12
                                            i32.ge_u
                                            if  ;; label = @21
                                              local.get 6
                                              i32.const -2
                                              i32.and
                                              i32.const -18
                                              i32.ne
                                              br_if 2 (;@19;)
                                              local.get 3
                                              i32.const -64
                                              i32.lt_s
                                              br_if 3 (;@18;)
                                              br 2 (;@19;)
                                            end
                                            local.get 3
                                            i32.const -64
                                            i32.lt_s
                                            br_if 2 (;@18;)
                                            br 1 (;@19;)
                                          end
                                          local.get 2
                                          i32.const 24
                                          i32.add
                                          local.get 3
                                          i32.add
                                          i32.load8_s
                                          local.set 3
                                          block  ;; label = @20
                                            block  ;; label = @21
                                              block  ;; label = @22
                                                block  ;; label = @23
                                                  local.get 5
                                                  i32.const 240
                                                  i32.sub
                                                  br_table 1 (;@22;) 0 (;@23;) 0 (;@23;) 0 (;@23;) 2 (;@21;) 0 (;@23;)
                                                end
                                                local.get 6
                                                i32.const 15
                                                i32.add
                                                i32.const 255
                                                i32.and
                                                i32.const 2
                                                i32.gt_u
                                                br_if 3 (;@19;)
                                                local.get 3
                                                i32.const -64
                                                i32.ge_s
                                                br_if 3 (;@19;)
                                                br 2 (;@20;)
                                              end
                                              local.get 3
                                              i32.const 112
                                              i32.add
                                              i32.const 255
                                              i32.and
                                              i32.const 48
                                              i32.ge_u
                                              br_if 2 (;@19;)
                                              br 1 (;@20;)
                                            end
                                            local.get 3
                                            i32.const -113
                                            i32.gt_s
                                            br_if 1 (;@19;)
                                          end
                                          local.get 4
                                          local.get 0
                                          i32.const 2
                                          i32.add
                                          local.tee 3
                                          i32.le_u
                                          if  ;; label = @20
                                            i32.const 0
                                            local.set 3
                                            br 5 (;@15;)
                                          end
                                          local.get 2
                                          i32.const 24
                                          i32.add
                                          local.tee 6
                                          local.get 3
                                          i32.add
                                          i32.load8_s
                                          i32.const -65
                                          i32.gt_s
                                          br_if 2 (;@17;)
                                          i32.const 0
                                          local.set 3
                                          local.get 0
                                          i32.const 3
                                          i32.add
                                          local.tee 5
                                          local.get 4
                                          i32.ge_u
                                          br_if 4 (;@15;)
                                          local.get 5
                                          local.get 6
                                          i32.add
                                          i32.load8_s
                                          i32.const -65
                                          i32.le_s
                                          br_if 5 (;@14;)
                                          i32.const 768
                                          br 3 (;@16;)
                                        end
                                        i32.const 256
                                        br 2 (;@16;)
                                      end
                                      i32.const 0
                                      local.set 3
                                      local.get 0
                                      i32.const 2
                                      i32.add
                                      local.tee 5
                                      local.get 4
                                      i32.ge_u
                                      br_if 2 (;@15;)
                                      local.get 2
                                      i32.const 24
                                      i32.add
                                      local.get 5
                                      i32.add
                                      i32.load8_s
                                      i32.const -65
                                      i32.le_s
                                      br_if 3 (;@14;)
                                    end
                                    i32.const 512
                                  end
                                  local.set 7
                                  i32.const 1
                                  local.set 3
                                end
                                local.get 2
                                local.get 0
                                i32.store offset=1048
                                local.get 2
                                local.get 3
                                local.get 7
                                i32.or
                                i32.store offset=1052
                                global.get 0
                                i32.const -64
                                i32.add
                                local.tee 0
                                global.set 0
                                local.get 0
                                i32.const 43
                                i32.store offset=12
                                local.get 0
                                i32.const 1051560
                                i32.store offset=8
                                local.get 0
                                i32.const 1051544
                                i32.store offset=20
                                local.get 0
                                local.get 2
                                i32.const 1048
                                i32.add
                                i32.store offset=16
                                local.get 0
                                i32.const 2
                                i32.store offset=28
                                local.get 0
                                i32.const 1050020
                                i32.store offset=24
                                local.get 0
                                i64.const 2
                                i64.store offset=36 align=4
                                local.get 0
                                local.get 0
                                i32.const 16
                                i32.add
                                i64.extend_i32_u
                                i64.const 30064771072
                                i64.or
                                i64.store offset=56
                                local.get 0
                                local.get 0
                                i32.const 8
                                i32.add
                                i64.extend_i32_u
                                i64.const 12884901888
                                i64.or
                                i64.store offset=48
                                local.get 0
                                local.get 0
                                i32.const 48
                                i32.add
                                i32.store offset=32
                                local.get 0
                                i32.const 24
                                i32.add
                                i32.const 1051604
                                call 8
                                unreachable
                              end
                              local.get 5
                              i32.const 1
                              i32.add
                              local.set 0
                              br 2 (;@11;)
                            end
                            local.get 0
                            i32.const 1
                            i32.add
                            local.set 0
                            br 1 (;@11;)
                          end
                          local.get 0
                          local.get 4
                          i32.ge_u
                          br_if 0 (;@11;)
                          loop  ;; label = @12
                            local.get 2
                            i32.const 24
                            i32.add
                            local.get 0
                            i32.add
                            i32.load8_s
                            i32.const 0
                            i32.lt_s
                            br_if 1 (;@11;)
                            local.get 4
                            local.get 0
                            i32.const 1
                            i32.add
                            local.tee 0
                            i32.ne
                            br_if 0 (;@12;)
                          end
                          br 6 (;@5;)
                        end
                        local.get 0
                        local.get 4
                        i32.lt_u
                        br_if 0 (;@10;)
                      end
                      br 4 (;@5;)
                    end
                    local.get 2
                    i32.const 0
                    i32.store offset=1064
                    local.get 2
                    i32.const 1
                    i32.store offset=1052
                    local.get 2
                    i32.const 1051640
                    i32.store offset=1048
                    local.get 2
                    i64.const 4
                    i64.store offset=1056 align=4
                    local.get 2
                    i32.const 1048
                    i32.add
                    i32.const 1051648
                    call 8
                    unreachable
                  end
                  local.get 0
                  i32.load offset=4
                  local.tee 0
                  i32.load
                  local.get 1
                  local.get 0
                  i32.load offset=4
                  i32.load offset=16
                  call_indirect (type 0)
                  local.set 0
                  br 4 (;@3;)
                end
                local.get 1
                local.get 0
                i32.load offset=4
                local.tee 0
                i32.load
                local.get 0
                i32.load offset=4
                call 20
                local.set 0
                br 3 (;@3;)
              end
              local.get 2
              local.get 0
              i32.load8_u offset=1
              i32.const 2
              i32.shl
              local.tee 0
              i32.load offset=1052976
              i32.store offset=1052
              local.get 2
              local.get 0
              i32.load offset=1053144
              i32.store offset=1048
              local.get 2
              local.get 2
              i32.const 1048
              i32.add
              i64.extend_i32_u
              i64.const 12884901888
              i64.or
              i64.store offset=8
              local.get 1
              i32.load
              block (result i32)  ;; label = @6
                local.get 1
                i32.load offset=4
                local.set 10
                local.get 2
                i64.const 1
                i64.store offset=36 align=4
                local.get 2
                i32.const 1
                i32.store offset=28
                local.get 2
                i32.const 1050232
                i32.store offset=24
                local.get 2
                local.get 2
                i32.const 8
                i32.add
                i32.store offset=32
                local.get 10
              end
              local.get 2
              i32.const 24
              i32.add
              call 7
              local.set 0
              br 2 (;@3;)
            end
            local.get 4
            i32.const 0
            i32.lt_s
            br_if 2 (;@2;)
            local.get 4
            i32.eqz
            if  ;; label = @5
              i32.const 1
              local.set 0
              br 1 (;@4;)
            end
            local.get 4
            call 19
            local.tee 0
            i32.eqz
            br_if 3 (;@1;)
          end
          local.get 4
          if  ;; label = @4
            local.get 0
            local.get 2
            i32.const 24
            i32.add
            local.get 4
            memory.copy
          end
          local.get 2
          local.get 4
          i32.store offset=16
          local.get 2
          local.get 0
          i32.store offset=12
          local.get 2
          local.get 4
          i32.store offset=8
          local.get 2
          local.get 2
          i32.const 4
          i32.add
          i64.extend_i32_u
          i64.const 4294967296
          i64.or
          i64.store offset=1056
          local.get 2
          local.get 2
          i32.const 8
          i32.add
          i64.extend_i32_u
          i64.const 17179869184
          i64.or
          i64.store offset=1048
          local.get 1
          i32.load
          block (result i32)  ;; label = @4
            local.get 1
            i32.load offset=4
            local.set 11
            local.get 2
            i64.const 2
            i64.store offset=36 align=4
            local.get 2
            i32.const 3
            i32.store offset=28
            local.get 2
            i32.const 1052808
            i32.store offset=24
            local.get 2
            local.get 2
            i32.const 1048
            i32.add
            i32.store offset=32
            local.get 11
          end
          local.get 2
          i32.const 24
          i32.add
          call 7
          local.set 0
          local.get 2
          i32.load offset=8
          i32.eqz
          br_if 0 (;@3;)
          local.get 2
          i32.load offset=12
          call 80
        end
        local.get 2
        i32.const 1072
        i32.add
        global.set 0
        local.get 0
        return
      end
      i32.const 1052928
      call 18
      unreachable
    end
    local.get 4
    call 9
    unreachable)
  (func $9 (type 0) (param $0 i32) (param $1 i32) (result i32)
    local.get 1
    local.get 0
    i32.load
    local.get 0
    i32.load offset=4
    call 20)
  (func $10 (type 10) (result i32)
    (local $0 i32) (local $1 i32) (local $2 i32) (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i32) (local $7 i32) (local $8 i64) (local $9 i64) (local $10 i64) (local $scratch i32) (local $scratch_12 i32)
    global.get 0
    i32.const 32
    i32.sub
    local.tee 1
    global.set 0
    block  ;; label = @1
      block  ;; label = @2
        block  ;; label = @3
          block  ;; label = @4
            block  ;; label = @5
              block  ;; label = @6
                block  ;; label = @7
                  block  ;; label = @8
                    i32.const 1055104
                    i64.load
                    local.tee 9
                    i64.eqz
                    if  ;; label = @9
                      i32.const 1055112
                      i64.load
                      local.set 8
                      loop  ;; label = @10
                        local.get 8
                        i64.const -1
                        i64.eq
                        br_if 2 (;@8;)
                        i32.const 1055112
                        local.get 8
                        i64.const 1
                        i64.add
                        local.tee 9
                        i32.const 1055112
                        i64.load
                        local.tee 10
                        local.get 8
                        local.get 10
                        i64.eq
                        local.tee 0
                        select
                        i64.store
                        local.get 10
                        local.set 8
                        local.get 0
                        i32.eqz
                        br_if 0 (;@10;)
                      end
                      i32.const 1055104
                      local.get 9
                      i64.store
                    end
                    i32.const 1055096
                    local.get 9
                    i64.store
                    call 5
                    i32.const 1055088
                    i32.load8_u
                    local.tee 0
                    i32.const 3
                    i32.eq
                    br_if 6 (;@2;)
                    block  ;; label = @9
                      block  ;; label = @10
                        block  ;; label = @11
                          local.get 0
                          i32.const 1
                          i32.sub
                          br_table 2 (;@9;) 1 (;@10;) 0 (;@11;)
                        end
                        i32.const 1055088
                        i32.const 2
                        i32.store8
                        i32.const 1055080
                        i32.load8_u
                        local.tee 0
                        i32.const 3
                        i32.ne
                        if  ;; label = @11
                          local.get 0
                          i32.const 2
                          i32.ne
                          if  ;; label = @12
                            i32.const 1055080
                            i32.const 3
                            i32.store8
                            i32.const 1055064
                            i64.const 1
                            i64.store
                            i32.const 1055056
                            i64.const 0
                            i64.store
                            i32.const 1055040
                            i64.const 0
                            i64.store
                            i32.const 1055072
                            i32.const 0
                            i32.store8
                            i32.const 1055052
                            i32.const 0
                            i32.store8
                            i32.const 1055048
                            i32.const 0
                            i32.store
                            br 9 (;@3;)
                          end
                          local.get 1
                          i32.const 0
                          i32.store offset=24
                          local.get 1
                          i32.const 1
                          i32.store offset=12
                          local.get 1
                          i32.const 1051772
                          i32.store offset=8
                          local.get 1
                          i64.const 4
                          i64.store offset=16 align=4
                          local.get 1
                          i32.const 8
                          i32.add
                          i32.const 1052068
                          call 8
                          unreachable
                        end
                        i32.const 1055104
                        i64.load
                        local.tee 9
                        i64.eqz
                        if  ;; label = @11
                          i32.const 1055112
                          i64.load
                          local.set 8
                          loop  ;; label = @12
                            local.get 8
                            i64.const -1
                            i64.eq
                            br_if 4 (;@8;)
                            i32.const 1055112
                            local.get 8
                            i64.const 1
                            i64.add
                            local.tee 9
                            i32.const 1055112
                            i64.load
                            local.tee 10
                            local.get 8
                            local.get 10
                            i64.eq
                            local.tee 0
                            select
                            i64.store
                            local.get 10
                            local.set 8
                            local.get 0
                            i32.eqz
                            br_if 0 (;@12;)
                          end
                          i32.const 1055104
                          local.get 9
                          i64.store
                        end
                        block  ;; label = @11
                          i32.const 1055040
                          i64.load
                          local.get 9
                          i64.ne
                          if  ;; label = @12
                            block (result i32)  ;; label = @13
                              i32.const 1055052
                              i32.load8_u
                              local.set 11
                              i32.const 1
                              local.set 2
                              i32.const 1055052
                              i32.const 1
                              i32.store8
                              local.get 11
                            end
                            br_if 9 (;@3;)
                            i32.const 1055040
                            local.get 9
                            i64.store
                            br 1 (;@11;)
                          end
                          i32.const 1055048
                          i32.load
                          local.tee 0
                          i32.const -1
                          i32.eq
                          br_if 8 (;@3;)
                          local.get 0
                          i32.const 1
                          i32.add
                          local.set 2
                        end
                        i32.const 1055048
                        local.get 2
                        i32.store
                        i32.const 1055056
                        i32.load
                        br_if 3 (;@7;)
                        i32.const 1055056
                        i32.const -1
                        i32.store
                        i32.const 1055072
                        i32.load8_u
                        br_if 6 (;@4;)
                        i32.const 0
                        local.set 2
                        i32.const 1055068
                        i32.load
                        local.tee 4
                        i32.eqz
                        br_if 6 (;@4;)
                        i32.const 1055064
                        i32.load
                        local.set 7
                        loop  ;; label = @11
                          local.get 1
                          local.get 4
                          local.get 2
                          i32.sub
                          local.tee 3
                          i32.store offset=4
                          local.get 1
                          local.get 2
                          local.get 7
                          i32.add
                          local.tee 5
                          i32.store
                          local.get 1
                          i32.const 8
                          i32.add
                          i32.const 1
                          local.get 1
                          i32.const 1
                          call 15
                          block  ;; label = @12
                            block  ;; label = @13
                              block  ;; label = @14
                                block  ;; label = @15
                                  local.get 1
                                  i32.load16_u offset=8
                                  i32.const 1
                                  i32.eq
                                  if  ;; label = @16
                                    local.get 3
                                    local.set 0
                                    local.get 1
                                    i32.load16_u offset=10
                                    local.tee 6
                                    i32.const 8
                                    i32.sub
                                    br_table 1 (;@15;) 2 (;@14;) 2 (;@14;) 2 (;@14;) 2 (;@14;) 2 (;@14;) 2 (;@14;) 2 (;@14;) 2 (;@14;) 2 (;@14;) 2 (;@14;) 2 (;@14;) 2 (;@14;) 2 (;@14;) 2 (;@14;) 2 (;@14;) 2 (;@14;) 2 (;@14;) 2 (;@14;) 4 (;@12;) 2 (;@14;)
                                  end
                                  local.get 1
                                  i32.load offset=12
                                  local.set 0
                                end
                                local.get 0
                                br_if 1 (;@13;)
                                i64.const 4516226831220738
                                local.set 8
                                br 8 (;@6;)
                              end
                              local.get 6
                              i64.extend_i32_u
                              i64.const 32
                              i64.shl
                              local.set 8
                              br 7 (;@6;)
                            end
                            local.get 0
                            local.get 2
                            i32.add
                            local.set 2
                          end
                          local.get 2
                          local.get 4
                          i32.lt_u
                          br_if 0 (;@11;)
                        end
                        br 5 (;@5;)
                      end
                      local.get 1
                      i32.const 0
                      i32.store offset=24
                      local.get 1
                      i32.const 1
                      i32.store offset=12
                      local.get 1
                      i32.const 1051772
                      i32.store offset=8
                      br 8 (;@1;)
                    end
                    local.get 1
                    i32.const 0
                    i32.store offset=24
                    local.get 1
                    i32.const 1
                    i32.store offset=12
                    local.get 1
                    i32.const 1051708
                    i32.store offset=8
                    br 7 (;@1;)
                  end
                  call 10
                  unreachable
                end
                i32.const 1051272
                call 16
                unreachable
              end
              block (result i32)  ;; label = @6
                local.get 8
                i32.wrap_i64
                local.set 12
                block  ;; label = @7
                  local.get 2
                  i32.eqz
                  br_if 0 (;@7;)
                  local.get 3
                  i32.eqz
                  br_if 0 (;@7;)
                  local.get 7
                  local.get 5
                  local.get 3
                  memory.copy
                end
                local.get 12
              end
              i32.const 255
              i32.and
              local.tee 0
              i32.const 4
              i32.le_u
              local.get 0
              i32.const 3
              i32.ne
              i32.and
              br_if 1 (;@4;)
              local.get 8
              i64.const 32
              i64.shr_u
              i32.wrap_i64
              local.tee 5
              i32.load
              local.set 6
              local.get 5
              i32.const 4
              i32.add
              i32.load
              local.tee 3
              i32.load
              local.tee 0
              if  ;; label = @6
                local.get 6
                local.get 0
                call_indirect (type 2)
              end
              local.get 3
              i32.load offset=4
              if  ;; label = @6
                local.get 6
                call 80
              end
              local.get 5
              call 80
              br 1 (;@4;)
            end
            local.get 2
            local.get 4
            i32.le_u
            br_if 0 (;@4;)
            i32.const 0
            local.get 2
            local.get 4
            i32.const 1052764
            call 17
            unreachable
          end
          i32.const 1055060
          i32.load
          if  ;; label = @4
            i32.const 1055064
            i32.load
            call 80
          end
          i32.const 1055060
          i64.const 4294967296
          i64.store align=4
          i32.const 1055056
          i32.const 1055056
          i32.load
          i32.const 1
          i32.add
          i32.store
          i32.const 1055048
          i32.const 1055048
          i32.load
          i32.const 1
          i32.sub
          local.tee 0
          i32.store
          i32.const 1055072
          i32.const 0
          i32.store8
          i32.const 1055068
          i32.const 0
          i32.store
          local.get 0
          br_if 0 (;@3;)
          i32.const 1055040
          i64.const 0
          i64.store
          i32.const 1055052
          i32.const 0
          i32.store8
        end
        i32.const 1055088
        i32.const 3
        i32.store8
      end
      local.get 1
      i32.const 32
      i32.add
      global.set 0
      i32.const 0
      return
    end
    local.get 1
    i64.const 4
    i64.store offset=16 align=4
    local.get 1
    i32.const 8
    i32.add
    i32.const 1051528
    call 8
    unreachable)
  (func $11 (type 4) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32)
    (local $4 i32)
    global.get 0
    i32.const 16
    i32.sub
    local.tee 4
    global.set 0
    local.get 0
    block (result i32)  ;; label = @1
      local.get 1
      local.get 2
      local.get 3
      local.get 4
      i32.const 12
      i32.add
      call 0
      local.tee 1
      i32.eqz
      if  ;; label = @2
        local.get 0
        local.get 4
        i32.load offset=12
        i32.store offset=4
        i32.const 0
        br 1 (;@1;)
      end
      local.get 0
      local.get 1
      i32.store16 offset=2
      i32.const 1
    end
    i32.store16
    local.get 4
    i32.const 16
    i32.add
    global.set 0)
  (func $12 (type 2) (param $0 i32)
    (local $1 i32)
    global.get 0
    i32.const 48
    i32.sub
    local.tee 1
    global.set 0
    local.get 1
    i32.const 1
    i32.store offset=12
    local.get 1
    i32.const 1050232
    i32.store offset=8
    local.get 1
    i64.const 1
    i64.store offset=20 align=4
    local.get 1
    local.get 1
    i32.const 47
    i32.add
    i64.extend_i32_u
    i64.const 38654705664
    i64.or
    i64.store offset=32
    local.get 1
    local.get 1
    i32.const 32
    i32.add
    i32.store offset=16
    local.get 1
    i32.const 8
    i32.add
    local.get 0
    call 8
    unreachable)
  (func $13 (type 4) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32)
    block  ;; label = @1
      local.get 0
      local.get 2
      i32.le_u
      if  ;; label = @2
        local.get 1
        local.get 2
        i32.gt_u
        br_if 1 (;@1;)
        local.get 0
        local.get 1
        i32.le_u
        br_if 1 (;@1;)
        global.get 0
        i32.const 48
        i32.sub
        local.tee 2
        global.set 0
        local.get 2
        local.get 1
        i32.store offset=4
        local.get 2
        local.get 0
        i32.store
        local.get 2
        i32.const 2
        i32.store offset=12
        local.get 2
        i32.const 1049292
        i32.store offset=8
        local.get 2
        i64.const 2
        i64.store offset=20 align=4
        local.get 2
        local.get 2
        i32.const 4
        i32.add
        i64.extend_i32_u
        i64.const 25769803776
        i64.or
        i64.store offset=40
        local.get 2
        local.get 2
        i64.extend_i32_u
        i64.const 25769803776
        i64.or
        i64.store offset=32
        local.get 2
        local.get 2
        i32.const 32
        i32.add
        i32.store offset=16
        local.get 2
        i32.const 8
        i32.add
        local.get 3
        call 8
        unreachable
      end
      global.get 0
      i32.const 48
      i32.sub
      local.tee 1
      global.set 0
      local.get 1
      local.get 2
      i32.store offset=4
      local.get 1
      local.get 0
      i32.store
      local.get 1
      i32.const 2
      i32.store offset=12
      local.get 1
      i32.const 1049240
      i32.store offset=8
      local.get 1
      i64.const 2
      i64.store offset=20 align=4
      local.get 1
      local.get 1
      i32.const 4
      i32.add
      i64.extend_i32_u
      i64.const 25769803776
      i64.or
      i64.store offset=40
      local.get 1
      local.get 1
      i64.extend_i32_u
      i64.const 25769803776
      i64.or
      i64.store offset=32
      local.get 1
      local.get 1
      i32.const 32
      i32.add
      i32.store offset=16
      local.get 1
      i32.const 8
      i32.add
      local.get 3
      call 8
      unreachable
    end
    global.get 0
    i32.const 48
    i32.sub
    local.tee 0
    global.set 0
    local.get 0
    local.get 2
    i32.store offset=4
    local.get 0
    local.get 1
    i32.store
    local.get 0
    i32.const 2
    i32.store offset=12
    local.get 0
    i32.const 1049324
    i32.store offset=8
    local.get 0
    i64.const 2
    i64.store offset=20 align=4
    local.get 0
    local.get 0
    i32.const 4
    i32.add
    i64.extend_i32_u
    i64.const 25769803776
    i64.or
    i64.store offset=40
    local.get 0
    local.get 0
    i64.extend_i32_u
    i64.const 25769803776
    i64.or
    i64.store offset=32
    local.get 0
    local.get 0
    i32.const 32
    i32.add
    i32.store offset=16
    local.get 0
    i32.const 8
    i32.add
    local.get 3
    call 8
    unreachable)
  (func $14 (type 2) (param $0 i32)
    (local $1 i32)
    global.get 0
    i32.const 32
    i32.sub
    local.tee 1
    global.set 0
    local.get 1
    i32.const 0
    i32.store offset=24
    local.get 1
    i32.const 1
    i32.store offset=12
    local.get 1
    i32.const 1048636
    i32.store offset=8
    local.get 1
    i64.const 4
    i64.store offset=16 align=4
    local.get 1
    i32.const 8
    i32.add
    local.get 0
    call 8
    unreachable)
  (func $15 (type 5) (param $0 i32) (result i32)
    (local $1 i32) (local $2 i32) (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i32) (local $7 i32) (local $scratch i32)
    global.get 0
    i32.const 16
    i32.sub
    local.tee 5
    global.set 0
    block (result i32)  ;; label = @1
      local.get 0
      i32.eqz
      if  ;; label = @2
        local.get 5
        i32.const 0
        i32.store offset=12
        block (result i32)  ;; label = @3
          i32.const 48
          local.get 0
          i32.const -68
          i32.gt_u
          br_if 0 (;@3;)
          drop
          i32.const 48
          block (result i32)  ;; label = @4
            local.get 0
            i32.const -80
            i32.ge_u
            if  ;; label = @5
              i32.const 1055632
              i32.const 48
              i32.store
              i32.const 0
              br 1 (;@4;)
            end
            i32.const 0
            i32.const 16
            local.get 0
            i32.const 19
            i32.add
            i32.const -16
            i32.and
            local.get 0
            i32.const 11
            i32.lt_u
            select
            local.tee 4
            i32.const 28
            i32.add
            call 79
            local.tee 0
            i32.eqz
            br_if 0 (;@4;)
            drop
            local.get 0
            i32.const 8
            i32.sub
            local.set 1
            block  ;; label = @5
              local.get 0
              i32.const 15
              i32.and
              i32.eqz
              if  ;; label = @6
                local.get 1
                local.set 0
                br 1 (;@5;)
              end
              local.get 0
              i32.const 4
              i32.sub
              local.tee 6
              i32.load
              local.tee 7
              i32.const -8
              i32.and
              local.get 0
              i32.const 15
              i32.add
              i32.const -16
              i32.and
              i32.const 8
              i32.sub
              local.tee 0
              i32.const 16
              i32.const 0
              local.get 0
              local.get 1
              i32.sub
              i32.const 15
              i32.le_u
              select
              i32.add
              local.tee 0
              local.get 1
              i32.sub
              local.tee 2
              i32.sub
              local.set 3
              local.get 7
              i32.const 3
              i32.and
              i32.eqz
              if  ;; label = @6
                local.get 0
                local.get 3
                i32.store offset=4
                local.get 0
                local.get 1
                i32.load
                local.get 2
                i32.add
                i32.store
                br 1 (;@5;)
              end
              local.get 0
              local.get 3
              local.get 0
              i32.load offset=4
              i32.const 1
              i32.and
              i32.or
              i32.const 2
              i32.or
              i32.store offset=4
              local.get 0
              local.get 3
              i32.add
              local.tee 3
              local.get 3
              i32.load offset=4
              i32.const 1
              i32.or
              i32.store offset=4
              local.get 6
              local.get 2
              local.get 6
              i32.load
              i32.const 1
              i32.and
              i32.or
              i32.const 2
              i32.or
              i32.store
              local.get 1
              local.get 2
              i32.add
              local.tee 3
              local.get 3
              i32.load offset=4
              i32.const 1
              i32.or
              i32.store offset=4
              local.get 1
              local.get 2
              call 82
            end
            block  ;; label = @5
              local.get 0
              i32.load offset=4
              local.tee 1
              i32.const 3
              i32.and
              i32.eqz
              br_if 0 (;@5;)
              local.get 1
              i32.const -8
              i32.and
              local.tee 2
              local.get 4
              i32.const 16
              i32.add
              i32.le_u
              br_if 0 (;@5;)
              local.get 0
              local.get 4
              local.get 1
              i32.const 1
              i32.and
              i32.or
              i32.const 2
              i32.or
              i32.store offset=4
              local.get 0
              local.get 4
              i32.add
              local.tee 1
              local.get 2
              local.get 4
              i32.sub
              local.tee 4
              i32.const 3
              i32.or
              i32.store offset=4
              local.get 0
              local.get 2
              i32.add
              local.tee 2
              local.get 2
              i32.load offset=4
              i32.const 1
              i32.or
              i32.store offset=4
              local.get 1
              local.get 4
              call 82
            end
            local.get 0
            i32.const 8
            i32.add
          end
          local.tee 0
          i32.eqz
          br_if 0 (;@3;)
          drop
          local.get 5
          i32.const 12
          i32.add
          local.get 0
          i32.store
          i32.const 0
        end
        local.set 0
        i32.const 0
        local.get 5
        i32.load offset=12
        local.get 0
        select
        br 1 (;@1;)
      end
      local.get 0
      call 79
    end
    local.set 8
    local.get 5
    i32.const 16
    i32.add
    global.set 0
    local.get 8)
  (func $16 (type 1) (param $0 i32) (param $1 i32) (param $2 i32) (result i32)
    (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i32) (local $7 i32) (local $8 i32) (local $9 i32) (local $10 i32) (local $11 i32) (local $12 i32)
    block  ;; label = @1
      block  ;; label = @2
        local.get 0
        i32.load offset=8
        local.tee 11
        i32.const 402653184
        i32.and
        i32.eqz
        br_if 0 (;@2;)
        block  ;; label = @3
          block  ;; label = @4
            block  ;; label = @5
              block  ;; label = @6
                local.get 11
                i32.const 268435456
                i32.and
                if  ;; label = @7
                  local.get 0
                  i32.load16_u offset=14
                  local.tee 5
                  br_if 1 (;@6;)
                  i32.const 0
                  local.set 2
                  br 2 (;@5;)
                end
                local.get 2
                i32.const 16
                i32.ge_u
                if  ;; label = @7
                  local.get 2
                  local.get 1
                  local.get 1
                  i32.const 3
                  i32.add
                  i32.const -4
                  i32.and
                  local.tee 9
                  i32.sub
                  local.tee 8
                  i32.add
                  local.tee 5
                  i32.const 3
                  i32.and
                  local.set 6
                  local.get 1
                  local.get 9
                  i32.ne
                  if  ;; label = @8
                    local.get 1
                    local.set 3
                    loop  ;; label = @9
                      local.get 7
                      local.get 3
                      i32.load8_s
                      i32.const -65
                      i32.gt_s
                      i32.add
                      local.set 7
                      local.get 3
                      i32.const 1
                      i32.add
                      local.set 3
                      local.get 8
                      i32.const 1
                      i32.add
                      local.tee 8
                      br_if 0 (;@9;)
                    end
                  end
                  local.get 6
                  if  ;; label = @8
                    local.get 9
                    local.get 5
                    i32.const -4
                    i32.and
                    i32.add
                    local.set 3
                    loop  ;; label = @9
                      local.get 4
                      local.get 3
                      i32.load8_s
                      i32.const -65
                      i32.gt_s
                      i32.add
                      local.set 4
                      local.get 3
                      i32.const 1
                      i32.add
                      local.set 3
                      local.get 6
                      i32.const 1
                      i32.sub
                      local.tee 6
                      br_if 0 (;@9;)
                    end
                  end
                  local.get 5
                  i32.const 2
                  i32.shr_u
                  local.set 8
                  local.get 4
                  local.get 7
                  i32.add
                  local.set 7
                  loop  ;; label = @8
                    local.get 9
                    local.set 5
                    local.get 8
                    i32.eqz
                    br_if 5 (;@3;)
                    i32.const 192
                    local.get 8
                    local.get 8
                    i32.const 192
                    i32.ge_u
                    select
                    local.tee 12
                    i32.const 3
                    i32.and
                    local.set 10
                    block  ;; label = @9
                      local.get 12
                      i32.const 2
                      i32.shl
                      local.tee 6
                      i32.const 1008
                      i32.and
                      local.tee 4
                      i32.eqz
                      if  ;; label = @10
                        i32.const 0
                        local.set 4
                        br 1 (;@9;)
                      end
                      local.get 4
                      local.get 5
                      i32.add
                      local.set 9
                      i32.const 0
                      local.set 4
                      local.get 5
                      local.set 3
                      loop  ;; label = @10
                        local.get 4
                        local.get 3
                        i32.load
                        local.tee 4
                        i32.const -1
                        i32.xor
                        i32.const 7
                        i32.shr_u
                        local.get 4
                        i32.const 6
                        i32.shr_u
                        i32.or
                        i32.const 16843009
                        i32.and
                        i32.add
                        local.get 3
                        i32.const 4
                        i32.add
                        i32.load
                        local.tee 4
                        i32.const -1
                        i32.xor
                        i32.const 7
                        i32.shr_u
                        local.get 4
                        i32.const 6
                        i32.shr_u
                        i32.or
                        i32.const 16843009
                        i32.and
                        i32.add
                        local.get 3
                        i32.const 8
                        i32.add
                        i32.load
                        local.tee 4
                        i32.const -1
                        i32.xor
                        i32.const 7
                        i32.shr_u
                        local.get 4
                        i32.const 6
                        i32.shr_u
                        i32.or
                        i32.const 16843009
                        i32.and
                        i32.add
                        local.get 3
                        i32.const 12
                        i32.add
                        i32.load
                        local.tee 4
                        i32.const -1
                        i32.xor
                        i32.const 7
                        i32.shr_u
                        local.get 4
                        i32.const 6
                        i32.shr_u
                        i32.or
                        i32.const 16843009
                        i32.and
                        i32.add
                        local.set 4
                        local.get 3
                        i32.const 16
                        i32.add
                        local.tee 3
                        local.get 9
                        i32.ne
                        br_if 0 (;@10;)
                      end
                    end
                    local.get 8
                    local.get 12
                    i32.sub
                    local.set 8
                    local.get 5
                    local.get 6
                    i32.add
                    local.set 9
                    local.get 4
                    i32.const 8
                    i32.shr_u
                    i32.const 16711935
                    i32.and
                    local.get 4
                    i32.const 16711935
                    i32.and
                    i32.add
                    i32.const 65537
                    i32.mul
                    i32.const 16
                    i32.shr_u
                    local.get 7
                    i32.add
                    local.set 7
                    local.get 10
                    i32.eqz
                    br_if 0 (;@8;)
                  end
                  local.get 10
                  i32.const 2
                  i32.shl
                  local.set 6
                  local.get 5
                  local.get 12
                  i32.const 252
                  i32.and
                  i32.const 2
                  i32.shl
                  i32.add
                  local.set 3
                  i32.const 0
                  local.set 4
                  loop  ;; label = @8
                    local.get 3
                    i32.load
                    local.tee 5
                    i32.const -1
                    i32.xor
                    i32.const 7
                    i32.shr_u
                    local.get 5
                    i32.const 6
                    i32.shr_u
                    i32.or
                    i32.const 16843009
                    i32.and
                    local.get 4
                    i32.add
                    local.set 4
                    local.get 3
                    i32.const 4
                    i32.add
                    local.set 3
                    local.get 6
                    i32.const 4
                    i32.sub
                    local.tee 6
                    br_if 0 (;@8;)
                  end
                  local.get 4
                  i32.const 8
                  i32.shr_u
                  i32.const 16711935
                  i32.and
                  local.get 4
                  i32.const 16711935
                  i32.and
                  i32.add
                  i32.const 65537
                  i32.mul
                  i32.const 16
                  i32.shr_u
                  local.get 7
                  i32.add
                  local.set 7
                  br 4 (;@3;)
                end
                local.get 2
                i32.eqz
                if  ;; label = @7
                  i32.const 0
                  local.set 2
                  br 4 (;@3;)
                end
                loop  ;; label = @7
                  local.get 7
                  local.get 1
                  local.get 3
                  i32.add
                  i32.load8_s
                  i32.const -65
                  i32.gt_s
                  i32.add
                  local.set 7
                  local.get 2
                  local.get 3
                  i32.const 1
                  i32.add
                  local.tee 3
                  i32.ne
                  br_if 0 (;@7;)
                end
                br 3 (;@3;)
              end
              local.get 1
              local.get 2
              i32.add
              local.set 9
              i32.const 0
              local.set 2
              local.get 1
              local.set 4
              local.get 5
              local.set 6
              loop  ;; label = @6
                local.get 4
                local.tee 3
                local.get 9
                i32.eq
                br_if 2 (;@4;)
                block (result i32)  ;; label = @7
                  local.get 3
                  i32.const 1
                  i32.add
                  local.get 3
                  i32.load8_s
                  local.tee 4
                  i32.const 0
                  i32.ge_s
                  br_if 0 (;@7;)
                  drop
                  local.get 3
                  i32.const 2
                  i32.add
                  local.get 4
                  i32.const -32
                  i32.lt_u
                  br_if 0 (;@7;)
                  drop
                  local.get 3
                  i32.const 3
                  i32.add
                  local.get 4
                  i32.const -16
                  i32.lt_u
                  br_if 0 (;@7;)
                  drop
                  local.get 3
                  i32.const 4
                  i32.add
                end
                local.tee 4
                local.get 3
                i32.sub
                local.get 2
                i32.add
                local.set 2
                local.get 6
                i32.const 1
                i32.sub
                local.tee 6
                br_if 0 (;@6;)
              end
            end
            i32.const 0
            local.set 6
          end
          local.get 5
          local.get 6
          i32.sub
          local.set 7
        end
        local.get 7
        local.get 0
        i32.load16_u offset=12
        local.tee 5
        i32.ge_u
        br_if 0 (;@2;)
        local.get 5
        local.get 7
        i32.sub
        local.set 5
        i32.const 0
        local.set 3
        i32.const 0
        local.set 8
        block  ;; label = @3
          block  ;; label = @4
            block  ;; label = @5
              local.get 11
              i32.const 29
              i32.shr_u
              i32.const 3
              i32.and
              i32.const 1
              i32.sub
              br_table 0 (;@5;) 1 (;@4;) 2 (;@3;)
            end
            local.get 5
            local.set 8
            br 1 (;@3;)
          end
          local.get 5
          i32.const 65534
          i32.and
          i32.const 1
          i32.shr_u
          local.set 8
        end
        local.get 11
        i32.const 2097151
        i32.and
        local.set 9
        local.get 0
        i32.load offset=4
        local.set 10
        local.get 0
        i32.load
        local.set 6
        loop  ;; label = @3
          local.get 3
          i32.const 65535
          i32.and
          local.get 8
          i32.const 65535
          i32.and
          i32.lt_u
          if  ;; label = @4
            i32.const 1
            local.set 4
            local.get 3
            i32.const 1
            i32.add
            local.set 3
            local.get 6
            local.get 9
            local.get 10
            i32.load offset=16
            call_indirect (type 0)
            i32.eqz
            br_if 1 (;@3;)
            br 3 (;@1;)
          end
        end
        i32.const 1
        local.set 4
        local.get 6
        local.get 1
        local.get 2
        local.get 10
        i32.load offset=12
        call_indirect (type 1)
        br_if 1 (;@1;)
        local.get 5
        local.get 8
        i32.sub
        i32.const 65535
        i32.and
        local.set 0
        i32.const 0
        local.set 3
        loop  ;; label = @3
          local.get 0
          local.get 3
          i32.const 65535
          i32.and
          i32.le_u
          if  ;; label = @4
            i32.const 0
            return
          end
          local.get 3
          i32.const 1
          i32.add
          local.set 3
          local.get 6
          local.get 9
          local.get 10
          i32.load offset=16
          call_indirect (type 0)
          i32.eqz
          br_if 0 (;@3;)
        end
        br 1 (;@1;)
      end
      local.get 0
      i32.load
      local.get 1
      local.get 2
      local.get 0
      i32.load offset=4
      i32.load offset=12
      call_indirect (type 1)
      local.set 4
    end
    local.get 4)
  (func $17 (type 11) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32) (param $5 i32) (result i32)
    (local $6 i32) (local $7 i32) (local $8 i32) (local $9 i32) (local $10 i32) (local $11 i32) (local $12 i64)
    block (result i32)  ;; label = @1
      local.get 1
      i32.eqz
      if  ;; label = @2
        local.get 0
        i32.load offset=8
        local.set 6
        i32.const 45
        local.set 11
        local.get 5
        i32.const 1
        i32.add
        br 1 (;@1;)
      end
      i32.const 43
      i32.const 1114112
      local.get 0
      i32.load offset=8
      local.tee 6
      i32.const 2097152
      i32.and
      local.tee 1
      select
      local.set 11
      local.get 1
      i32.const 21
      i32.shr_u
      local.get 5
      i32.add
    end
    local.set 9
    block  ;; label = @1
      local.get 6
      i32.const 8388608
      i32.and
      i32.eqz
      if  ;; label = @2
        i32.const 0
        local.set 2
        br 1 (;@1;)
      end
      local.get 3
      if  ;; label = @2
        local.get 2
        local.set 1
        local.get 3
        local.set 8
        loop  ;; label = @3
          local.get 7
          local.get 1
          i32.load8_s
          i32.const -65
          i32.gt_s
          i32.add
          local.set 7
          local.get 1
          i32.const 1
          i32.add
          local.set 1
          local.get 8
          i32.const 1
          i32.sub
          local.tee 8
          br_if 0 (;@3;)
        end
      end
      local.get 7
      local.get 9
      i32.add
      local.set 9
    end
    block  ;; label = @1
      local.get 0
      i32.load16_u offset=12
      local.tee 8
      local.get 9
      i32.gt_u
      if  ;; label = @2
        block  ;; label = @3
          block  ;; label = @4
            local.get 6
            i32.const 16777216
            i32.and
            i32.eqz
            if  ;; label = @5
              local.get 8
              local.get 9
              i32.sub
              local.set 9
              i32.const 0
              local.set 1
              i32.const 0
              local.set 8
              block  ;; label = @6
                block  ;; label = @7
                  block  ;; label = @8
                    local.get 6
                    i32.const 29
                    i32.shr_u
                    i32.const 3
                    i32.and
                    i32.const 1
                    i32.sub
                    br_table 0 (;@8;) 1 (;@7;) 0 (;@8;) 2 (;@6;)
                  end
                  local.get 9
                  local.set 8
                  br 1 (;@6;)
                end
                local.get 9
                i32.const 65534
                i32.and
                i32.const 1
                i32.shr_u
                local.set 8
              end
              local.get 6
              i32.const 2097151
              i32.and
              local.set 10
              local.get 0
              i32.load offset=4
              local.set 6
              local.get 0
              i32.load
              local.set 0
              loop  ;; label = @6
                local.get 1
                i32.const 65535
                i32.and
                local.get 8
                i32.const 65535
                i32.and
                i32.ge_u
                br_if 2 (;@4;)
                i32.const 1
                local.set 7
                local.get 1
                i32.const 1
                i32.add
                local.set 1
                local.get 0
                local.get 10
                local.get 6
                i32.load offset=16
                call_indirect (type 0)
                i32.eqz
                br_if 0 (;@6;)
              end
              br 4 (;@1;)
            end
            local.get 0
            local.get 0
            i64.load offset=8 align=4
            local.tee 12
            i32.wrap_i64
            i32.const -1612709888
            i32.and
            i32.const 536870960
            i32.or
            i32.store offset=8
            i32.const 1
            local.set 7
            local.get 0
            i32.load
            local.tee 6
            local.get 0
            i32.load offset=4
            local.tee 10
            local.get 11
            local.get 2
            local.get 3
            call 22
            br_if 3 (;@1;)
            i32.const 0
            local.set 1
            local.get 8
            local.get 9
            i32.sub
            i32.const 65535
            i32.and
            local.set 2
            loop  ;; label = @5
              local.get 1
              i32.const 65535
              i32.and
              local.get 2
              i32.ge_u
              br_if 2 (;@3;)
              local.get 1
              i32.const 1
              i32.add
              local.set 1
              local.get 6
              i32.const 48
              local.get 10
              i32.load offset=16
              call_indirect (type 0)
              i32.eqz
              br_if 0 (;@5;)
            end
            br 3 (;@1;)
          end
          i32.const 1
          local.set 7
          local.get 0
          local.get 6
          local.get 11
          local.get 2
          local.get 3
          call 22
          br_if 2 (;@1;)
          local.get 0
          local.get 4
          local.get 5
          local.get 6
          i32.load offset=12
          call_indirect (type 1)
          br_if 2 (;@1;)
          local.get 9
          local.get 8
          i32.sub
          i32.const 65535
          i32.and
          local.set 2
          i32.const 0
          local.set 1
          loop  ;; label = @4
            local.get 2
            local.get 1
            i32.const 65535
            i32.and
            i32.le_u
            if  ;; label = @5
              i32.const 0
              return
            end
            local.get 1
            i32.const 1
            i32.add
            local.set 1
            local.get 0
            local.get 10
            local.get 6
            i32.load offset=16
            call_indirect (type 0)
            i32.eqz
            br_if 0 (;@4;)
          end
          br 2 (;@1;)
        end
        local.get 6
        local.get 4
        local.get 5
        local.get 10
        i32.load offset=12
        call_indirect (type 1)
        br_if 1 (;@1;)
        local.get 0
        local.get 12
        i64.store offset=8 align=4
        i32.const 0
        return
      end
      i32.const 1
      local.set 7
      local.get 0
      i32.load
      local.tee 1
      local.get 0
      i32.load offset=4
      local.tee 0
      local.get 11
      local.get 2
      local.get 3
      call 22
      br_if 0 (;@1;)
      local.get 1
      local.get 4
      local.get 5
      local.get 0
      i32.load offset=12
      call_indirect (type 1)
      local.set 7
    end
    local.get 7)
  (func $18 (type 8) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32) (result i32)
    block  ;; label = @1
      local.get 2
      i32.const 1114112
      i32.eq
      br_if 0 (;@1;)
      local.get 0
      local.get 2
      local.get 1
      i32.load offset=16
      call_indirect (type 0)
      i32.eqz
      br_if 0 (;@1;)
      i32.const 1
      return
    end
    local.get 3
    i32.eqz
    if  ;; label = @1
      i32.const 0
      return
    end
    local.get 0
    local.get 3
    local.get 4
    local.get 1
    i32.load offset=12
    call_indirect (type 1))
  (func $19 (type 0) (param $0 i32) (param $1 i32) (result i32)
    (local $2 i32) (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i32) (local $7 i32) (local $8 i32) (local $scratch i32) (local $scratch_10 i32)
    global.get 0
    i32.const 16
    i32.sub
    local.tee 4
    global.set 0
    i32.const 10
    local.set 2
    local.get 0
    i32.load
    local.tee 5
    local.set 3
    local.get 5
    i32.const 1000
    i32.ge_u
    if  ;; label = @1
      local.get 5
      local.set 0
      loop  ;; label = @2
        local.get 4
        i32.const 6
        i32.add
        local.get 2
        i32.add
        local.tee 6
        i32.const 4
        i32.sub
        local.get 0
        local.get 0
        i32.const 10000
        i32.div_u
        local.tee 3
        i32.const 10000
        i32.mul
        i32.sub
        local.tee 7
        i32.const 65535
        i32.and
        i32.const 100
        i32.div_u
        local.tee 8
        i32.const 1
        i32.shl
        i32.load16_u offset=1048653 align=1
        i32.store16 align=1
        local.get 6
        i32.const 2
        i32.sub
        local.get 7
        local.get 8
        i32.const 100
        i32.mul
        i32.sub
        i32.const 65535
        i32.and
        i32.const 1
        i32.shl
        i32.load16_u offset=1048653 align=1
        i32.store16 align=1
        local.get 2
        i32.const 4
        i32.sub
        local.set 2
        block (result i32)  ;; label = @3
          local.get 0
          i32.const 9999999
          i32.gt_u
          local.set 9
          local.get 3
          local.set 0
          local.get 9
        end
        br_if 0 (;@2;)
      end
    end
    block  ;; label = @1
      local.get 3
      i32.const 9
      i32.le_u
      if  ;; label = @2
        local.get 3
        local.set 0
        br 1 (;@1;)
      end
      local.get 2
      i32.const 2
      i32.sub
      local.tee 2
      local.get 4
      i32.const 6
      i32.add
      i32.add
      local.get 3
      local.get 3
      i32.const 65535
      i32.and
      i32.const 100
      i32.div_u
      local.tee 0
      i32.const 100
      i32.mul
      i32.sub
      i32.const 65535
      i32.and
      i32.const 1
      i32.shl
      i32.load16_u offset=1048653 align=1
      i32.store16 align=1
    end
    i32.const 0
    local.get 5
    local.get 0
    select
    i32.eqz
    if  ;; label = @1
      local.get 2
      i32.const 1
      i32.sub
      local.tee 2
      local.get 4
      i32.const 6
      i32.add
      i32.add
      local.get 0
      i32.const 1
      i32.shl
      i32.load8_u offset=1048654
      i32.store8
    end
    local.get 1
    i32.const 1
    i32.const 1
    i32.const 0
    local.get 4
    i32.const 6
    i32.add
    local.get 2
    i32.add
    i32.const 10
    local.get 2
    i32.sub
    call 21
    local.set 10
    local.get 4
    i32.const 16
    i32.add
    global.set 0
    local.get 10)
  (func $20 (type 0) (param $0 i32) (param $1 i32) (result i32)
    local.get 0
    i32.load
    local.get 1
    local.get 0
    i32.load offset=4
    i32.load offset=12
    call_indirect (type 0))
  (func $21 (type 0) (param $0 i32) (param $1 i32) (result i32)
    local.get 1
    i32.load
    local.get 1
    i32.load offset=4
    local.get 0
    call 7)
  (func $22 (type 0) (param $0 i32) (param $1 i32) (result i32)
    (local $2 i32) (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i64) (local $7 i64) (local $8 i64) (local $scratch i32) (local $scratch_10 i32)
    global.get 0
    i32.const 32
    i32.sub
    local.tee 3
    global.set 0
    i32.const 20
    local.set 2
    local.get 0
    i64.load
    local.tee 8
    local.set 6
    local.get 8
    i64.const 1000
    i64.ge_u
    if  ;; label = @1
      local.get 8
      local.set 7
      loop  ;; label = @2
        local.get 3
        i32.const 12
        i32.add
        local.get 2
        i32.add
        local.tee 0
        i32.const 4
        i32.sub
        local.get 7
        local.get 7
        i64.const 10000
        i64.div_u
        local.tee 6
        i64.const 10000
        i64.mul
        i64.sub
        i32.wrap_i64
        local.tee 4
        i32.const 65535
        i32.and
        i32.const 100
        i32.div_u
        local.tee 5
        i32.const 1
        i32.shl
        i32.load16_u offset=1048653 align=1
        i32.store16 align=1
        local.get 0
        i32.const 2
        i32.sub
        local.get 4
        local.get 5
        i32.const 100
        i32.mul
        i32.sub
        i32.const 65535
        i32.and
        i32.const 1
        i32.shl
        i32.load16_u offset=1048653 align=1
        i32.store16 align=1
        local.get 2
        i32.const 4
        i32.sub
        local.set 2
        block (result i32)  ;; label = @3
          local.get 7
          i64.const 9999999
          i64.gt_u
          local.set 9
          local.get 6
          local.set 7
          local.get 9
        end
        br_if 0 (;@2;)
      end
    end
    local.get 6
    i64.const 9
    i64.gt_u
    if  ;; label = @1
      local.get 2
      i32.const 2
      i32.sub
      local.tee 2
      local.get 3
      i32.const 12
      i32.add
      i32.add
      local.get 6
      i32.wrap_i64
      local.tee 0
      local.get 0
      i32.const 65535
      i32.and
      i32.const 100
      i32.div_u
      local.tee 0
      i32.const 100
      i32.mul
      i32.sub
      i32.const 65535
      i32.and
      i32.const 1
      i32.shl
      i32.load16_u offset=1048653 align=1
      i32.store16 align=1
      local.get 0
      i64.extend_i32_u
      local.set 6
    end
    local.get 6
    i64.eqz
    local.get 8
    i64.const 0
    i64.ne
    i32.and
    i32.eqz
    if  ;; label = @1
      local.get 2
      i32.const 1
      i32.sub
      local.tee 2
      local.get 3
      i32.const 12
      i32.add
      i32.add
      local.get 6
      i32.wrap_i64
      i32.const 1
      i32.shl
      i32.load8_u offset=1048654
      i32.store8
    end
    local.get 1
    i32.const 1
    i32.const 1
    i32.const 0
    local.get 3
    i32.const 12
    i32.add
    local.get 2
    i32.add
    i32.const 20
    local.get 2
    i32.sub
    call 21
    local.set 10
    local.get 3
    i32.const 32
    i32.add
    global.set 0
    local.get 10)
  (func $23 (type 1) (param $0 i32) (param $1 i32) (param $2 i32) (result i32)
    (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i32) (local $7 i32) (local $8 i32) (local $9 i32) (local $10 i32) (local $11 i32) (local $12 i32) (local $13 i32) (local $14 i32)
    local.get 1
    i32.const 1
    i32.sub
    local.set 13
    local.get 0
    i32.load offset=4
    local.set 9
    local.get 0
    i32.load
    local.set 10
    local.get 0
    i32.load offset=8
    local.set 11
    block  ;; label = @1
      loop  ;; label = @2
        local.get 6
        br_if 1 (;@1;)
        block (result i32)  ;; label = @3
          block  ;; label = @4
            local.get 2
            local.get 4
            i32.lt_u
            br_if 0 (;@4;)
            loop  ;; label = @5
              local.get 1
              local.get 4
              i32.add
              local.set 5
              block  ;; label = @6
                block  ;; label = @7
                  block  ;; label = @8
                    block  ;; label = @9
                      block  ;; label = @10
                        local.get 2
                        local.get 4
                        i32.sub
                        local.tee 6
                        i32.const 7
                        i32.le_u
                        if  ;; label = @11
                          local.get 2
                          local.get 4
                          i32.ne
                          br_if 1 (;@10;)
                          local.get 2
                          local.set 4
                          br 7 (;@4;)
                        end
                        local.get 5
                        i32.const 3
                        i32.add
                        i32.const -4
                        i32.and
                        local.tee 0
                        local.get 5
                        i32.eq
                        br_if 1 (;@9;)
                        local.get 0
                        local.get 5
                        i32.sub
                        local.set 3
                        i32.const 0
                        local.set 0
                        loop  ;; label = @11
                          local.get 0
                          local.get 5
                          i32.add
                          i32.load8_u
                          i32.const 10
                          i32.eq
                          br_if 5 (;@6;)
                          local.get 3
                          local.get 0
                          i32.const 1
                          i32.add
                          local.tee 0
                          i32.ne
                          br_if 0 (;@11;)
                        end
                        local.get 3
                        local.get 6
                        i32.const 8
                        i32.sub
                        local.tee 0
                        i32.gt_u
                        br_if 3 (;@7;)
                        br 2 (;@8;)
                      end
                      i32.const 0
                      local.set 0
                      loop  ;; label = @10
                        local.get 0
                        local.get 5
                        i32.add
                        i32.load8_u
                        i32.const 10
                        i32.eq
                        br_if 4 (;@6;)
                        local.get 6
                        local.get 0
                        i32.const 1
                        i32.add
                        local.tee 0
                        i32.ne
                        br_if 0 (;@10;)
                      end
                      local.get 2
                      local.set 4
                      br 5 (;@4;)
                    end
                    local.get 6
                    i32.const 8
                    i32.sub
                    local.set 0
                    i32.const 0
                    local.set 3
                  end
                  loop  ;; label = @8
                    i32.const 16843008
                    local.get 3
                    local.get 5
                    i32.add
                    local.tee 7
                    i32.load
                    local.tee 14
                    i32.const 168430090
                    i32.xor
                    i32.sub
                    local.get 14
                    i32.or
                    i32.const 16843008
                    local.get 7
                    i32.const 4
                    i32.add
                    i32.load
                    local.tee 7
                    i32.const 168430090
                    i32.xor
                    i32.sub
                    local.get 7
                    i32.or
                    i32.and
                    i32.const -2139062144
                    i32.and
                    i32.const -2139062144
                    i32.ne
                    br_if 1 (;@7;)
                    local.get 3
                    i32.const 8
                    i32.add
                    local.tee 3
                    local.get 0
                    i32.le_u
                    br_if 0 (;@8;)
                  end
                end
                local.get 3
                local.get 6
                i32.eq
                if  ;; label = @7
                  local.get 2
                  local.set 4
                  br 3 (;@4;)
                end
                local.get 3
                local.get 5
                i32.add
                local.set 6
                local.get 2
                local.get 3
                i32.sub
                local.get 4
                i32.sub
                local.set 7
                i32.const 0
                local.set 0
                block  ;; label = @7
                  loop  ;; label = @8
                    local.get 0
                    local.get 6
                    i32.add
                    i32.load8_u
                    i32.const 10
                    i32.eq
                    br_if 1 (;@7;)
                    local.get 7
                    local.get 0
                    i32.const 1
                    i32.add
                    local.tee 0
                    i32.ne
                    br_if 0 (;@8;)
                  end
                  local.get 2
                  local.set 4
                  br 3 (;@4;)
                end
                local.get 0
                local.get 3
                i32.add
                local.set 0
              end
              local.get 0
              local.get 4
              i32.add
              local.tee 3
              i32.const 1
              i32.add
              local.set 4
              block  ;; label = @6
                local.get 2
                local.get 3
                i32.le_u
                br_if 0 (;@6;)
                local.get 0
                local.get 5
                i32.add
                i32.load8_u
                i32.const 10
                i32.ne
                br_if 0 (;@6;)
                i32.const 0
                local.set 6
                local.get 4
                local.tee 5
                br 3 (;@3;)
              end
              local.get 2
              local.get 4
              i32.ge_u
              br_if 0 (;@5;)
            end
          end
          local.get 2
          local.get 8
          i32.eq
          br_if 2 (;@1;)
          i32.const 1
          local.set 6
          local.get 8
          local.set 5
          local.get 2
        end
        local.set 0
        block  ;; label = @3
          local.get 11
          i32.load8_u
          if  ;; label = @4
            local.get 10
            i32.const 1050196
            i32.const 4
            local.get 9
            i32.load offset=12
            call_indirect (type 1)
            br_if 1 (;@3;)
          end
          i32.const 0
          local.set 3
          local.get 0
          local.get 8
          i32.ne
          if  ;; label = @4
            local.get 0
            local.get 13
            i32.add
            i32.load8_u
            i32.const 10
            i32.eq
            local.set 3
          end
          local.get 0
          local.get 8
          i32.sub
          local.set 0
          local.get 1
          local.get 8
          i32.add
          local.set 7
          local.get 11
          local.get 3
          i32.store8
          local.get 5
          local.set 8
          local.get 10
          local.get 7
          local.get 0
          local.get 9
          i32.load offset=12
          call_indirect (type 1)
          i32.eqz
          br_if 1 (;@2;)
        end
      end
      i32.const 1
      local.set 12
    end
    local.get 12)
  (func $24 (type 0) (param $0 i32) (param $1 i32) (result i32)
    (local $2 i32) (local $3 i32)
    local.get 0
    i32.load offset=4
    local.set 2
    local.get 0
    i32.load
    local.set 3
    block  ;; label = @1
      local.get 0
      i32.load offset=8
      local.tee 0
      i32.load8_u
      i32.eqz
      br_if 0 (;@1;)
      local.get 3
      i32.const 1050196
      i32.const 4
      local.get 2
      i32.load offset=12
      call_indirect (type 1)
      i32.eqz
      br_if 0 (;@1;)
      i32.const 1
      return
    end
    local.get 0
    local.get 1
    i32.const 10
    i32.eq
    i32.store8
    local.get 3
    local.get 1
    local.get 2
    i32.load offset=16
    call_indirect (type 0))
  (func $25 (type 0) (param $0 i32) (param $1 i32) (result i32)
    local.get 1
    i32.load offset=4
    drop
    local.get 0
    i32.const 1048896
    local.get 1
    call 7)
  (func $26 (type 8) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32) (result i32)
    (local $5 i32) (local $6 i32) (local $7 i32) (local $8 i32)
    global.get 0
    i32.const 32
    i32.sub
    local.tee 5
    global.set 0
    i32.const 1
    local.set 7
    block  ;; label = @1
      local.get 0
      i32.load8_u offset=4
      br_if 0 (;@1;)
      local.get 0
      i32.load8_u offset=5
      local.set 8
      local.get 0
      i32.load
      local.tee 6
      i32.load8_u offset=10
      i32.const 128
      i32.and
      i32.eqz
      if  ;; label = @2
        local.get 6
        i32.load
        i32.const 1048887
        i32.const 1048920
        local.get 8
        i32.const 1
        i32.and
        local.tee 8
        select
        i32.const 2
        i32.const 3
        local.get 8
        select
        local.get 6
        i32.load offset=4
        i32.load offset=12
        call_indirect (type 1)
        br_if 1 (;@1;)
        local.get 6
        i32.load
        local.get 1
        local.get 2
        local.get 6
        i32.load offset=4
        i32.load offset=12
        call_indirect (type 1)
        br_if 1 (;@1;)
        local.get 6
        i32.load
        i32.const 1050242
        i32.const 2
        local.get 6
        i32.load offset=4
        i32.load offset=12
        call_indirect (type 1)
        br_if 1 (;@1;)
        local.get 3
        local.get 6
        local.get 4
        call_indirect (type 0)
        local.set 7
        br 1 (;@1;)
      end
      local.get 8
      i32.const 1
      i32.and
      i32.eqz
      if  ;; label = @2
        local.get 6
        i32.load
        i32.const 1048923
        i32.const 3
        local.get 6
        i32.load offset=4
        i32.load offset=12
        call_indirect (type 1)
        br_if 1 (;@1;)
      end
      local.get 5
      i32.const 1
      i32.store8 offset=15
      local.get 5
      i32.const 1048896
      i32.store offset=20
      local.get 5
      local.get 6
      i64.load align=4
      i64.store align=4
      local.get 5
      local.get 6
      i64.load offset=8 align=4
      i64.store offset=24 align=4
      local.get 5
      local.get 5
      i32.const 15
      i32.add
      i32.store offset=8
      local.get 5
      local.get 5
      i32.store offset=16
      local.get 5
      local.get 1
      local.get 2
      call 27
      br_if 0 (;@1;)
      local.get 5
      i32.const 1050242
      i32.const 2
      call 27
      br_if 0 (;@1;)
      local.get 3
      local.get 5
      i32.const 16
      i32.add
      local.get 4
      call_indirect (type 0)
      br_if 0 (;@1;)
      local.get 5
      i32.load offset=16
      i32.const 1048889
      i32.const 2
      local.get 5
      i32.load offset=20
      i32.load offset=12
      call_indirect (type 1)
      local.set 7
    end
    local.get 0
    i32.const 1
    i32.store8 offset=5
    local.get 0
    local.get 7
    i32.store8 offset=4
    local.get 5
    i32.const 32
    i32.add
    global.set 0
    local.get 0)
  (func $27 (type 0) (param $0 i32) (param $1 i32) (result i32)
    local.get 1
    i32.const 1050172
    i32.const 24
    call 20)
  (func $28 (type 12) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
    (local $5 i32) (local $6 i32) (local $7 i32) (local $8 i32) (local $9 i32) (local $10 i32) (local $11 i32) (local $12 i32) (local $13 i32) (local $14 i32) (local $15 i64) (local $scratch i32)
    global.get 0
    i32.const 464
    i32.sub
    local.tee 5
    global.set 0
    i32.const 1055128
    i32.const 1055128
    i32.load
    local.tee 7
    i32.const 1
    i32.add
    i32.store
    local.get 5
    local.get 1
    i32.store offset=24
    local.get 5
    local.get 0
    i32.store offset=20
    local.get 5
    local.get 2
    i32.store offset=28
    block  ;; label = @1
      block  ;; label = @2
        local.get 7
        i32.const 0
        i32.ge_s
        if  ;; label = @3
          i32.const 1055124
          i32.load8_u
          i32.eqz
          if  ;; label = @4
            i32.const 1055124
            i32.const 1
            i32.store8
            i32.const 1055120
            i32.const 1055120
            i32.load
            i32.const 1
            i32.add
            i32.store
            i32.const 1055132
            i32.load
            local.tee 7
            i32.const 0
            i32.ge_s
            br_if 2 (;@2;)
            local.get 5
            i32.const 0
            i32.store offset=80
            local.get 5
            i32.const 1
            i32.store offset=68
            local.get 5
            i32.const 1051840
            i32.store offset=64
            local.get 5
            i64.const 4
            i64.store offset=72 align=4
            local.get 5
            i32.const 40
            i32.add
            local.get 5
            i32.const 463
            i32.add
            local.get 5
            i32.const -64
            i32.sub
            call 33
            local.get 5
            i32.load8_u offset=40
            local.get 5
            i32.load offset=44
            call 34
            br 3 (;@1;)
          end
          local.get 5
          local.get 0
          local.get 1
          i32.load offset=24
          call_indirect (type 3)
          local.get 5
          local.get 5
          i32.load offset=4
          i32.const 0
          local.get 5
          i32.load
          local.tee 0
          select
          i32.store offset=36
          local.get 5
          local.get 0
          i32.const 1
          local.get 0
          select
          i32.store offset=32
          local.get 5
          i32.const 3
          i32.store offset=68
          local.get 5
          i32.const 1052668
          i32.store offset=64
          local.get 5
          i64.const 2
          i64.store offset=76 align=4
          local.get 5
          local.get 5
          i32.const 32
          i32.add
          i64.extend_i32_u
          i64.const 12884901888
          i64.or
          i64.store offset=48
          local.get 5
          local.get 5
          i32.const 28
          i32.add
          i64.extend_i32_u
          i64.const 42949672960
          i64.or
          i64.store offset=40
          local.get 5
          local.get 5
          i32.const 40
          i32.add
          i32.store offset=72
          local.get 5
          i32.const 56
          i32.add
          local.get 5
          i32.const 463
          i32.add
          local.get 5
          i32.const -64
          i32.sub
          call 33
          local.get 5
          i32.load8_u offset=56
          local.get 5
          i32.load offset=60
          call 34
          br 2 (;@1;)
        end
        local.get 5
        i32.const 3
        i32.store offset=68
        local.get 5
        i32.const 1052580
        i32.store offset=64
        local.get 5
        i64.const 2
        i64.store offset=76 align=4
        local.get 5
        local.get 5
        i32.const 20
        i32.add
        i64.extend_i32_u
        i64.const 30064771072
        i64.or
        i64.store offset=48
        local.get 5
        local.get 5
        i32.const 28
        i32.add
        i64.extend_i32_u
        i64.const 42949672960
        i64.or
        i64.store offset=40
        local.get 5
        local.get 5
        i32.const 40
        i32.add
        i32.store offset=72
        local.get 5
        i32.const 56
        i32.add
        local.get 5
        i32.const 463
        i32.add
        local.get 5
        i32.const -64
        i32.sub
        call 33
        local.get 5
        i32.load8_u offset=56
        local.get 5
        i32.load offset=60
        call 34
        br 1 (;@1;)
      end
      i32.const 1055132
      local.get 7
      i32.const 1
      i32.add
      i32.store
      local.get 5
      i32.const 8
      i32.add
      local.get 0
      local.get 1
      i32.load offset=20
      call_indirect (type 3)
      local.get 5
      i32.load offset=12
      local.set 12
      local.get 5
      i32.load offset=8
      local.set 7
      i32.const 3
      local.set 0
      block  ;; label = @2
        block  ;; label = @3
          block  ;; label = @4
            block  ;; label = @5
              local.get 4
              br_if 0 (;@5;)
              i32.const 1
              local.set 0
              i32.const 1055120
              i32.load
              i32.const 1
              i32.gt_u
              br_if 0 (;@5;)
              i32.const 1055090
              i32.load8_u
              i32.const 1
              i32.sub
              local.tee 0
              i32.const 255
              i32.and
              i32.const 3
              i32.lt_u
              br_if 0 (;@5;)
              local.get 5
              i32.const 0
              i32.store8 offset=78
              local.get 5
              i32.const 1052142
              i64.load align=1
              i64.store offset=70 align=2
              local.get 5
              i32.const 1052136
              i64.load align=1
              i64.store offset=64
              i32.const 0
              local.set 1
              i32.const 8
              i32.const 0
              i32.const 16843008
              local.get 5
              i32.load offset=68
              local.tee 0
              i32.sub
              local.get 0
              i32.or
              i32.const -2139062144
              i32.and
              i32.const -2139062144
              i32.eq
              select
              local.tee 0
              local.get 5
              i32.const -64
              i32.sub
              i32.add
              local.set 4
              block  ;; label = @6
                block  ;; label = @7
                  block  ;; label = @8
                    loop  ;; label = @9
                      local.get 1
                      local.get 4
                      i32.add
                      i32.load8_u
                      if  ;; label = @10
                        local.get 0
                        local.get 1
                        i32.const 1
                        i32.add
                        local.tee 1
                        i32.xor
                        i32.const 15
                        i32.ne
                        br_if 1 (;@9;)
                        br 2 (;@8;)
                      end
                    end
                    local.get 0
                    local.get 1
                    i32.add
                    i32.const 14
                    i32.ne
                    br_if 0 (;@8;)
                    block (result i32)  ;; label = @9
                      i32.const 1055028
                      i32.load
                      i32.const -1
                      i32.eq
                      if  ;; label = @10
                        global.get 0
                        i32.const 16
                        i32.sub
                        local.tee 4
                        global.set 0
                        block  ;; label = @11
                          local.get 4
                          i32.const 12
                          i32.add
                          local.get 4
                          i32.const 8
                          i32.add
                          call 2
                          i32.const 65535
                          i32.and
                          i32.eqz
                          if  ;; label = @12
                            local.get 4
                            i32.load offset=12
                            local.tee 0
                            i32.eqz
                            if  ;; label = @13
                              i32.const 1055636
                              local.set 1
                              br 2 (;@11;)
                            end
                            block  ;; label = @13
                              block  ;; label = @14
                                local.get 0
                                i32.const 1
                                i32.add
                                local.tee 0
                                i32.eqz
                                br_if 0 (;@14;)
                                local.get 4
                                i32.load offset=8
                                call 79
                                local.tee 6
                                i32.eqz
                                br_if 0 (;@14;)
                                block  ;; label = @15
                                  block (result i32)  ;; label = @16
                                    i32.const 0
                                    local.get 0
                                    i32.eqz
                                    br_if 0 (;@16;)
                                    drop
                                    local.get 0
                                    i64.extend_i32_u
                                    i64.const 2
                                    i64.shl
                                    local.tee 15
                                    i32.wrap_i64
                                    local.tee 1
                                    local.get 0
                                    i32.const 4
                                    i32.or
                                    i32.const 65536
                                    i32.lt_u
                                    br_if 0 (;@16;)
                                    drop
                                    i32.const -1
                                    local.get 1
                                    local.get 15
                                    i64.const 32
                                    i64.shr_u
                                    i32.wrap_i64
                                    select
                                  end
                                  local.tee 1
                                  call 79
                                  local.tee 0
                                  i32.eqz
                                  br_if 0 (;@15;)
                                  local.get 0
                                  i32.const 4
                                  i32.sub
                                  i32.load8_u
                                  i32.const 3
                                  i32.and
                                  i32.eqz
                                  br_if 0 (;@15;)
                                  local.get 1
                                  i32.eqz
                                  br_if 0 (;@15;)
                                  local.get 0
                                  i32.const 0
                                  local.get 1
                                  memory.fill
                                end
                                local.get 0
                                local.tee 1
                                br_if 1 (;@13;)
                                local.get 6
                                call 80
                              end
                              i32.const 70
                              call 85
                              unreachable
                            end
                            local.get 1
                            local.get 6
                            call 1
                            i32.const 65535
                            i32.and
                            i32.eqz
                            br_if 1 (;@11;)
                            local.get 6
                            call 80
                            local.get 1
                            call 80
                          end
                          i32.const 71
                          call 85
                          unreachable
                        end
                        i32.const 1055028
                        local.get 1
                        i32.store
                        local.get 4
                        i32.const 16
                        i32.add
                        global.set 0
                      end
                      i32.const 0
                      block (result i32)  ;; label = @10
                        block  ;; label = @11
                          block  ;; label = @12
                            local.get 5
                            i32.const -64
                            i32.sub
                            local.tee 8
                            local.tee 1
                            i32.const 3
                            i32.and
                            i32.eqz
                            br_if 0 (;@12;)
                            local.get 1
                            local.get 1
                            i32.load8_u
                            local.tee 0
                            i32.eqz
                            br_if 2 (;@10;)
                            drop
                            local.get 1
                            local.get 0
                            i32.const 61
                            i32.eq
                            br_if 2 (;@10;)
                            drop
                            local.get 1
                            i32.const 1
                            i32.add
                            local.tee 0
                            i32.const 3
                            i32.and
                            i32.eqz
                            if  ;; label = @13
                              local.get 0
                              local.set 1
                              br 1 (;@12;)
                            end
                            local.get 0
                            i32.load8_u
                            local.tee 4
                            i32.eqz
                            br_if 1 (;@11;)
                            local.get 4
                            i32.const 61
                            i32.eq
                            br_if 1 (;@11;)
                            local.get 1
                            i32.const 2
                            i32.add
                            local.tee 0
                            i32.const 3
                            i32.and
                            i32.eqz
                            if  ;; label = @13
                              local.get 0
                              local.set 1
                              br 1 (;@12;)
                            end
                            local.get 0
                            i32.load8_u
                            local.tee 4
                            i32.eqz
                            br_if 1 (;@11;)
                            local.get 4
                            i32.const 61
                            i32.eq
                            br_if 1 (;@11;)
                            local.get 1
                            i32.const 3
                            i32.add
                            local.tee 0
                            i32.const 3
                            i32.and
                            i32.eqz
                            if  ;; label = @13
                              local.get 0
                              local.set 1
                              br 1 (;@12;)
                            end
                            local.get 0
                            i32.load8_u
                            local.tee 4
                            i32.eqz
                            br_if 1 (;@11;)
                            local.get 4
                            i32.const 61
                            i32.eq
                            br_if 1 (;@11;)
                            local.get 1
                            i32.const 4
                            i32.add
                            local.set 1
                          end
                          block  ;; label = @12
                            i32.const 16843008
                            local.get 1
                            i32.load
                            local.tee 0
                            i32.sub
                            local.get 0
                            i32.or
                            i32.const -2139062144
                            i32.and
                            i32.const -2139062144
                            i32.ne
                            br_if 0 (;@12;)
                            loop  ;; label = @13
                              i32.const 16843008
                              local.get 0
                              i32.const 1027423549
                              i32.xor
                              local.tee 0
                              i32.sub
                              local.get 0
                              i32.or
                              i32.const -2139062144
                              i32.and
                              i32.const -2139062144
                              i32.ne
                              br_if 1 (;@12;)
                              i32.const 16843008
                              local.get 1
                              i32.const 4
                              i32.add
                              local.tee 1
                              i32.load
                              local.tee 0
                              i32.sub
                              local.get 0
                              i32.or
                              i32.const -2139062144
                              i32.and
                              i32.const -2139062144
                              i32.eq
                              br_if 0 (;@13;)
                            end
                          end
                          local.get 1
                          i32.const 1
                          i32.sub
                          local.set 0
                          loop  ;; label = @12
                            local.get 0
                            i32.const 1
                            i32.add
                            local.tee 0
                            i32.load8_u
                            local.tee 1
                            i32.eqz
                            br_if 1 (;@11;)
                            local.get 1
                            i32.const 61
                            i32.ne
                            br_if 0 (;@12;)
                          end
                        end
                        local.get 0
                      end
                      local.tee 0
                      local.get 8
                      i32.eq
                      br_if 0 (;@9;)
                      drop
                      block  ;; label = @10
                        local.get 8
                        local.get 0
                        local.get 8
                        i32.sub
                        local.tee 9
                        i32.add
                        i32.load8_u
                        br_if 0 (;@10;)
                        i32.const 1055028
                        i32.load
                        local.tee 0
                        i32.eqz
                        br_if 0 (;@10;)
                        local.get 0
                        i32.load
                        local.tee 1
                        i32.eqz
                        br_if 0 (;@10;)
                        local.get 0
                        i32.const 4
                        i32.add
                        local.set 4
                        loop  ;; label = @11
                          block  ;; label = @12
                            block (result i32)  ;; label = @13
                              local.get 1
                              local.set 0
                              i32.const 0
                              local.get 9
                              i32.eqz
                              br_if 0 (;@13;)
                              drop
                              block  ;; label = @14
                                local.get 8
                                i32.load8_u
                                local.tee 6
                                i32.eqz
                                if  ;; label = @15
                                  i32.const 0
                                  local.set 6
                                  br 1 (;@14;)
                                end
                                local.get 8
                                i32.const 1
                                i32.add
                                local.set 10
                                local.get 9
                                i32.const 1
                                i32.sub
                                local.set 11
                                block  ;; label = @15
                                  loop  ;; label = @16
                                    local.get 6
                                    local.get 0
                                    i32.load8_u
                                    local.tee 13
                                    i32.ne
                                    br_if 1 (;@15;)
                                    local.get 13
                                    i32.eqz
                                    br_if 1 (;@15;)
                                    local.get 11
                                    i32.eqz
                                    br_if 1 (;@15;)
                                    local.get 11
                                    i32.const 1
                                    i32.sub
                                    local.set 11
                                    local.get 0
                                    i32.const 1
                                    i32.add
                                    local.set 0
                                    local.get 10
                                    i32.load8_u
                                    local.set 6
                                    local.get 10
                                    i32.const 1
                                    i32.add
                                    local.set 10
                                    local.get 6
                                    br_if 0 (;@16;)
                                  end
                                  i32.const 0
                                  local.set 6
                                end
                              end
                              local.get 6
                              local.get 0
                              i32.load8_u
                              i32.sub
                            end
                            i32.eqz
                            if  ;; label = @13
                              local.get 1
                              local.get 9
                              i32.add
                              local.tee 0
                              i32.load8_u
                              i32.const 61
                              i32.eq
                              br_if 1 (;@12;)
                            end
                            local.get 4
                            i32.load
                            local.set 1
                            local.get 4
                            i32.const 4
                            i32.add
                            local.set 4
                            local.get 1
                            br_if 1 (;@11;)
                            br 2 (;@10;)
                          end
                        end
                        local.get 0
                        i32.const 1
                        i32.add
                        local.set 14
                      end
                      local.get 14
                    end
                    local.tee 6
                    br_if 1 (;@7;)
                  end
                  i32.const 2
                  local.set 0
                  i32.const 3
                  local.set 4
                  br 1 (;@6;)
                end
                local.get 6
                call 86
                local.tee 0
                i32.const 0
                i32.lt_s
                br_if 2 (;@4;)
                block (result i32)  ;; label = @7
                  block  ;; label = @8
                    local.get 0
                    if  ;; label = @9
                      local.get 0
                      call 19
                      local.tee 1
                      i32.eqz
                      br_if 7 (;@2;)
                      local.get 0
                      if  ;; label = @10
                        local.get 1
                        local.get 6
                        local.get 0
                        memory.copy
                      end
                      block  ;; label = @10
                        block  ;; label = @11
                          local.get 0
                          i32.const 1
                          i32.sub
                          br_table 0 (;@11;) 3 (;@8;) 3 (;@8;) 1 (;@10;) 3 (;@8;)
                        end
                        local.get 1
                        i32.load8_u
                        i32.const 48
                        i32.ne
                        br_if 2 (;@8;)
                        i32.const 3
                        local.set 4
                        i32.const 2
                        br 3 (;@7;)
                      end
                      local.get 1
                      i32.load align=1
                      i32.const 1819047270
                      i32.ne
                      br_if 1 (;@8;)
                      i32.const 2
                      local.set 4
                      i32.const 1
                      br 2 (;@7;)
                    end
                    i32.const 1
                    local.set 4
                    local.get 0
                    if  ;; label = @9
                      i32.const 1
                      local.get 6
                      local.get 0
                      memory.copy
                    end
                    i32.const 0
                    local.set 0
                    br 2 (;@6;)
                  end
                  i32.const 1
                  local.set 4
                  i32.const 0
                end
                local.set 0
                local.get 1
                call 80
              end
              i32.const 1055090
              i32.const 1055090
              i32.load8_u
              local.tee 1
              local.get 4
              local.get 1
              select
              i32.store8
              local.get 1
              i32.eqz
              br_if 0 (;@5;)
              i32.const 3
              local.set 0
              local.get 1
              i32.const 3
              i32.gt_u
              br_if 0 (;@5;)
              i32.const 33619971
              local.get 1
              i32.const 3
              i32.shl
              i32.const 248
              i32.and
              i32.shr_u
              local.set 0
            end
            local.get 5
            local.get 2
            i32.store offset=32
            i32.const 12
            local.set 4
            local.get 5
            i32.const -64
            i32.sub
            local.tee 1
            local.get 7
            local.get 12
            i32.const 12
            i32.add
            i32.load
            local.tee 6
            call_indirect (type 3)
            local.get 7
            local.set 2
            block (result i32)  ;; label = @5
              local.get 5
              i64.load offset=64
              i64.const 7199936582794304877
              i64.xor
              local.get 5
              i64.load offset=72
              i64.const -5076933981314334344
              i64.xor
              i64.or
              i64.const 0
              i64.ne
              if (result i32)  ;; label = @6
                local.get 1
                local.get 7
                local.get 6
                call_indirect (type 3)
                i32.const 1052540
                local.get 5
                i64.load offset=64
                i64.const 7038534328312030277
                i64.xor
                local.get 5
                i64.load offset=72
                i64.const 6454766240053981802
                i64.xor
                i64.or
                i64.const 0
                i64.ne
                br_if 1 (;@5;)
                drop
                local.get 7
                i32.const 4
                i32.add
                local.set 2
                i32.const 8
              else
                i32.const 4
              end
              local.get 7
              i32.add
              i32.load
              local.set 4
              local.get 2
              i32.load
            end
            local.set 2
            i32.const 1055089
            i32.load8_u
            local.set 1
            i32.const 1055089
            i32.const 1
            i32.store8
            local.get 5
            local.get 4
            i32.store offset=60
            local.get 5
            local.get 2
            i32.store offset=56
            local.get 5
            local.get 1
            i32.store8 offset=40
            local.get 1
            br_if 1 (;@3;)
            local.get 5
            i32.const 1052236
            i32.store offset=76
            local.get 5
            local.get 5
            i32.const 463
            i32.add
            i32.store offset=72
            local.get 5
            local.get 5
            i32.const 56
            i32.add
            i32.store offset=68
            local.get 5
            local.get 5
            i32.const 32
            i32.add
            i32.store offset=64
            block  ;; label = @5
              block  ;; label = @6
                i32.const 1055096
                i64.load
                local.tee 15
                i64.const 0
                i64.ne
                if  ;; label = @7
                  i32.const 1055104
                  i64.load
                  local.get 15
                  i64.eq
                  br_if 1 (;@6;)
                end
                local.get 5
                i32.const -64
                i32.sub
                i32.const 0
                local.get 1
                call 36
                br 1 (;@5;)
              end
              local.get 5
              i32.const -64
              i32.sub
              i32.const 1052150
              i32.const 4
              call 36
            end
            block  ;; label = @5
              block  ;; label = @6
                block  ;; label = @7
                  block  ;; label = @8
                    local.get 0
                    i32.const 255
                    i32.and
                    i32.const 1
                    i32.sub
                    br_table 1 (;@7;) 2 (;@6;) 3 (;@5;) 0 (;@8;)
                  end
                  local.get 5
                  i32.const -64
                  i32.sub
                  local.get 5
                  i32.const 463
                  i32.add
                  i32.const 0
                  call 37
                  local.get 5
                  i32.load8_u offset=64
                  local.get 5
                  i32.load offset=68
                  call 34
                  br 2 (;@5;)
                end
                local.get 5
                i32.const -64
                i32.sub
                local.get 5
                i32.const 463
                i32.add
                i32.const 1
                call 37
                local.get 5
                i32.load8_u offset=64
                local.get 5
                i32.load offset=68
                call 34
                br 1 (;@5;)
              end
              block (result i32)  ;; label = @6
                i32.const 1055020
                i32.load8_u
                local.set 16
                i32.const 1055020
                i32.const 0
                i32.store8
                local.get 16
              end
              i32.eqz
              br_if 0 (;@5;)
              local.get 5
              i32.const 0
              i32.store offset=80
              local.get 5
              i32.const 1
              i32.store offset=68
              local.get 5
              i32.const 1052356
              i32.store offset=64
              local.get 5
              i64.const 4
              i64.store offset=72 align=4
              local.get 5
              i32.const 40
              i32.add
              local.get 5
              i32.const 463
              i32.add
              local.get 5
              i32.const -64
              i32.sub
              call 33
              local.get 5
              i32.load8_u offset=40
              local.get 5
              i32.load offset=44
              call 34
            end
            i32.const 1055132
            i32.const 1055132
            i32.load
            i32.const 1
            i32.sub
            i32.store
            i32.const 1055089
            i32.const 0
            i32.store8
            i32.const 1055124
            i32.const 0
            i32.store8
            local.get 3
            i32.eqz
            if  ;; label = @5
              local.get 5
              i32.const 0
              i32.store offset=80
              local.get 5
              i32.const 1
              i32.store offset=68
              local.get 5
              i32.const 1052740
              i32.store offset=64
              local.get 5
              i64.const 4
              i64.store offset=72 align=4
              local.get 5
              i32.const 40
              i32.add
              local.get 5
              i32.const 463
              i32.add
              local.get 5
              i32.const -64
              i32.sub
              call 33
              local.get 5
              i32.load8_u offset=40
              local.get 5
              i32.load offset=44
              call 34
              br 4 (;@1;)
            end
            unreachable
          end
          i32.const 1052928
          call 18
          unreachable
        end
        local.get 5
        i64.const 0
        i64.store offset=76 align=4
        local.get 5
        i64.const 17179869185
        i64.store offset=68 align=4
        local.get 5
        i32.const 1051988
        i32.store offset=64
        local.get 5
        i32.const 40
        i32.add
        local.get 5
        i32.const -64
        i32.sub
        call 11
        unreachable
      end
      local.get 0
      call 9
      unreachable
    end
    unreachable)
  (func $29 (type 6) (param $0 i32) (param $1 i32) (param $2 i32)
    (local $3 i32) (local $4 i32)
    global.get 0
    i32.const -64
    i32.add
    local.tee 3
    global.set 0
    local.get 2
    i32.load offset=4
    drop
    local.get 3
    i32.const 4
    i32.store8 offset=8
    local.get 3
    local.get 1
    i32.store offset=16
    block  ;; label = @1
      block  ;; label = @2
        local.get 3
        i32.const 8
        i32.add
        i32.const 1050244
        local.get 2
        call 7
        if  ;; label = @3
          local.get 3
          i32.load8_u offset=8
          i32.const 4
          i32.ne
          br_if 1 (;@2;)
          local.get 3
          i32.const 0
          i32.store offset=40
          local.get 3
          i32.const 1
          i32.store offset=28
          local.get 3
          i32.const 1050356
          i32.store offset=24
          local.get 3
          i64.const 4
          i64.store offset=32 align=4
          local.get 3
          i32.const 24
          i32.add
          i32.const 1050364
          call 8
          unreachable
        end
        local.get 0
        i32.const 4
        i32.store8
        local.get 3
        i32.load offset=12
        local.set 0
        local.get 3
        i32.load8_u offset=8
        local.tee 1
        i32.const 4
        i32.le_u
        local.get 1
        i32.const 3
        i32.ne
        i32.and
        br_if 1 (;@1;)
        local.get 0
        i32.load
        local.set 1
        local.get 0
        i32.const 4
        i32.add
        i32.load
        local.tee 2
        i32.load
        local.tee 4
        if  ;; label = @3
          local.get 1
          local.get 4
          call_indirect (type 2)
        end
        local.get 2
        i32.load offset=4
        if  ;; label = @3
          local.get 1
          call 80
        end
        local.get 0
        call 80
        br 1 (;@1;)
      end
      local.get 0
      local.get 3
      i64.load offset=8
      i64.store align=4
    end
    local.get 3
    i32.const -64
    i32.sub
    global.set 0)
  (func $30 (type 3) (param $0 i32) (param $1 i32)
    (local $2 i32) (local $3 i32)
    local.get 0
    i32.const 255
    i32.and
    local.tee 0
    i32.const 4
    i32.le_u
    local.get 0
    i32.const 3
    i32.ne
    i32.and
    i32.eqz
    if  ;; label = @1
      local.get 1
      i32.load
      local.set 0
      local.get 1
      i32.const 4
      i32.add
      i32.load
      local.tee 2
      i32.load
      local.tee 3
      if  ;; label = @2
        local.get 0
        local.get 3
        call_indirect (type 2)
      end
      local.get 2
      i32.load offset=4
      if  ;; label = @2
        local.get 0
        call 80
      end
      local.get 1
      call 80
    end)
  (func $31 (type 0) (param $0 i32) (param $1 i32) (result i32)
    (local $2 i32) (local $3 i32) (local $scratch i32) (local $scratch_5 i32)
    global.get 0
    i32.const -64
    i32.add
    local.tee 2
    global.set 0
    local.get 1
    i32.load offset=4
    local.set 3
    block (result i32)  ;; label = @1
      local.get 1
      i32.load
      local.set 4
      local.get 2
      local.get 0
      i32.load
      local.tee 0
      i64.load align=4
      i64.store offset=8 align=4
      local.get 2
      local.get 0
      i32.const 12
      i32.add
      i64.extend_i32_u
      i64.const 25769803776
      i64.or
      i64.store offset=32
      local.get 2
      local.get 0
      i32.const 8
      i32.add
      i64.extend_i32_u
      i64.const 25769803776
      i64.or
      i64.store offset=24
      local.get 2
      local.get 2
      i32.const 8
      i32.add
      i64.extend_i32_u
      i64.const 12884901888
      i64.or
      i64.store offset=16
      local.get 2
      i64.const 3
      i64.store offset=52 align=4
      local.get 2
      i32.const 3
      i32.store offset=44
      local.get 2
      i32.const 1052888
      i32.store offset=40
      local.get 2
      local.get 2
      i32.const 16
      i32.add
      i32.store offset=48
      local.get 4
    end
    local.get 3
    local.get 2
    i32.const 40
    i32.add
    call 7
    local.set 5
    local.get 2
    i32.const -64
    i32.sub
    global.set 0
    local.get 5)
  (func $32 (type 6) (param $0 i32) (param $1 i32) (param $2 i32)
    (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i64) (local $7 i64) (local $8 i64) (local $9 i64)
    global.get 0
    i32.const 640
    i32.sub
    local.tee 3
    global.set 0
    local.get 3
    local.get 2
    i32.const 9
    local.get 1
    select
    i32.store offset=4
    local.get 3
    local.get 1
    i32.const 1052364
    local.get 1
    select
    i32.store
    block  ;; label = @1
      i32.const 1055104
      i64.load
      local.tee 8
      i64.eqz
      if  ;; label = @2
        i32.const 1055112
        i64.load
        local.set 6
        loop  ;; label = @3
          local.get 6
          i64.const -1
          i64.eq
          br_if 2 (;@1;)
          i32.const 1055112
          local.get 6
          i64.const 1
          i64.add
          local.tee 8
          i32.const 1055112
          i64.load
          local.tee 7
          local.get 6
          local.get 7
          i64.eq
          local.tee 1
          select
          i64.store
          local.get 7
          local.set 6
          local.get 1
          i32.eqz
          br_if 0 (;@3;)
        end
        i32.const 1055104
        local.get 8
        i64.store
      end
      local.get 3
      local.get 8
      i64.store offset=8
      local.get 3
      i32.const 16
      i32.add
      local.tee 1
      i32.const 0
      i32.const 512
      memory.fill
      local.get 3
      i64.const 0
      i64.store offset=536
      local.get 3
      i32.const 512
      i32.store offset=532
      local.get 3
      local.get 1
      i32.store offset=528
      local.get 0
      i64.load32_u
      local.set 6
      local.get 0
      i64.load32_u offset=4
      local.set 7
      local.get 3
      i32.const 5
      i32.store offset=548
      local.get 3
      i32.const 1052420
      i32.store offset=544
      local.get 3
      i64.const 4
      i64.store offset=556 align=4
      local.get 3
      local.get 7
      i64.const 12884901888
      i64.or
      local.tee 7
      i64.store offset=592
      local.get 3
      local.get 6
      i64.const 42949672960
      i64.or
      local.tee 6
      i64.store offset=584
      local.get 3
      local.get 3
      i32.const 8
      i32.add
      i64.extend_i32_u
      i64.const 47244640256
      i64.or
      local.tee 8
      i64.store offset=576
      local.get 3
      local.get 3
      i64.extend_i32_u
      i64.const 12884901888
      i64.or
      local.tee 9
      i64.store offset=568
      local.get 3
      local.get 3
      i32.const 568
      i32.add
      i32.store offset=552
      local.get 3
      i32.const 4
      i32.store8 offset=604
      local.get 3
      local.get 3
      i32.const 528
      i32.add
      i32.store offset=612
      local.get 3
      i32.const 604
      i32.add
      i32.const 1050404
      local.get 3
      i32.const 544
      i32.add
      call 7
      local.set 2
      local.get 3
      i32.load8_u offset=604
      local.set 1
      block  ;; label = @2
        block  ;; label = @3
          block  ;; label = @4
            block  ;; label = @5
              block  ;; label = @6
                local.get 2
                if  ;; label = @7
                  local.get 1
                  i32.const 4
                  i32.ne
                  br_if 1 (;@6;)
                  local.get 3
                  i32.const 0
                  i32.store offset=632
                  local.get 3
                  i32.const 1
                  i32.store offset=620
                  local.get 3
                  i32.const 1050356
                  i32.store offset=616
                  local.get 3
                  i64.const 4
                  i64.store offset=624 align=4
                  local.get 3
                  i32.const 616
                  i32.add
                  i32.const 1050364
                  call 8
                  unreachable
                end
                i32.const 23
                local.get 1
                i32.shr_u
                i32.const 1
                i32.and
                br_if 1 (;@5;)
                local.get 3
                i32.load offset=608
                local.tee 1
                i32.load
                local.set 2
                local.get 1
                i32.const 4
                i32.add
                i32.load
                local.tee 4
                i32.load
                local.tee 5
                if  ;; label = @7
                  local.get 2
                  local.get 5
                  call_indirect (type 2)
                end
                local.get 4
                i32.load offset=4
                if  ;; label = @7
                  local.get 2
                  call 80
                end
                local.get 1
                call 80
                br 1 (;@5;)
              end
              local.get 3
              i32.load offset=604
              local.tee 1
              i32.const 255
              i32.and
              i32.const 4
              i32.ne
              br_if 1 (;@4;)
            end
            local.get 3
            i32.load offset=536
            local.tee 1
            i32.const 513
            i32.lt_u
            br_if 1 (;@3;)
            i32.const 0
            local.get 1
            i32.const 512
            i32.const 1052376
            call 17
            unreachable
          end
          local.get 1
          i32.const 255
          i32.and
          i32.const 3
          i32.ge_u
          if  ;; label = @4
            local.get 3
            i32.load offset=608
            local.tee 1
            i32.load
            local.set 2
            local.get 1
            i32.const 4
            i32.add
            i32.load
            local.tee 4
            i32.load
            local.tee 5
            if  ;; label = @5
              local.get 2
              local.get 5
              call_indirect (type 2)
            end
            local.get 4
            i32.load offset=4
            if  ;; label = @5
              local.get 2
              call 80
            end
            local.get 1
            call 80
          end
          local.get 0
          i32.load offset=12
          i32.const 36
          i32.add
          i32.load
          local.set 1
          local.get 0
          i32.load offset=8
          local.set 0
          local.get 3
          i32.const 5
          i32.store offset=620
          local.get 3
          i32.const 1052420
          i32.store offset=616
          local.get 3
          i64.const 4
          i64.store offset=628 align=4
          local.get 3
          local.get 7
          i64.store offset=592
          local.get 3
          local.get 6
          i64.store offset=584
          local.get 3
          local.get 8
          i64.store offset=576
          local.get 3
          local.get 9
          i64.store offset=568
          local.get 3
          local.get 3
          i32.const 568
          i32.add
          i32.store offset=624
          local.get 3
          i32.const 544
          i32.add
          local.get 0
          local.get 3
          i32.const 616
          i32.add
          local.get 1
          call_indirect (type 6)
          local.get 3
          i32.load offset=548
          local.set 0
          local.get 3
          i32.load8_u offset=544
          local.tee 1
          i32.const 4
          i32.le_u
          local.get 1
          i32.const 3
          i32.ne
          i32.and
          br_if 1 (;@2;)
          local.get 0
          i32.load
          local.set 1
          local.get 0
          i32.const 4
          i32.add
          i32.load
          local.tee 2
          i32.load
          local.tee 4
          if  ;; label = @4
            local.get 1
            local.get 4
            call_indirect (type 2)
          end
          local.get 2
          i32.load offset=4
          if  ;; label = @4
            local.get 1
            call 80
          end
          local.get 0
          call 80
          br 1 (;@2;)
        end
        local.get 3
        i32.const 568
        i32.add
        local.get 0
        i32.load offset=8
        local.get 3
        i32.const 16
        i32.add
        local.get 1
        local.get 0
        i32.load offset=12
        i32.load offset=28
        call_indirect (type 4)
        local.get 3
        i32.load offset=572
        local.set 0
        local.get 3
        i32.load8_u offset=568
        local.tee 1
        i32.const 4
        i32.le_u
        local.get 1
        i32.const 3
        i32.ne
        i32.and
        br_if 0 (;@2;)
        local.get 0
        i32.load
        local.set 1
        local.get 0
        i32.const 4
        i32.add
        i32.load
        local.tee 2
        i32.load
        local.tee 4
        if  ;; label = @3
          local.get 1
          local.get 4
          call_indirect (type 2)
        end
        local.get 2
        i32.load offset=4
        if  ;; label = @3
          local.get 1
          call 80
        end
        local.get 0
        call 80
      end
      local.get 3
      i32.const 640
      i32.add
      global.set 0
      return
    end
    call 10
    unreachable)
  (func $33 (type 6) (param $0 i32) (param $1 i32) (param $2 i32)
    (local $3 i32)
    global.get 0
    i32.const 48
    i32.sub
    local.tee 3
    global.set 0
    local.get 3
    i32.const 1
    i32.store offset=12
    local.get 3
    i32.const 1050232
    i32.store offset=8
    local.get 3
    i64.const 1
    i64.store offset=20 align=4
    local.get 3
    local.get 2
    i32.store8 offset=47
    local.get 3
    local.get 3
    i32.const 47
    i32.add
    i64.extend_i32_u
    i64.const 51539607552
    i64.or
    i64.store offset=32
    local.get 3
    local.get 3
    i32.const 32
    i32.add
    i32.store offset=16
    local.get 0
    local.get 1
    local.get 3
    i32.const 8
    i32.add
    call 33
    local.get 3
    i32.const 48
    i32.add
    global.set 0)
  (func $34 (type 4) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32)
    global.get 0
    i32.const 16
    i32.sub
    local.tee 1
    global.set 0
    local.get 1
    local.get 3
    i32.store offset=4
    local.get 1
    local.get 2
    i32.store
    local.get 1
    i32.const 8
    i32.add
    i32.const 2
    local.get 1
    i32.const 1
    call 15
    block  ;; label = @1
      local.get 1
      i32.load16_u offset=8
      i32.const 1
      i32.eq
      if  ;; label = @2
        local.get 0
        local.get 1
        i64.load16_u offset=10
        i64.const 32
        i64.shl
        i64.store align=4
        br 1 (;@1;)
      end
      local.get 0
      local.get 1
      i32.load offset=12
      i32.store offset=4
      local.get 0
      i32.const 4
      i32.store8
    end
    local.get 1
    i32.const 16
    i32.add
    global.set 0)
  (func $35 (type 4) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32)
    global.get 0
    i32.const 16
    i32.sub
    local.tee 1
    global.set 0
    local.get 1
    i32.const 8
    i32.add
    i32.const 2
    local.get 2
    local.get 3
    call 15
    block  ;; label = @1
      local.get 1
      i32.load16_u offset=8
      i32.const 1
      i32.eq
      if  ;; label = @2
        local.get 0
        local.get 1
        i64.load16_u offset=10
        i64.const 32
        i64.shl
        i64.store align=4
        br 1 (;@1;)
      end
      local.get 0
      local.get 1
      i32.load offset=12
      i32.store offset=4
      local.get 0
      i32.const 4
      i32.store8
    end
    local.get 1
    i32.const 16
    i32.add
    global.set 0)
  (func $36 (type 5) (param $0 i32) (result i32)
    unreachable)
  (func $37 (type 3) (param $0 i32) (param $1 i32)
    local.get 0
    i32.const 4
    i32.store8)
  (func $38 (type 4) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32)
    (local $4 i32) (local $5 i64)
    global.get 0
    i32.const 16
    i32.sub
    local.tee 1
    global.set 0
    block  ;; label = @1
      block  ;; label = @2
        local.get 3
        if  ;; label = @3
          loop  ;; label = @4
            local.get 1
            local.get 3
            i32.store offset=4
            local.get 1
            local.get 2
            i32.store
            local.get 1
            i32.const 8
            i32.add
            i32.const 2
            local.get 1
            i32.const 1
            call 15
            block  ;; label = @5
              local.get 1
              i32.load16_u offset=8
              if  ;; label = @6
                local.get 1
                i64.load16_u offset=10
                local.tee 5
                i64.const 27
                i64.eq
                br_if 1 (;@5;)
                local.get 0
                local.get 5
                i64.const 32
                i64.shl
                i64.store align=4
                br 4 (;@2;)
              end
              local.get 1
              i32.load offset=12
              local.tee 4
              i32.eqz
              if  ;; label = @6
                local.get 0
                i32.const 1050472
                i64.load
                i64.store align=4
                br 4 (;@2;)
              end
              local.get 3
              local.get 4
              i32.lt_u
              br_if 4 (;@1;)
              local.get 2
              local.get 4
              i32.add
              local.set 2
              local.get 3
              local.get 4
              i32.sub
              local.set 3
            end
            local.get 3
            br_if 0 (;@4;)
          end
        end
        local.get 0
        i32.const 4
        i32.store8
      end
      local.get 1
      i32.const 16
      i32.add
      global.set 0
      return
    end
    local.get 4
    local.get 3
    local.get 3
    i32.const 1050480
    call 17
    unreachable)
  (func $39 (type 4) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32)
    (local $4 i32) (local $5 i32) (local $6 i32) (local $7 i32) (local $8 i32) (local $9 i32) (local $10 i64) (local $scratch i32)
    global.get 0
    i32.const 32
    i32.sub
    local.tee 4
    global.set 0
    block  ;; label = @1
      block  ;; label = @2
        local.get 3
        i32.eqz
        br_if 0 (;@2;)
        local.get 2
        i32.const 4
        i32.add
        local.set 5
        local.get 3
        i32.const 3
        i32.shl
        local.tee 6
        i32.const 8
        i32.sub
        i32.const 3
        i32.shr_u
        i32.const 1
        i32.add
        local.set 7
        i32.const 0
        local.set 1
        block  ;; label = @3
          loop  ;; label = @4
            local.get 5
            i32.load
            br_if 1 (;@3;)
            local.get 5
            i32.const 8
            i32.add
            local.set 5
            local.get 1
            i32.const 1
            i32.add
            local.set 1
            local.get 6
            i32.const 8
            i32.sub
            local.tee 6
            br_if 0 (;@4;)
          end
          local.get 7
          local.set 1
        end
        local.get 1
        local.get 3
        i32.le_u
        if  ;; label = @3
          local.get 1
          local.get 3
          i32.eq
          br_if 1 (;@2;)
          local.get 3
          local.get 1
          i32.sub
          local.set 3
          local.get 2
          local.get 1
          i32.const 3
          i32.shl
          i32.add
          local.set 6
          loop  ;; label = @4
            local.get 4
            i32.const 8
            i32.add
            i32.const 2
            local.get 6
            local.get 3
            call 15
            block  ;; label = @5
              block  ;; label = @6
                local.get 4
                i32.load16_u offset=8
                if  ;; label = @7
                  local.get 4
                  i64.load16_u offset=10
                  local.tee 10
                  i64.const 27
                  i64.ne
                  br_if 1 (;@6;)
                  br 3 (;@4;)
                end
                local.get 4
                i32.load offset=12
                local.tee 5
                i32.eqz
                if  ;; label = @7
                  local.get 0
                  i32.const 1050472
                  i64.load
                  i64.store align=4
                  br 6 (;@1;)
                end
                local.get 6
                i32.const 4
                i32.add
                local.set 1
                block (result i32)  ;; label = @7
                  local.get 3
                  i32.const 3
                  i32.shl
                  local.tee 8
                  i32.const 8
                  i32.sub
                  i32.const 3
                  i32.shr_u
                  i32.const 1
                  i32.add
                  local.set 11
                  i32.const 0
                  local.set 2
                  loop  ;; label = @8
                    local.get 5
                    local.get 1
                    i32.load
                    local.tee 9
                    i32.lt_u
                    br_if 3 (;@5;)
                    local.get 1
                    i32.const 8
                    i32.add
                    local.set 1
                    local.get 2
                    i32.const 1
                    i32.add
                    local.set 2
                    local.get 5
                    local.get 9
                    i32.sub
                    local.set 5
                    local.get 8
                    i32.const 8
                    i32.sub
                    local.tee 8
                    br_if 0 (;@8;)
                  end
                  local.get 11
                end
                local.set 2
                br 1 (;@5;)
              end
              local.get 0
              local.get 10
              i64.const 32
              i64.shl
              i64.store align=4
              br 4 (;@1;)
            end
            local.get 2
            local.get 3
            i32.le_u
            if  ;; label = @5
              local.get 2
              local.get 3
              i32.eq
              if  ;; label = @6
                local.get 5
                i32.eqz
                br_if 4 (;@2;)
                local.get 4
                i32.const 0
                i32.store offset=24
                local.get 4
                i32.const 1
                i32.store offset=12
                local.get 4
                i32.const 1051396
                i32.store offset=8
                local.get 4
                i64.const 4
                i64.store offset=16 align=4
                local.get 4
                i32.const 8
                i32.add
                i32.const 1051404
                call 8
                unreachable
              end
              local.get 5
              local.get 6
              local.get 2
              i32.const 3
              i32.shl
              i32.add
              local.tee 6
              i32.load offset=4
              local.tee 1
              i32.gt_u
              if  ;; label = @6
                local.get 4
                i32.const 0
                i32.store offset=24
                local.get 4
                i32.const 1
                i32.store offset=12
                local.get 4
                i32.const 1051456
                i32.store offset=8
                local.get 4
                i64.const 4
                i64.store offset=16 align=4
                local.get 4
                i32.const 8
                i32.add
                i32.const 1051464
                call 8
                unreachable
              end
              local.get 3
              local.get 2
              i32.sub
              local.set 3
              local.get 6
              local.get 1
              local.get 5
              i32.sub
              i32.store offset=4
              local.get 6
              local.get 6
              i32.load
              local.get 5
              i32.add
              i32.store
              br 1 (;@4;)
            end
          end
          local.get 2
          local.get 3
          local.get 3
          i32.const 1051340
          call 17
          unreachable
        end
        local.get 1
        local.get 3
        local.get 3
        i32.const 1051340
        call 17
        unreachable
      end
      local.get 0
      i32.const 4
      i32.store8
    end
    local.get 4
    i32.const 32
    i32.add
    global.set 0)
  (func $40 (type 0) (param $0 i32) (param $1 i32) (result i32)
    (local $2 i32) (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i32) (local $7 i32) (local $8 i32) (local $9 i32) (local $10 i64)
    global.get 0
    i32.const 16
    i32.sub
    local.tee 5
    global.set 0
    local.get 1
    i32.load offset=4
    local.set 8
    local.get 1
    i32.load
    local.set 7
    local.get 0
    i32.load8_u
    local.set 9
    i32.const 512
    local.set 1
    block  ;; label = @1
      block  ;; label = @2
        block  ;; label = @3
          i32.const 512
          call 79
          local.tee 0
          if  ;; label = @4
            local.get 5
            local.get 0
            i32.store offset=8
            local.get 5
            i32.const 512
            i32.store offset=4
            loop  ;; label = @5
              block  ;; label = @6
                block  ;; label = @7
                  block  ;; label = @8
                    block (result i32)  ;; label = @9
                      i32.const 1055024
                      i32.load
                      local.set 2
                      block  ;; label = @10
                        local.get 0
                        i32.eqz
                        if  ;; label = @11
                          block  ;; label = @12
                            local.get 2
                            call 86
                            i32.const 1
                            i32.add
                            local.tee 4
                            call 79
                            local.tee 3
                            i32.eqz
                            br_if 0 (;@12;)
                            local.get 4
                            i32.eqz
                            br_if 0 (;@12;)
                            local.get 3
                            local.get 2
                            local.get 4
                            memory.copy
                          end
                          local.get 3
                          local.tee 2
                          br_if 1 (;@10;)
                          i32.const 1055632
                          i32.const 48
                          i32.store
                          i32.const 0
                          br 2 (;@9;)
                        end
                        local.get 2
                        call 86
                        i32.const 1
                        i32.add
                        local.get 1
                        i32.gt_u
                        if  ;; label = @11
                          i32.const 1055632
                          i32.const 68
                          i32.store
                          i32.const 0
                          br 2 (;@9;)
                        end
                        block  ;; label = @11
                          block  ;; label = @12
                            local.get 2
                            local.get 0
                            local.tee 4
                            i32.xor
                            i32.const 3
                            i32.and
                            if  ;; label = @13
                              local.get 2
                              i32.load8_u
                              local.set 3
                              br 1 (;@12;)
                            end
                            block  ;; label = @13
                              local.get 2
                              i32.const 3
                              i32.and
                              i32.eqz
                              br_if 0 (;@13;)
                              local.get 4
                              local.get 2
                              i32.load8_u
                              local.tee 3
                              i32.store8
                              local.get 3
                              i32.eqz
                              br_if 2 (;@11;)
                              local.get 4
                              i32.const 1
                              i32.add
                              local.set 3
                              local.get 2
                              i32.const 1
                              i32.add
                              local.tee 6
                              i32.const 3
                              i32.and
                              i32.eqz
                              if  ;; label = @14
                                local.get 3
                                local.set 4
                                local.get 6
                                local.set 2
                                br 1 (;@13;)
                              end
                              local.get 3
                              local.get 6
                              i32.load8_u
                              local.tee 3
                              i32.store8
                              local.get 3
                              i32.eqz
                              br_if 2 (;@11;)
                              local.get 4
                              i32.const 2
                              i32.add
                              local.set 3
                              local.get 2
                              i32.const 2
                              i32.add
                              local.tee 6
                              i32.const 3
                              i32.and
                              i32.eqz
                              if  ;; label = @14
                                local.get 3
                                local.set 4
                                local.get 6
                                local.set 2
                                br 1 (;@13;)
                              end
                              local.get 3
                              local.get 6
                              i32.load8_u
                              local.tee 3
                              i32.store8
                              local.get 3
                              i32.eqz
                              br_if 2 (;@11;)
                              local.get 4
                              i32.const 3
                              i32.add
                              local.set 3
                              local.get 2
                              i32.const 3
                              i32.add
                              local.tee 6
                              i32.const 3
                              i32.and
                              i32.eqz
                              if  ;; label = @14
                                local.get 3
                                local.set 4
                                local.get 6
                                local.set 2
                                br 1 (;@13;)
                              end
                              local.get 3
                              local.get 6
                              i32.load8_u
                              local.tee 3
                              i32.store8
                              local.get 3
                              i32.eqz
                              br_if 2 (;@11;)
                              local.get 4
                              i32.const 4
                              i32.add
                              local.set 4
                              local.get 2
                              i32.const 4
                              i32.add
                              local.set 2
                            end
                            i32.const 16843008
                            local.get 2
                            i32.load
                            local.tee 3
                            i32.sub
                            local.get 3
                            i32.or
                            i32.const -2139062144
                            i32.and
                            i32.const -2139062144
                            i32.ne
                            br_if 0 (;@12;)
                            loop  ;; label = @13
                              local.get 4
                              local.get 3
                              i32.store
                              local.get 4
                              i32.const 4
                              i32.add
                              local.set 4
                              i32.const 16843008
                              local.get 2
                              i32.const 4
                              i32.add
                              local.tee 2
                              i32.load
                              local.tee 3
                              i32.sub
                              local.get 3
                              i32.or
                              i32.const -2139062144
                              i32.and
                              i32.const -2139062144
                              i32.eq
                              br_if 0 (;@13;)
                            end
                          end
                          local.get 4
                          local.get 3
                          i32.store8
                          local.get 3
                          i32.const 255
                          i32.and
                          i32.eqz
                          br_if 0 (;@11;)
                          local.get 2
                          i32.const 1
                          i32.add
                          local.set 3
                          loop  ;; label = @12
                            local.get 4
                            i32.const 1
                            i32.add
                            local.tee 4
                            local.get 3
                            i32.load8_u
                            local.tee 2
                            i32.store8
                            local.get 3
                            i32.const 1
                            i32.add
                            local.set 3
                            local.get 2
                            br_if 0 (;@12;)
                          end
                        end
                        local.get 0
                        local.set 2
                      end
                      local.get 2
                    end
                    i32.eqz
                    if  ;; label = @9
                      i32.const 1055632
                      i32.load
                      local.tee 2
                      i32.const 68
                      i32.eq
                      br_if 2 (;@7;)
                      local.get 2
                      i64.extend_i32_u
                      i64.const 32
                      i64.shl
                      local.set 10
                      local.get 1
                      if  ;; label = @10
                        local.get 0
                        call 80
                      end
                      i32.const -2147483648
                      local.set 1
                      br 1 (;@8;)
                    end
                    local.get 5
                    local.get 0
                    call 86
                    local.tee 2
                    i32.store offset=12
                    local.get 1
                    local.get 2
                    i32.gt_u
                    if  ;; label = @9
                      block  ;; label = @10
                        local.get 2
                        i32.eqz
                        if  ;; label = @11
                          local.get 0
                          call 80
                          i32.const 1
                          local.set 1
                          br 1 (;@10;)
                        end
                        local.get 0
                        local.get 2
                        call 81
                        local.tee 1
                        i32.eqz
                        br_if 7 (;@3;)
                      end
                      local.get 5
                      local.get 1
                      i32.store offset=8
                      local.get 2
                      local.set 1
                    end
                    local.get 5
                    i64.load offset=8 align=4
                    local.set 10
                  end
                  block  ;; label = @8
                    local.get 1
                    i32.const -2147483648
                    i32.ne
                    br_if 0 (;@8;)
                    local.get 10
                    i64.const 255
                    i64.and
                    i64.const 3
                    i64.ne
                    br_if 0 (;@8;)
                    local.get 10
                    i64.const 32
                    i64.shr_u
                    i32.wrap_i64
                    local.tee 0
                    i32.load
                    local.set 2
                    local.get 0
                    i32.const 4
                    i32.add
                    i32.load
                    local.tee 4
                    i32.load
                    local.tee 3
                    if  ;; label = @9
                      local.get 2
                      local.get 3
                      call_indirect (type 2)
                    end
                    local.get 4
                    i32.load offset=4
                    if  ;; label = @9
                      local.get 2
                      call 80
                    end
                    local.get 0
                    call 80
                  end
                  local.get 7
                  i32.const 1051848
                  i32.const 17
                  local.get 8
                  i32.load offset=12
                  local.tee 0
                  call_indirect (type 1)
                  br_if 1 (;@6;)
                  local.get 9
                  i32.const 1
                  i32.and
                  i32.eqz
                  if  ;; label = @8
                    local.get 7
                    i32.const 1051865
                    i32.const 88
                    local.get 0
                    call_indirect (type 1)
                    br_if 2 (;@6;)
                  end
                  i32.const 0
                  local.set 0
                  local.get 1
                  i32.const -2147483648
                  i32.or
                  i32.const -2147483648
                  i32.eq
                  br_if 6 (;@1;)
                  br 5 (;@2;)
                end
                local.get 5
                local.get 1
                i32.store offset=12
                local.get 5
                i32.const 4
                i32.add
                local.get 1
                i32.const 1
                call 45
                local.get 5
                i32.load offset=8
                local.set 0
                local.get 5
                i32.load offset=4
                local.set 1
                br 1 (;@5;)
              end
            end
            i32.const 1
            local.set 0
            local.get 1
            i32.const -2147483648
            i32.or
            i32.const -2147483648
            i32.ne
            br_if 2 (;@2;)
            br 3 (;@1;)
          end
          i32.const 512
          call 9
          unreachable
        end
        local.get 2
        call 9
        unreachable
      end
      local.get 10
      i32.wrap_i64
      call 80
    end
    local.get 5
    i32.const 16
    i32.add
    global.set 0
    local.get 0)
  (func $41 (type 6) (param $0 i32) (param $1 i32) (param $2 i32)
    (local $3 i32) (local $4 i32) (local $5 i32)
    global.get 0
    i32.const 32
    i32.sub
    local.tee 3
    global.set 0
    block  ;; label = @1
      block (result i32)  ;; label = @2
        i32.const 0
        local.get 2
        local.get 1
        local.get 2
        i32.add
        local.tee 1
        i32.gt_u
        br_if 0 (;@2;)
        drop
        i32.const 0
        i32.const 8
        local.get 1
        local.get 0
        i32.load
        local.tee 2
        i32.const 1
        i32.shl
        local.tee 4
        local.get 1
        local.get 4
        i32.gt_u
        select
        local.tee 1
        local.get 1
        i32.const 8
        i32.le_u
        select
        local.tee 1
        i32.const 0
        i32.lt_s
        br_if 0 (;@2;)
        drop
        local.get 3
        local.get 2
        if (result i32)  ;; label = @3
          local.get 3
          local.get 2
          i32.store offset=28
          local.get 3
          local.get 0
          i32.load offset=4
          i32.store offset=20
          i32.const 1
        else
          i32.const 0
        end
        i32.store offset=24
        local.get 3
        i32.const 8
        i32.add
        local.set 2
        block (result i32)  ;; label = @3
          local.get 3
          i32.const 20
          i32.add
          local.tee 4
          i32.load offset=4
          if  ;; label = @4
            local.get 4
            i32.load offset=8
            i32.eqz
            if  ;; label = @5
              local.get 1
              call 19
              br 2 (;@3;)
            end
            local.get 4
            i32.load
            local.get 1
            call 81
            br 1 (;@3;)
          end
          local.get 1
          call 19
        end
        local.set 4
        local.get 2
        local.get 1
        i32.store offset=8
        local.get 2
        local.get 4
        i32.const 1
        local.get 4
        select
        i32.store offset=4
        local.get 2
        local.get 4
        i32.eqz
        i32.store
        local.get 3
        i32.load offset=8
        i32.const 1
        i32.ne
        br_if 1 (;@1;)
        local.get 3
        i32.load offset=16
        local.set 5
        local.get 3
        i32.load offset=12
      end
      if  ;; label = @2
        local.get 5
        call 9
        unreachable
      end
      i32.const 1052780
      call 18
      unreachable
    end
    local.get 3
    i32.load offset=12
    local.set 2
    local.get 0
    local.get 1
    i32.store
    local.get 0
    local.get 2
    i32.store offset=4
    local.get 3
    i32.const 32
    i32.add
    global.set 0)
  (func $42 (type 2) (param $0 i32)
    (local $1 i32) (local $2 i32) (local $3 i32)
    local.get 0
    i32.load offset=4
    local.set 1
    local.get 0
    i32.load8_u
    local.tee 0
    i32.const 4
    i32.le_u
    local.get 0
    i32.const 3
    i32.ne
    i32.and
    i32.eqz
    if  ;; label = @1
      local.get 1
      i32.load
      local.set 0
      local.get 1
      i32.const 4
      i32.add
      i32.load
      local.tee 2
      i32.load
      local.tee 3
      if  ;; label = @2
        local.get 0
        local.get 3
        call_indirect (type 2)
      end
      local.get 2
      i32.load offset=4
      if  ;; label = @2
        local.get 0
        call 80
      end
      local.get 1
      call 80
    end)
  (func $43 (type 1) (param $0 i32) (param $1 i32) (param $2 i32) (result i32)
    (local $3 i64) (local $4 i64) (local $5 i32) (local $6 i32) (local $7 i32) (local $8 i32) (local $9 i32)
    local.get 0
    i32.load offset=8
    local.tee 5
    i32.load offset=4
    local.tee 6
    i64.const 4294967295
    local.get 5
    i64.load offset=8
    local.tee 3
    local.get 3
    i64.const 4294967295
    i64.ge_u
    select
    i32.wrap_i64
    i32.sub
    local.tee 7
    i32.const 0
    local.get 6
    local.get 7
    i32.ge_u
    select
    local.tee 7
    local.get 2
    local.get 2
    local.get 7
    i32.gt_u
    select
    local.tee 8
    if  ;; label = @1
      local.get 5
      i32.load
      local.get 3
      local.get 6
      i64.extend_i32_u
      local.tee 4
      local.get 3
      local.get 4
      i64.lt_u
      select
      i32.wrap_i64
      i32.add
      local.get 1
      local.get 8
      memory.copy
    end
    local.get 5
    local.get 3
    local.get 8
    i64.extend_i32_u
    i64.add
    i64.store offset=8
    block  ;; label = @1
      local.get 2
      local.get 7
      i32.le_u
      br_if 0 (;@1;)
      i32.const 1050472
      i64.load
      local.tee 3
      i64.const 255
      i64.and
      i64.const 4
      i64.eq
      br_if 0 (;@1;)
      local.get 0
      i32.load offset=4
      local.set 1
      local.get 0
      i32.load8_u
      local.tee 2
      i32.const 4
      i32.le_u
      local.get 2
      i32.const 3
      i32.ne
      i32.and
      i32.eqz
      if  ;; label = @2
        local.get 1
        i32.load
        local.set 2
        local.get 1
        i32.const 4
        i32.add
        i32.load
        local.tee 5
        i32.load
        local.tee 6
        if  ;; label = @3
          local.get 2
          local.get 6
          call_indirect (type 2)
        end
        local.get 5
        i32.load offset=4
        if  ;; label = @3
          local.get 2
          call 80
        end
        local.get 1
        call 80
      end
      local.get 0
      local.get 3
      i64.store align=4
      i32.const 1
      local.set 9
    end
    local.get 9)
  (func $44 (type 0) (param $0 i32) (param $1 i32) (result i32)
    (local $2 i32) (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i32) (local $7 i32) (local $8 i64) (local $9 i64)
    global.get 0
    i32.const 16
    i32.sub
    local.tee 2
    global.set 0
    local.get 2
    i32.const 0
    i32.store offset=12
    block (result i32)  ;; label = @1
      local.get 1
      i32.const 128
      i32.ge_u
      if  ;; label = @2
        local.get 1
        i32.const 63
        i32.and
        i32.const -128
        i32.or
        local.set 3
        local.get 1
        i32.const 6
        i32.shr_u
        local.set 4
        local.get 1
        i32.const 2048
        i32.lt_u
        if  ;; label = @3
          local.get 2
          local.get 3
          i32.store8 offset=13
          local.get 2
          local.get 4
          i32.const 192
          i32.or
          i32.store8 offset=12
          i32.const 2
          br 2 (;@1;)
        end
        local.get 1
        i32.const 12
        i32.shr_u
        local.set 5
        local.get 4
        i32.const 63
        i32.and
        i32.const -128
        i32.or
        local.set 4
        local.get 1
        i32.const 65535
        i32.le_u
        if  ;; label = @3
          local.get 2
          local.get 3
          i32.store8 offset=14
          local.get 2
          local.get 4
          i32.store8 offset=13
          local.get 2
          local.get 5
          i32.const 224
          i32.or
          i32.store8 offset=12
          i32.const 3
          br 2 (;@1;)
        end
        local.get 2
        local.get 3
        i32.store8 offset=15
        local.get 2
        local.get 4
        i32.store8 offset=14
        local.get 2
        local.get 5
        i32.const 63
        i32.and
        i32.const -128
        i32.or
        i32.store8 offset=13
        local.get 2
        local.get 1
        i32.const 18
        i32.shr_u
        i32.const -16
        i32.or
        i32.store8 offset=12
        i32.const 4
        br 1 (;@1;)
      end
      local.get 2
      local.get 1
      i32.store8 offset=12
      i32.const 1
    end
    local.set 1
    i32.const 0
    local.set 4
    local.get 0
    i32.load offset=8
    local.tee 3
    i32.load offset=4
    local.tee 5
    i64.const 4294967295
    local.get 3
    i64.load offset=8
    local.tee 8
    local.get 8
    i64.const 4294967295
    i64.ge_u
    select
    i32.wrap_i64
    i32.sub
    local.tee 6
    i32.const 0
    local.get 5
    local.get 6
    i32.ge_u
    select
    local.tee 6
    local.get 1
    local.get 1
    local.get 6
    i32.gt_u
    select
    local.tee 7
    if  ;; label = @1
      local.get 3
      i32.load
      local.get 8
      local.get 5
      i64.extend_i32_u
      local.tee 9
      local.get 8
      local.get 9
      i64.lt_u
      select
      i32.wrap_i64
      i32.add
      local.get 2
      i32.const 12
      i32.add
      local.get 7
      memory.copy
    end
    local.get 3
    local.get 8
    local.get 7
    i64.extend_i32_u
    i64.add
    i64.store offset=8
    block  ;; label = @1
      local.get 1
      local.get 6
      i32.le_u
      br_if 0 (;@1;)
      i32.const 1050472
      i64.load
      local.tee 8
      i64.const 255
      i64.and
      i64.const 4
      i64.eq
      br_if 0 (;@1;)
      local.get 0
      i32.load offset=4
      local.set 1
      local.get 0
      i32.load8_u
      local.tee 3
      i32.const 4
      i32.le_u
      local.get 3
      i32.const 3
      i32.ne
      i32.and
      i32.eqz
      if  ;; label = @2
        local.get 1
        i32.load
        local.set 3
        local.get 1
        i32.const 4
        i32.add
        i32.load
        local.tee 4
        i32.load
        local.tee 5
        if  ;; label = @3
          local.get 3
          local.get 5
          call_indirect (type 2)
        end
        local.get 4
        i32.load offset=4
        if  ;; label = @3
          local.get 3
          call 80
        end
        local.get 1
        call 80
      end
      local.get 0
      local.get 8
      i64.store align=4
      i32.const 1
      local.set 4
    end
    local.get 2
    i32.const 16
    i32.add
    global.set 0
    local.get 4)
  (func $45 (type 0) (param $0 i32) (param $1 i32) (result i32)
    local.get 1
    i32.load offset=4
    drop
    local.get 0
    i32.const 1050404
    local.get 1
    call 7)
  (func $46 (type 0) (param $0 i32) (param $1 i32) (result i32)
    local.get 0
    i32.load
    i32.load8_u
    i32.eqz
    if  ;; label = @1
      local.get 1
      i32.const 1048644
      i32.const 5
      call 20
      return
    end
    local.get 1
    i32.const 1048649
    i32.const 4
    call 20)
  (func $47 (type 1) (param $0 i32) (param $1 i32) (param $2 i32) (result i32)
    (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i64)
    global.get 0
    i32.const 16
    i32.sub
    local.tee 3
    global.set 0
    block  ;; label = @1
      block  ;; label = @2
        local.get 2
        i32.eqz
        br_if 0 (;@2;)
        loop  ;; label = @3
          local.get 3
          local.get 2
          i32.store offset=4
          local.get 3
          local.get 1
          i32.store
          local.get 3
          i32.const 8
          i32.add
          i32.const 2
          local.get 3
          i32.const 1
          call 15
          block  ;; label = @4
            block  ;; label = @5
              block (result i64)  ;; label = @6
                local.get 3
                i32.load16_u offset=8
                i32.const 1
                i32.eq
                if  ;; label = @7
                  local.get 3
                  i64.load16_u offset=10
                  local.tee 6
                  i64.const 27
                  i64.eq
                  br_if 3 (;@4;)
                  local.get 6
                  i64.const 32
                  i64.shl
                  br 1 (;@6;)
                end
                local.get 3
                i32.load offset=12
                local.tee 4
                br_if 1 (;@5;)
                i32.const 1050472
                i64.load
              end
              local.tee 6
              i64.const 255
              i64.and
              i64.const 4
              i64.eq
              br_if 3 (;@2;)
              local.get 0
              i32.load offset=4
              local.set 1
              local.get 0
              i32.load8_u
              local.tee 2
              i32.const 4
              i32.le_u
              local.get 2
              i32.const 3
              i32.ne
              i32.and
              i32.eqz
              if  ;; label = @6
                local.get 1
                i32.load
                local.set 2
                local.get 1
                i32.const 4
                i32.add
                i32.load
                local.tee 4
                i32.load
                local.tee 5
                if  ;; label = @7
                  local.get 2
                  local.get 5
                  call_indirect (type 2)
                end
                local.get 4
                i32.load offset=4
                if  ;; label = @7
                  local.get 2
                  call 80
                end
                local.get 1
                call 80
              end
              local.get 0
              local.get 6
              i64.store align=4
              i32.const 1
              local.set 5
              br 3 (;@2;)
            end
            local.get 2
            local.get 4
            i32.lt_u
            br_if 3 (;@1;)
            local.get 1
            local.get 4
            i32.add
            local.set 1
            local.get 2
            local.get 4
            i32.sub
            local.set 2
          end
          local.get 2
          br_if 0 (;@3;)
        end
      end
      local.get 3
      i32.const 16
      i32.add
      global.set 0
      local.get 5
      return
    end
    local.get 4
    local.get 2
    local.get 2
    i32.const 1050480
    call 17
    unreachable)
  (func $48 (type 0) (param $0 i32) (param $1 i32) (result i32)
    (local $2 i32) (local $3 i32) (local $4 i32) (local $scratch i32)
    global.get 0
    i32.const 16
    i32.sub
    local.tee 2
    global.set 0
    local.get 2
    i32.const 0
    i32.store offset=12
    local.get 0
    local.get 2
    i32.const 12
    i32.add
    block (result i32)  ;; label = @1
      local.get 1
      i32.const 128
      i32.ge_u
      if  ;; label = @2
        local.get 1
        i32.const 63
        i32.and
        i32.const -128
        i32.or
        local.set 3
        local.get 1
        i32.const 6
        i32.shr_u
        local.set 0
        local.get 1
        i32.const 2048
        i32.lt_u
        if  ;; label = @3
          local.get 2
          local.get 3
          i32.store8 offset=13
          local.get 2
          local.get 0
          i32.const 192
          i32.or
          i32.store8 offset=12
          i32.const 2
          br 2 (;@1;)
        end
        local.get 1
        i32.const 12
        i32.shr_u
        local.set 4
        local.get 0
        i32.const 63
        i32.and
        i32.const -128
        i32.or
        local.set 0
        local.get 1
        i32.const 65535
        i32.le_u
        if  ;; label = @3
          local.get 2
          local.get 3
          i32.store8 offset=14
          local.get 2
          local.get 0
          i32.store8 offset=13
          local.get 2
          local.get 4
          i32.const 224
          i32.or
          i32.store8 offset=12
          i32.const 3
          br 2 (;@1;)
        end
        local.get 2
        local.get 3
        i32.store8 offset=15
        local.get 2
        local.get 0
        i32.store8 offset=14
        local.get 2
        local.get 4
        i32.const 63
        i32.and
        i32.const -128
        i32.or
        i32.store8 offset=13
        local.get 2
        local.get 1
        i32.const 18
        i32.shr_u
        i32.const -16
        i32.or
        i32.store8 offset=12
        i32.const 4
        br 1 (;@1;)
      end
      local.get 2
      local.get 1
      i32.store8 offset=12
      i32.const 1
    end
    call 51
    local.set 5
    local.get 2
    i32.const 16
    i32.add
    global.set 0
    local.get 5)
  (func $49 (type 0) (param $0 i32) (param $1 i32) (result i32)
    local.get 1
    i32.load offset=4
    drop
    local.get 0
    i32.const 1050244
    local.get 1
    call 7)
  (func $50 (type 3) (param $0 i32) (param $1 i32)
    local.get 0
    i32.const 0
    i32.store)
  (func $51 (type 3) (param $0 i32) (param $1 i32)
    local.get 0
    i32.const 8
    i32.add
    i32.const 1050208
    i64.load align=4
    i64.store align=4
    local.get 0
    i32.const 1050200
    i64.load align=4
    i64.store align=4)
  (func $52 (type 0) (param $0 i32) (param $1 i32) (result i32)
    local.get 1
    i32.load
    local.get 0
    i32.load
    local.get 0
    i32.load offset=4
    local.get 1
    i32.load offset=4
    i32.load offset=12
    call_indirect (type 1))
  (func $53 (type 3) (param $0 i32) (param $1 i32)
    (local $2 i32) (local $3 i32)
    local.get 1
    i32.load offset=4
    local.set 2
    local.get 1
    i32.load
    local.set 3
    i32.const 8
    call 79
    local.tee 1
    i32.eqz
    if  ;; label = @1
      i32.const 8
      call 9
      unreachable
    end
    local.get 1
    local.get 2
    i32.store offset=4
    local.get 1
    local.get 3
    i32.store
    local.get 0
    i32.const 1052912
    i32.store offset=4
    local.get 0
    local.get 1
    i32.store)
  (func $54 (type 3) (param $0 i32) (param $1 i32)
    local.get 0
    i32.const 1052912
    i32.store offset=4
    local.get 0
    local.get 1
    i32.store)
  (func $55 (type 3) (param $0 i32) (param $1 i32)
    local.get 0
    local.get 1
    i64.load align=4
    i64.store)
  (func $56 (type 2) (param $0 i32)
    local.get 0
    i32.load
    i32.const -2147483648
    i32.or
    i32.const -2147483648
    i32.ne
    if  ;; label = @1
      local.get 0
      i32.load offset=4
      call 80
    end)
  (func $57 (type 0) (param $0 i32) (param $1 i32) (result i32)
    (local $2 i32) (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i32) (local $7 i64) (local $scratch i32) (local $scratch_9 i32)
    global.get 0
    i32.const 32
    i32.sub
    local.tee 2
    global.set 0
    block (result i32)  ;; label = @1
      local.get 0
      i32.load
      i32.const -2147483648
      i32.ne
      if  ;; label = @2
        local.get 1
        i32.load
        local.get 0
        i32.load offset=4
        local.get 0
        i32.load offset=8
        local.get 1
        i32.load offset=4
        i32.load offset=12
        call_indirect (type 1)
        br 1 (;@1;)
      end
      local.get 1
      i32.load offset=4
      local.set 3
      block (result i32)  ;; label = @2
        local.get 1
        i32.load
        local.set 8
        local.get 0
        i32.load offset=12
        i32.load
        local.tee 0
        i64.load offset=16 align=4
        local.set 7
        local.get 0
        i32.load offset=12
        local.set 4
        local.get 0
        i32.load offset=8
        local.set 5
        local.get 0
        i32.load
        local.set 6
        local.get 0
        i32.load offset=4
        local.set 0
        local.get 2
        local.get 7
        i64.store offset=24 align=4
        local.get 2
        local.get 4
        i32.store offset=20
        local.get 2
        local.get 5
        i32.store offset=16
        local.get 2
        local.get 0
        i32.store offset=12
        local.get 2
        local.get 6
        i32.store offset=8
        local.get 8
      end
      local.get 3
      local.get 2
      i32.const 8
      i32.add
      call 7
    end
    local.set 9
    local.get 2
    i32.const 32
    i32.add
    global.set 0
    local.get 9)
  (func $58 (type 3) (param $0 i32) (param $1 i32)
    (local $2 i32) (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i32) (local $7 i64) (local $scratch i32)
    global.get 0
    i32.const -64
    i32.add
    local.tee 2
    global.set 0
    local.get 1
    i32.load
    i32.const -2147483648
    i32.eq
    if  ;; label = @1
      block (result i32)  ;; label = @2
        local.get 1
        i32.load offset=12
        local.set 8
        local.get 2
        i32.const 0
        i32.store offset=36
        local.get 2
        i64.const 4294967296
        i64.store offset=28 align=4
        local.get 8
      end
      i32.load
      local.tee 3
      i64.load offset=16 align=4
      local.set 7
      local.get 3
      i32.load offset=12
      local.set 4
      local.get 3
      i32.load offset=8
      local.set 5
      local.get 3
      i32.load
      local.set 6
      local.get 3
      i32.load offset=4
      local.set 3
      local.get 2
      local.get 7
      i64.store offset=56 align=4
      local.get 2
      local.get 4
      i32.store offset=52
      local.get 2
      local.get 5
      i32.store offset=48
      local.get 2
      local.get 3
      i32.store offset=44
      local.get 2
      local.get 6
      i32.store offset=40
      local.get 2
      i32.const 28
      i32.add
      i32.const 1052460
      local.get 2
      i32.const 40
      i32.add
      call 7
      drop
      local.get 2
      i32.const 24
      i32.add
      local.get 2
      i32.const 36
      i32.add
      i32.load
      local.tee 3
      i32.store
      local.get 2
      local.get 2
      i64.load offset=28 align=4
      local.tee 7
      i64.store offset=16
      local.get 1
      i32.const 8
      i32.add
      local.get 3
      i32.store
      local.get 1
      local.get 7
      i64.store align=4
    end
    local.get 1
    i64.load align=4
    local.set 7
    local.get 1
    i64.const 4294967296
    i64.store align=4
    local.get 2
    i32.const 8
    i32.add
    local.tee 3
    local.get 1
    i32.const 8
    i32.add
    local.tee 1
    i32.load
    i32.store
    local.get 1
    i32.const 0
    i32.store
    local.get 2
    local.get 7
    i64.store
    i32.const 12
    call 79
    local.tee 1
    i32.eqz
    if  ;; label = @1
      i32.const 12
      call 9
      unreachable
    end
    local.get 1
    local.get 2
    i64.load
    i64.store align=4
    local.get 1
    i32.const 8
    i32.add
    local.get 3
    i32.load
    i32.store
    local.get 0
    i32.const 1052960
    i32.store offset=4
    local.get 0
    local.get 1
    i32.store
    local.get 2
    i32.const -64
    i32.sub
    global.set 0)
  (func $59 (type 3) (param $0 i32) (param $1 i32)
    (local $2 i32) (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i32) (local $7 i64) (local $scratch i32)
    global.get 0
    i32.const 48
    i32.sub
    local.tee 2
    global.set 0
    local.get 1
    i32.load
    i32.const -2147483648
    i32.eq
    if  ;; label = @1
      block (result i32)  ;; label = @2
        local.get 1
        i32.load offset=12
        local.set 8
        local.get 2
        i32.const 0
        i32.store offset=20
        local.get 2
        i64.const 4294967296
        i64.store offset=12 align=4
        local.get 8
      end
      i32.load
      local.tee 3
      i64.load offset=16 align=4
      local.set 7
      local.get 3
      i32.load offset=12
      local.set 4
      local.get 3
      i32.load offset=8
      local.set 5
      local.get 3
      i32.load
      local.set 6
      local.get 3
      i32.load offset=4
      local.set 3
      local.get 2
      local.get 7
      i64.store offset=40 align=4
      local.get 2
      local.get 4
      i32.store offset=36
      local.get 2
      local.get 5
      i32.store offset=32
      local.get 2
      local.get 3
      i32.store offset=28
      local.get 2
      local.get 6
      i32.store offset=24
      local.get 2
      i32.const 12
      i32.add
      i32.const 1052460
      local.get 2
      i32.const 24
      i32.add
      call 7
      drop
      local.get 2
      i32.const 8
      i32.add
      local.get 2
      i32.const 20
      i32.add
      i32.load
      local.tee 3
      i32.store
      local.get 2
      local.get 2
      i64.load offset=12 align=4
      local.tee 7
      i64.store
      local.get 1
      i32.const 8
      i32.add
      local.get 3
      i32.store
      local.get 1
      local.get 7
      i64.store align=4
    end
    local.get 0
    i32.const 1052960
    i32.store offset=4
    local.get 0
    local.get 1
    i32.store
    local.get 2
    i32.const 48
    i32.add
    global.set 0)
  (func $60 (type 2) (param $0 i32)
    local.get 0
    i32.load
    if  ;; label = @1
      local.get 0
      i32.load offset=4
      call 80
    end)
  (func $61 (type 3) (param $0 i32) (param $1 i32)
    local.get 0
    i32.const 8
    i32.add
    i32.const 1050224
    i64.load align=4
    i64.store align=4
    local.get 0
    i32.const 1050216
    i64.load align=4
    i64.store align=4)
  (func $62 (type 1) (param $0 i32) (param $1 i32) (param $2 i32) (result i32)
    (local $3 i32)
    local.get 0
    i32.load
    local.get 0
    i32.load offset=8
    local.tee 3
    i32.sub
    local.get 2
    i32.lt_u
    if  ;; label = @1
      local.get 0
      local.get 3
      local.get 2
      call 45
      local.get 0
      i32.load offset=8
      local.set 3
    end
    local.get 2
    if  ;; label = @1
      local.get 0
      i32.load offset=4
      local.get 3
      i32.add
      local.get 1
      local.get 2
      memory.copy
    end
    local.get 0
    local.get 2
    local.get 3
    i32.add
    i32.store offset=8
    i32.const 0)
  (func $63 (type 0) (param $0 i32) (param $1 i32) (result i32)
    (local $2 i32) (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i32) (local $7 i32)
    local.get 0
    i32.load offset=8
    local.tee 4
    local.set 2
    block (result i32)  ;; label = @1
      i32.const 1
      local.get 1
      i32.const 128
      i32.lt_u
      br_if 0 (;@1;)
      drop
      i32.const 2
      local.get 1
      i32.const 2048
      i32.lt_u
      br_if 0 (;@1;)
      drop
      i32.const 3
      i32.const 4
      local.get 1
      i32.const 65536
      i32.lt_u
      select
    end
    local.tee 6
    local.get 0
    i32.load
    local.get 4
    i32.sub
    i32.gt_u
    if (result i32)  ;; label = @1
      local.get 0
      local.get 4
      local.get 6
      call 45
      local.get 0
      i32.load offset=8
    else
      local.get 2
    end
    local.get 0
    i32.load offset=4
    i32.add
    local.set 2
    block  ;; label = @1
      local.get 1
      i32.const 128
      i32.ge_u
      if  ;; label = @2
        local.get 1
        i32.const 63
        i32.and
        i32.const -128
        i32.or
        local.set 5
        local.get 1
        i32.const 6
        i32.shr_u
        local.set 3
        local.get 1
        i32.const 2048
        i32.lt_u
        if  ;; label = @3
          local.get 2
          local.get 5
          i32.store8 offset=1
          local.get 2
          local.get 3
          i32.const 192
          i32.or
          i32.store8
          br 2 (;@1;)
        end
        local.get 1
        i32.const 12
        i32.shr_u
        local.set 7
        local.get 3
        i32.const 63
        i32.and
        i32.const -128
        i32.or
        local.set 3
        local.get 1
        i32.const 65535
        i32.le_u
        if  ;; label = @3
          local.get 2
          local.get 5
          i32.store8 offset=2
          local.get 2
          local.get 3
          i32.store8 offset=1
          local.get 2
          local.get 7
          i32.const 224
          i32.or
          i32.store8
          br 2 (;@1;)
        end
        local.get 2
        local.get 5
        i32.store8 offset=3
        local.get 2
        local.get 3
        i32.store8 offset=2
        local.get 2
        local.get 7
        i32.const 63
        i32.and
        i32.const -128
        i32.or
        i32.store8 offset=1
        local.get 2
        local.get 1
        i32.const 18
        i32.shr_u
        i32.const -16
        i32.or
        i32.store8
        br 1 (;@1;)
      end
      local.get 2
      local.get 1
      i32.store8
    end
    local.get 0
    local.get 4
    local.get 6
    i32.add
    i32.store offset=8
    i32.const 0)
  (func $64 (type 0) (param $0 i32) (param $1 i32) (result i32)
    local.get 1
    i32.load offset=4
    drop
    local.get 0
    i32.const 1052460
    local.get 1
    call 7)
  (func $65 (type 0) (param $0 i32) (param $1 i32) (result i32)
    (local $2 i32) (local $3 i32) (local $4 i32) (local $scratch i32)
    global.get 0
    i32.const 16
    i32.sub
    local.tee 3
    global.set 0
    block (result i32)  ;; label = @1
      block  ;; label = @2
        local.get 1
        i32.load offset=8
        local.tee 2
        i32.const 33554432
        i32.and
        i32.eqz
        if  ;; label = @3
          local.get 2
          i32.const 67108864
          i32.and
          br_if 1 (;@2;)
          i32.const 3
          local.set 2
          local.get 0
          i32.load8_u
          local.tee 0
          local.set 4
          local.get 0
          i32.const 10
          i32.ge_u
          if  ;; label = @4
            local.get 3
            local.get 0
            local.get 0
            i32.const 100
            i32.div_u
            local.tee 4
            i32.const 100
            i32.mul
            i32.sub
            i32.const 255
            i32.and
            i32.const 1
            i32.shl
            i32.load16_u offset=1048653 align=1
            i32.store16 offset=12 align=1
            i32.const 1
            local.set 2
          end
          i32.const 0
          local.get 0
          local.get 4
          select
          i32.eqz
          if  ;; label = @4
            local.get 2
            i32.const 1
            i32.sub
            local.tee 2
            local.get 3
            i32.const 11
            i32.add
            i32.add
            local.get 4
            i32.const 1
            i32.shl
            i32.load8_u offset=1048654
            i32.store8
          end
          local.get 1
          i32.const 1
          i32.const 1
          i32.const 0
          local.get 3
          i32.const 11
          i32.add
          local.get 2
          i32.add
          i32.const 3
          local.get 2
          i32.sub
          call 21
          br 2 (;@1;)
        end
        local.get 0
        i32.load8_u
        local.set 2
        i32.const 3
        local.set 0
        loop  ;; label = @3
          local.get 0
          local.get 3
          i32.add
          i32.const 7
          i32.add
          local.get 2
          i32.const 15
          i32.and
          i32.const 1048853
          i32.add
          i32.load8_u
          i32.store8
          local.get 2
          i32.const 255
          i32.and
          local.tee 4
          i32.const 4
          i32.shr_u
          local.set 2
          local.get 0
          i32.const 1
          i32.sub
          local.set 0
          local.get 4
          i32.const 15
          i32.gt_u
          br_if 0 (;@3;)
        end
        local.get 1
        i32.const 1
        i32.const 1048869
        i32.const 2
        local.get 0
        local.get 3
        i32.add
        i32.const 8
        i32.add
        i32.const 3
        local.get 0
        i32.sub
        call 21
        br 1 (;@1;)
      end
      local.get 0
      i32.load8_u
      local.set 2
      i32.const 3
      local.set 0
      loop  ;; label = @2
        local.get 0
        local.get 3
        i32.add
        i32.const 12
        i32.add
        local.get 2
        i32.const 15
        i32.and
        i32.const 1048871
        i32.add
        i32.load8_u
        i32.store8
        local.get 2
        i32.const 255
        i32.and
        local.tee 4
        i32.const 4
        i32.shr_u
        local.set 2
        local.get 0
        i32.const 1
        i32.sub
        local.set 0
        local.get 4
        i32.const 15
        i32.gt_u
        br_if 0 (;@2;)
      end
      local.get 1
      i32.const 1
      i32.const 1048869
      i32.const 2
      local.get 0
      local.get 3
      i32.add
      i32.const 13
      i32.add
      i32.const 3
      local.get 0
      i32.sub
      call 21
    end
    local.set 5
    local.get 3
    i32.const 16
    i32.add
    global.set 0
    local.get 5)
  (func $66 (type 0) (param $0 i32) (param $1 i32) (result i32)
    (local $2 i32) (local $3 i32) (local $4 i32) (local $scratch i32) (local $scratch_6 i32) (local $scratch_7 i32)
    global.get 0
    i32.const 16
    i32.sub
    local.tee 3
    global.set 0
    block (result i32)  ;; label = @1
      block  ;; label = @2
        local.get 1
        i32.load offset=8
        local.tee 2
        i32.const 33554432
        i32.and
        i32.eqz
        if  ;; label = @3
          local.get 2
          i32.const 67108864
          i32.and
          br_if 1 (;@2;)
          local.get 0
          local.get 1
          call 23
          br 2 (;@1;)
        end
        local.get 0
        i32.load
        local.set 0
        i32.const 9
        local.set 2
        loop  ;; label = @3
          local.get 2
          local.get 3
          i32.add
          i32.const 6
          i32.add
          local.get 0
          i32.const 15
          i32.and
          i32.load8_u offset=1048853
          i32.store8
          local.get 2
          i32.const 1
          i32.sub
          local.set 2
          block (result i32)  ;; label = @4
            local.get 0
            i32.const 15
            i32.gt_u
            local.set 5
            local.get 0
            i32.const 4
            i32.shr_u
            local.set 0
            local.get 5
          end
          br_if 0 (;@3;)
        end
        local.get 1
        i32.const 1
        i32.const 1048869
        i32.const 2
        local.get 2
        local.get 3
        i32.add
        i32.const 7
        i32.add
        i32.const 9
        local.get 2
        i32.sub
        call 21
        br 1 (;@1;)
      end
      local.get 0
      i32.load
      local.set 0
      i32.const 9
      local.set 2
      loop  ;; label = @2
        local.get 2
        local.get 3
        i32.add
        i32.const 6
        i32.add
        local.get 0
        i32.const 15
        i32.and
        i32.load8_u offset=1048871
        i32.store8
        local.get 2
        i32.const 1
        i32.sub
        local.set 2
        block (result i32)  ;; label = @3
          local.get 0
          i32.const 15
          i32.gt_u
          local.set 6
          local.get 0
          i32.const 4
          i32.shr_u
          local.set 0
          local.get 6
        end
        br_if 0 (;@2;)
      end
      local.get 1
      i32.const 1
      i32.const 1048869
      i32.const 2
      local.get 2
      local.get 3
      i32.add
      i32.const 7
      i32.add
      i32.const 9
      local.get 2
      i32.sub
      call 21
    end
    local.set 7
    local.get 3
    i32.const 16
    i32.add
    global.set 0
    local.get 7)
  (func $67 (type 0) (param $0 i32) (param $1 i32) (result i32)
    (local $2 i32) (local $3 i32) (local $4 i32)
    global.get 0
    i32.const 16
    i32.sub
    local.tee 2
    global.set 0
    local.get 2
    local.get 0
    i32.const 4
    i32.add
    i32.store offset=4
    local.get 1
    i32.load
    i32.const 1052848
    i32.const 9
    local.get 1
    i32.load offset=4
    i32.load offset=12
    call_indirect (type 1)
    local.set 3
    local.get 2
    i32.const 0
    i32.store8 offset=13
    local.get 2
    local.get 3
    i32.store8 offset=12
    local.get 2
    local.get 1
    i32.store offset=8
    local.get 2
    i32.const 8
    i32.add
    i32.const 1052857
    i32.const 11
    local.get 0
    i32.const 13
    call 30
    i32.const 1052868
    i32.const 9
    local.get 2
    i32.const 4
    i32.add
    i32.const 14
    call 30
    local.set 0
    local.get 2
    i32.load8_u offset=13
    local.tee 3
    local.get 2
    i32.load8_u offset=12
    local.tee 4
    i32.or
    local.set 1
    block  ;; label = @1
      local.get 3
      i32.const 1
      i32.ne
      br_if 0 (;@1;)
      local.get 4
      i32.const 1
      i32.and
      br_if 0 (;@1;)
      local.get 0
      i32.load
      local.tee 0
      i32.load8_u offset=10
      i32.const 128
      i32.and
      i32.eqz
      if  ;; label = @2
        local.get 0
        i32.load
        i32.const 1048927
        i32.const 2
        local.get 0
        i32.load offset=4
        i32.load offset=12
        call_indirect (type 1)
        local.set 1
        br 1 (;@1;)
      end
      local.get 0
      i32.load
      i32.const 1048926
      i32.const 1
      local.get 0
      i32.load offset=4
      i32.load offset=12
      call_indirect (type 1)
      local.set 1
    end
    local.get 2
    i32.const 16
    i32.add
    global.set 0
    local.get 1
    i32.const 1
    i32.and)
  (func $68 (type 0) (param $0 i32) (param $1 i32) (result i32)
    (local $2 i32) (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i32)
    global.get 0
    i32.const 32
    i32.sub
    local.tee 2
    global.set 0
    i32.const 1
    local.set 3
    block  ;; label = @1
      local.get 0
      i32.load
      local.tee 4
      i32.load8_u
      i32.const 1
      i32.eq
      if  ;; label = @2
        local.get 1
        i32.load
        local.tee 0
        i32.const 1052881
        i32.const 4
        local.get 1
        i32.load offset=4
        local.tee 6
        i32.load offset=12
        local.tee 5
        call_indirect (type 1)
        br_if 1 (;@1;)
        local.get 4
        i32.const 1
        i32.add
        local.set 4
        block  ;; label = @3
          local.get 1
          i32.load8_u offset=10
          i32.const 128
          i32.and
          i32.eqz
          if  ;; label = @4
            local.get 0
            i32.const 1048891
            i32.const 1
            local.get 5
            call_indirect (type 1)
            br_if 3 (;@1;)
            local.get 4
            local.get 1
            call 69
            br_if 3 (;@1;)
            local.get 1
            i32.load
            local.set 0
            local.get 1
            i32.load offset=4
            i32.load offset=12
            local.set 5
            br 1 (;@3;)
          end
          local.get 0
          i32.const 1048892
          i32.const 2
          local.get 5
          call_indirect (type 1)
          br_if 2 (;@1;)
          local.get 2
          i32.const 1
          i32.store8 offset=15
          local.get 2
          local.get 6
          i32.store offset=4
          local.get 2
          local.get 0
          i32.store
          local.get 2
          i32.const 1048896
          i32.store offset=20
          local.get 2
          local.get 1
          i64.load offset=8 align=4
          i64.store offset=24 align=4
          local.get 2
          local.get 2
          i32.const 15
          i32.add
          i32.store offset=8
          local.get 2
          local.get 2
          i32.store offset=16
          local.get 4
          local.get 2
          i32.const 16
          i32.add
          call 69
          br_if 2 (;@1;)
          local.get 2
          i32.load offset=16
          i32.const 1048889
          i32.const 2
          local.get 2
          i32.load offset=20
          i32.load offset=12
          call_indirect (type 1)
          br_if 2 (;@1;)
        end
        local.get 0
        i32.const 1052807
        i32.const 1
        local.get 5
        call_indirect (type 1)
        local.set 3
        br 1 (;@1;)
      end
      local.get 1
      i32.load
      i32.const 1052877
      i32.const 4
      local.get 1
      i32.load offset=4
      i32.load offset=12
      call_indirect (type 1)
      local.set 3
    end
    local.get 2
    i32.const 32
    i32.add
    global.set 0
    local.get 3)
  (func $69 (type 0) (param $0 i32) (param $1 i32) (result i32)
    local.get 1
    local.get 0
    i32.load offset=4
    local.get 0
    i32.load offset=8
    call 20)
  (func $70 (type 4) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32)
    (local $4 i32) (local $5 i32) (local $6 i32) (local $7 i32) (local $8 i32) (local $9 i32) (local $10 i32) (local $11 i32) (local $12 i32) (local $13 i32) (local $14 i64) (local $scratch i32)
    global.get 0
    i32.const 32
    i32.sub
    local.tee 6
    global.set 0
    block  ;; label = @1
      block  ;; label = @2
        block  ;; label = @3
          block  ;; label = @4
            block  ;; label = @5
              block  ;; label = @6
                block  ;; label = @7
                  block  ;; label = @8
                    block  ;; label = @9
                      block  ;; label = @10
                        local.get 1
                        i32.load offset=16
                        i32.eqz
                        if  ;; label = @11
                          local.get 1
                          i32.const -1
                          i32.store offset=16
                          local.get 3
                          local.get 3
                          local.get 2
                          i32.const 3
                          i32.add
                          i32.const -4
                          i32.and
                          local.get 2
                          i32.sub
                          local.tee 7
                          i32.sub
                          i32.const 7
                          i32.and
                          i32.const 0
                          local.get 3
                          local.get 7
                          i32.ge_u
                          select
                          local.tee 5
                          i32.sub
                          local.set 8
                          local.get 3
                          local.get 5
                          i32.lt_u
                          br_if 1 (;@10;)
                          local.get 7
                          local.get 3
                          local.get 3
                          local.get 7
                          i32.gt_u
                          select
                          local.set 11
                          local.get 2
                          local.get 3
                          i32.add
                          local.set 7
                          block  ;; label = @12
                            block  ;; label = @13
                              block (result i32)  ;; label = @14
                                block  ;; label = @15
                                  loop  ;; label = @16
                                    local.get 4
                                    local.get 5
                                    i32.add
                                    i32.eqz
                                    br_if 1 (;@15;)
                                    local.get 4
                                    i32.const 1
                                    i32.sub
                                    local.tee 4
                                    local.get 7
                                    i32.add
                                    i32.load8_u
                                    i32.const 10
                                    i32.ne
                                    br_if 0 (;@16;)
                                  end
                                  local.get 4
                                  local.get 5
                                  i32.add
                                  i32.const 1
                                  i32.add
                                  local.get 8
                                  i32.add
                                  br 1 (;@14;)
                                end
                                i32.const 0
                                local.get 5
                                i32.sub
                                local.set 10
                                local.get 2
                                i32.const 4
                                i32.sub
                                local.set 12
                                local.get 5
                                i32.const -1
                                i32.xor
                                local.get 2
                                i32.add
                                local.set 7
                                loop  ;; label = @15
                                  block  ;; label = @16
                                    local.get 7
                                    local.set 5
                                    local.get 10
                                    local.set 4
                                    local.get 8
                                    local.tee 9
                                    local.get 11
                                    i32.le_u
                                    br_if 0 (;@16;)
                                    local.get 4
                                    i32.const 8
                                    i32.sub
                                    local.set 10
                                    local.get 5
                                    i32.const 8
                                    i32.sub
                                    local.set 7
                                    i32.const 16843008
                                    local.get 2
                                    local.get 8
                                    i32.const 8
                                    i32.sub
                                    local.tee 8
                                    i32.add
                                    i32.load
                                    local.tee 13
                                    i32.const 168430090
                                    i32.xor
                                    i32.sub
                                    local.get 13
                                    i32.or
                                    i32.const 16843008
                                    local.get 9
                                    local.get 12
                                    i32.add
                                    i32.load
                                    local.tee 13
                                    i32.const 168430090
                                    i32.xor
                                    i32.sub
                                    local.get 13
                                    i32.or
                                    i32.and
                                    i32.const -2139062144
                                    i32.and
                                    i32.const -2139062144
                                    i32.eq
                                    br_if 1 (;@15;)
                                  end
                                end
                                local.get 3
                                local.get 9
                                i32.lt_u
                                br_if 5 (;@9;)
                                loop  ;; label = @15
                                  local.get 3
                                  local.get 4
                                  i32.add
                                  i32.eqz
                                  br_if 2 (;@13;)
                                  local.get 4
                                  i32.const 1
                                  i32.sub
                                  local.set 4
                                  block (result i32)  ;; label = @16
                                    local.get 3
                                    local.get 5
                                    i32.add
                                    local.set 15
                                    local.get 5
                                    i32.const 1
                                    i32.sub
                                    local.set 5
                                    local.get 15
                                  end
                                  i32.load8_u
                                  i32.const 10
                                  i32.ne
                                  br_if 0 (;@15;)
                                end
                                local.get 3
                                local.get 4
                                i32.add
                                i32.const 1
                                i32.add
                              end
                              local.tee 7
                              local.get 3
                              i32.le_u
                              br_if 1 (;@12;)
                              local.get 6
                              i32.const 0
                              i32.store offset=16
                              local.get 6
                              i32.const 1
                              i32.store offset=4
                              local.get 6
                              i32.const 1051256
                              i32.store
                              local.get 6
                              i64.const 4
                              i64.store offset=8 align=4
                              local.get 6
                              i32.const 1052944
                              call 8
                              unreachable
                            end
                            local.get 1
                            i32.load offset=28
                            local.tee 5
                            i32.eqz
                            if  ;; label = @13
                              i32.const 0
                              local.set 5
                              br 10 (;@3;)
                            end
                            local.get 1
                            i32.load offset=24
                            local.tee 9
                            local.get 5
                            i32.add
                            i32.const 1
                            i32.sub
                            i32.load8_u
                            i32.const 10
                            i32.ne
                            br_if 9 (;@3;)
                            i32.const 0
                            local.set 4
                            loop  ;; label = @13
                              local.get 6
                              local.get 5
                              local.get 4
                              i32.sub
                              local.tee 7
                              i32.store offset=28
                              local.get 6
                              local.get 4
                              local.get 9
                              i32.add
                              local.tee 11
                              i32.store offset=24
                              local.get 6
                              i32.const 1
                              local.get 6
                              i32.const 24
                              i32.add
                              i32.const 1
                              call 15
                              block  ;; label = @14
                                block  ;; label = @15
                                  block (result i64)  ;; label = @16
                                    block (result i32)  ;; label = @17
                                      local.get 6
                                      i32.load16_u
                                      i32.const 1
                                      i32.eq
                                      if  ;; label = @18
                                        local.get 7
                                        local.get 6
                                        i32.load16_u offset=2
                                        local.tee 10
                                        i32.const 8
                                        i32.eq
                                        br_if 1 (;@17;)
                                        drop
                                        local.get 1
                                        i32.const 0
                                        i32.store8 offset=32
                                        local.get 10
                                        i32.const 27
                                        i32.eq
                                        br_if 4 (;@14;)
                                        local.get 10
                                        i64.extend_i32_u
                                        i64.const 32
                                        i64.shl
                                        br 2 (;@16;)
                                      end
                                      local.get 6
                                      i32.load offset=4
                                    end
                                    local.set 8
                                    local.get 1
                                    i32.const 0
                                    i32.store8 offset=32
                                    local.get 8
                                    br_if 1 (;@15;)
                                    i64.const 4516226831220738
                                  end
                                  local.set 14
                                  local.get 4
                                  if  ;; label = @16
                                    local.get 7
                                    if  ;; label = @17
                                      local.get 9
                                      local.get 11
                                      local.get 7
                                      memory.copy
                                    end
                                    local.get 1
                                    local.get 7
                                    i32.store offset=28
                                  end
                                  local.get 14
                                  i64.const 255
                                  i64.and
                                  i64.const 4
                                  i64.ne
                                  br_if 7 (;@8;)
                                  local.get 1
                                  i32.load offset=28
                                  local.set 5
                                  br 12 (;@3;)
                                end
                                local.get 4
                                local.get 8
                                i32.add
                                local.set 4
                              end
                              local.get 4
                              local.get 5
                              i32.lt_u
                              br_if 0 (;@13;)
                            end
                            br 8 (;@4;)
                          end
                          local.get 1
                          i32.load offset=28
                          local.tee 5
                          i32.eqz
                          if  ;; label = @12
                            local.get 7
                            i32.eqz
                            br_if 7 (;@5;)
                            local.get 2
                            local.set 5
                            local.get 7
                            local.set 4
                            loop  ;; label = @13
                              local.get 6
                              local.get 4
                              i32.store offset=28
                              local.get 6
                              local.get 5
                              i32.store offset=24
                              local.get 6
                              i32.const 1
                              local.get 6
                              i32.const 24
                              i32.add
                              i32.const 1
                              call 15
                              block  ;; label = @14
                                block  ;; label = @15
                                  block (result i64)  ;; label = @16
                                    local.get 6
                                    i32.load16_u
                                    i32.const 1
                                    i32.eq
                                    if  ;; label = @17
                                      local.get 6
                                      i64.load16_u offset=2
                                      local.tee 14
                                      i64.const 27
                                      i64.eq
                                      br_if 3 (;@14;)
                                      local.get 14
                                      i64.const 32
                                      i64.shl
                                      br 1 (;@16;)
                                    end
                                    local.get 6
                                    i32.load offset=4
                                    local.tee 8
                                    br_if 1 (;@15;)
                                    i32.const 1050472
                                    i64.load
                                  end
                                  local.tee 14
                                  i64.const 255
                                  i64.and
                                  i64.const 4
                                  i64.eq
                                  br_if 10 (;@5;)
                                  local.get 14
                                  i64.const -4294967041
                                  i64.and
                                  i64.const 34359738368
                                  i64.eq
                                  br_if 10 (;@5;)
                                  local.get 0
                                  local.get 14
                                  i64.store align=4
                                  br 13 (;@2;)
                                end
                                local.get 4
                                local.get 8
                                i32.lt_u
                                br_if 7 (;@7;)
                                local.get 5
                                local.get 8
                                i32.add
                                local.set 5
                                local.get 4
                                local.get 8
                                i32.sub
                                local.set 4
                              end
                              local.get 4
                              br_if 0 (;@13;)
                            end
                            br 7 (;@5;)
                          end
                          block  ;; label = @12
                            block  ;; label = @13
                              local.get 1
                              i32.load offset=20
                              local.get 5
                              i32.sub
                              local.get 7
                              i32.le_u
                              if  ;; label = @14
                                local.get 6
                                local.get 1
                                i32.const 20
                                i32.add
                                local.get 2
                                local.get 7
                                call 75
                                local.get 6
                                i32.load8_u
                                i32.const 4
                                i32.eq
                                br_if 1 (;@13;)
                                local.get 0
                                local.get 6
                                i64.load
                                i64.store align=4
                                br 12 (;@2;)
                              end
                              local.get 7
                              if  ;; label = @14
                                local.get 1
                                i32.load offset=24
                                local.get 5
                                i32.add
                                local.get 2
                                local.get 7
                                memory.copy
                              end
                              local.get 1
                              local.get 5
                              local.get 7
                              i32.add
                              local.tee 8
                              i32.store offset=28
                              br 1 (;@12;)
                            end
                            local.get 1
                            i32.load offset=28
                            local.set 8
                          end
                          local.get 8
                          i32.eqz
                          br_if 6 (;@5;)
                          local.get 1
                          i32.load offset=24
                          local.set 10
                          i32.const 0
                          local.set 4
                          loop  ;; label = @12
                            local.get 6
                            local.get 8
                            local.get 4
                            i32.sub
                            local.tee 9
                            i32.store offset=28
                            local.get 6
                            local.get 4
                            local.get 10
                            i32.add
                            local.tee 12
                            i32.store offset=24
                            local.get 6
                            i32.const 1
                            local.get 6
                            i32.const 24
                            i32.add
                            i32.const 1
                            call 15
                            block  ;; label = @13
                              block  ;; label = @14
                                block (result i64)  ;; label = @15
                                  block (result i32)  ;; label = @16
                                    local.get 6
                                    i32.load16_u
                                    i32.const 1
                                    i32.eq
                                    if  ;; label = @17
                                      local.get 9
                                      local.get 6
                                      i32.load16_u offset=2
                                      local.tee 11
                                      i32.const 8
                                      i32.eq
                                      br_if 1 (;@16;)
                                      drop
                                      local.get 1
                                      i32.const 0
                                      i32.store8 offset=32
                                      local.get 11
                                      i32.const 27
                                      i32.eq
                                      br_if 4 (;@13;)
                                      local.get 11
                                      i64.extend_i32_u
                                      i64.const 32
                                      i64.shl
                                      br 2 (;@15;)
                                    end
                                    local.get 6
                                    i32.load offset=4
                                  end
                                  local.set 5
                                  local.get 1
                                  i32.const 0
                                  i32.store8 offset=32
                                  local.get 5
                                  br_if 1 (;@14;)
                                  i64.const 4516226831220738
                                end
                                local.set 14
                                local.get 4
                                if  ;; label = @15
                                  local.get 9
                                  if  ;; label = @16
                                    local.get 10
                                    local.get 12
                                    local.get 9
                                    memory.copy
                                  end
                                  local.get 1
                                  local.get 9
                                  i32.store offset=28
                                end
                                local.get 14
                                i64.const 255
                                i64.and
                                i64.const 4
                                i64.eq
                                br_if 9 (;@5;)
                                local.get 0
                                local.get 14
                                i64.store align=4
                                br 12 (;@2;)
                              end
                              local.get 4
                              local.get 5
                              i32.add
                              local.set 4
                            end
                            local.get 4
                            local.get 8
                            i32.lt_u
                            br_if 0 (;@12;)
                          end
                          br 5 (;@6;)
                        end
                        i32.const 1052832
                        call 16
                        unreachable
                      end
                      local.get 8
                      local.get 3
                      local.get 3
                      i32.const 1049988
                      call 17
                      unreachable
                    end
                    i32.const 0
                    local.get 9
                    local.get 3
                    i32.const 1050004
                    call 17
                    unreachable
                  end
                  local.get 0
                  local.get 14
                  i64.store align=4
                  br 5 (;@2;)
                end
                local.get 8
                local.get 4
                local.get 4
                i32.const 1050480
                call 17
                unreachable
              end
              local.get 4
              local.get 8
              i32.le_u
              if  ;; label = @6
                local.get 1
                i32.const 0
                i32.store offset=28
                br 1 (;@5;)
              end
              i32.const 0
              local.get 4
              local.get 8
              i32.const 1052764
              call 17
              unreachable
            end
            local.get 2
            local.get 7
            i32.add
            local.set 5
            local.get 3
            local.get 7
            i32.sub
            local.tee 2
            local.get 1
            i32.load offset=20
            local.get 1
            i32.load offset=28
            local.tee 3
            i32.sub
            i32.ge_u
            if  ;; label = @5
              local.get 0
              local.get 1
              i32.const 20
              i32.add
              local.get 5
              local.get 2
              call 75
              br 3 (;@2;)
            end
            local.get 2
            if  ;; label = @5
              local.get 1
              i32.load offset=24
              local.get 3
              i32.add
              local.get 5
              local.get 2
              memory.copy
            end
            local.get 0
            i32.const 4
            i32.store8
            local.get 1
            local.get 2
            local.get 3
            i32.add
            i32.store offset=28
            br 2 (;@2;)
          end
          local.get 4
          local.get 5
          i32.gt_u
          br_if 2 (;@1;)
          i32.const 0
          local.set 5
          local.get 1
          i32.const 0
          i32.store offset=28
        end
        local.get 1
        i32.load offset=20
        local.get 5
        i32.sub
        local.get 3
        i32.le_u
        if  ;; label = @3
          local.get 0
          local.get 1
          i32.const 20
          i32.add
          local.get 2
          local.get 3
          call 75
          br 1 (;@2;)
        end
        local.get 3
        if  ;; label = @3
          local.get 1
          i32.load offset=24
          local.get 5
          i32.add
          local.get 2
          local.get 3
          memory.copy
        end
        local.get 0
        i32.const 4
        i32.store8
        local.get 1
        local.get 3
        local.get 5
        i32.add
        i32.store offset=28
      end
      local.get 1
      local.get 1
      i32.load offset=16
      i32.const 1
      i32.add
      i32.store offset=16
      local.get 6
      i32.const 32
      i32.add
      global.set 0
      return
    end
    i32.const 0
    local.get 4
    local.get 5
    i32.const 1052764
    call 17
    unreachable)
  (func $71 (type 4) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32)
    (local $4 i32) (local $5 i32) (local $6 i32) (local $7 i32) (local $8 i32) (local $9 i32) (local $10 i32) (local $11 i32) (local $12 i64) (local $13 i64)
    global.get 0
    i32.const 16
    i32.sub
    local.tee 4
    global.set 0
    block  ;; label = @1
      block  ;; label = @2
        block  ;; label = @3
          block  ;; label = @4
            local.get 3
            local.get 1
            i32.load
            local.tee 10
            local.get 1
            i32.load offset=8
            local.tee 5
            i32.sub
            i32.le_u
            br_if 0 (;@4;)
            local.get 5
            i32.eqz
            if  ;; label = @5
              i32.const 0
              local.set 5
              br 1 (;@4;)
            end
            local.get 1
            i32.load offset=4
            local.set 9
            loop  ;; label = @5
              local.get 4
              local.get 5
              local.get 7
              i32.sub
              local.tee 6
              i32.store offset=4
              local.get 4
              local.get 7
              local.get 9
              i32.add
              local.tee 11
              i32.store
              local.get 4
              i32.const 8
              i32.add
              i32.const 1
              local.get 4
              i32.const 1
              call 15
              block  ;; label = @6
                block  ;; label = @7
                  block (result i64)  ;; label = @8
                    block (result i32)  ;; label = @9
                      local.get 4
                      i32.load16_u offset=8
                      i32.const 1
                      i32.eq
                      if  ;; label = @10
                        local.get 6
                        local.get 4
                        i32.load16_u offset=10
                        local.tee 8
                        i32.const 8
                        i32.eq
                        br_if 1 (;@9;)
                        drop
                        local.get 1
                        i32.const 0
                        i32.store8 offset=12
                        local.get 8
                        i32.const 27
                        i32.eq
                        br_if 4 (;@6;)
                        local.get 8
                        i64.extend_i32_u
                        i64.const 32
                        i64.shl
                        br 2 (;@8;)
                      end
                      local.get 4
                      i32.load offset=12
                    end
                    local.set 8
                    local.get 1
                    i32.const 0
                    i32.store8 offset=12
                    local.get 8
                    br_if 1 (;@7;)
                    i64.const 4516226831220738
                  end
                  local.set 12
                  local.get 7
                  if  ;; label = @8
                    local.get 6
                    if  ;; label = @9
                      local.get 9
                      local.get 11
                      local.get 6
                      memory.copy
                    end
                    local.get 1
                    local.get 6
                    i32.store offset=8
                    local.get 6
                    local.set 5
                  end
                  local.get 12
                  i64.const 255
                  i64.and
                  i64.const 4
                  i64.eq
                  br_if 3 (;@4;)
                  local.get 0
                  local.get 12
                  i64.store align=4
                  br 4 (;@3;)
                end
                local.get 7
                local.get 8
                i32.add
                local.set 7
              end
              local.get 5
              local.get 7
              i32.gt_u
              br_if 0 (;@5;)
            end
            local.get 5
            local.get 7
            i32.lt_u
            br_if 2 (;@2;)
            i32.const 0
            local.set 5
            local.get 1
            i32.const 0
            i32.store offset=8
          end
          local.get 3
          local.get 10
          i32.lt_u
          if  ;; label = @4
            local.get 3
            if  ;; label = @5
              local.get 1
              i32.load offset=4
              local.get 5
              i32.add
              local.get 2
              local.get 3
              memory.copy
            end
            local.get 0
            i32.const 4
            i32.store8
            local.get 1
            local.get 3
            local.get 5
            i32.add
            i32.store offset=8
            br 1 (;@3;)
          end
          block  ;; label = @4
            block  ;; label = @5
              block  ;; label = @6
                local.get 3
                if  ;; label = @7
                  loop  ;; label = @8
                    local.get 4
                    local.get 3
                    i32.store offset=4
                    local.get 4
                    local.get 2
                    i32.store
                    local.get 4
                    i32.const 8
                    i32.add
                    i32.const 1
                    local.get 4
                    i32.const 1
                    call 15
                    block  ;; label = @9
                      block  ;; label = @10
                        block (result i64)  ;; label = @11
                          local.get 4
                          i32.load16_u offset=8
                          i32.const 1
                          i32.eq
                          if  ;; label = @12
                            local.get 4
                            i64.load16_u offset=10
                            local.tee 12
                            i64.const 27
                            i64.eq
                            br_if 3 (;@9;)
                            local.get 12
                            i64.const 32
                            i64.shl
                            br 1 (;@11;)
                          end
                          local.get 4
                          i32.load offset=12
                          local.tee 6
                          br_if 1 (;@10;)
                          i32.const 1050472
                          i64.load
                        end
                        local.tee 12
                        i64.const 32
                        i64.shr_u
                        local.set 13
                        local.get 12
                        i32.wrap_i64
                        i32.const 255
                        i32.and
                        local.tee 2
                        i32.const 4
                        i32.eq
                        br_if 4 (;@6;)
                        local.get 2
                        br_if 5 (;@5;)
                        local.get 13
                        i64.const 8
                        i64.ne
                        br_if 5 (;@5;)
                        i64.const 4
                        local.set 13
                        i64.const 0
                        local.set 12
                        br 6 (;@4;)
                      end
                      local.get 3
                      local.get 6
                      i32.lt_u
                      br_if 8 (;@1;)
                      local.get 2
                      local.get 6
                      i32.add
                      local.set 2
                      local.get 3
                      local.get 6
                      i32.sub
                      local.set 3
                    end
                    local.get 3
                    br_if 0 (;@8;)
                  end
                end
                i64.const 0
                local.set 12
              end
              local.get 12
              i64.const 4294967040
              i64.and
              local.get 13
              i64.const 32
              i64.shl
              i64.or
              local.set 12
              i64.const 4
              local.set 13
              br 1 (;@4;)
            end
            local.get 12
            i64.const 255
            i64.and
            local.set 13
            local.get 12
            i64.const -256
            i64.and
            local.set 12
          end
          local.get 1
          i32.const 0
          i32.store8 offset=12
          local.get 0
          local.get 12
          local.get 13
          i64.or
          i64.store align=4
        end
        local.get 4
        i32.const 16
        i32.add
        global.set 0
        return
      end
      i32.const 0
      local.get 7
      local.get 5
      i32.const 1052764
      call 17
      unreachable
    end
    local.get 6
    local.get 3
    local.get 3
    i32.const 1050480
    call 17
    unreachable)
  (func $72 (type 1) (param $0 i32) (param $1 i32) (param $2 i32) (result i32)
    (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i32)
    global.get 0
    i32.const 16
    i32.sub
    local.tee 3
    global.set 0
    local.get 3
    i32.const 8
    i32.add
    local.get 0
    i32.load offset=8
    i32.load
    local.get 1
    local.get 2
    call 74
    local.get 3
    i32.load8_u offset=8
    local.tee 4
    i32.const 4
    i32.ne
    if  ;; label = @1
      local.get 0
      i32.load offset=4
      local.set 1
      local.get 0
      i32.load8_u
      local.tee 2
      i32.const 4
      i32.le_u
      local.get 2
      i32.const 3
      i32.ne
      i32.and
      i32.eqz
      if  ;; label = @2
        local.get 1
        i32.load
        local.set 2
        local.get 1
        i32.const 4
        i32.add
        i32.load
        local.tee 5
        i32.load
        local.tee 6
        if  ;; label = @3
          local.get 2
          local.get 6
          call_indirect (type 2)
        end
        local.get 5
        i32.load offset=4
        if  ;; label = @3
          local.get 2
          call 80
        end
        local.get 1
        call 80
      end
      local.get 0
      local.get 3
      i64.load offset=8
      i64.store align=4
    end
    local.get 3
    i32.const 16
    i32.add
    global.set 0
    local.get 4
    i32.const 4
    i32.ne)
  (func $73 (type 0) (param $0 i32) (param $1 i32) (result i32)
    (local $2 i32) (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i32)
    global.get 0
    i32.const 16
    i32.sub
    local.tee 2
    global.set 0
    local.get 2
    i32.const 0
    i32.store offset=4
    block (result i32)  ;; label = @1
      local.get 1
      i32.const 128
      i32.ge_u
      if  ;; label = @2
        local.get 1
        i32.const 63
        i32.and
        i32.const -128
        i32.or
        local.set 3
        local.get 1
        i32.const 6
        i32.shr_u
        local.set 4
        local.get 1
        i32.const 2048
        i32.lt_u
        if  ;; label = @3
          local.get 2
          local.get 3
          i32.store8 offset=5
          local.get 2
          local.get 4
          i32.const 192
          i32.or
          i32.store8 offset=4
          i32.const 2
          br 2 (;@1;)
        end
        local.get 1
        i32.const 12
        i32.shr_u
        local.set 5
        local.get 4
        i32.const 63
        i32.and
        i32.const -128
        i32.or
        local.set 4
        local.get 1
        i32.const 65535
        i32.le_u
        if  ;; label = @3
          local.get 2
          local.get 3
          i32.store8 offset=6
          local.get 2
          local.get 4
          i32.store8 offset=5
          local.get 2
          local.get 5
          i32.const 224
          i32.or
          i32.store8 offset=4
          i32.const 3
          br 2 (;@1;)
        end
        local.get 2
        local.get 3
        i32.store8 offset=7
        local.get 2
        local.get 4
        i32.store8 offset=6
        local.get 2
        local.get 5
        i32.const 63
        i32.and
        i32.const -128
        i32.or
        i32.store8 offset=5
        local.get 2
        local.get 1
        i32.const 18
        i32.shr_u
        i32.const -16
        i32.or
        i32.store8 offset=4
        i32.const 4
        br 1 (;@1;)
      end
      local.get 2
      local.get 1
      i32.store8 offset=4
      i32.const 1
    end
    local.set 1
    local.get 2
    i32.const 8
    i32.add
    local.get 0
    i32.load offset=8
    i32.load
    local.get 2
    i32.const 4
    i32.add
    local.get 1
    call 74
    local.get 2
    i32.load8_u offset=8
    local.tee 4
    i32.const 4
    i32.ne
    if  ;; label = @1
      local.get 0
      i32.load offset=4
      local.set 1
      local.get 0
      i32.load8_u
      local.tee 3
      i32.const 4
      i32.le_u
      local.get 3
      i32.const 3
      i32.ne
      i32.and
      i32.eqz
      if  ;; label = @2
        local.get 1
        i32.load
        local.set 3
        local.get 1
        i32.const 4
        i32.add
        i32.load
        local.tee 5
        i32.load
        local.tee 6
        if  ;; label = @3
          local.get 3
          local.get 6
          call_indirect (type 2)
        end
        local.get 5
        i32.load offset=4
        if  ;; label = @3
          local.get 3
          call 80
        end
        local.get 1
        call 80
      end
      local.get 0
      local.get 2
      i64.load offset=8
      i64.store align=4
    end
    local.get 2
    i32.const 16
    i32.add
    global.set 0
    local.get 4
    i32.const 4
    i32.ne)
  (func $74 (type 0) (param $0 i32) (param $1 i32) (result i32)
    (local $2 i32) (local $scratch i32)
    global.get 0
    i32.const 16
    i32.sub
    local.tee 2
    global.set 0
    local.get 1
    i32.load offset=4
    drop
    local.get 0
    i32.const 1050380
    local.get 1
    call 7
    local.set 3
    local.get 2
    i32.const 16
    i32.add
    global.set 0
    local.get 3)
  (func $75 (type 5) (param $0 i32) (result i32)
    (local $1 i32) (local $2 i32) (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i32) (local $7 i32) (local $8 i32) (local $9 i32) (local $10 i32) (local $11 i32) (local $scratch i32)
    global.get 0
    i32.const 16
    i32.sub
    local.tee 10
    global.set 0
    i32.const 1055160
    i32.load
    local.tee 7
    i32.eqz
    if  ;; label = @1
      i32.const 1055608
      i32.load
      local.tee 3
      i32.eqz
      if  ;; label = @2
        i32.const 1055620
        i64.const -1
        i64.store align=4
        i32.const 1055612
        i64.const 281474976776192
        i64.store align=4
        i32.const 1055608
        local.get 10
        i32.const 8
        i32.add
        i32.const -16
        i32.and
        i32.const 1431655768
        i32.xor
        local.tee 3
        i32.store
        i32.const 1055628
        i32.const 0
        i32.store
        i32.const 1055580
        i32.const 0
        i32.store
      end
      i32.const 1055584
      i32.const 1055680
      i32.store
      i32.const 1055152
      i32.const 1055680
      i32.store
      i32.const 1055172
      local.get 3
      i32.store
      i32.const 1055168
      i32.const -1
      i32.store
      i32.const 1055588
      i32.const 58432
      i32.store
      i32.const 1055572
      i32.const 58432
      i32.store
      i32.const 1055568
      i32.const 58432
      i32.store
      loop  ;; label = @2
        local.get 1
        i32.const 1055196
        i32.add
        local.get 1
        i32.const 1055184
        i32.add
        local.tee 2
        i32.store
        local.get 2
        local.get 1
        i32.const 1055176
        i32.add
        local.tee 5
        i32.store
        local.get 1
        i32.const 1055188
        i32.add
        local.get 5
        i32.store
        local.get 1
        i32.const 1055204
        i32.add
        local.get 1
        i32.const 1055192
        i32.add
        local.tee 5
        i32.store
        local.get 5
        local.get 2
        i32.store
        local.get 1
        i32.const 1055212
        i32.add
        local.get 1
        i32.const 1055200
        i32.add
        local.tee 2
        i32.store
        local.get 2
        local.get 5
        i32.store
        local.get 1
        i32.const 1055208
        i32.add
        local.get 2
        i32.store
        local.get 1
        i32.const 32
        i32.add
        local.tee 1
        i32.const 256
        i32.ne
        br_if 0 (;@2;)
      end
      i32.const 1114060
      i32.const 56
      i32.store
      i32.const 1055164
      i32.const 1055624
      i32.load
      i32.store
      i32.const 1055160
      i32.const 1055688
      local.tee 7
      i32.store
      i32.const 1055148
      i32.const 58368
      i32.store
      i32.const 1055692
      i32.const 58369
      i32.store
    end
    block  ;; label = @1
      block  ;; label = @2
        block  ;; label = @3
          block  ;; label = @4
            block  ;; label = @5
              block  ;; label = @6
                block  ;; label = @7
                  block  ;; label = @8
                    block  ;; label = @9
                      block  ;; label = @10
                        block  ;; label = @11
                          block  ;; label = @12
                            local.get 0
                            i32.const 236
                            i32.le_u
                            if  ;; label = @13
                              i32.const 1055136
                              i32.load
                              local.tee 4
                              i32.const 16
                              local.get 0
                              i32.const 19
                              i32.add
                              i32.const 496
                              i32.and
                              local.get 0
                              i32.const 11
                              i32.lt_u
                              select
                              local.tee 6
                              i32.const 3
                              i32.shr_u
                              local.tee 0
                              i32.shr_u
                              local.tee 1
                              i32.const 3
                              i32.and
                              if  ;; label = @14
                                block  ;; label = @15
                                  local.get 1
                                  i32.const 1
                                  i32.and
                                  local.get 0
                                  i32.or
                                  i32.const 1
                                  i32.xor
                                  local.tee 2
                                  i32.const 3
                                  i32.shl
                                  local.tee 0
                                  i32.const 1055176
                                  i32.add
                                  local.tee 1
                                  local.get 0
                                  i32.const 1055184
                                  i32.add
                                  i32.load
                                  local.tee 0
                                  i32.load offset=8
                                  local.tee 5
                                  i32.eq
                                  if  ;; label = @16
                                    i32.const 1055136
                                    local.get 4
                                    i32.const -2
                                    local.get 2
                                    i32.rotl
                                    i32.and
                                    i32.store
                                    br 1 (;@15;)
                                  end
                                  local.get 1
                                  local.get 5
                                  i32.store offset=8
                                  local.get 5
                                  local.get 1
                                  i32.store offset=12
                                end
                                local.get 0
                                i32.const 8
                                i32.add
                                local.set 1
                                local.get 0
                                local.get 2
                                i32.const 3
                                i32.shl
                                local.tee 2
                                i32.const 3
                                i32.or
                                i32.store offset=4
                                local.get 0
                                local.get 2
                                i32.add
                                local.tee 0
                                local.get 0
                                i32.load offset=4
                                i32.const 1
                                i32.or
                                i32.store offset=4
                                br 13 (;@1;)
                              end
                              local.get 6
                              i32.const 1055144
                              i32.load
                              local.tee 8
                              i32.le_u
                              br_if 1 (;@12;)
                              local.get 1
                              if  ;; label = @14
                                block  ;; label = @15
                                  i32.const 2
                                  local.get 0
                                  i32.shl
                                  local.tee 2
                                  i32.const 0
                                  local.get 2
                                  i32.sub
                                  i32.or
                                  local.get 1
                                  local.get 0
                                  i32.shl
                                  i32.and
                                  i32.ctz
                                  local.tee 1
                                  i32.const 3
                                  i32.shl
                                  local.tee 0
                                  i32.const 1055176
                                  i32.add
                                  local.tee 2
                                  local.get 0
                                  i32.const 1055184
                                  i32.add
                                  i32.load
                                  local.tee 0
                                  i32.load offset=8
                                  local.tee 5
                                  i32.eq
                                  if  ;; label = @16
                                    i32.const 1055136
                                    local.get 4
                                    i32.const -2
                                    local.get 1
                                    i32.rotl
                                    i32.and
                                    local.tee 4
                                    i32.store
                                    br 1 (;@15;)
                                  end
                                  local.get 2
                                  local.get 5
                                  i32.store offset=8
                                  local.get 5
                                  local.get 2
                                  i32.store offset=12
                                end
                                local.get 0
                                local.get 6
                                i32.const 3
                                i32.or
                                i32.store offset=4
                                local.get 0
                                local.get 1
                                i32.const 3
                                i32.shl
                                local.tee 1
                                i32.add
                                local.get 1
                                local.get 6
                                i32.sub
                                local.tee 5
                                i32.store
                                local.get 0
                                local.get 6
                                i32.add
                                local.tee 3
                                local.get 5
                                i32.const 1
                                i32.or
                                i32.store offset=4
                                local.get 8
                                if  ;; label = @15
                                  local.get 8
                                  i32.const -8
                                  i32.and
                                  i32.const 1055176
                                  i32.add
                                  local.set 1
                                  i32.const 1055156
                                  i32.load
                                  local.set 2
                                  block (result i32)  ;; label = @16
                                    local.get 4
                                    i32.const 1
                                    local.get 8
                                    i32.const 3
                                    i32.shr_u
                                    i32.shl
                                    local.tee 7
                                    i32.and
                                    i32.eqz
                                    if  ;; label = @17
                                      i32.const 1055136
                                      local.get 4
                                      local.get 7
                                      i32.or
                                      i32.store
                                      local.get 1
                                      br 1 (;@16;)
                                    end
                                    local.get 1
                                    i32.load offset=8
                                  end
                                  local.tee 4
                                  local.get 2
                                  i32.store offset=12
                                  local.get 1
                                  local.get 2
                                  i32.store offset=8
                                  local.get 2
                                  local.get 1
                                  i32.store offset=12
                                  local.get 2
                                  local.get 4
                                  i32.store offset=8
                                end
                                local.get 0
                                i32.const 8
                                i32.add
                                local.set 1
                                i32.const 1055156
                                local.get 3
                                i32.store
                                i32.const 1055144
                                local.get 5
                                i32.store
                                br 13 (;@1;)
                              end
                              i32.const 1055140
                              i32.load
                              local.tee 11
                              i32.eqz
                              br_if 1 (;@12;)
                              local.get 11
                              i32.ctz
                              i32.const 2
                              i32.shl
                              i32.const 1055440
                              i32.add
                              i32.load
                              local.tee 2
                              i32.load offset=4
                              i32.const -8
                              i32.and
                              local.get 6
                              i32.sub
                              local.set 3
                              local.get 2
                              local.set 0
                              loop  ;; label = @14
                                block  ;; label = @15
                                  local.get 0
                                  i32.load offset=16
                                  local.tee 1
                                  i32.eqz
                                  if  ;; label = @16
                                    local.get 0
                                    i32.load offset=20
                                    local.tee 1
                                    i32.eqz
                                    br_if 1 (;@15;)
                                  end
                                  local.get 1
                                  i32.load offset=4
                                  i32.const -8
                                  i32.and
                                  local.get 6
                                  i32.sub
                                  local.tee 0
                                  local.get 3
                                  local.get 0
                                  local.get 3
                                  i32.lt_u
                                  local.tee 0
                                  select
                                  local.set 3
                                  local.get 1
                                  local.get 2
                                  local.get 0
                                  select
                                  local.set 2
                                  local.get 1
                                  local.set 0
                                  br 1 (;@14;)
                                end
                              end
                              local.get 2
                              i32.load offset=24
                              local.set 9
                              local.get 2
                              local.get 2
                              i32.load offset=12
                              local.tee 1
                              i32.ne
                              if  ;; label = @14
                                local.get 2
                                i32.load offset=8
                                local.tee 0
                                local.get 1
                                i32.store offset=12
                                local.get 1
                                local.get 0
                                i32.store offset=8
                                br 12 (;@2;)
                              end
                              local.get 2
                              i32.load offset=20
                              local.tee 0
                              if (result i32)  ;; label = @14
                                local.get 2
                                i32.const 20
                                i32.add
                              else
                                local.get 2
                                i32.load offset=16
                                local.tee 0
                                i32.eqz
                                br_if 3 (;@11;)
                                local.get 2
                                i32.const 16
                                i32.add
                              end
                              local.set 5
                              loop  ;; label = @14
                                local.get 5
                                local.set 7
                                local.get 0
                                local.tee 1
                                i32.const 20
                                i32.add
                                local.set 5
                                local.get 1
                                i32.load offset=20
                                local.tee 0
                                br_if 0 (;@14;)
                                local.get 1
                                i32.const 16
                                i32.add
                                local.set 5
                                local.get 1
                                i32.load offset=16
                                local.tee 0
                                br_if 0 (;@14;)
                              end
                              local.get 7
                              i32.const 0
                              i32.store
                              br 11 (;@2;)
                            end
                            i32.const -1
                            local.set 6
                            local.get 0
                            i32.const -65
                            i32.gt_u
                            br_if 0 (;@12;)
                            local.get 0
                            i32.const 19
                            i32.add
                            local.tee 1
                            i32.const -16
                            i32.and
                            local.set 6
                            i32.const 1055140
                            i32.load
                            local.tee 8
                            i32.eqz
                            br_if 0 (;@12;)
                            i32.const 31
                            local.set 9
                            i32.const 0
                            local.get 6
                            i32.sub
                            local.set 3
                            local.get 0
                            i32.const 16777196
                            i32.le_u
                            if  ;; label = @13
                              local.get 6
                              i32.const 38
                              local.get 1
                              i32.const 8
                              i32.shr_u
                              i32.clz
                              local.tee 0
                              i32.sub
                              i32.shr_u
                              i32.const 1
                              i32.and
                              local.get 0
                              i32.const 1
                              i32.shl
                              i32.sub
                              i32.const 62
                              i32.add
                              local.set 9
                            end
                            block  ;; label = @13
                              block  ;; label = @14
                                block  ;; label = @15
                                  local.get 9
                                  i32.const 2
                                  i32.shl
                                  i32.const 1055440
                                  i32.add
                                  i32.load
                                  local.tee 0
                                  i32.eqz
                                  if  ;; label = @16
                                    i32.const 0
                                    local.set 1
                                    i32.const 0
                                    local.set 5
                                    br 1 (;@15;)
                                  end
                                  i32.const 0
                                  local.set 1
                                  local.get 6
                                  i32.const 25
                                  local.get 9
                                  i32.const 1
                                  i32.shr_u
                                  i32.sub
                                  i32.const 0
                                  local.get 9
                                  i32.const 31
                                  i32.ne
                                  select
                                  i32.shl
                                  local.set 2
                                  i32.const 0
                                  local.set 5
                                  loop  ;; label = @16
                                    block  ;; label = @17
                                      local.get 0
                                      i32.load offset=4
                                      i32.const -8
                                      i32.and
                                      local.get 6
                                      i32.sub
                                      local.tee 4
                                      local.get 3
                                      i32.ge_u
                                      br_if 0 (;@17;)
                                      local.get 0
                                      local.set 5
                                      local.get 4
                                      local.tee 3
                                      br_if 0 (;@17;)
                                      i32.const 0
                                      local.set 3
                                      local.get 0
                                      local.set 1
                                      br 3 (;@14;)
                                    end
                                    local.get 1
                                    local.get 0
                                    i32.load offset=20
                                    local.tee 4
                                    local.get 4
                                    local.get 0
                                    local.get 2
                                    i32.const 29
                                    i32.shr_u
                                    i32.const 4
                                    i32.and
                                    i32.add
                                    i32.load offset=16
                                    local.tee 0
                                    i32.eq
                                    select
                                    local.get 1
                                    local.get 4
                                    select
                                    local.set 1
                                    local.get 2
                                    i32.const 1
                                    i32.shl
                                    local.set 2
                                    local.get 0
                                    br_if 0 (;@16;)
                                  end
                                end
                                local.get 1
                                local.get 5
                                i32.or
                                i32.eqz
                                if  ;; label = @15
                                  i32.const 0
                                  local.set 5
                                  i32.const 2
                                  local.get 9
                                  i32.shl
                                  local.tee 0
                                  i32.const 0
                                  local.get 0
                                  i32.sub
                                  i32.or
                                  local.get 8
                                  i32.and
                                  local.tee 0
                                  i32.eqz
                                  br_if 3 (;@12;)
                                  local.get 0
                                  i32.ctz
                                  i32.const 2
                                  i32.shl
                                  i32.const 1055440
                                  i32.add
                                  i32.load
                                  local.set 1
                                end
                                local.get 1
                                i32.eqz
                                br_if 1 (;@13;)
                              end
                              loop  ;; label = @14
                                local.get 1
                                i32.load offset=4
                                i32.const -8
                                i32.and
                                local.get 6
                                i32.sub
                                local.tee 2
                                local.get 3
                                i32.lt_u
                                local.set 0
                                local.get 2
                                local.get 3
                                local.get 0
                                select
                                local.set 3
                                local.get 1
                                local.get 5
                                local.get 0
                                select
                                local.set 5
                                local.get 1
                                i32.load offset=16
                                local.tee 0
                                if (result i32)  ;; label = @15
                                  local.get 0
                                else
                                  local.get 1
                                  i32.load offset=20
                                end
                                local.tee 1
                                br_if 0 (;@14;)
                              end
                            end
                            local.get 5
                            i32.eqz
                            br_if 0 (;@12;)
                            local.get 3
                            i32.const 1055144
                            i32.load
                            local.get 6
                            i32.sub
                            i32.ge_u
                            br_if 0 (;@12;)
                            local.get 5
                            i32.load offset=24
                            local.set 7
                            local.get 5
                            local.get 5
                            i32.load offset=12
                            local.tee 1
                            i32.ne
                            if  ;; label = @13
                              local.get 5
                              i32.load offset=8
                              local.tee 0
                              local.get 1
                              i32.store offset=12
                              local.get 1
                              local.get 0
                              i32.store offset=8
                              br 10 (;@3;)
                            end
                            local.get 5
                            i32.load offset=20
                            local.tee 0
                            if (result i32)  ;; label = @13
                              local.get 5
                              i32.const 20
                              i32.add
                            else
                              local.get 5
                              i32.load offset=16
                              local.tee 0
                              i32.eqz
                              br_if 3 (;@10;)
                              local.get 5
                              i32.const 16
                              i32.add
                            end
                            local.set 2
                            loop  ;; label = @13
                              local.get 2
                              local.set 4
                              local.get 0
                              local.tee 1
                              i32.const 20
                              i32.add
                              local.set 2
                              local.get 1
                              i32.load offset=20
                              local.tee 0
                              br_if 0 (;@13;)
                              local.get 1
                              i32.const 16
                              i32.add
                              local.set 2
                              local.get 1
                              i32.load offset=16
                              local.tee 0
                              br_if 0 (;@13;)
                            end
                            local.get 4
                            i32.const 0
                            i32.store
                            br 9 (;@3;)
                          end
                          local.get 6
                          i32.const 1055144
                          i32.load
                          local.tee 5
                          i32.le_u
                          if  ;; label = @12
                            i32.const 1055156
                            i32.load
                            local.set 1
                            block  ;; label = @13
                              local.get 5
                              local.get 6
                              i32.sub
                              local.tee 0
                              i32.const 16
                              i32.ge_u
                              if  ;; label = @14
                                local.get 1
                                local.get 6
                                i32.add
                                local.tee 2
                                local.get 0
                                i32.const 1
                                i32.or
                                i32.store offset=4
                                local.get 1
                                local.get 5
                                i32.add
                                local.get 0
                                i32.store
                                local.get 1
                                local.get 6
                                i32.const 3
                                i32.or
                                i32.store offset=4
                                br 1 (;@13;)
                              end
                              local.get 1
                              local.get 5
                              i32.const 3
                              i32.or
                              i32.store offset=4
                              local.get 1
                              local.get 5
                              i32.add
                              local.tee 0
                              local.get 0
                              i32.load offset=4
                              i32.const 1
                              i32.or
                              i32.store offset=4
                              i32.const 0
                              local.set 2
                              i32.const 0
                              local.set 0
                            end
                            i32.const 1055144
                            local.get 0
                            i32.store
                            i32.const 1055156
                            local.get 2
                            i32.store
                            local.get 1
                            i32.const 8
                            i32.add
                            local.set 1
                            br 11 (;@1;)
                          end
                          local.get 6
                          i32.const 1055148
                          i32.load
                          local.tee 2
                          i32.lt_u
                          if  ;; label = @12
                            local.get 6
                            local.get 7
                            i32.add
                            local.tee 0
                            local.get 2
                            local.get 6
                            i32.sub
                            local.tee 1
                            i32.const 1
                            i32.or
                            i32.store offset=4
                            i32.const 1055160
                            local.get 0
                            i32.store
                            i32.const 1055148
                            local.get 1
                            i32.store
                            local.get 7
                            local.get 6
                            i32.const 3
                            i32.or
                            i32.store offset=4
                            local.get 7
                            i32.const 8
                            i32.add
                            local.set 1
                            br 11 (;@1;)
                          end
                          i32.const 0
                          local.set 1
                          local.get 6
                          local.get 6
                          i32.const 71
                          i32.add
                          local.tee 5
                          block (result i32)  ;; label = @12
                            i32.const 1055608
                            i32.load
                            if  ;; label = @13
                              i32.const 1055616
                              i32.load
                              br 1 (;@12;)
                            end
                            i32.const 1055620
                            i64.const -1
                            i64.store align=4
                            i32.const 1055612
                            i64.const 281474976776192
                            i64.store align=4
                            i32.const 1055608
                            local.get 10
                            i32.const 12
                            i32.add
                            i32.const -16
                            i32.and
                            i32.const 1431655768
                            i32.xor
                            i32.store
                            i32.const 1055628
                            i32.const 0
                            i32.store
                            i32.const 1055580
                            i32.const 0
                            i32.store
                            i32.const 65536
                          end
                          local.tee 0
                          i32.add
                          local.tee 3
                          i32.const 0
                          local.get 0
                          i32.sub
                          local.tee 4
                          i32.and
                          local.tee 0
                          i32.ge_u
                          if  ;; label = @12
                            i32.const 1055632
                            i32.const 48
                            i32.store
                            br 11 (;@1;)
                          end
                          block  ;; label = @12
                            i32.const 1055576
                            i32.load
                            local.tee 1
                            i32.eqz
                            br_if 0 (;@12;)
                            i32.const 1055568
                            i32.load
                            local.tee 8
                            local.get 0
                            i32.add
                            local.tee 9
                            local.get 8
                            i32.gt_u
                            local.get 1
                            local.get 9
                            i32.ge_u
                            i32.and
                            br_if 0 (;@12;)
                            i32.const 0
                            local.set 1
                            i32.const 1055632
                            i32.const 48
                            i32.store
                            br 11 (;@1;)
                          end
                          i32.const 1055580
                          i32.load8_u
                          i32.const 4
                          i32.and
                          br_if 4 (;@7;)
                          block  ;; label = @12
                            block  ;; label = @13
                              local.get 7
                              if  ;; label = @14
                                i32.const 1055584
                                local.set 1
                                loop  ;; label = @15
                                  local.get 1
                                  i32.load
                                  local.tee 8
                                  local.get 7
                                  i32.le_u
                                  if  ;; label = @16
                                    local.get 7
                                    local.get 8
                                    local.get 1
                                    i32.load offset=4
                                    i32.add
                                    i32.lt_u
                                    br_if 3 (;@13;)
                                  end
                                  local.get 1
                                  i32.load offset=8
                                  local.tee 1
                                  br_if 0 (;@15;)
                                end
                              end
                              i32.const 0
                              call 84
                              local.tee 2
                              i32.const -1
                              i32.eq
                              br_if 5 (;@8;)
                              local.get 0
                              local.set 4
                              i32.const 1055612
                              i32.load
                              local.tee 1
                              i32.const 1
                              i32.sub
                              local.tee 3
                              local.get 2
                              i32.and
                              if  ;; label = @14
                                local.get 0
                                local.get 2
                                i32.sub
                                local.get 2
                                local.get 3
                                i32.add
                                i32.const 0
                                local.get 1
                                i32.sub
                                i32.and
                                i32.add
                                local.set 4
                              end
                              local.get 4
                              local.get 6
                              i32.le_u
                              br_if 5 (;@8;)
                              local.get 4
                              i32.const 2147483646
                              i32.gt_u
                              br_if 5 (;@8;)
                              i32.const 1055576
                              i32.load
                              local.tee 1
                              if  ;; label = @14
                                i32.const 1055568
                                i32.load
                                local.tee 3
                                local.get 4
                                i32.add
                                local.tee 7
                                local.get 3
                                i32.le_u
                                br_if 6 (;@8;)
                                local.get 1
                                local.get 7
                                i32.lt_u
                                br_if 6 (;@8;)
                              end
                              local.get 4
                              call 84
                              local.tee 1
                              local.get 2
                              i32.ne
                              br_if 1 (;@12;)
                              br 7 (;@6;)
                            end
                            local.get 3
                            local.get 2
                            i32.sub
                            local.get 4
                            i32.and
                            local.tee 4
                            i32.const 2147483646
                            i32.gt_u
                            br_if 4 (;@8;)
                            local.get 4
                            call 84
                            local.tee 2
                            local.get 1
                            i32.load
                            local.get 1
                            i32.load offset=4
                            i32.add
                            i32.eq
                            br_if 3 (;@9;)
                            local.get 2
                            local.set 1
                          end
                          block  ;; label = @12
                            local.get 4
                            local.get 6
                            i32.const 72
                            i32.add
                            i32.ge_u
                            br_if 0 (;@12;)
                            local.get 1
                            i32.const -1
                            i32.eq
                            br_if 0 (;@12;)
                            i32.const 1055616
                            i32.load
                            local.tee 2
                            local.get 5
                            local.get 4
                            i32.sub
                            i32.add
                            i32.const 0
                            local.get 2
                            i32.sub
                            i32.and
                            local.tee 2
                            i32.const 2147483646
                            i32.gt_u
                            if  ;; label = @13
                              local.get 1
                              local.set 2
                              br 7 (;@6;)
                            end
                            local.get 2
                            call 84
                            i32.const -1
                            i32.ne
                            if  ;; label = @13
                              local.get 2
                              local.get 4
                              i32.add
                              local.set 4
                              local.get 1
                              local.set 2
                              br 7 (;@6;)
                            end
                            i32.const 0
                            local.get 4
                            i32.sub
                            call 84
                            drop
                            br 4 (;@8;)
                          end
                          local.get 1
                          local.tee 2
                          i32.const -1
                          i32.ne
                          br_if 5 (;@6;)
                          br 3 (;@8;)
                        end
                        i32.const 0
                        local.set 1
                        br 8 (;@2;)
                      end
                      i32.const 0
                      local.set 1
                      br 6 (;@3;)
                    end
                    local.get 2
                    i32.const -1
                    i32.ne
                    br_if 2 (;@6;)
                  end
                  i32.const 1055580
                  i32.const 1055580
                  i32.load
                  i32.const 4
                  i32.or
                  i32.store
                end
                local.get 0
                i32.const 2147483646
                i32.gt_u
                br_if 1 (;@5;)
                local.get 0
                call 84
                local.set 2
                i32.const 0
                call 84
                local.set 0
                local.get 2
                i32.const -1
                i32.eq
                br_if 1 (;@5;)
                local.get 0
                i32.const -1
                i32.eq
                br_if 1 (;@5;)
                local.get 0
                local.get 2
                i32.le_u
                br_if 1 (;@5;)
                local.get 0
                local.get 2
                i32.sub
                local.tee 4
                local.get 6
                i32.const 56
                i32.add
                i32.le_u
                br_if 1 (;@5;)
              end
              i32.const 1055568
              i32.const 1055568
              i32.load
              local.get 4
              i32.add
              local.tee 0
              i32.store
              i32.const 1055572
              i32.load
              local.get 0
              i32.lt_u
              if  ;; label = @6
                i32.const 1055572
                local.get 0
                i32.store
              end
              block  ;; label = @6
                block  ;; label = @7
                  block  ;; label = @8
                    i32.const 1055160
                    i32.load
                    local.tee 3
                    if  ;; label = @9
                      i32.const 1055584
                      local.set 1
                      loop  ;; label = @10
                        local.get 2
                        local.get 1
                        i32.load
                        local.tee 0
                        local.get 1
                        i32.load offset=4
                        local.tee 5
                        i32.add
                        i32.eq
                        br_if 2 (;@8;)
                        local.get 1
                        i32.load offset=8
                        local.tee 1
                        br_if 0 (;@10;)
                      end
                      br 2 (;@7;)
                    end
                    i32.const 1055152
                    i32.load
                    local.tee 0
                    i32.const 0
                    local.get 0
                    local.get 2
                    i32.le_u
                    select
                    i32.eqz
                    if  ;; label = @9
                      i32.const 1055152
                      local.get 2
                      i32.store
                    end
                    i32.const 0
                    local.set 1
                    i32.const 1055588
                    local.get 4
                    i32.store
                    i32.const 1055584
                    local.get 2
                    i32.store
                    i32.const 1055168
                    i32.const -1
                    i32.store
                    i32.const 1055172
                    i32.const 1055608
                    i32.load
                    i32.store
                    i32.const 1055596
                    i32.const 0
                    i32.store
                    loop  ;; label = @9
                      local.get 1
                      i32.const 1055196
                      i32.add
                      local.get 1
                      i32.const 1055184
                      i32.add
                      local.tee 0
                      i32.store
                      local.get 0
                      local.get 1
                      i32.const 1055176
                      i32.add
                      local.tee 5
                      i32.store
                      local.get 1
                      i32.const 1055188
                      i32.add
                      local.get 5
                      i32.store
                      local.get 1
                      i32.const 1055204
                      i32.add
                      local.get 1
                      i32.const 1055192
                      i32.add
                      local.tee 5
                      i32.store
                      local.get 5
                      local.get 0
                      i32.store
                      local.get 1
                      i32.const 1055212
                      i32.add
                      local.get 1
                      i32.const 1055200
                      i32.add
                      local.tee 0
                      i32.store
                      local.get 0
                      local.get 5
                      i32.store
                      local.get 1
                      i32.const 1055208
                      i32.add
                      local.get 0
                      i32.store
                      local.get 1
                      i32.const 32
                      i32.add
                      local.tee 1
                      i32.const 256
                      i32.ne
                      br_if 0 (;@9;)
                    end
                    local.get 2
                    i32.const -8
                    local.get 2
                    i32.sub
                    i32.const 15
                    i32.and
                    local.tee 0
                    i32.add
                    local.tee 1
                    local.get 4
                    i32.const 56
                    i32.sub
                    local.tee 5
                    local.get 0
                    i32.sub
                    local.tee 0
                    i32.const 1
                    i32.or
                    i32.store offset=4
                    i32.const 1055164
                    i32.const 1055624
                    i32.load
                    i32.store
                    i32.const 1055148
                    local.get 0
                    i32.store
                    i32.const 1055160
                    local.get 1
                    i32.store
                    local.get 2
                    local.get 5
                    i32.add
                    i32.const 56
                    i32.store offset=4
                    br 2 (;@6;)
                  end
                  local.get 2
                  local.get 3
                  i32.le_u
                  br_if 0 (;@7;)
                  local.get 0
                  local.get 3
                  i32.gt_u
                  br_if 0 (;@7;)
                  local.get 1
                  i32.load offset=12
                  i32.const 8
                  i32.and
                  br_if 0 (;@7;)
                  local.get 3
                  i32.const -8
                  local.get 3
                  i32.sub
                  i32.const 15
                  i32.and
                  local.tee 0
                  i32.add
                  local.tee 2
                  i32.const 1055148
                  i32.load
                  local.get 4
                  i32.add
                  local.tee 7
                  local.get 0
                  i32.sub
                  local.tee 0
                  i32.const 1
                  i32.or
                  i32.store offset=4
                  local.get 1
                  local.get 4
                  local.get 5
                  i32.add
                  i32.store offset=4
                  i32.const 1055164
                  i32.const 1055624
                  i32.load
                  i32.store
                  i32.const 1055148
                  local.get 0
                  i32.store
                  i32.const 1055160
                  local.get 2
                  i32.store
                  local.get 3
                  local.get 7
                  i32.add
                  i32.const 56
                  i32.store offset=4
                  br 1 (;@6;)
                end
                i32.const 1055152
                i32.load
                local.get 2
                i32.gt_u
                if  ;; label = @7
                  i32.const 1055152
                  local.get 2
                  i32.store
                end
                local.get 2
                local.get 4
                i32.add
                local.set 5
                i32.const 1055584
                local.set 1
                block  ;; label = @7
                  loop  ;; label = @8
                    local.get 5
                    local.get 1
                    i32.load
                    local.tee 0
                    i32.ne
                    if  ;; label = @9
                      local.get 1
                      i32.load offset=8
                      local.tee 1
                      br_if 1 (;@8;)
                      br 2 (;@7;)
                    end
                  end
                  local.get 1
                  i32.load8_u offset=12
                  i32.const 8
                  i32.and
                  i32.eqz
                  br_if 3 (;@4;)
                end
                i32.const 1055584
                local.set 1
                loop  ;; label = @7
                  block  ;; label = @8
                    local.get 1
                    i32.load
                    local.tee 0
                    local.get 3
                    i32.le_u
                    if  ;; label = @9
                      local.get 3
                      local.get 0
                      local.get 1
                      i32.load offset=4
                      i32.add
                      local.tee 5
                      i32.lt_u
                      br_if 1 (;@8;)
                    end
                    local.get 1
                    i32.load offset=8
                    local.set 1
                    br 1 (;@7;)
                  end
                end
                local.get 2
                i32.const -8
                local.get 2
                i32.sub
                i32.const 15
                i32.and
                local.tee 0
                i32.add
                local.tee 1
                local.get 4
                i32.const 56
                i32.sub
                local.tee 7
                local.get 0
                i32.sub
                local.tee 8
                i32.const 1
                i32.or
                i32.store offset=4
                local.get 2
                local.get 7
                i32.add
                i32.const 56
                i32.store offset=4
                local.get 3
                local.get 5
                i32.const 55
                local.get 5
                i32.sub
                i32.const 15
                i32.and
                i32.add
                i32.const 63
                i32.sub
                local.tee 0
                local.get 0
                local.get 3
                i32.const 16
                i32.add
                i32.lt_u
                select
                local.tee 0
                i32.const 35
                i32.store offset=4
                i32.const 1055164
                i32.const 1055624
                i32.load
                i32.store
                i32.const 1055148
                local.get 8
                i32.store
                i32.const 1055160
                local.get 1
                i32.store
                local.get 0
                i32.const 16
                i32.add
                i32.const 1055592
                i64.load align=4
                i64.store align=4
                local.get 0
                i32.const 1055584
                i64.load align=4
                i64.store offset=8 align=4
                i32.const 1055592
                local.get 0
                i32.const 8
                i32.add
                i32.store
                i32.const 1055588
                local.get 4
                i32.store
                i32.const 1055584
                local.get 2
                i32.store
                i32.const 1055596
                i32.const 0
                i32.store
                local.get 0
                i32.const 36
                i32.add
                local.set 1
                loop  ;; label = @7
                  local.get 1
                  i32.const 7
                  i32.store
                  local.get 1
                  i32.const 4
                  i32.add
                  local.tee 1
                  local.get 5
                  i32.lt_u
                  br_if 0 (;@7;)
                end
                local.get 0
                local.get 3
                i32.eq
                br_if 0 (;@6;)
                local.get 0
                local.get 0
                i32.load offset=4
                i32.const -2
                i32.and
                i32.store offset=4
                local.get 0
                local.get 0
                local.get 3
                i32.sub
                local.tee 2
                i32.store
                local.get 3
                local.get 2
                i32.const 1
                i32.or
                i32.store offset=4
                block (result i32)  ;; label = @7
                  block (result i32)  ;; label = @8
                    local.get 2
                    i32.const 255
                    i32.le_u
                    if  ;; label = @9
                      local.get 2
                      i32.const -8
                      i32.and
                      i32.const 1055176
                      i32.add
                      local.set 1
                      block (result i32)  ;; label = @10
                        i32.const 1055136
                        i32.load
                        local.tee 0
                        i32.const 1
                        local.get 2
                        i32.const 3
                        i32.shr_u
                        i32.shl
                        local.tee 2
                        i32.and
                        i32.eqz
                        if  ;; label = @11
                          i32.const 1055136
                          local.get 0
                          local.get 2
                          i32.or
                          i32.store
                          local.get 1
                          br 1 (;@10;)
                        end
                        local.get 1
                        i32.load offset=8
                      end
                      local.tee 0
                      local.get 3
                      i32.store offset=12
                      local.get 1
                      local.get 3
                      i32.store offset=8
                      i32.const 8
                      local.set 5
                      i32.const 12
                      br 1 (;@8;)
                    end
                    i32.const 31
                    local.set 1
                    local.get 2
                    i32.const 16777215
                    i32.le_u
                    if  ;; label = @9
                      local.get 2
                      i32.const 38
                      local.get 2
                      i32.const 8
                      i32.shr_u
                      i32.clz
                      local.tee 0
                      i32.sub
                      i32.shr_u
                      i32.const 1
                      i32.and
                      local.get 0
                      i32.const 1
                      i32.shl
                      i32.sub
                      i32.const 62
                      i32.add
                      local.set 1
                    end
                    local.get 3
                    local.get 1
                    i32.store offset=28
                    local.get 3
                    i64.const 0
                    i64.store offset=16 align=4
                    local.get 1
                    i32.const 2
                    i32.shl
                    i32.const 1055440
                    i32.add
                    local.set 0
                    block  ;; label = @9
                      block  ;; label = @10
                        i32.const 1055140
                        i32.load
                        local.tee 5
                        i32.const 1
                        local.get 1
                        i32.shl
                        local.tee 4
                        i32.and
                        i32.eqz
                        if  ;; label = @11
                          local.get 0
                          local.get 3
                          i32.store
                          i32.const 1055140
                          local.get 4
                          local.get 5
                          i32.or
                          i32.store
                          br 1 (;@10;)
                        end
                        local.get 2
                        i32.const 25
                        local.get 1
                        i32.const 1
                        i32.shr_u
                        i32.sub
                        i32.const 0
                        local.get 1
                        i32.const 31
                        i32.ne
                        select
                        i32.shl
                        local.set 1
                        local.get 0
                        i32.load
                        local.set 5
                        loop  ;; label = @11
                          local.get 5
                          local.tee 0
                          i32.load offset=4
                          i32.const -8
                          i32.and
                          local.get 2
                          i32.eq
                          br_if 2 (;@9;)
                          local.get 1
                          i32.const 29
                          i32.shr_u
                          local.set 5
                          local.get 1
                          i32.const 1
                          i32.shl
                          local.set 1
                          local.get 0
                          local.get 5
                          i32.const 4
                          i32.and
                          i32.add
                          local.tee 4
                          i32.load offset=16
                          local.tee 5
                          br_if 0 (;@11;)
                        end
                        local.get 4
                        i32.const 16
                        i32.add
                        local.get 3
                        i32.store
                      end
                      local.get 3
                      local.get 0
                      i32.store offset=24
                      i32.const 12
                      local.set 5
                      local.get 3
                      local.tee 0
                      local.set 1
                      i32.const 8
                      br 1 (;@8;)
                    end
                    local.get 0
                    i32.load offset=8
                    local.set 1
                    local.get 0
                    local.get 3
                    i32.store offset=8
                    local.get 1
                    local.get 3
                    i32.store offset=12
                    local.get 3
                    local.get 1
                    i32.store offset=8
                    i32.const 0
                    local.set 1
                    i32.const 12
                    local.set 5
                    i32.const 24
                  end
                  local.set 12
                  local.get 3
                  local.get 5
                  i32.add
                  local.get 0
                  i32.store
                  local.get 12
                end
                local.get 3
                i32.add
                local.get 1
                i32.store
              end
              i32.const 1055148
              i32.load
              local.tee 1
              local.get 6
              i32.le_u
              br_if 0 (;@5;)
              i32.const 1055160
              i32.load
              local.tee 0
              local.get 6
              i32.add
              local.tee 2
              local.get 1
              local.get 6
              i32.sub
              local.tee 1
              i32.const 1
              i32.or
              i32.store offset=4
              i32.const 1055148
              local.get 1
              i32.store
              i32.const 1055160
              local.get 2
              i32.store
              local.get 0
              local.get 6
              i32.const 3
              i32.or
              i32.store offset=4
              local.get 0
              i32.const 8
              i32.add
              local.set 1
              br 4 (;@1;)
            end
            i32.const 0
            local.set 1
            i32.const 1055632
            i32.const 48
            i32.store
            br 3 (;@1;)
          end
          local.get 1
          local.get 2
          i32.store
          local.get 1
          local.get 1
          i32.load offset=4
          local.get 4
          i32.add
          i32.store offset=4
          local.get 2
          i32.const -8
          local.get 2
          i32.sub
          i32.const 15
          i32.and
          i32.add
          local.tee 8
          local.get 6
          i32.const 3
          i32.or
          i32.store offset=4
          local.get 0
          i32.const -8
          local.get 0
          i32.sub
          i32.const 15
          i32.and
          i32.add
          local.tee 4
          local.get 6
          local.get 8
          i32.add
          local.tee 3
          i32.sub
          local.set 7
          block  ;; label = @4
            i32.const 1055160
            i32.load
            local.get 4
            i32.eq
            if  ;; label = @5
              i32.const 1055160
              local.get 3
              i32.store
              i32.const 1055148
              i32.const 1055148
              i32.load
              local.get 7
              i32.add
              local.tee 0
              i32.store
              local.get 3
              local.get 0
              i32.const 1
              i32.or
              i32.store offset=4
              br 1 (;@4;)
            end
            i32.const 1055156
            i32.load
            local.get 4
            i32.eq
            if  ;; label = @5
              i32.const 1055156
              local.get 3
              i32.store
              i32.const 1055144
              i32.const 1055144
              i32.load
              local.get 7
              i32.add
              local.tee 0
              i32.store
              local.get 3
              local.get 0
              i32.const 1
              i32.or
              i32.store offset=4
              local.get 0
              local.get 3
              i32.add
              local.get 0
              i32.store
              br 1 (;@4;)
            end
            local.get 4
            i32.load offset=4
            local.tee 2
            i32.const 3
            i32.and
            i32.const 1
            i32.eq
            if  ;; label = @5
              local.get 2
              i32.const -8
              i32.and
              local.set 9
              local.get 4
              i32.load offset=12
              local.set 1
              block  ;; label = @6
                local.get 2
                i32.const 255
                i32.le_u
                if  ;; label = @7
                  local.get 4
                  i32.load offset=8
                  local.tee 0
                  local.get 1
                  i32.eq
                  if  ;; label = @8
                    i32.const 1055136
                    i32.const 1055136
                    i32.load
                    i32.const -2
                    local.get 2
                    i32.const 3
                    i32.shr_u
                    i32.rotl
                    i32.and
                    i32.store
                    br 2 (;@6;)
                  end
                  local.get 1
                  local.get 0
                  i32.store offset=8
                  local.get 0
                  local.get 1
                  i32.store offset=12
                  br 1 (;@6;)
                end
                local.get 4
                i32.load offset=24
                local.set 6
                block  ;; label = @7
                  local.get 1
                  local.get 4
                  i32.ne
                  if  ;; label = @8
                    local.get 4
                    i32.load offset=8
                    local.tee 0
                    local.get 1
                    i32.store offset=12
                    local.get 1
                    local.get 0
                    i32.store offset=8
                    br 1 (;@7;)
                  end
                  block  ;; label = @8
                    local.get 4
                    i32.load offset=20
                    local.tee 2
                    if (result i32)  ;; label = @9
                      local.get 4
                      i32.const 20
                      i32.add
                    else
                      local.get 4
                      i32.load offset=16
                      local.tee 2
                      i32.eqz
                      br_if 1 (;@8;)
                      local.get 4
                      i32.const 16
                      i32.add
                    end
                    local.set 0
                    loop  ;; label = @9
                      local.get 0
                      local.set 5
                      local.get 2
                      local.tee 1
                      i32.const 20
                      i32.add
                      local.set 0
                      local.get 1
                      i32.load offset=20
                      local.tee 2
                      br_if 0 (;@9;)
                      local.get 1
                      i32.const 16
                      i32.add
                      local.set 0
                      local.get 1
                      i32.load offset=16
                      local.tee 2
                      br_if 0 (;@9;)
                    end
                    local.get 5
                    i32.const 0
                    i32.store
                    br 1 (;@7;)
                  end
                  i32.const 0
                  local.set 1
                end
                local.get 6
                i32.eqz
                br_if 0 (;@6;)
                block  ;; label = @7
                  local.get 4
                  i32.load offset=28
                  local.tee 0
                  i32.const 2
                  i32.shl
                  i32.const 1055440
                  i32.add
                  local.tee 2
                  i32.load
                  local.get 4
                  i32.eq
                  if  ;; label = @8
                    local.get 2
                    local.get 1
                    i32.store
                    local.get 1
                    br_if 1 (;@7;)
                    i32.const 1055140
                    i32.const 1055140
                    i32.load
                    i32.const -2
                    local.get 0
                    i32.rotl
                    i32.and
                    i32.store
                    br 2 (;@6;)
                  end
                  block  ;; label = @8
                    local.get 4
                    local.get 6
                    i32.load offset=16
                    i32.eq
                    if  ;; label = @9
                      local.get 6
                      local.get 1
                      i32.store offset=16
                      br 1 (;@8;)
                    end
                    local.get 6
                    local.get 1
                    i32.store offset=20
                  end
                  local.get 1
                  i32.eqz
                  br_if 1 (;@6;)
                end
                local.get 1
                local.get 6
                i32.store offset=24
                local.get 4
                i32.load offset=16
                local.tee 0
                if  ;; label = @7
                  local.get 1
                  local.get 0
                  i32.store offset=16
                  local.get 0
                  local.get 1
                  i32.store offset=24
                end
                local.get 4
                i32.load offset=20
                local.tee 0
                i32.eqz
                br_if 0 (;@6;)
                local.get 1
                local.get 0
                i32.store offset=20
                local.get 0
                local.get 1
                i32.store offset=24
              end
              local.get 7
              local.get 9
              i32.add
              local.set 7
              local.get 4
              local.get 9
              i32.add
              local.tee 4
              i32.load offset=4
              local.set 2
            end
            local.get 4
            local.get 2
            i32.const -2
            i32.and
            i32.store offset=4
            local.get 3
            local.get 7
            i32.add
            local.get 7
            i32.store
            local.get 3
            local.get 7
            i32.const 1
            i32.or
            i32.store offset=4
            local.get 7
            i32.const 255
            i32.le_u
            if  ;; label = @5
              local.get 7
              i32.const -8
              i32.and
              i32.const 1055176
              i32.add
              local.set 0
              block (result i32)  ;; label = @6
                i32.const 1055136
                i32.load
                local.tee 1
                i32.const 1
                local.get 7
                i32.const 3
                i32.shr_u
                i32.shl
                local.tee 2
                i32.and
                i32.eqz
                if  ;; label = @7
                  i32.const 1055136
                  local.get 1
                  local.get 2
                  i32.or
                  i32.store
                  local.get 0
                  br 1 (;@6;)
                end
                local.get 0
                i32.load offset=8
              end
              local.tee 1
              local.get 3
              i32.store offset=12
              local.get 0
              local.get 3
              i32.store offset=8
              local.get 3
              local.get 0
              i32.store offset=12
              local.get 3
              local.get 1
              i32.store offset=8
              br 1 (;@4;)
            end
            i32.const 31
            local.set 1
            local.get 7
            i32.const 16777215
            i32.le_u
            if  ;; label = @5
              local.get 7
              i32.const 38
              local.get 7
              i32.const 8
              i32.shr_u
              i32.clz
              local.tee 0
              i32.sub
              i32.shr_u
              i32.const 1
              i32.and
              local.get 0
              i32.const 1
              i32.shl
              i32.sub
              i32.const 62
              i32.add
              local.set 1
            end
            local.get 3
            local.get 1
            i32.store offset=28
            local.get 3
            i64.const 0
            i64.store offset=16 align=4
            local.get 1
            i32.const 2
            i32.shl
            i32.const 1055440
            i32.add
            local.set 0
            i32.const 1055140
            i32.load
            local.tee 2
            i32.const 1
            local.get 1
            i32.shl
            local.tee 5
            i32.and
            i32.eqz
            if  ;; label = @5
              local.get 0
              local.get 3
              i32.store
              i32.const 1055140
              local.get 2
              local.get 5
              i32.or
              i32.store
              local.get 3
              local.get 0
              i32.store offset=24
              local.get 3
              local.get 3
              i32.store offset=8
              local.get 3
              local.get 3
              i32.store offset=12
              br 1 (;@4;)
            end
            local.get 7
            i32.const 25
            local.get 1
            i32.const 1
            i32.shr_u
            i32.sub
            i32.const 0
            local.get 1
            i32.const 31
            i32.ne
            select
            i32.shl
            local.set 1
            local.get 0
            i32.load
            local.set 0
            block  ;; label = @5
              loop  ;; label = @6
                local.get 0
                local.tee 2
                i32.load offset=4
                i32.const -8
                i32.and
                local.get 7
                i32.eq
                br_if 1 (;@5;)
                local.get 1
                i32.const 29
                i32.shr_u
                local.set 0
                local.get 1
                i32.const 1
                i32.shl
                local.set 1
                local.get 2
                local.get 0
                i32.const 4
                i32.and
                i32.add
                local.tee 5
                i32.load offset=16
                local.tee 0
                br_if 0 (;@6;)
              end
              local.get 5
              i32.const 16
              i32.add
              local.get 3
              i32.store
              local.get 3
              local.get 2
              i32.store offset=24
              local.get 3
              local.get 3
              i32.store offset=12
              local.get 3
              local.get 3
              i32.store offset=8
              br 1 (;@4;)
            end
            local.get 2
            i32.load offset=8
            local.tee 0
            local.get 3
            i32.store offset=12
            local.get 2
            local.get 3
            i32.store offset=8
            local.get 3
            i32.const 0
            i32.store offset=24
            local.get 3
            local.get 2
            i32.store offset=12
            local.get 3
            local.get 0
            i32.store offset=8
          end
          local.get 8
          i32.const 8
          i32.add
          local.set 1
          br 2 (;@1;)
        end
        block  ;; label = @3
          local.get 7
          i32.eqz
          br_if 0 (;@3;)
          block  ;; label = @4
            local.get 5
            i32.load offset=28
            local.tee 0
            i32.const 2
            i32.shl
            i32.const 1055440
            i32.add
            local.tee 2
            i32.load
            local.get 5
            i32.eq
            if  ;; label = @5
              local.get 2
              local.get 1
              i32.store
              local.get 1
              br_if 1 (;@4;)
              i32.const 1055140
              local.get 8
              i32.const -2
              local.get 0
              i32.rotl
              i32.and
              local.tee 8
              i32.store
              br 2 (;@3;)
            end
            block  ;; label = @5
              local.get 5
              local.get 7
              i32.load offset=16
              i32.eq
              if  ;; label = @6
                local.get 7
                local.get 1
                i32.store offset=16
                br 1 (;@5;)
              end
              local.get 7
              local.get 1
              i32.store offset=20
            end
            local.get 1
            i32.eqz
            br_if 1 (;@3;)
          end
          local.get 1
          local.get 7
          i32.store offset=24
          local.get 5
          i32.load offset=16
          local.tee 0
          if  ;; label = @4
            local.get 1
            local.get 0
            i32.store offset=16
            local.get 0
            local.get 1
            i32.store offset=24
          end
          local.get 5
          i32.load offset=20
          local.tee 0
          i32.eqz
          br_if 0 (;@3;)
          local.get 1
          local.get 0
          i32.store offset=20
          local.get 0
          local.get 1
          i32.store offset=24
        end
        block  ;; label = @3
          local.get 3
          i32.const 15
          i32.le_u
          if  ;; label = @4
            local.get 5
            local.get 3
            local.get 6
            i32.or
            local.tee 0
            i32.const 3
            i32.or
            i32.store offset=4
            local.get 0
            local.get 5
            i32.add
            local.tee 0
            local.get 0
            i32.load offset=4
            i32.const 1
            i32.or
            i32.store offset=4
            br 1 (;@3;)
          end
          local.get 5
          local.get 6
          i32.add
          local.tee 4
          local.get 3
          i32.const 1
          i32.or
          i32.store offset=4
          local.get 5
          local.get 6
          i32.const 3
          i32.or
          i32.store offset=4
          local.get 3
          local.get 4
          i32.add
          local.get 3
          i32.store
          local.get 3
          i32.const 255
          i32.le_u
          if  ;; label = @4
            local.get 3
            i32.const -8
            i32.and
            i32.const 1055176
            i32.add
            local.set 0
            block (result i32)  ;; label = @5
              i32.const 1055136
              i32.load
              local.tee 1
              i32.const 1
              local.get 3
              i32.const 3
              i32.shr_u
              i32.shl
              local.tee 2
              i32.and
              i32.eqz
              if  ;; label = @6
                i32.const 1055136
                local.get 1
                local.get 2
                i32.or
                i32.store
                local.get 0
                br 1 (;@5;)
              end
              local.get 0
              i32.load offset=8
            end
            local.tee 1
            local.get 4
            i32.store offset=12
            local.get 0
            local.get 4
            i32.store offset=8
            local.get 4
            local.get 0
            i32.store offset=12
            local.get 4
            local.get 1
            i32.store offset=8
            br 1 (;@3;)
          end
          i32.const 31
          local.set 1
          local.get 3
          i32.const 16777215
          i32.le_u
          if  ;; label = @4
            local.get 3
            i32.const 38
            local.get 3
            i32.const 8
            i32.shr_u
            i32.clz
            local.tee 0
            i32.sub
            i32.shr_u
            i32.const 1
            i32.and
            local.get 0
            i32.const 1
            i32.shl
            i32.sub
            i32.const 62
            i32.add
            local.set 1
          end
          local.get 4
          local.get 1
          i32.store offset=28
          local.get 4
          i64.const 0
          i64.store offset=16 align=4
          local.get 1
          i32.const 2
          i32.shl
          i32.const 1055440
          i32.add
          local.set 0
          local.get 8
          i32.const 1
          local.get 1
          i32.shl
          local.tee 2
          i32.and
          i32.eqz
          if  ;; label = @4
            local.get 0
            local.get 4
            i32.store
            i32.const 1055140
            local.get 2
            local.get 8
            i32.or
            i32.store
            local.get 4
            local.get 0
            i32.store offset=24
            local.get 4
            local.get 4
            i32.store offset=8
            local.get 4
            local.get 4
            i32.store offset=12
            br 1 (;@3;)
          end
          local.get 3
          i32.const 25
          local.get 1
          i32.const 1
          i32.shr_u
          i32.sub
          i32.const 0
          local.get 1
          i32.const 31
          i32.ne
          select
          i32.shl
          local.set 1
          local.get 0
          i32.load
          local.set 0
          block  ;; label = @4
            loop  ;; label = @5
              local.get 0
              local.tee 2
              i32.load offset=4
              i32.const -8
              i32.and
              local.get 3
              i32.eq
              br_if 1 (;@4;)
              local.get 1
              i32.const 29
              i32.shr_u
              local.set 0
              local.get 1
              i32.const 1
              i32.shl
              local.set 1
              local.get 2
              local.get 0
              i32.const 4
              i32.and
              i32.add
              local.tee 7
              i32.load offset=16
              local.tee 0
              br_if 0 (;@5;)
            end
            local.get 7
            i32.const 16
            i32.add
            local.get 4
            i32.store
            local.get 4
            local.get 2
            i32.store offset=24
            local.get 4
            local.get 4
            i32.store offset=12
            local.get 4
            local.get 4
            i32.store offset=8
            br 1 (;@3;)
          end
          local.get 2
          i32.load offset=8
          local.tee 0
          local.get 4
          i32.store offset=12
          local.get 2
          local.get 4
          i32.store offset=8
          local.get 4
          i32.const 0
          i32.store offset=24
          local.get 4
          local.get 2
          i32.store offset=12
          local.get 4
          local.get 0
          i32.store offset=8
        end
        local.get 5
        i32.const 8
        i32.add
        local.set 1
        br 1 (;@1;)
      end
      block  ;; label = @2
        local.get 9
        i32.eqz
        br_if 0 (;@2;)
        block  ;; label = @3
          local.get 2
          i32.load offset=28
          local.tee 0
          i32.const 2
          i32.shl
          i32.const 1055440
          i32.add
          local.tee 5
          i32.load
          local.get 2
          i32.eq
          if  ;; label = @4
            local.get 5
            local.get 1
            i32.store
            local.get 1
            br_if 1 (;@3;)
            i32.const 1055140
            local.get 11
            i32.const -2
            local.get 0
            i32.rotl
            i32.and
            i32.store
            br 2 (;@2;)
          end
          block  ;; label = @4
            local.get 2
            local.get 9
            i32.load offset=16
            i32.eq
            if  ;; label = @5
              local.get 9
              local.get 1
              i32.store offset=16
              br 1 (;@4;)
            end
            local.get 9
            local.get 1
            i32.store offset=20
          end
          local.get 1
          i32.eqz
          br_if 1 (;@2;)
        end
        local.get 1
        local.get 9
        i32.store offset=24
        local.get 2
        i32.load offset=16
        local.tee 0
        if  ;; label = @3
          local.get 1
          local.get 0
          i32.store offset=16
          local.get 0
          local.get 1
          i32.store offset=24
        end
        local.get 2
        i32.load offset=20
        local.tee 0
        i32.eqz
        br_if 0 (;@2;)
        local.get 1
        local.get 0
        i32.store offset=20
        local.get 0
        local.get 1
        i32.store offset=24
      end
      block  ;; label = @2
        local.get 3
        i32.const 15
        i32.le_u
        if  ;; label = @3
          local.get 2
          local.get 3
          local.get 6
          i32.or
          local.tee 0
          i32.const 3
          i32.or
          i32.store offset=4
          local.get 0
          local.get 2
          i32.add
          local.tee 0
          local.get 0
          i32.load offset=4
          i32.const 1
          i32.or
          i32.store offset=4
          br 1 (;@2;)
        end
        local.get 2
        local.get 6
        i32.add
        local.tee 5
        local.get 3
        i32.const 1
        i32.or
        i32.store offset=4
        local.get 2
        local.get 6
        i32.const 3
        i32.or
        i32.store offset=4
        local.get 3
        local.get 5
        i32.add
        local.get 3
        i32.store
        local.get 8
        if  ;; label = @3
          local.get 8
          i32.const -8
          i32.and
          i32.const 1055176
          i32.add
          local.set 0
          i32.const 1055156
          i32.load
          local.set 1
          block (result i32)  ;; label = @4
            i32.const 1
            local.get 8
            i32.const 3
            i32.shr_u
            i32.shl
            local.tee 7
            local.get 4
            i32.and
            i32.eqz
            if  ;; label = @5
              i32.const 1055136
              local.get 4
              local.get 7
              i32.or
              i32.store
              local.get 0
              br 1 (;@4;)
            end
            local.get 0
            i32.load offset=8
          end
          local.tee 4
          local.get 1
          i32.store offset=12
          local.get 0
          local.get 1
          i32.store offset=8
          local.get 1
          local.get 0
          i32.store offset=12
          local.get 1
          local.get 4
          i32.store offset=8
        end
        i32.const 1055156
        local.get 5
        i32.store
        i32.const 1055144
        local.get 3
        i32.store
      end
      local.get 2
      i32.const 8
      i32.add
      local.set 1
    end
    local.get 10
    i32.const 16
    i32.add
    global.set 0
    local.get 1)
  (func $76 (type 2) (param $0 i32)
    (local $1 i32) (local $2 i32) (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i32) (local $7 i32) (local $8 i32)
    block  ;; label = @1
      local.get 0
      i32.eqz
      br_if 0 (;@1;)
      local.get 0
      i32.const 8
      i32.sub
      local.tee 3
      local.get 0
      i32.const 4
      i32.sub
      i32.load
      local.tee 2
      i32.const -8
      i32.and
      local.tee 0
      i32.add
      local.set 5
      block  ;; label = @2
        local.get 2
        i32.const 1
        i32.and
        br_if 0 (;@2;)
        local.get 2
        i32.const 2
        i32.and
        i32.eqz
        br_if 1 (;@1;)
        local.get 3
        local.get 3
        i32.load
        local.tee 4
        i32.sub
        local.tee 3
        i32.const 1055152
        i32.load
        i32.lt_u
        br_if 1 (;@1;)
        local.get 0
        local.get 4
        i32.add
        local.set 0
        block  ;; label = @3
          block  ;; label = @4
            block  ;; label = @5
              i32.const 1055156
              i32.load
              local.get 3
              i32.ne
              if  ;; label = @6
                local.get 3
                i32.load offset=12
                local.set 1
                local.get 4
                i32.const 255
                i32.le_u
                if  ;; label = @7
                  local.get 1
                  local.get 3
                  i32.load offset=8
                  local.tee 2
                  i32.ne
                  br_if 2 (;@5;)
                  i32.const 1055136
                  i32.const 1055136
                  i32.load
                  i32.const -2
                  local.get 4
                  i32.const 3
                  i32.shr_u
                  i32.rotl
                  i32.and
                  i32.store
                  br 5 (;@2;)
                end
                local.get 3
                i32.load offset=24
                local.set 7
                local.get 1
                local.get 3
                i32.ne
                if  ;; label = @7
                  local.get 3
                  i32.load offset=8
                  local.tee 2
                  local.get 1
                  i32.store offset=12
                  local.get 1
                  local.get 2
                  i32.store offset=8
                  br 4 (;@3;)
                end
                local.get 3
                i32.load offset=20
                local.tee 2
                if (result i32)  ;; label = @7
                  local.get 3
                  i32.const 20
                  i32.add
                else
                  local.get 3
                  i32.load offset=16
                  local.tee 2
                  i32.eqz
                  br_if 3 (;@4;)
                  local.get 3
                  i32.const 16
                  i32.add
                end
                local.set 4
                loop  ;; label = @7
                  local.get 4
                  local.set 6
                  local.get 2
                  local.tee 1
                  i32.const 20
                  i32.add
                  local.set 4
                  local.get 1
                  i32.load offset=20
                  local.tee 2
                  br_if 0 (;@7;)
                  local.get 1
                  i32.const 16
                  i32.add
                  local.set 4
                  local.get 1
                  i32.load offset=16
                  local.tee 2
                  br_if 0 (;@7;)
                end
                local.get 6
                i32.const 0
                i32.store
                br 3 (;@3;)
              end
              local.get 5
              i32.load offset=4
              local.tee 2
              i32.const 3
              i32.and
              i32.const 3
              i32.ne
              br_if 3 (;@2;)
              local.get 5
              local.get 2
              i32.const -2
              i32.and
              i32.store offset=4
              i32.const 1055144
              local.get 0
              i32.store
              local.get 5
              local.get 0
              i32.store
              local.get 3
              local.get 0
              i32.const 1
              i32.or
              i32.store offset=4
              return
            end
            local.get 1
            local.get 2
            i32.store offset=8
            local.get 2
            local.get 1
            i32.store offset=12
            br 2 (;@2;)
          end
          i32.const 0
          local.set 1
        end
        local.get 7
        i32.eqz
        br_if 0 (;@2;)
        block  ;; label = @3
          local.get 3
          i32.load offset=28
          local.tee 4
          i32.const 2
          i32.shl
          i32.const 1055440
          i32.add
          local.tee 2
          i32.load
          local.get 3
          i32.eq
          if  ;; label = @4
            local.get 2
            local.get 1
            i32.store
            local.get 1
            br_if 1 (;@3;)
            i32.const 1055140
            i32.const 1055140
            i32.load
            i32.const -2
            local.get 4
            i32.rotl
            i32.and
            i32.store
            br 2 (;@2;)
          end
          block  ;; label = @4
            local.get 3
            local.get 7
            i32.load offset=16
            i32.eq
            if  ;; label = @5
              local.get 7
              local.get 1
              i32.store offset=16
              br 1 (;@4;)
            end
            local.get 7
            local.get 1
            i32.store offset=20
          end
          local.get 1
          i32.eqz
          br_if 1 (;@2;)
        end
        local.get 1
        local.get 7
        i32.store offset=24
        local.get 3
        i32.load offset=16
        local.tee 2
        if  ;; label = @3
          local.get 1
          local.get 2
          i32.store offset=16
          local.get 2
          local.get 1
          i32.store offset=24
        end
        local.get 3
        i32.load offset=20
        local.tee 2
        i32.eqz
        br_if 0 (;@2;)
        local.get 1
        local.get 2
        i32.store offset=20
        local.get 2
        local.get 1
        i32.store offset=24
      end
      local.get 3
      local.get 5
      i32.ge_u
      br_if 0 (;@1;)
      local.get 5
      i32.load offset=4
      local.tee 4
      i32.const 1
      i32.and
      i32.eqz
      br_if 0 (;@1;)
      block  ;; label = @2
        block  ;; label = @3
          block  ;; label = @4
            block  ;; label = @5
              local.get 4
              i32.const 2
              i32.and
              i32.eqz
              if  ;; label = @6
                i32.const 1055160
                i32.load
                local.get 5
                i32.eq
                if  ;; label = @7
                  i32.const 1055160
                  local.get 3
                  i32.store
                  i32.const 1055148
                  i32.const 1055148
                  i32.load
                  local.get 0
                  i32.add
                  local.tee 0
                  i32.store
                  local.get 3
                  local.get 0
                  i32.const 1
                  i32.or
                  i32.store offset=4
                  local.get 3
                  i32.const 1055156
                  i32.load
                  i32.ne
                  br_if 6 (;@1;)
                  i32.const 1055144
                  i32.const 0
                  i32.store
                  i32.const 1055156
                  i32.const 0
                  i32.store
                  return
                end
                i32.const 1055156
                i32.load
                local.tee 7
                local.get 5
                i32.eq
                if  ;; label = @7
                  i32.const 1055156
                  local.get 3
                  i32.store
                  i32.const 1055144
                  i32.const 1055144
                  i32.load
                  local.get 0
                  i32.add
                  local.tee 0
                  i32.store
                  local.get 3
                  local.get 0
                  i32.const 1
                  i32.or
                  i32.store offset=4
                  local.get 0
                  local.get 3
                  i32.add
                  local.get 0
                  i32.store
                  return
                end
                local.get 4
                i32.const -8
                i32.and
                local.get 0
                i32.add
                local.set 0
                local.get 5
                i32.load offset=12
                local.set 1
                local.get 4
                i32.const 255
                i32.le_u
                if  ;; label = @7
                  local.get 5
                  i32.load offset=8
                  local.tee 2
                  local.get 1
                  i32.eq
                  if  ;; label = @8
                    i32.const 1055136
                    i32.const 1055136
                    i32.load
                    i32.const -2
                    local.get 4
                    i32.const 3
                    i32.shr_u
                    i32.rotl
                    i32.and
                    i32.store
                    br 5 (;@3;)
                  end
                  local.get 1
                  local.get 2
                  i32.store offset=8
                  local.get 2
                  local.get 1
                  i32.store offset=12
                  br 4 (;@3;)
                end
                local.get 5
                i32.load offset=24
                local.set 8
                local.get 1
                local.get 5
                i32.ne
                if  ;; label = @7
                  local.get 5
                  i32.load offset=8
                  local.tee 2
                  local.get 1
                  i32.store offset=12
                  local.get 1
                  local.get 2
                  i32.store offset=8
                  br 3 (;@4;)
                end
                local.get 5
                i32.load offset=20
                local.tee 2
                if (result i32)  ;; label = @7
                  local.get 5
                  i32.const 20
                  i32.add
                else
                  local.get 5
                  i32.load offset=16
                  local.tee 2
                  i32.eqz
                  br_if 2 (;@5;)
                  local.get 5
                  i32.const 16
                  i32.add
                end
                local.set 4
                loop  ;; label = @7
                  local.get 4
                  local.set 6
                  local.get 2
                  local.tee 1
                  i32.const 20
                  i32.add
                  local.set 4
                  local.get 1
                  i32.load offset=20
                  local.tee 2
                  br_if 0 (;@7;)
                  local.get 1
                  i32.const 16
                  i32.add
                  local.set 4
                  local.get 1
                  i32.load offset=16
                  local.tee 2
                  br_if 0 (;@7;)
                end
                local.get 6
                i32.const 0
                i32.store
                br 2 (;@4;)
              end
              local.get 5
              local.get 4
              i32.const -2
              i32.and
              i32.store offset=4
              local.get 0
              local.get 3
              i32.add
              local.get 0
              i32.store
              local.get 3
              local.get 0
              i32.const 1
              i32.or
              i32.store offset=4
              br 3 (;@2;)
            end
            i32.const 0
            local.set 1
          end
          local.get 8
          i32.eqz
          br_if 0 (;@3;)
          block  ;; label = @4
            local.get 5
            i32.load offset=28
            local.tee 4
            i32.const 2
            i32.shl
            i32.const 1055440
            i32.add
            local.tee 2
            i32.load
            local.get 5
            i32.eq
            if  ;; label = @5
              local.get 2
              local.get 1
              i32.store
              local.get 1
              br_if 1 (;@4;)
              i32.const 1055140
              i32.const 1055140
              i32.load
              i32.const -2
              local.get 4
              i32.rotl
              i32.and
              i32.store
              br 2 (;@3;)
            end
            block  ;; label = @5
              local.get 5
              local.get 8
              i32.load offset=16
              i32.eq
              if  ;; label = @6
                local.get 8
                local.get 1
                i32.store offset=16
                br 1 (;@5;)
              end
              local.get 8
              local.get 1
              i32.store offset=20
            end
            local.get 1
            i32.eqz
            br_if 1 (;@3;)
          end
          local.get 1
          local.get 8
          i32.store offset=24
          local.get 5
          i32.load offset=16
          local.tee 2
          if  ;; label = @4
            local.get 1
            local.get 2
            i32.store offset=16
            local.get 2
            local.get 1
            i32.store offset=24
          end
          local.get 5
          i32.load offset=20
          local.tee 2
          i32.eqz
          br_if 0 (;@3;)
          local.get 1
          local.get 2
          i32.store offset=20
          local.get 2
          local.get 1
          i32.store offset=24
        end
        local.get 0
        local.get 3
        i32.add
        local.get 0
        i32.store
        local.get 3
        local.get 0
        i32.const 1
        i32.or
        i32.store offset=4
        local.get 3
        local.get 7
        i32.ne
        br_if 0 (;@2;)
        i32.const 1055144
        local.get 0
        i32.store
        return
      end
      local.get 0
      i32.const 255
      i32.le_u
      if  ;; label = @2
        local.get 0
        i32.const -8
        i32.and
        i32.const 1055176
        i32.add
        local.set 2
        block (result i32)  ;; label = @3
          i32.const 1055136
          i32.load
          local.tee 4
          i32.const 1
          local.get 0
          i32.const 3
          i32.shr_u
          i32.shl
          local.tee 0
          i32.and
          i32.eqz
          if  ;; label = @4
            i32.const 1055136
            local.get 0
            local.get 4
            i32.or
            i32.store
            local.get 2
            br 1 (;@3;)
          end
          local.get 2
          i32.load offset=8
        end
        local.tee 0
        local.get 3
        i32.store offset=12
        local.get 2
        local.get 3
        i32.store offset=8
        local.get 3
        local.get 2
        i32.store offset=12
        local.get 3
        local.get 0
        i32.store offset=8
        return
      end
      i32.const 31
      local.set 1
      local.get 0
      i32.const 16777215
      i32.le_u
      if  ;; label = @2
        local.get 0
        i32.const 38
        local.get 0
        i32.const 8
        i32.shr_u
        i32.clz
        local.tee 2
        i32.sub
        i32.shr_u
        i32.const 1
        i32.and
        local.get 2
        i32.const 1
        i32.shl
        i32.sub
        i32.const 62
        i32.add
        local.set 1
      end
      local.get 3
      local.get 1
      i32.store offset=28
      local.get 3
      i64.const 0
      i64.store offset=16 align=4
      local.get 1
      i32.const 2
      i32.shl
      i32.const 1055440
      i32.add
      local.set 4
      block (result i32)  ;; label = @2
        block  ;; label = @3
          block (result i32)  ;; label = @4
            i32.const 1055140
            i32.load
            local.tee 6
            i32.const 1
            local.get 1
            i32.shl
            local.tee 2
            i32.and
            i32.eqz
            if  ;; label = @5
              local.get 4
              local.get 3
              i32.store
              i32.const 1055140
              local.get 2
              local.get 6
              i32.or
              i32.store
              i32.const 24
              local.set 1
              i32.const 8
              br 1 (;@4;)
            end
            local.get 0
            i32.const 25
            local.get 1
            i32.const 1
            i32.shr_u
            i32.sub
            i32.const 0
            local.get 1
            i32.const 31
            i32.ne
            select
            i32.shl
            local.set 1
            local.get 4
            i32.load
            local.set 4
            loop  ;; label = @5
              local.get 4
              local.tee 2
              i32.load offset=4
              i32.const -8
              i32.and
              local.get 0
              i32.eq
              br_if 2 (;@3;)
              local.get 1
              i32.const 29
              i32.shr_u
              local.set 4
              local.get 1
              i32.const 1
              i32.shl
              local.set 1
              local.get 2
              local.get 4
              i32.const 4
              i32.and
              i32.add
              local.tee 6
              i32.load offset=16
              local.tee 4
              br_if 0 (;@5;)
            end
            local.get 6
            i32.const 16
            i32.add
            local.get 3
            i32.store
            i32.const 24
            local.set 1
            local.get 2
            local.set 4
            i32.const 8
          end
          local.set 0
          local.get 3
          local.tee 2
          br 1 (;@2;)
        end
        local.get 2
        i32.load offset=8
        local.tee 4
        local.get 3
        i32.store offset=12
        local.get 2
        local.get 3
        i32.store offset=8
        i32.const 24
        local.set 0
        i32.const 8
        local.set 1
        i32.const 0
      end
      local.set 6
      local.get 1
      local.get 3
      i32.add
      local.get 4
      i32.store
      local.get 3
      local.get 2
      i32.store offset=12
      local.get 0
      local.get 3
      i32.add
      local.get 6
      i32.store
      i32.const 1055168
      i32.const 1055168
      i32.load
      i32.const 1
      i32.sub
      local.tee 0
      i32.const -1
      local.get 0
      select
      i32.store
    end)
  (func $77 (type 0) (param $0 i32) (param $1 i32) (result i32)
    (local $2 i32) (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i32) (local $7 i32) (local $8 i32) (local $9 i32) (local $10 i32) (local $11 i32) (local $12 i32)
    local.get 0
    i32.eqz
    if  ;; label = @1
      local.get 1
      call 79
      return
    end
    local.get 1
    i32.const -64
    i32.ge_u
    if  ;; label = @1
      i32.const 1055632
      i32.const 48
      i32.store
      i32.const 0
      return
    end
    i32.const 16
    local.get 1
    i32.const 19
    i32.add
    i32.const -16
    i32.and
    local.get 1
    i32.const 11
    i32.lt_u
    select
    local.set 3
    local.get 0
    i32.const 4
    i32.sub
    local.tee 7
    i32.load
    local.tee 8
    i32.const -8
    i32.and
    local.set 2
    block  ;; label = @1
      block  ;; label = @2
        local.get 8
        i32.const 3
        i32.and
        i32.eqz
        if  ;; label = @3
          local.get 3
          i32.const 256
          i32.lt_u
          br_if 1 (;@2;)
          local.get 2
          local.get 3
          i32.const 4
          i32.or
          i32.lt_u
          br_if 1 (;@2;)
          local.get 2
          local.get 3
          i32.sub
          i32.const 1055616
          i32.load
          i32.const 1
          i32.shl
          i32.le_u
          br_if 2 (;@1;)
          br 1 (;@2;)
        end
        local.get 0
        i32.const 8
        i32.sub
        local.tee 6
        local.get 2
        i32.add
        local.set 4
        local.get 2
        local.get 3
        i32.ge_u
        if  ;; label = @3
          local.get 2
          local.get 3
          i32.sub
          local.tee 1
          i32.const 16
          i32.lt_u
          br_if 2 (;@1;)
          local.get 7
          local.get 3
          local.get 8
          i32.const 1
          i32.and
          i32.or
          i32.const 2
          i32.or
          i32.store
          local.get 3
          local.get 6
          i32.add
          local.tee 2
          local.get 1
          i32.const 3
          i32.or
          i32.store offset=4
          local.get 4
          local.get 4
          i32.load offset=4
          i32.const 1
          i32.or
          i32.store offset=4
          local.get 2
          local.get 1
          call 82
          local.get 0
          return
        end
        i32.const 1055160
        i32.load
        local.get 4
        i32.eq
        if  ;; label = @3
          i32.const 1055148
          i32.load
          local.get 2
          i32.add
          local.tee 2
          local.get 3
          i32.le_u
          br_if 1 (;@2;)
          local.get 7
          local.get 3
          local.get 8
          i32.const 1
          i32.and
          i32.or
          i32.const 2
          i32.or
          i32.store
          i32.const 1055160
          local.get 3
          local.get 6
          i32.add
          local.tee 1
          i32.store
          i32.const 1055148
          local.get 2
          local.get 3
          i32.sub
          local.tee 2
          i32.store
          local.get 1
          local.get 2
          i32.const 1
          i32.or
          i32.store offset=4
          local.get 0
          return
        end
        i32.const 1055156
        i32.load
        local.get 4
        i32.eq
        if  ;; label = @3
          i32.const 1055144
          i32.load
          local.get 2
          i32.add
          local.tee 2
          local.get 3
          i32.lt_u
          br_if 1 (;@2;)
          block  ;; label = @4
            local.get 2
            local.get 3
            i32.sub
            local.tee 1
            i32.const 16
            i32.ge_u
            if  ;; label = @5
              local.get 7
              local.get 3
              local.get 8
              i32.const 1
              i32.and
              i32.or
              i32.const 2
              i32.or
              i32.store
              local.get 3
              local.get 6
              i32.add
              local.tee 5
              local.get 1
              i32.const 1
              i32.or
              i32.store offset=4
              local.get 2
              local.get 6
              i32.add
              local.tee 2
              local.get 1
              i32.store
              local.get 2
              local.get 2
              i32.load offset=4
              i32.const -2
              i32.and
              i32.store offset=4
              br 1 (;@4;)
            end
            local.get 7
            local.get 8
            i32.const 1
            i32.and
            local.get 2
            i32.or
            i32.const 2
            i32.or
            i32.store
            local.get 2
            local.get 6
            i32.add
            local.tee 1
            local.get 1
            i32.load offset=4
            i32.const 1
            i32.or
            i32.store offset=4
            i32.const 0
            local.set 1
          end
          i32.const 1055156
          local.get 5
          i32.store
          i32.const 1055144
          local.get 1
          i32.store
          local.get 0
          return
        end
        local.get 4
        i32.load offset=4
        local.tee 5
        i32.const 2
        i32.and
        br_if 0 (;@2;)
        local.get 5
        i32.const -8
        i32.and
        local.get 2
        i32.add
        local.tee 10
        local.get 3
        i32.lt_u
        br_if 0 (;@2;)
        local.get 10
        local.get 3
        i32.sub
        local.set 11
        local.get 4
        i32.load offset=12
        local.set 1
        block  ;; label = @3
          local.get 5
          i32.const 255
          i32.le_u
          if  ;; label = @4
            local.get 4
            i32.load offset=8
            local.tee 2
            local.get 1
            i32.eq
            if  ;; label = @5
              i32.const 1055136
              i32.const 1055136
              i32.load
              i32.const -2
              local.get 5
              i32.const 3
              i32.shr_u
              i32.rotl
              i32.and
              i32.store
              br 2 (;@3;)
            end
            local.get 1
            local.get 2
            i32.store offset=8
            local.get 2
            local.get 1
            i32.store offset=12
            br 1 (;@3;)
          end
          local.get 4
          i32.load offset=24
          local.set 9
          block  ;; label = @4
            local.get 1
            local.get 4
            i32.ne
            if  ;; label = @5
              local.get 4
              i32.load offset=8
              local.tee 2
              local.get 1
              i32.store offset=12
              local.get 1
              local.get 2
              i32.store offset=8
              br 1 (;@4;)
            end
            block  ;; label = @5
              local.get 4
              i32.load offset=20
              local.tee 2
              if (result i32)  ;; label = @6
                local.get 4
                i32.const 20
                i32.add
              else
                local.get 4
                i32.load offset=16
                local.tee 2
                i32.eqz
                br_if 1 (;@5;)
                local.get 4
                i32.const 16
                i32.add
              end
              local.set 5
              loop  ;; label = @6
                local.get 5
                local.set 12
                local.get 2
                local.tee 1
                i32.const 20
                i32.add
                local.set 5
                local.get 1
                i32.load offset=20
                local.tee 2
                br_if 0 (;@6;)
                local.get 1
                i32.const 16
                i32.add
                local.set 5
                local.get 1
                i32.load offset=16
                local.tee 2
                br_if 0 (;@6;)
              end
              local.get 12
              i32.const 0
              i32.store
              br 1 (;@4;)
            end
            i32.const 0
            local.set 1
          end
          local.get 9
          i32.eqz
          br_if 0 (;@3;)
          block  ;; label = @4
            local.get 4
            i32.load offset=28
            local.tee 2
            i32.const 2
            i32.shl
            i32.const 1055440
            i32.add
            local.tee 5
            i32.load
            local.get 4
            i32.eq
            if  ;; label = @5
              local.get 5
              local.get 1
              i32.store
              local.get 1
              br_if 1 (;@4;)
              i32.const 1055140
              i32.const 1055140
              i32.load
              i32.const -2
              local.get 2
              i32.rotl
              i32.and
              i32.store
              br 2 (;@3;)
            end
            block  ;; label = @5
              local.get 4
              local.get 9
              i32.load offset=16
              i32.eq
              if  ;; label = @6
                local.get 9
                local.get 1
                i32.store offset=16
                br 1 (;@5;)
              end
              local.get 9
              local.get 1
              i32.store offset=20
            end
            local.get 1
            i32.eqz
            br_if 1 (;@3;)
          end
          local.get 1
          local.get 9
          i32.store offset=24
          local.get 4
          i32.load offset=16
          local.tee 2
          if  ;; label = @4
            local.get 1
            local.get 2
            i32.store offset=16
            local.get 2
            local.get 1
            i32.store offset=24
          end
          local.get 4
          i32.load offset=20
          local.tee 2
          i32.eqz
          br_if 0 (;@3;)
          local.get 1
          local.get 2
          i32.store offset=20
          local.get 2
          local.get 1
          i32.store offset=24
        end
        local.get 11
        i32.const 15
        i32.le_u
        if  ;; label = @3
          local.get 7
          local.get 8
          i32.const 1
          i32.and
          local.get 10
          i32.or
          i32.const 2
          i32.or
          i32.store
          local.get 6
          local.get 10
          i32.add
          local.tee 1
          local.get 1
          i32.load offset=4
          i32.const 1
          i32.or
          i32.store offset=4
          local.get 0
          return
        end
        local.get 7
        local.get 3
        local.get 8
        i32.const 1
        i32.and
        i32.or
        i32.const 2
        i32.or
        i32.store
        local.get 3
        local.get 6
        i32.add
        local.tee 1
        local.get 11
        i32.const 3
        i32.or
        i32.store offset=4
        local.get 6
        local.get 10
        i32.add
        local.tee 2
        local.get 2
        i32.load offset=4
        i32.const 1
        i32.or
        i32.store offset=4
        local.get 1
        local.get 11
        call 82
        local.get 0
        return
      end
      local.get 1
      call 79
      local.tee 2
      i32.eqz
      if  ;; label = @2
        i32.const 0
        return
      end
      i32.const -4
      i32.const -8
      local.get 7
      i32.load
      local.tee 5
      i32.const 3
      i32.and
      select
      local.get 5
      i32.const -8
      i32.and
      i32.add
      local.tee 5
      local.get 1
      local.get 1
      local.get 5
      i32.gt_u
      select
      local.tee 1
      if  ;; label = @2
        local.get 2
        local.get 0
        local.get 1
        memory.copy
      end
      local.get 0
      call 80
      local.get 2
      local.set 0
    end
    local.get 0)
  (func $78 (type 3) (param $0 i32) (param $1 i32)
    (local $2 i32) (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i32) (local $7 i32) (local $8 i32)
    local.get 0
    local.get 1
    i32.add
    local.set 5
    block  ;; label = @1
      block  ;; label = @2
        local.get 0
        i32.load offset=4
        local.tee 2
        i32.const 1
        i32.and
        br_if 0 (;@2;)
        local.get 2
        i32.const 2
        i32.and
        i32.eqz
        br_if 1 (;@1;)
        local.get 0
        i32.load
        local.tee 2
        local.get 1
        i32.add
        local.set 1
        block  ;; label = @3
          block  ;; label = @4
            block  ;; label = @5
              local.get 0
              local.get 2
              i32.sub
              local.tee 0
              i32.const 1055156
              i32.load
              i32.ne
              if  ;; label = @6
                local.get 0
                i32.load offset=12
                local.set 3
                local.get 2
                i32.const 255
                i32.le_u
                if  ;; label = @7
                  local.get 3
                  local.get 0
                  i32.load offset=8
                  local.tee 4
                  i32.ne
                  br_if 2 (;@5;)
                  i32.const 1055136
                  i32.const 1055136
                  i32.load
                  i32.const -2
                  local.get 2
                  i32.const 3
                  i32.shr_u
                  i32.rotl
                  i32.and
                  i32.store
                  br 5 (;@2;)
                end
                local.get 0
                i32.load offset=24
                local.set 6
                local.get 0
                local.get 3
                i32.ne
                if  ;; label = @7
                  local.get 0
                  i32.load offset=8
                  local.tee 2
                  local.get 3
                  i32.store offset=12
                  local.get 3
                  local.get 2
                  i32.store offset=8
                  br 4 (;@3;)
                end
                local.get 0
                i32.load offset=20
                local.tee 4
                if (result i32)  ;; label = @7
                  local.get 0
                  i32.const 20
                  i32.add
                else
                  local.get 0
                  i32.load offset=16
                  local.tee 4
                  i32.eqz
                  br_if 3 (;@4;)
                  local.get 0
                  i32.const 16
                  i32.add
                end
                local.set 2
                loop  ;; label = @7
                  local.get 2
                  local.set 7
                  local.get 4
                  local.tee 3
                  i32.const 20
                  i32.add
                  local.set 2
                  local.get 3
                  i32.load offset=20
                  local.tee 4
                  br_if 0 (;@7;)
                  local.get 3
                  i32.const 16
                  i32.add
                  local.set 2
                  local.get 3
                  i32.load offset=16
                  local.tee 4
                  br_if 0 (;@7;)
                end
                local.get 7
                i32.const 0
                i32.store
                br 3 (;@3;)
              end
              local.get 5
              i32.load offset=4
              local.tee 2
              i32.const 3
              i32.and
              i32.const 3
              i32.ne
              br_if 3 (;@2;)
              local.get 5
              local.get 2
              i32.const -2
              i32.and
              i32.store offset=4
              i32.const 1055144
              local.get 1
              i32.store
              local.get 5
              local.get 1
              i32.store
              local.get 0
              local.get 1
              i32.const 1
              i32.or
              i32.store offset=4
              return
            end
            local.get 3
            local.get 4
            i32.store offset=8
            local.get 4
            local.get 3
            i32.store offset=12
            br 2 (;@2;)
          end
          i32.const 0
          local.set 3
        end
        local.get 6
        i32.eqz
        br_if 0 (;@2;)
        block  ;; label = @3
          local.get 0
          i32.load offset=28
          local.tee 2
          i32.const 2
          i32.shl
          i32.const 1055440
          i32.add
          local.tee 4
          i32.load
          local.get 0
          i32.eq
          if  ;; label = @4
            local.get 4
            local.get 3
            i32.store
            local.get 3
            br_if 1 (;@3;)
            i32.const 1055140
            i32.const 1055140
            i32.load
            i32.const -2
            local.get 2
            i32.rotl
            i32.and
            i32.store
            br 2 (;@2;)
          end
          block  ;; label = @4
            local.get 0
            local.get 6
            i32.load offset=16
            i32.eq
            if  ;; label = @5
              local.get 6
              local.get 3
              i32.store offset=16
              br 1 (;@4;)
            end
            local.get 6
            local.get 3
            i32.store offset=20
          end
          local.get 3
          i32.eqz
          br_if 1 (;@2;)
        end
        local.get 3
        local.get 6
        i32.store offset=24
        local.get 0
        i32.load offset=16
        local.tee 2
        if  ;; label = @3
          local.get 3
          local.get 2
          i32.store offset=16
          local.get 2
          local.get 3
          i32.store offset=24
        end
        local.get 0
        i32.load offset=20
        local.tee 2
        i32.eqz
        br_if 0 (;@2;)
        local.get 3
        local.get 2
        i32.store offset=20
        local.get 2
        local.get 3
        i32.store offset=24
      end
      block  ;; label = @2
        block  ;; label = @3
          block  ;; label = @4
            block  ;; label = @5
              local.get 5
              i32.load offset=4
              local.tee 2
              i32.const 2
              i32.and
              i32.eqz
              if  ;; label = @6
                i32.const 1055160
                i32.load
                local.get 5
                i32.eq
                if  ;; label = @7
                  i32.const 1055160
                  local.get 0
                  i32.store
                  i32.const 1055148
                  i32.const 1055148
                  i32.load
                  local.get 1
                  i32.add
                  local.tee 1
                  i32.store
                  local.get 0
                  local.get 1
                  i32.const 1
                  i32.or
                  i32.store offset=4
                  local.get 0
                  i32.const 1055156
                  i32.load
                  i32.ne
                  br_if 6 (;@1;)
                  i32.const 1055144
                  i32.const 0
                  i32.store
                  i32.const 1055156
                  i32.const 0
                  i32.store
                  return
                end
                i32.const 1055156
                i32.load
                local.tee 8
                local.get 5
                i32.eq
                if  ;; label = @7
                  i32.const 1055156
                  local.get 0
                  i32.store
                  i32.const 1055144
                  i32.const 1055144
                  i32.load
                  local.get 1
                  i32.add
                  local.tee 1
                  i32.store
                  local.get 0
                  local.get 1
                  i32.const 1
                  i32.or
                  i32.store offset=4
                  local.get 0
                  local.get 1
                  i32.add
                  local.get 1
                  i32.store
                  return
                end
                local.get 2
                i32.const -8
                i32.and
                local.get 1
                i32.add
                local.set 1
                local.get 5
                i32.load offset=12
                local.set 3
                local.get 2
                i32.const 255
                i32.le_u
                if  ;; label = @7
                  local.get 5
                  i32.load offset=8
                  local.tee 4
                  local.get 3
                  i32.eq
                  if  ;; label = @8
                    i32.const 1055136
                    i32.const 1055136
                    i32.load
                    i32.const -2
                    local.get 2
                    i32.const 3
                    i32.shr_u
                    i32.rotl
                    i32.and
                    i32.store
                    br 5 (;@3;)
                  end
                  local.get 3
                  local.get 4
                  i32.store offset=8
                  local.get 4
                  local.get 3
                  i32.store offset=12
                  br 4 (;@3;)
                end
                local.get 5
                i32.load offset=24
                local.set 6
                local.get 3
                local.get 5
                i32.ne
                if  ;; label = @7
                  local.get 5
                  i32.load offset=8
                  local.tee 2
                  local.get 3
                  i32.store offset=12
                  local.get 3
                  local.get 2
                  i32.store offset=8
                  br 3 (;@4;)
                end
                local.get 5
                i32.load offset=20
                local.tee 4
                if (result i32)  ;; label = @7
                  local.get 5
                  i32.const 20
                  i32.add
                else
                  local.get 5
                  i32.load offset=16
                  local.tee 4
                  i32.eqz
                  br_if 2 (;@5;)
                  local.get 5
                  i32.const 16
                  i32.add
                end
                local.set 2
                loop  ;; label = @7
                  local.get 2
                  local.set 7
                  local.get 4
                  local.tee 3
                  i32.const 20
                  i32.add
                  local.set 2
                  local.get 3
                  i32.load offset=20
                  local.tee 4
                  br_if 0 (;@7;)
                  local.get 3
                  i32.const 16
                  i32.add
                  local.set 2
                  local.get 3
                  i32.load offset=16
                  local.tee 4
                  br_if 0 (;@7;)
                end
                local.get 7
                i32.const 0
                i32.store
                br 2 (;@4;)
              end
              local.get 5
              local.get 2
              i32.const -2
              i32.and
              i32.store offset=4
              local.get 0
              local.get 1
              i32.add
              local.get 1
              i32.store
              local.get 0
              local.get 1
              i32.const 1
              i32.or
              i32.store offset=4
              br 3 (;@2;)
            end
            i32.const 0
            local.set 3
          end
          local.get 6
          i32.eqz
          br_if 0 (;@3;)
          block  ;; label = @4
            local.get 5
            i32.load offset=28
            local.tee 2
            i32.const 2
            i32.shl
            i32.const 1055440
            i32.add
            local.tee 4
            i32.load
            local.get 5
            i32.eq
            if  ;; label = @5
              local.get 4
              local.get 3
              i32.store
              local.get 3
              br_if 1 (;@4;)
              i32.const 1055140
              i32.const 1055140
              i32.load
              i32.const -2
              local.get 2
              i32.rotl
              i32.and
              i32.store
              br 2 (;@3;)
            end
            block  ;; label = @5
              local.get 5
              local.get 6
              i32.load offset=16
              i32.eq
              if  ;; label = @6
                local.get 6
                local.get 3
                i32.store offset=16
                br 1 (;@5;)
              end
              local.get 6
              local.get 3
              i32.store offset=20
            end
            local.get 3
            i32.eqz
            br_if 1 (;@3;)
          end
          local.get 3
          local.get 6
          i32.store offset=24
          local.get 5
          i32.load offset=16
          local.tee 2
          if  ;; label = @4
            local.get 3
            local.get 2
            i32.store offset=16
            local.get 2
            local.get 3
            i32.store offset=24
          end
          local.get 5
          i32.load offset=20
          local.tee 2
          i32.eqz
          br_if 0 (;@3;)
          local.get 3
          local.get 2
          i32.store offset=20
          local.get 2
          local.get 3
          i32.store offset=24
        end
        local.get 0
        local.get 1
        i32.add
        local.get 1
        i32.store
        local.get 0
        local.get 1
        i32.const 1
        i32.or
        i32.store offset=4
        local.get 0
        local.get 8
        i32.ne
        br_if 0 (;@2;)
        i32.const 1055144
        local.get 1
        i32.store
        return
      end
      local.get 1
      i32.const 255
      i32.le_u
      if  ;; label = @2
        local.get 1
        i32.const -8
        i32.and
        i32.const 1055176
        i32.add
        local.set 2
        block (result i32)  ;; label = @3
          i32.const 1055136
          i32.load
          local.tee 3
          i32.const 1
          local.get 1
          i32.const 3
          i32.shr_u
          i32.shl
          local.tee 1
          i32.and
          i32.eqz
          if  ;; label = @4
            i32.const 1055136
            local.get 1
            local.get 3
            i32.or
            i32.store
            local.get 2
            br 1 (;@3;)
          end
          local.get 2
          i32.load offset=8
        end
        local.tee 1
        local.get 0
        i32.store offset=12
        local.get 2
        local.get 0
        i32.store offset=8
        local.get 0
        local.get 2
        i32.store offset=12
        local.get 0
        local.get 1
        i32.store offset=8
        return
      end
      i32.const 31
      local.set 3
      local.get 1
      i32.const 16777215
      i32.le_u
      if  ;; label = @2
        local.get 1
        i32.const 38
        local.get 1
        i32.const 8
        i32.shr_u
        i32.clz
        local.tee 2
        i32.sub
        i32.shr_u
        i32.const 1
        i32.and
        local.get 2
        i32.const 1
        i32.shl
        i32.sub
        i32.const 62
        i32.add
        local.set 3
      end
      local.get 0
      local.get 3
      i32.store offset=28
      local.get 0
      i64.const 0
      i64.store offset=16 align=4
      local.get 3
      i32.const 2
      i32.shl
      i32.const 1055440
      i32.add
      local.set 2
      i32.const 1055140
      i32.load
      local.tee 4
      i32.const 1
      local.get 3
      i32.shl
      local.tee 7
      i32.and
      i32.eqz
      if  ;; label = @2
        local.get 2
        local.get 0
        i32.store
        i32.const 1055140
        local.get 4
        local.get 7
        i32.or
        i32.store
        local.get 0
        local.get 2
        i32.store offset=24
        local.get 0
        local.get 0
        i32.store offset=8
        local.get 0
        local.get 0
        i32.store offset=12
        return
      end
      local.get 1
      i32.const 25
      local.get 3
      i32.const 1
      i32.shr_u
      i32.sub
      i32.const 0
      local.get 3
      i32.const 31
      i32.ne
      select
      i32.shl
      local.set 3
      local.get 2
      i32.load
      local.set 2
      block  ;; label = @2
        loop  ;; label = @3
          local.get 2
          local.tee 4
          i32.load offset=4
          i32.const -8
          i32.and
          local.get 1
          i32.eq
          br_if 1 (;@2;)
          local.get 3
          i32.const 29
          i32.shr_u
          local.set 2
          local.get 3
          i32.const 1
          i32.shl
          local.set 3
          local.get 4
          local.get 2
          i32.const 4
          i32.and
          i32.add
          local.tee 7
          i32.load offset=16
          local.tee 2
          br_if 0 (;@3;)
        end
        local.get 7
        i32.const 16
        i32.add
        local.get 0
        i32.store
        local.get 0
        local.get 4
        i32.store offset=24
        local.get 0
        local.get 0
        i32.store offset=12
        local.get 0
        local.get 0
        i32.store offset=8
        return
      end
      local.get 4
      i32.load offset=8
      local.tee 1
      local.get 0
      i32.store offset=12
      local.get 4
      local.get 0
      i32.store offset=8
      local.get 0
      i32.const 0
      i32.store offset=24
      local.get 0
      local.get 4
      i32.store offset=12
      local.get 0
      local.get 1
      i32.store offset=8
    end)
  (func $79 (type 2) (param $0 i32)
    local.get 0
    call 3
    unreachable)
  (func $80 (type 5) (param $0 i32) (result i32)
    local.get 0
    i32.eqz
    if  ;; label = @1
      memory.size
      i32.const 16
      i32.shl
      return
    end
    block  ;; label = @1
      local.get 0
      i32.const 65535
      i32.and
      br_if 0 (;@1;)
      local.get 0
      i32.const 0
      i32.lt_s
      br_if 0 (;@1;)
      local.get 0
      i32.const 16
      i32.shr_u
      memory.grow
      local.tee 0
      i32.const -1
      i32.eq
      if  ;; label = @2
        i32.const 1055632
        i32.const 48
        i32.store
        i32.const -1
        return
      end
      local.get 0
      i32.const 16
      i32.shl
      return
    end
    unreachable)
  (func $81 (type 2) (param $0 i32)
    local.get 0
    call 83
    unreachable)
  (func $82 (type 5) (param $0 i32) (result i32)
    (local $1 i32) (local $2 i32) (local $3 i32) (local $scratch i32)
    block  ;; label = @1
      block  ;; label = @2
        local.get 0
        local.tee 1
        i32.const 3
        i32.and
        i32.eqz
        br_if 0 (;@2;)
        local.get 1
        i32.load8_u
        i32.eqz
        if  ;; label = @3
          i32.const 0
          return
        end
        local.get 0
        i32.const 1
        i32.add
        local.tee 1
        i32.const 3
        i32.and
        i32.eqz
        br_if 0 (;@2;)
        local.get 1
        i32.load8_u
        i32.eqz
        br_if 1 (;@1;)
        local.get 0
        i32.const 2
        i32.add
        local.tee 1
        i32.const 3
        i32.and
        i32.eqz
        br_if 0 (;@2;)
        local.get 1
        i32.load8_u
        i32.eqz
        br_if 1 (;@1;)
        local.get 0
        i32.const 3
        i32.add
        local.tee 1
        i32.const 3
        i32.and
        i32.eqz
        br_if 0 (;@2;)
        local.get 1
        i32.load8_u
        i32.eqz
        br_if 1 (;@1;)
        local.get 0
        i32.const 4
        i32.add
        local.tee 1
        i32.const 3
        i32.and
        br_if 1 (;@1;)
      end
      local.get 1
      i32.const 4
      i32.sub
      local.set 2
      local.get 1
      i32.const 5
      i32.sub
      local.set 1
      loop  ;; label = @2
        local.get 1
        i32.const 4
        i32.add
        local.set 1
        i32.const 16843008
        local.get 2
        i32.const 4
        i32.add
        local.tee 2
        i32.load
        local.tee 3
        i32.sub
        local.get 3
        i32.or
        i32.const -2139062144
        i32.and
        i32.const -2139062144
        i32.eq
        br_if 0 (;@2;)
      end
      loop  ;; label = @2
        local.get 1
        i32.const 1
        i32.add
        local.set 1
        block (result i32)  ;; label = @3
          local.get 2
          i32.load8_u
          local.set 4
          local.get 2
          i32.const 1
          i32.add
          local.set 2
          local.get 4
        end
        br_if 0 (;@2;)
      end
    end
    local.get 1
    local.get 0
    i32.sub)
  (table $0 52 52 funcref)
  (memory $0 17)
  (global $global$0 (mut i32) (i32.const 1048576))
  (export "memory" (memory 0))
  (export "_start" (func 4))
  (export "__main_void" (func 14))
  (elem $0 (i32.const 1) func 6 12 13 73 5 23 24 25 31 35 26 44 70 72 27 28 29 46 51 52 53 76 77 78 47 48 49 71 38 39 40 41 42 43 33 64 66 67 68 56 57 58 59 60 61 62 63 54 50 55 65)
  (data $0 (i32.const 1048576) "Fibonacci result is: \00\00\00\00\00\10\00\15\00\00\00\81\06\10\00\01\00\00\00capacity overflow\00\00\00(\00\10\00\11\00\00\00falsetrue000102030405060708091011121314151617181920212223242526272829303132333435363738394041424344454647484950515253545556575859606162636465666768697071727374757677787980818283848586878889909192939495969798990123456789abcdef0x0123456789ABCDEF, ,\0a((\0a\00\00\00\00\00\00\0c\00\00\00\04\00\00\00\0f\00\00\00\10\00\00\00\11\00\00\00 {  {\0a} }\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01")
  (data $1 (i32.const 1049123) "\02\02\02\02\02\02\02\02\02\02\02\02\02\02\02\02\02\02\02\02\02\02\02\02\02\02\02\02\02\02\03\03\03\03\03\03\03\03\03\03\03\03\03\03\03\03\04\04\04\04\04")
  (data $2 (i32.const 1049185) "range start index  out of range for slice of length \00\00\00a\02\10\00\12\00\00\00s\02\10\00\22\00\00\00slice index starts at  but ends at \00\a8\02\10\00\16\00\00\00\be\02\10\00\0d\00\00\00range end index \dc\02\10\00\10\00\00\00s\02\10\00\22\00\00\00library/std/src/rt.rs\00library/std/src/sys/pal/wasip1/os.rs\00library/std/src/sys/sync/mutex/no_threads.rs\00library/core/src/slice/memchr.rs\00library/std/src/io/stdio.rs\00library/std/src/io/buffered/linewritershim.rs\00library/std/src/sync/reentrant_lock.rs\00library/std/src/sys/io/io_slice/wasi.rs\00library/std/src/panicking.rs\00library/std/src/sync/poison/once.rs\00/rustc/ed61e7d7e242494fb7057f2657300d9e77bb4fcb/library/alloc/src/slice.rs\00library/std/src/io/mod.rs\00library/std/src/thread/mod.rs\00/rustc/ed61e7d7e242494fb7057f2657300d9e77bb4fcb/library/alloc/src/raw_vec/mod.rs\00/rustc/ed61e7d7e242494fb7057f2657300d9e77bb4fcb/library/alloc/src/vec/mod.rs\00/\00\00\00d\03\10\00 \00\00\00\84\00\00\00\1e\00\00\00d\03\10\00 \00\00\00\a0\00\00\00\09\00\00\00\01\00\00\00\00\00\00\00\82\06\10\00\02\00\00\00==assertion `left  right` failed\0a  left: \0a right: \00\00\b6\05\10\00\10\00\00\00\c6\05\10\00\17\00\00\00\dd\05\10\00\09\00\00\00 right` failed: \0a  left: \00\00\00\b6\05\10\00\10\00\00\00\00\06\10\00\10\00\00\00\10\06\10\00\09\00\00\00\dd\05\10\00\09\00\00\00RefCell already borrowed    m]\cb\d6,P\ebcxA\a6Wq\1b\8b\b9Edn\0a\ae\e5\adaj\f2\99N\b2\ef\93Y\01\00\00\00\00\00\00\00:\0a: \12\00\00\00\0c\00\00\00\04\00\00\00\13\00\00\00\14\00\00\00\15\00\00\00a formatting trait implementation returned an error when the underlying stream did not\00\00\9c\06\10\00V\00\00\00\aa\04\10\00\19\00\00\00\88\02\00\00\11\00\00\00\12\00\00\00\0c\00\00\00\04\00\00\00\16\00\00\00\17\00\00\00\18\00\00\00\12\00\00\00\0c\00\00\00\04\00\00\00\19\00\00\00\1a\00\00\00\1b\00\00\00failed to write whole buffer<\07\10\00\1c\00\00\00\17\00\00\00\00\00\00\00\02\00\00\00X\07\10\00\aa\04\10\00\19\00\00\001\07\00\00$\00\00\00entity not foundpermission deniedconnection refusedconnection resethost unreachablenetwork unreachableconnection abortednot connectedaddress in useaddress not availablenetwork downbroken pipeentity already existsoperation would blocknot a directoryis a directorydirectory not emptyread-only filesystem or storage mediumfilesystem loop or indirection limit (e.g. symlink loop)stale network file handleinvalid input parameterinvalid datatimed outwrite zerono storage spaceseek on unseekable filequota exceededfile too largeresource busyexecutable file busydeadlockcross-device link or renametoo many linksinvalid filenameargument list too longoperation interruptedunsupportedunexpected end of fileout of memoryin progressother erroruncategorized errormid > len\00\00m\0a\10\00\09\00\00\00stdout\00\00\85\03\10\00\1b\00\00\00\e3\02\00\00\13\00\00\00failed printing to \00\98\0a\10\00\13\00\00\00\82\06\10\00\02\00\00\00\85\03\10\00\1b\00\00\00\8d\04\00\00\09\00\00\00\aa\04\10\00\19\00\00\000\06\00\00 \00\00\00advancing io slices beyond their length\00\dc\0a\10\00'\00\00\00\aa\04\10\00\19\00\00\002\06\00\00\0d\00\00\00advancing IoSlice beyond its length\00\1c\0b\10\00#\00\00\00\f6\03\10\00'\00\00\00\14\00\00\00\0d\00\00\00failed to write the buffered data\00\00\00X\0b\10\00!\00\00\00\17\00\00\00\fc\02\10\00\15\00\00\00\8d\00\00\00\0d\00\00\00\00\00\00\00\08\00\00\00\04\00\00\00\1c\00\00\00called `Result::unwrap()` on an `Err` value\00\12\03\10\00$\00\00\00'\00\00\006\00\00\00strerror_r failure\00\00\e4\0b\10\00\12\00\00\00\12\03\10\00$\00\00\00%\00\00\00\0d\00\00\00Once instance has previously been poisoned\00\00\10\0c\10\00*\00\00\00one-time initialization may not be performed recursivelyD\0c\10\008\00\00\00fatal runtime error: rwlock locked for writing, aborting\0a\00\00\00\84\0c\10\009\00\00\00stack backtrace:\0anote: Some details are omitted, run with `RUST_BACKTRACE=full` for a verbose backtrace.\0acannot recursively acquire mutex\00\00\001\0d\10\00 \00\00\007\03\10\00,\00\00\00\13\00\00\00\09\00\00\00lock count overflow in reentrant mutex\00\00\cf\03\10\00&\00\00\00#\01\00\00-\00\00\00;\04\10\00#\00\00\00\d7\00\00\00\14\00\00\00memory allocation of  bytes failed\0a\00\b4\0d\10\00\15\00\00\00\c9\0d\10\00\0e\00\00\00RUST_BACKTRACEmainfailed to generate unique thread ID: bitspace exhausted\00\00\00\fa\0d\10\007\00\00\00\c4\04\10\00\1d\00\00\00\d4\04\00\00\0d")
  (data $3 (i32.const 1052244) "\01\00\00\00\1d\00\00\00\1e\00\00\00\1f\00\00\00 \00\00\00!\00\00\00\22\00\00\00#\00\00\00note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace\0a\00\00t\0e\10\00N\00\00\00<unnamed>\00\00\00\1e\04\10\00\1c\00\00\00\1e\01\00\00.\00\00\00\0athread '' () panicked at :\0a\e8\0e\10\00\09\00\00\00\f1\0e\10\00\03\00\00\00\f4\0e\10\00\0e\00\00\00\02\0f\10\00\02\00\00\00\81\06\10\00\01\00\00\00$\00\00\00\0c\00\00\00\04\00\00\00%\00\00\00&\00\00\00'\00\00\00\00\00\00\00\08\00\00\00\04\00\00\00(\00\00\00)\00\00\00*\00\00\00+\00\00\00,\00\00\00\10\00\00\00\04\00\00\00-\00\00\00.\00\00\00/\00\00\000\00\00\00Box<dyn Any>aborting due to panic at \00\00\00\88\0f\10\00\19\00\00\00\02\0f\10\00\02\00\00\00\81\06\10\00\01\00\00\00panicked at \0athread panicked while processing panic. aborting.\0a\00\bc\0f\10\00\0c\00\00\00\02\0f\10\00\02\00\00\00\c8\0f\10\003\00\00\00thread caused non-unwinding panic. aborting.\0a\00\00\00\14\10\10\00-\00\00\00\00\00\00\00\04\00\00\00\04\00\00\001\00\00\003\05\10\00L\00\00\00\14\0b\00\00$\00\00\00\e2\04\10\00P\00\00\00*\02\00\00\11\00\00\00 (os error )\01\00\00\00\00\00\00\00|\10\10\00\0b\00\00\00\87\10\10\00\01\00\00\00\85\03\10\00\1b\00\00\00\5c\03\00\00\14\00\00\00Utf8Errorvalid_up_toerror_lenNoneSome\00\00\00\01\00\00\00\00\00\00\00\80\06\10\00\01\00\00\00\80\06\10\00\01\00\00\00\00\00\00\00\08\00\00\00\04\00\00\002\00\00\00_\04\10\00J\00\00\00\bd\01\00\00\1d\00\00\00\a1\03\10\00-\00\00\00\16\01\00\00)\00\00\00$\00\00\00\0c\00\00\00\04\00\00\003\00\00\00\10\00\00\00\11\00\00\00\12\00\00\00\10\00\00\00\10\00\00\00\13\00\00\00\12\00\00\00\0d\00\00\00\0e\00\00\00\15\00\00\00\0c\00\00\00\0b\00\00\00\15\00\00\00\15\00\00\00\0f\00\00\00\0e\00\00\00\13\00\00\00&\00\00\008\00\00\00\19\00\00\00\17\00\00\00\0c\00\00\00\09\00\00\00\0a\00\00\00\10\00\00\00\17\00\00\00\0e\00\00\00\0e\00\00\00\0d\00\00\00\14\00\00\00\08\00\00\00\1b\00\00\00\0e\00\00\00\10\00\00\00\16\00\00\00\15\00\00\00\0b\00\00\00\16\00\00\00\0d\00\00\00\0b\00\00\00\0b\00\00\00\13\00\00\00\80\07\10\00\90\07\10\00\a1\07\10\00\b3\07\10\00\c3\07\10\00\d3\07\10\00\e6\07\10\00\f8\07\10\00\05\08\10\00\13\08\10\00(\08\10\004\08\10\00?\08\10\00T\08\10\00i\08\10\00x\08\10\00\86\08\10\00\99\08\10\00\bf\08\10\00\f7\08\10\00\10\09\10\00'\09\10\003\09\10\00<\09\10\00F\09\10\00V\09\10\00m\09\10\00{\09\10\00\89\09\10\00\96\09\10\00\aa\09\10\00\b2\09\10\00\cd\09\10\00\db\09\10\00\eb\09\10\00\01\0a\10\00\16\0a\10\00!\0a\10\007\0a\10\00D\0a\10\00O\0a\10\00Z\0a\10\00Success\00Illegal byte sequence\00Domain error\00Result not representable\00Not a tty\00Permission denied\00Operation not permitted\00No such file or directory\00No such process\00File exists\00Value too large for data type\00No space left on device\00Out of memory\00Resource busy\00Interrupted system call\00Resource temporarily unavailable\00Invalid seek\00Cross-device link\00Read-only file system\00Directory not empty\00Connection reset by peer\00Operation timed out\00Connection refused\00Host is unreachable\00Address in use\00Broken pipe\00I/O error\00No such device or address\00No such device\00Not a directory\00Is a directory\00Text file busy\00Exec format error\00Invalid argument\00Argument list too long\00Symbolic link loop\00Filename too long\00Too many open files in system\00No file descriptors available\00Bad file descriptor\00No child process\00Bad address\00File too large\00Too many links\00No locks available\00Resource deadlock would occur\00State not recoverable\00Previous owner died\00Operation canceled\00Function not implemented\00No message of desired type\00Identifier removed\00Link has been severed\00Protocol error\00Bad message\00Not a socket\00Destination address required\00Message too large\00Protocol wrong type for socket\00Protocol not available\00Protocol not supported\00Not supported\00Address family not supported by protocol\00Address not available\00Network is down\00Network unreachable\00Connection reset by network\00Connection aborted\00No buffer space available\00Socket is connected\00Socket not connected\00Operation already in progress\00Operation in progress\00Stale file handle\00Quota exceeded\00Multihop attempted\00Capabilities insufficient\00\00\00u\02N\00\d6\01\e2\04\b9\04\18\01\8e\05\ed\02\16\04\f2\00\97\03\01\038\05\af\01\82\01O\03/\04\1e\00\d4\05\a2\00\12\03\1e\03\c2\01\de\03\08\00\ac\05\00\01d\02\f1\01e\054\02\8c\02\cf\02-\03L\04\e3\05\9f\02\f8\04\1c\05\08\05\b1\02K\05\15\02x\00R\02<\03\f1\03\e4\00\c3\03}\04\cc\00\aa\03y\05$\02n\01m\03\22\04\ab\04D\00\fb\01\ae\00\83\03`\00\e5\01\07\04\94\04^\04+\00X\019\01\92\00\c2\05\9b\01C\02F\01\f6\05")
  (data $4 (i32.const 1055020) "\01\00\00\00\80\05\10\00\ff\ff\ff\ff"))
