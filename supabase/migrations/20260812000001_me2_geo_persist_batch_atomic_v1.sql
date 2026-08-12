-- ============================================================================
-- Magic Engine 2.0 · GEO 测量批次的原子落库 RPC（Issue #883 / #917 · WP04A）
--
-- ⚠️ **本文件只提交代码与测试，尚未 apply。** apply 是单独授权的运维动作（A5），
--    绝不夹带进任何 PR（WP00 §9.2 / CLAUDE.md 铁律 2 的不可逆操作例外）。
--
-- ────────────────────────────────────────────────────────────────────────────
-- 为什么必须有这个函数
-- ────────────────────────────────────────────────────────────────────────────
--
-- WP04 冻结的 store 契约（`src/lib/geo-measurement-runtime/types.ts:163-168`）要求
-- `persistBatch` 对「批次 + 全部观测 + 全部证据」做**全有或全无**的持久化。
--
-- 走 PostgREST 做不到：三张表就是三条独立 HTTP 请求 = 三个事务。
-- WP03 的 migration 自己把这件事写死了（`20260811000001_...sql:529-534`、`:897-898`）。
--
-- 起初的做法是「三条定序 INSERT + 事后对账 + 不一致就大声失败」。**那个做法是错的**：
-- 对账只能**发现**污染，不能**阻止**污染。而这三张表的 UPDATE / DELETE 被
-- `geo_immutable_row` 触发器全禁（`:789-819`），还有 TRUNCATE 守卫 ——
-- 也就是说一旦写出半截数据，它**既补不上也删不掉，永久留在证据库里**。
-- 一个「已声明的取舍」并不能让契约违反变成不违反；何况这里的代价是不可逆的。
--
-- 一个 plpgsql 函数体跑在**单个事务**里：任何一步抛错，整个函数的写入全部回滚，
-- 一行不留。这是这套 schema 上唯一真正满足契约的办法。
--
-- ────────────────────────────────────────────────────────────────────────────
-- 权限设计：**刻意不用 SECURITY DEFINER**
-- ────────────────────────────────────────────────────────────────────────────
--
-- 🔴 仓库里既有的 `kernel_*` RPC 都是 `SECURITY DEFINER`，本函数**故意不跟**。
--
--    唯一的调用方是 `service_role`（`src/lib/supabase.ts` 的 supabaseAdmin），
--    而 service_role 本来就绕过 RLS、本来就有这三张表的 INSERT 权限 ——
--    也就是说 DEFINER **不会让这个函数多做成任何一件事**，只会凭空造出一个
--    「以属主身份运行」的提权面。最小权限的答案就是 INVOKER。
--
--    副作用是好的：万一将来有人用一个权限不足的角色去调它，会当场因为缺
--    INSERT 权限而失败（fail closed），而不是被函数默默代跑。
--
-- 🔴 `SET search_path` 显式钉死：即便是 INVOKER，不钉 search_path 也可能被调用方
--    的会话设置牵着走（把 `public.geo_batches` 解析到别的 schema）。
-- 🔴 EXECUTE 权限先全撤再单授 service_role —— 不留 PUBLIC 默认可执行。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.geo_persist_batch_v1(
  p_client_id    uuid,
  p_batch        jsonb,
  p_observations jsonb,
  p_evidence     jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
-- 🔴 刻意是 INVOKER（不写 SECURITY DEFINER）—— 理由见文件头。
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch_id        uuid;
  v_batch_client    uuid;
  v_observations    integer;
  v_evidence        integer;
  v_bad             integer;
BEGIN
  -- 🔴 **刻意没有 EXCEPTION 块。** 任何一步抛错都要让整个事务回滚；
  --    捕获异常会开子事务，反而可能把「部分成功」变成一个可提交的状态。
  --    这个函数的全部价值就是「要么全进，要么一行不留」。

  IF p_client_id IS NULL THEN
    RAISE EXCEPTION 'geo_persist_batch_v1: p_client_id 不能为空' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF jsonb_typeof(p_batch) <> 'object' THEN
    RAISE EXCEPTION 'geo_persist_batch_v1: p_batch 必须是一个 JSON 对象' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF jsonb_typeof(p_observations) <> 'array' OR jsonb_typeof(p_evidence) <> 'array' THEN
    RAISE EXCEPTION 'geo_persist_batch_v1: p_observations / p_evidence 必须是 JSON 数组'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_batch_id     := (p_batch ->> 'id')::uuid;
  v_batch_client := (p_batch ->> 'client_id')::uuid;

  IF v_batch_id IS NULL THEN
    RAISE EXCEPTION 'geo_persist_batch_v1: 批次缺 id' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── 租户闸：三张表的每一行都必须属于同一个客户 ─────────────────────────────
  -- 库层的复合外键只保证「批次与查询集同租户」「观测与批次同租户」，
  -- 保证不了「调用方传进来的这一堆行本来就是同一个客户的」。这里补上。
  IF v_batch_client IS DISTINCT FROM p_client_id THEN
    RAISE EXCEPTION 'geo_persist_batch_v1: 批次 client_id (%) 与调用声明的 (%) 不一致',
      v_batch_client, p_client_id USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(p_observations) AS o
   WHERE (o.value ->> 'client_id')::uuid IS DISTINCT FROM p_client_id
      OR (o.value ->> 'batch_id')::uuid  IS DISTINCT FROM v_batch_id;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'geo_persist_batch_v1: % 条观测的 client_id/batch_id 与本批次不符', v_bad
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(p_evidence) AS e
   WHERE (e.value ->> 'client_id')::uuid IS DISTINCT FROM p_client_id;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'geo_persist_batch_v1: % 条证据的 client_id 与本批次不符', v_bad
      USING ERRCODE = 'check_violation';
  END IF;

  -- ── ① 批次终态行（同时触发查询集上锁，见 20260811000001:766-783）───────────
  INSERT INTO public.geo_batches
  SELECT * FROM jsonb_populate_record(NULL::public.geo_batches, p_batch);

  -- ── ② 整批观测（单条语句多行插入）─────────────────────────────────────────
  INSERT INTO public.geo_observations
  SELECT * FROM jsonb_populate_recordset(NULL::public.geo_observations, p_observations);
  GET DIAGNOSTICS v_observations = ROW_COUNT;

  -- ── ③ 整批证据 ────────────────────────────────────────────────────────────
  -- 🔴 **列清单必须显式写出，且不能包含 `raw_response_locator`** ——
  --    那是 `GENERATED ALWAYS AS ... STORED` 列（`20260811000001:508-512`），
  --    写入方给它赋值 Postgres 会直接拒。`SELECT *` 会带上它。
  INSERT INTO public.geo_evidence (
    id, client_id, observation_id, raw_response, raw_response_unknown_reason, citations, created_at
  )
  SELECT r.id, r.client_id, r.observation_id, r.raw_response, r.raw_response_unknown_reason,
         r.citations, r.created_at
    FROM jsonb_populate_recordset(NULL::public.geo_evidence, p_evidence) AS r;
  GET DIAGNOSTICS v_evidence = ROW_COUNT;

  -- ── 事务内自检：成功观测必须都有证据 ──────────────────────────────────────
  -- 🔴 这一条**在事务内**跑，所以它不是「事后发现污染」，而是「阻止污染提交」。
  --    库层拦不住「成功的观测却没有证据行」（20260811000001:897-898 明说），
  --    在这里补一刀，不过关就整批回滚。
  SELECT count(*) INTO v_bad
    FROM public.geo_observations o
    LEFT JOIN public.geo_evidence e ON e.observation_id = o.id
   WHERE o.batch_id = v_batch_id
     AND o.outcome_ok
     AND e.id IS NULL;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'geo_persist_batch_v1: % 条成功观测没有对应证据行，整批回滚', v_bad
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'observations', v_observations,
    'evidence', v_evidence
  );
END;
$$;

COMMENT ON FUNCTION public.geo_persist_batch_v1(uuid, jsonb, jsonb, jsonb) IS
  'GEO 测量批次的原子落库：批次 + 观测 + 证据在同一个事务内全有或全无。'
  '任一步失败整批回滚，绝不留下不可删除的半截证据。刻意用 INVOKER 权限，不提权。';

-- 🔴 EXECUTE 先全撤再单授 —— 不留 PUBLIC 默认可执行。
REVOKE EXECUTE ON FUNCTION public.geo_persist_batch_v1(uuid, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.geo_persist_batch_v1(uuid, jsonb, jsonb, jsonb)
  TO service_role;

-- 🔴 不发这一句，PostgREST 的 schema 缓存里没有这个函数，第一次 .rpc() 会拿到
--    「function does not exist」—— 那个报错看起来像「migration 没 apply」，能把人带偏很久。
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- apply 之后必须自验的几条（WP00 §2 规则 2：文件名不是 apply 证据）
--
--   -- 函数在，且是 INVOKER（prosecdef = false）
--   SELECT p.proname, p.prosecdef, p.proconfig
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'geo_persist_batch_v1';
--   -- prosecdef 必须是 f；proconfig 必须含 search_path=public, pg_temp
--
--   -- 只有 service_role 能执行
--   SELECT grantee, privilege_type
--     FROM information_schema.routine_privileges
--    WHERE routine_name = 'geo_persist_batch_v1';
--   -- 只应看到 service_role 的 EXECUTE
-- ============================================================================
