-- ============================================================================
--  Tailor-made 画册（第二种交付文档，挂在既有报价单上）
-- ----------------------------------------------------------------------------
--  行程单回答「每天去哪、住哪、多少钱」；画册回答「这些地方长什么样、为什么值得去」。
--  两份文档发给同一个终端客户、共用同一个报价编号和客户名，所以是同一行上的
--  第二个 payload，不是另一张表 —— 另起一张表就要维护两边的客户名同步，
--  而顾问改了客户名却只同步了一份，就会把两份文件发给两个不同称呼的人。
--
--  brochure 可空：绝大多数报价单只出行程单，画册是选配。
--  null = 这份报价单还没做画册；非 null = 做了（哪怕只是空壳草稿）。
--
--  schema 见 templates/tailor-made-brochure/README.md
--  日期：2026-08-30
-- ============================================================================

alter table tailor_made_itineraries
  add column brochure jsonb;

comment on column tailor_made_itineraries.brochure is
  '画册 JSON（选配，null = 未创建）；schema 见 templates/tailor-made-brochure/README.md';

-- 列表页要显示「这单有没有画册」，只需判空，不必把整个 JSON 读出来。
-- 部分索引只收录真正有画册的行 —— 目前绝大多数行是 null。
create index idx_tailor_made_has_brochure
  on tailor_made_itineraries (client_id)
  where brochure is not null;
