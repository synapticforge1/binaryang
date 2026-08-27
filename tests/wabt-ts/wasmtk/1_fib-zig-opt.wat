(module
  (type $0 (func (param i32 i32 i32 i32 i32)))
  (type $1 (func (param i32) (result i32)))
  (type $2 (func (param i32 i32) (result i32)))
  (type $3 (func (param i32)))
  (type $4 (func (param i32 i64 i32 i32) (result i32)))
  (type $5 (func (param i32 i32 i32 i64 i32) (result i32)))
  (type $6 (func (param i32 i32 i32 i32) (result i32)))
  (type $7 (func))
  (type $8 (func (param i32 i32 i32) (result i32)))
  (type $9 (func (param i32 i32 i32 i32)))
  (import "wasi_snapshot_preview1" "proc_exit" (func $fimport$0 (type 3)))
  (import "wasi_snapshot_preview1" "fd_seek" (func $fimport$1 (type 4)))
  (import "wasi_snapshot_preview1" "fd_pwrite" (func $fimport$2 (type 5)))
  (import "wasi_snapshot_preview1" "fd_write" (func $fimport$3 (type 6)))
  (func $0 (type 2) (param $0 i32) (param $1 i32) (result i32)
    (local $2 i32) (local $3 i32) (local $4 i32) (local $5 i32) (local $6 i32) (local $7 i64)
    global.get 0
    i32.const 16
    i32.sub
    local.tee 3
    global.set 0
    loop  ;; label = @1
      block  ;; label = @2
        local.get 1
        local.get 4
        i32.le_u
        if  ;; label = @3
          i32.const 0
          local.set 2
          br 1 (;@2;)
        end
        local.get 0
        local.get 4
        i32.add
        local.set 6
        block  ;; label = @3
          i32.const 16777308
          i32.load
          i32.const 16777312
          i32.load
          local.tee 5
          local.get 1
          local.get 4
          i32.sub
          local.tee 2
          i32.add
          i32.ge_u
          if  ;; label = @4
            local.get 2
            if  ;; label = @5
              i32.const 16777304
              i32.load
              local.get 5
              i32.add
              local.get 6
              local.get 2
              memory.copy
            end
            i32.const 16777312
            i32.const 16777312
            i32.load
            local.get 2
            i32.add
            i32.store
            br 1 (;@3;)
          end
          i32.const 16777300
          i32.load
          i32.load
          local.set 5
          local.get 3
          local.get 2
          i32.store offset=4
          local.get 3
          local.get 6
          i32.store
          local.get 3
          i32.const 8
          i32.add
          i32.const 16777300
          local.get 3
          i32.const 1
          i32.const 1
          local.get 5
          call_indirect (type 0)
          local.get 3
          i64.load offset=8
          local.tee 7
          i64.const 32
          i64.shr_u
          i32.wrap_i64
          local.tee 2
          i32.const 65535
          i32.and
          br_if 1 (;@2;)
          local.get 7
          i32.wrap_i64
          local.set 2
        end
        local.get 2
        local.get 4
        i32.add
        local.set 4
        br 1 (;@1;)
      end
    end
    local.get 3
    i32.const 16
    i32.add
    global.set 0
    local.get 2)
  (func $1 (type 7)
    (local $0 i32) (local $1 i32)
    global.get 0
    i32.const 112
    i32.sub
    local.tee 0
    global.set 0
    i32.const 16777328
    block (result i32)  ;; label = @1
      i32.const 16777280
      i32.load
      i32.eqz
      if  ;; label = @2
        i32.const 16777328
        i32.load
        i32.const 1
        i32.add
        br 1 (;@1;)
      end
      i32.const 16777332
      i32.load8_u
      i32.eqz
      if  ;; label = @2
        i32.const 16777332
        i32.const 1
        i32.store8
      end
      i32.const 16777280
      i32.const 0
      i32.store
      i32.const 1
    end
    i32.store
    i32.const 16777300
    i32.const 16777300
    i32.load
    i32.load offset=8
    call_indirect (type 1)
    drop
    i32.const 16777308
    i32.const 64
    i32.store
    i32.const 16777304
    local.get 0
    i32.const 15
    i32.add
    i32.store
    block  ;; label = @1
      i32.const 16777216
      i32.const 16
      call 4
      i32.const 65535
      i32.and
      br_if 0 (;@1;)
      local.get 0
      i32.const 13621
      i32.store16 offset=110 align=1
      local.get 0
      i32.const 110
      i32.add
      i32.const 2
      call 4
      i32.const 65535
      i32.and
      br_if 0 (;@1;)
      i32.const 16777232
      i32.const 1
      call 4
      drop
    end
    i32.const 16777300
    i32.const 16777300
    i32.load
    i32.load offset=8
    call_indirect (type 1)
    drop
    i32.const 16777304
    i64.const 2863311530
    i64.store
    i32.const 16777328
    i32.const 16777328
    i32.load
    i32.const 1
    i32.sub
    local.tee 1
    i32.store
    i32.const 16777312
    i32.const 0
    i32.store
    local.get 1
    i32.eqz
    if  ;; label = @1
      i32.const 16777280
      i32.const -1
      i32.store
      i32.const 16777332
      i32.const 0
      i32.store8
    end
    local.get 0
    i32.const 112
    i32.add
    global.set 0
    i32.const 0
    call 0
    unreachable)
  (func $2 (type 1) (param $0 i32) (result i32)
    (local $1 i32) (local $2 i32) (local $3 i32)
    global.get 0
    i32.const 16
    i32.sub
    local.tee 1
    global.set 0
    local.get 0
    i32.load
    i32.load
    local.set 3
    loop  ;; label = @1
      block  ;; label = @2
        local.get 0
        i32.load offset=12
        i32.eqz
        if  ;; label = @3
          i32.const 0
          local.set 2
          br 1 (;@2;)
        end
        local.get 1
        i32.const 8
        i32.add
        local.get 0
        i32.const 16777236
        i32.const 1
        i32.const 1
        local.get 3
        call_indirect (type 0)
        local.get 1
        i32.load16_u offset=12
        local.tee 2
        i32.eqz
        br_if 1 (;@1;)
      end
    end
    local.get 1
    i32.const 16
    i32.add
    global.set 0
    local.get 2)
  (func $3 (type 8) (param $0 i32) (param $1 i32) (param $2 i32) (result i32)
    unreachable)
  (func $4 (type 9) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32)
    unreachable)
  (func $5 (type 0) (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32)
    (local $5 i32) (local $6 i32) (local $7 i32) (local $8 i32) (local $9 i32) (local $10 i32) (local $11 i32) (local $12 i32) (local $13 i32) (local $14 i32) (local $15 i64)
    global.get 0
    i32.const 208
    i32.sub
    local.tee 8
    global.set 0
    local.get 1
    i32.const 12
    i32.sub
    local.set 6
    local.get 1
    i32.load offset=4
    local.set 10
    local.get 1
    i32.load offset=12
    local.tee 9
    if (result i32)  ;; label = @1
      local.get 8
      local.get 9
      i32.store offset=12
      local.get 8
      local.get 10
      i32.store offset=8
      i32.const 1
    else
      i32.const 0
    end
    local.set 5
    local.get 6
    i32.load offset=8
    local.set 12
    local.get 2
    local.set 7
    local.get 3
    i32.const 1
    i32.sub
    local.tee 11
    local.set 3
    block  ;; label = @1
      loop  ;; label = @2
        local.get 3
        i32.eqz
        br_if 1 (;@1;)
        block  ;; label = @3
          local.get 7
          i32.const 4
          i32.add
          i32.load
          local.tee 13
          if  ;; label = @4
            local.get 8
            i32.const 8
            i32.add
            local.get 5
            i32.const 3
            i32.shl
            i32.add
            local.tee 14
            local.get 13
            i32.store offset=4
            local.get 14
            local.get 7
            i32.load
            i32.store
            local.get 5
            i32.const 15
            i32.eq
            br_if 1 (;@3;)
            local.get 5
            i32.const 1
            i32.add
            local.set 5
          end
          local.get 7
          i32.const 8
          i32.add
          local.set 7
          local.get 3
          i32.const 1
          i32.sub
          local.set 3
          br 1 (;@2;)
        end
      end
      i32.const 16
      local.set 5
    end
    block  ;; label = @1
      block  ;; label = @2
        block  ;; label = @3
          local.get 5
          i32.const 16
          i32.eq
          br_if 0 (;@3;)
          local.get 2
          local.get 11
          i32.const 3
          i32.shl
          i32.add
          local.tee 2
          i32.load offset=4
          local.set 3
          local.get 2
          i32.load
          local.set 11
          block  ;; label = @4
            block  ;; label = @5
              block  ;; label = @6
                block  ;; label = @7
                  local.get 4
                  br_table 3 (;@4;) 0 (;@7;) 1 (;@6;)
                end
                local.get 3
                br_if 1 (;@5;)
                br 2 (;@4;)
              end
              block  ;; label = @6
                block  ;; label = @7
                  local.get 3
                  br_table 3 (;@4;) 0 (;@7;) 1 (;@6;)
                end
                local.get 9
                local.get 10
                i32.add
                local.get 8
                i32.const 136
                i32.add
                local.get 1
                i32.load offset=8
                local.get 9
                i32.sub
                local.tee 2
                i32.const 63
                i32.gt_u
                local.tee 3
                select
                local.set 9
                local.get 2
                i32.const 64
                local.get 3
                select
                local.tee 10
                local.get 4
                local.get 4
                local.get 10
                i32.gt_u
                select
                local.tee 2
                if  ;; label = @7
                  local.get 9
                  local.get 11
                  i32.load8_u
                  local.get 2
                  memory.fill
                end
                local.get 8
                i32.const 8
                i32.add
                local.get 5
                i32.const 3
                i32.shl
                i32.add
                local.tee 7
                local.get 2
                i32.store offset=4
                local.get 7
                local.get 9
                i32.store
                local.get 4
                local.get 2
                i32.sub
                local.set 2
                local.get 5
                i32.const 2
                i32.add
                local.set 3
                local.get 7
                i32.const 12
                i32.add
                local.set 7
                loop  ;; label = @7
                  local.get 3
                  i32.const 17
                  i32.eq
                  local.get 2
                  local.get 10
                  i32.le_u
                  i32.or
                  i32.eqz
                  if  ;; label = @8
                    local.get 7
                    local.get 10
                    i32.store
                    local.get 7
                    i32.const 4
                    i32.sub
                    local.get 9
                    i32.store
                    local.get 7
                    i32.const 8
                    i32.add
                    local.set 7
                    local.get 3
                    i32.const 1
                    i32.add
                    local.set 3
                    local.get 2
                    local.get 10
                    i32.sub
                    local.set 2
                    br 1 (;@7;)
                  end
                end
                local.get 3
                i32.const 1
                i32.sub
                local.set 5
                local.get 2
                i32.eqz
                local.get 3
                i32.const 17
                i32.eq
                i32.or
                br_if 4 (;@2;)
                local.get 7
                local.get 2
                i32.store
                local.get 7
                i32.const 4
                i32.sub
                local.get 9
                i32.store
                local.get 3
                local.set 5
                br 4 (;@2;)
              end
              local.get 5
              i32.const 16
              i32.sub
              local.set 9
              local.get 4
              local.get 5
              i32.add
              local.set 2
              local.get 8
              i32.const 8
              i32.add
              local.get 5
              i32.const 3
              i32.shl
              i32.add
              local.set 7
              loop  ;; label = @6
                local.get 4
                i32.eqz
                if  ;; label = @7
                  local.get 2
                  local.set 5
                  br 3 (;@4;)
                end
                local.get 7
                local.get 11
                i32.store
                local.get 7
                i32.const 4
                i32.add
                local.get 3
                i32.store
                local.get 7
                i32.const 8
                i32.add
                local.set 7
                local.get 4
                i32.const 1
                i32.sub
                local.set 4
                local.get 9
                i32.const 1
                i32.add
                local.tee 9
                br_if 0 (;@6;)
              end
              br 2 (;@3;)
            end
            local.get 8
            i32.const 8
            i32.add
            local.get 5
            i32.const 3
            i32.shl
            i32.add
            local.tee 2
            local.get 3
            i32.store offset=4
            local.get 2
            local.get 11
            i32.store
            local.get 5
            i32.const 1
            i32.add
            local.set 5
            br 2 (;@2;)
          end
          local.get 5
          br_if 1 (;@2;)
          local.get 0
          i64.const 0
          i64.store align=4
          br 2 (;@1;)
        end
        i32.const 16
        local.set 5
      end
      block  ;; label = @2
        block  ;; label = @3
          block (result i32)  ;; label = @4
            block  ;; label = @5
              block  ;; label = @6
                block  ;; label = @7
                  block (result i32)  ;; label = @8
                    block  ;; label = @9
                      block  ;; label = @10
                        block  ;; label = @11
                          block  ;; label = @12
                            block  ;; label = @13
                              local.get 6
                              i32.load8_u offset=38
                              i32.const 7
                              i32.and
                              i32.const 1
                              i32.sub
                              br_table 1 (;@12;) 2 (;@11;) 1 (;@12;) 0 (;@13;) 2 (;@11;)
                            end
                            local.get 0
                            i64.const 4294967296
                            i64.store align=4
                            br 11 (;@1;)
                          end
                          block  ;; label = @12
                            block  ;; label = @13
                              block  ;; label = @14
                                block  ;; label = @15
                                  local.get 12
                                  local.get 8
                                  i32.const 8
                                  i32.add
                                  local.get 5
                                  local.get 6
                                  i64.load
                                  local.get 8
                                  i32.const 200
                                  i32.add
                                  call 2
                                  i32.const 65535
                                  i32.and
                                  local.tee 2
                                  i32.const 60
                                  i32.sub
                                  br_table 8 (;@7;) 8 (;@7;) 3 (;@12;) 1 (;@14;) 2 (;@13;) 3 (;@12;) 3 (;@12;) 3 (;@12;) 3 (;@12;) 3 (;@12;) 8 (;@7;) 0 (;@15;)
                                end
                                block  ;; label = @15
                                  block  ;; label = @16
                                    block  ;; label = @17
                                      block  ;; label = @18
                                        local.get 2
                                        i32.const 19
                                        i32.sub
                                        br_table 9 (;@9;) 6 (;@12;) 6 (;@12;) 1 (;@17;) 0 (;@18;)
                                      end
                                      local.get 2
                                      i32.eqz
                                      br_if 7 (;@10;)
                                      i32.const 28
                                      local.get 2
                                      i32.const 8
                                      i32.eq
                                      br_if 9 (;@8;)
                                      drop
                                      local.get 2
                                      i32.const 29
                                      i32.eq
                                      br_if 1 (;@16;)
                                      local.get 2
                                      i32.const 51
                                      i32.eq
                                      br_if 2 (;@15;)
                                      local.get 2
                                      i32.const 76
                                      i32.ne
                                      br_if 5 (;@12;)
                                      i32.const 16
                                      br 9 (;@8;)
                                    end
                                    i32.const 24
                                    br 8 (;@8;)
                                  end
                                  i32.const 5
                                  br 7 (;@8;)
                                end
                                i32.const 25
                                br 6 (;@8;)
                              end
                              i32.const 20
                              br 5 (;@8;)
                            end
                            i32.const 9
                            br 4 (;@8;)
                          end
                          i32.const 19
                          br 3 (;@8;)
                        end
                        block  ;; label = @11
                          block  ;; label = @12
                            block  ;; label = @13
                              block  ;; label = @14
                                block  ;; label = @15
                                  block  ;; label = @16
                                    block  ;; label = @17
                                      local.get 12
                                      local.get 8
                                      i32.const 8
                                      i32.add
                                      local.get 5
                                      local.get 8
                                      i32.const 200
                                      i32.add
                                      call 3
                                      i32.const 65535
                                      i32.and
                                      local.tee 2
                                      i32.const 19
                                      i32.sub
                                      br_table 12 (;@5;) 6 (;@11;) 6 (;@11;) 1 (;@16;) 0 (;@17;)
                                    end
                                    block  ;; label = @17
                                      local.get 2
                                      i32.const 63
                                      i32.sub
                                      br_table 4 (;@13;) 5 (;@12;) 0 (;@17;)
                                    end
                                    local.get 2
                                    i32.eqz
                                    br_if 10 (;@6;)
                                    i32.const 28
                                    local.get 2
                                    i32.const 8
                                    i32.eq
                                    br_if 12 (;@4;)
                                    drop
                                    local.get 2
                                    i32.const 29
                                    i32.eq
                                    br_if 1 (;@15;)
                                    local.get 2
                                    i32.const 51
                                    i32.eq
                                    br_if 2 (;@14;)
                                    local.get 2
                                    i32.const 76
                                    i32.ne
                                    br_if 5 (;@11;)
                                    i32.const 16
                                    br 12 (;@4;)
                                  end
                                  i32.const 24
                                  br 11 (;@4;)
                                end
                                i32.const 5
                                br 10 (;@4;)
                              end
                              i32.const 25
                              br 9 (;@4;)
                            end
                            i32.const 20
                            br 8 (;@4;)
                          end
                          i32.const 9
                          br 7 (;@4;)
                        end
                        i32.const 19
                        br 6 (;@4;)
                      end
                      local.get 6
                      local.get 6
                      i64.load
                      local.get 8
                      i32.load offset=200
                      local.tee 2
                      i64.extend_i32_u
                      i64.add
                      i64.store
                      local.get 0
                      local.get 1
                      local.get 2
                      call 10
                      i32.store
                      local.get 0
                      i32.const 0
                      i32.store16 offset=4
                      br 8 (;@1;)
                    end
                    i32.const 23
                  end
                  local.set 1
                  local.get 0
                  i64.const 4294967296
                  i64.store align=4
                  local.get 6
                  local.get 1
                  i32.store16 offset=28
                  br 6 (;@1;)
                end
                local.get 6
                i32.const 4718596
                local.get 6
                i32.load8_u offset=38
                i32.const 4
                i32.xor
                i32.const 7
                i32.and
                i32.const 3
                i32.mul
                i32.shr_u
                i32.const 7
                i32.and
                i32.store8 offset=38
                local.get 6
                i64.load
                local.tee 15
                i64.eqz
                br_if 4 (;@2;)
                local.get 6
                i64.const 0
                i64.store
                block  ;; label = @7
                  block  ;; label = @8
                    block  ;; label = @9
                      local.get 6
                      i32.load8_u offset=38
                      i32.const 7
                      i32.and
                      i32.const 1
                      i32.sub
                      br_table 6 (;@3;) 0 (;@9;) 6 (;@3;) 1 (;@8;) 0 (;@9;)
                    end
                    local.get 6
                    i32.load16_u offset=36
                    br_if 1 (;@7;)
                    i32.const 22
                    local.set 3
                    block  ;; label = @9
                      local.get 6
                      i32.load offset=8
                      local.get 15
                      i32.const 0
                      local.get 8
                      i32.const 200
                      i32.add
                      call 1
                      i32.const 65535
                      i32.and
                      local.tee 1
                      i32.const 60
                      i32.sub
                      i32.const 2
                      i32.lt_u
                      br_if 0 (;@9;)
                      local.get 1
                      i32.eqz
                      br_if 6 (;@3;)
                      local.get 1
                      i32.const 28
                      i32.eq
                      local.get 1
                      i32.const 70
                      i32.eq
                      i32.or
                      br_if 0 (;@9;)
                      local.get 1
                      i32.const 76
                      i32.eq
                      if  ;; label = @10
                        i32.const 16
                        local.set 3
                        br 1 (;@9;)
                      end
                      i32.const 19
                      local.set 3
                    end
                    local.get 6
                    local.get 3
                    i32.store16 offset=36
                    br 1 (;@7;)
                  end
                  local.get 6
                  i32.load16_u offset=36
                  i32.eqz
                  br_if 5 (;@2;)
                end
                local.get 0
                i64.const 4294967296
                i64.store align=4
                local.get 6
                i32.const 4
                i32.store8 offset=38
                br 5 (;@1;)
              end
              local.get 6
              local.get 6
              i64.load
              local.get 8
              i32.load offset=200
              local.tee 2
              i64.extend_i32_u
              i64.add
              i64.store
              local.get 0
              local.get 1
              local.get 2
              call 10
              i32.store
              local.get 0
              i32.const 0
              i32.store16 offset=4
              br 4 (;@1;)
            end
            i32.const 23
          end
          local.set 1
          local.get 0
          i64.const 4294967296
          i64.store align=4
          local.get 6
          local.get 1
          i32.store16 offset=28
          br 2 (;@1;)
        end
        local.get 6
        local.get 15
        i64.store
      end
      local.get 0
      i64.const 0
      i64.store align=4
    end
    local.get 8
    i32.const 208
    i32.add
    global.set 0)
  (func $6 (type 2) (param $0 i32) (param $1 i32) (result i32)
    (local $2 i32) (local $3 i32)
    block  ;; label = @1
      local.get 0
      i32.load offset=12
      local.tee 2
      local.get 1
      i32.gt_u
      if  ;; label = @2
        local.get 2
        local.get 1
        i32.sub
        local.tee 2
        if  ;; label = @3
          local.get 0
          i32.load offset=4
          local.tee 3
          local.get 1
          local.get 3
          i32.add
          local.get 2
          memory.copy
        end
        i32.const 0
        local.set 1
        br 1 (;@1;)
      end
      local.get 1
      local.get 2
      i32.sub
      local.set 1
      i32.const 0
      local.set 2
    end
    local.get 0
    local.get 2
    i32.store offset=12
    local.get 1)
  (table $0 5 5 funcref)
  (memory $0 257)
  (global $global$0 (mut i32) (i32.const 16777216))
  (export "memory" (memory 0))
  (export "_start" (func 5))
  (elem $0 (i32.const 1) func 9 8 6 7)
  (data $0 (i32.const 16777216) "Fibonacci(10) = \0a\00\00\00\1c\00\00\01")
  (data $1 (i32.const 16777256) "\15\00\00\00\00\00\00\00\01\00\00\00\02\00\00\00\03\00\00\00\04")
  (data $2 (i32.const 16777280) "\ff\ff\ff\ff")
  (data $3 (i32.const 16777296) "\02\00\00\000\00\00\01\aa\aa\aa\aa"))
