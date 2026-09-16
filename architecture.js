'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={domain:null,stage:null,action:null,mode:'current',selected:'goal'};
const nodes={};
function add(id,title,status,summary,input,output,up,down,gap,evidence=[]){nodes[id]={id,title,status,summary,input,output,up,down,gap,evidence};}
const product=['docs/specs/2026-09-15-me-product-definition-impact.md','产品负责人确认：六大业务支柱 × AI 基建、学习、记忆、调优 × IMPACT。'];
const stateDoc=['docs/STATE.md §3（2026-08-12 历史快照）','模块与代码映射。文档带有日期，不能作为当前生产状态证明。'];
add('goal','企业增长目标','partial','将企业目标、资源与实际经营结果连在一起。',['业务目标、预算、客户事实'],['目标与行动优先级'],['企业经营者'],['行业 Agent、六大业务支柱'],'已有目标与策略模块；完整跨支柱结果闭环需逐路径核验。',[product,['src/lib/strategy · src/app/api/goals','模块入口由 STATE.md 映射；本页未执行生产查询。']]);
add('sources','多平台 / 多屏幕信息','partial','从广告、搜索、社媒、网站和客户系统汇总证据。',['平台数据、客户上传、业务记录'],['带来源的客户上下文'],['广告平台、搜索、社媒、网站、CRM'],['行业 Agent、Inspect、Measure'],'各连接器分散；统一身份、币种、来源和完整性不能假定已经打通。',[stateDoc,['src/lib/meta/client.ts','Meta 读取接口；连接器读取不等于跨平台归一化完成。']]);
add('agent','行业 Agent','partial','使用行业知识、客户上下文和沉淀经验，进行判断并提出行动。',['客户事实、行业知识、目标、历史结果'],['问题、假设、处方、动作候选'],['信息来源、记忆'],['六支柱的 IMPACT'],'Agent 模块已有；行业训练方式、评估效果和每个业务域接线需分别核验。',[product,['docs/STATE.md §3 · Agent 层','lib/{huatuo,zhuge,zhangqian,luban,agent-tools,memory}']]);
add('infra','AI 基建','partial','统一组织模型、工具、连接器与执行治理。',['上下文、动作请求、授权策略'],['模型推理、工具调用、执行记录'],['所有业务支柱'],['IMPACT 各阶段'],'基础模块存在；广告写路径尚未统一经过 Kernel / Gateway。',[product,['src/app/api/clients/[id]/meta-ads/execute/route.ts:28','直接导入 setCampaignStatus / setCampaignDailyBudget，未见 Kernel 调用。']]);
add('learning','学习','partial','从可比较的结果中提炼方法、失败原因和适用条件。',['结果证据、实验身份、复盘结论'],['有适用条件的经验'],['Check、Tune'],['客户记忆、行业经验、下一轮处方'],'广告赢家识别、实验身份与完整结果归因仍有缺口。',[product,['docs/specs/2026-08-15-me2-ads-build-order-v1.md §5','赢家识别与创意映射未形成完整学习闭环；历史审计计数不作为实时值。']]);
add('memory','记忆','partial','保存客户事实、决策和已验证经验，供后续判断使用。',['客户事实、历史决策、学习结论'],['客户上下文与可复用经验'],['客户资料、Check、学习'],['行业 Agent、Prescribe'],'记忆模块已有；广告创意身份与结果关联仍需接线。客户私有记忆与行业经验需分开。',[product,['src/lib/memory · docs/roadmap/2026-08-19-me2-platformization-principle.md','共享机制、行业知识、客户私有事实分层。']]);
add('tuning','调优','partial','将检查和学习结论转成下一轮策略、创意与预算候选。',['可比结果、客户记忆、约束'],['下一轮动作与实验计划'],['Check、学习、记忆'],['Inspect、Prescribe、Act'],'单个平台可调预算不代表跨平台自动 Tune 已完成。',[product]);
add('results','业务结果与复盘','partial','回答动作是否发生、是否推动目标，以及下一步如何改进。',['执行证据、线索、销售、收入指标'],['验证结论、归因分析、经验'],['Act、Check、业务系统'],['学习、记忆、调优'],'现有飞轮模块不等于每条广告路径都已有可信归因。',[product,['docs/ROADMAP.md · AD-ATTR-1','广告指标来源隔离、账户与币种口径存在已记录缺口。']]);
const domains=[['seo','SEO','搜索发现与内容增长','lib/{blog,keywords,seo-gap,seo-intelligence,gsc}'],['social','社交媒体','内容生产、分发与互动','lib/{brief,content,social,reels,publer,scheduling}'],['ads','广告','创意、投放与业务结果','lib/{meta,google-ads,tiktok-ads,ads-strategy}'],['reputation','口碑','客户反馈与品牌声誉','lib/{gbp,places,reports}'],['ai_visibility','AI 可见度','AI 回答中的发现与引用','lib/{geo,ai-tracker,geo-measurement}'],['competitor','竞品','竞争变化与经营决策','lib/{competitors,diagnostic}']];
domains.forEach(([id,title,summary,path])=>add(id,title,'partial',summary,['客户目标、该业务域的平台证据'],['诊断、行动与结果信号'],['行业 Agent、共同底座'],['该支柱的 IMPACT、企业目标'],id==='ads'?'可展开广告当前调用链。其他模块状态不能套用到广告。':'本页仅核对文档模块映射，尚未完成该支柱逐节点运行时审计。',[product,[path,stateDoc[1]]]));
const stages=[['inspect','洞察','Inspect','能看：发现问题与机会'],['measure','测量','Measure','能看：建立可比的证据'],['prescribe','处方','Prescribe','能想：提出策略与候选'],['act','执行','Act','能干：在平台完成动作'],['check','检查 / 复盘','Check','能复盘：核对实际结果'],['tune','调优','Tune','能学习：改进下一轮']];
stages.forEach(([id,title,en,summary],i)=>add(id,title,'partial',summary,['上游证据、客户目标与规则'],[id==='act'?'平台对象、状态变化与执行记录':'本阶段结论与后续输入'],[i?stages[i-1][1]:'多平台信息、客户目标'],[i<5?stages[i+1][1]:'下一轮洞察、记忆'],'当前状态按业务域和具体调用链分别核验。',[product]));
Object.assign(nodes.act,{input:['结构化草稿，或 action_type + campaign_id + 参数'],output:['Meta 实体或平台状态变更','执行响应与部分审计记录'],gap:'Meta 现有路径直接写平台。缺统一网关、完整身份、生产就绪验证。'});
Object.assign(nodes.measure,{gap:'广告来源、币种、创意与实验身份仍有缺口；不可比数据不能直接用于扩量。'});
Object.assign(nodes.tune,{gap:'广告自动调优闭环是目标能力；预算修改接口本身不提供赢家识别和跨平台编排。'});
const meta='src/app/api/clients/[id]/meta-ads/execute/route.ts';
add('request','接收执行请求','existing','当前由接口调用方提交具体对象与动作。',['action_type、campaign_id、new_daily_budget'],['已解析的动作请求'],['接口调用方'],['客户访问与对象归属检查'],'不是从完整 AI 处方自动编译的统一动作契约。',[[meta+':48','ExecuteBody: action_type, campaign_id, params.new_daily_budget']]);
add('ownership','校验客户与账户归属','partial','Meta 路由检查用户访问和 Campaign 所属广告账户。',['clientId、campaignId、token'],['当前 Campaign 状态与预算'],['执行请求'],['预算守卫'],'同一广告账户被多个客户共用时，仅账户归属不足以隔离客户。',[[meta+':105','const ownership = await assertCampaignOwnedByClient(campaign_id, clientId, accessToken)']]);
add('guard','检查单次预算幅度','existing','将新预算与当前日预算比较，超出 ±20% 时返回拒绝。',['当前预算、新日预算'],['通过或 exceeds_safe_adjustment'],['账户归属检查'],['平台写入'],'单次限制不能替代累计预算上限；当前入口仅支持 Campaign 级预算。',[[meta+':162','const guard = checkBudgetWithinSafeRange(currentCents, budgetCents)'],['src/lib/meta/guardrails.ts','±20% safe-adjustment band；非正数当前预算不能自动调整。']]);
add('write','直接调用 Meta 写预算','existing','路由通过 Meta 客户端更新 Campaign 日预算。',['campaign_id、token、budgetCents'],['平台 API 执行结果'],['单次预算守卫'],['条件回读、审计'],'未接统一 Kernel/Gateway；币种在当前调用链中未完整表达。',[[meta+':180','metaSuccess = await setCampaignDailyBudget(campaign_id, accessToken, budgetCents)']]);
add('readback','条件回读投放状态','partial','代码意图：原状态 ACTIVE 且改预算成功后回读，必要时恢复。',['修改结果、原状态'],['状态确认或警告'],['Meta 写入'],['审计与接口响应'],'本地文件调用 getCampaignDetails，但导入列表缺少该函数；该分支不能标为已验证可用。',[[meta+':188','const reread = await getCampaignDetails(campaign_id, accessToken)\n本地导入列表未包含 getCampaignDetails。']]);
add('audit','写执行审计','partial','将前后状态和预期指标写入 flywheel_actions。',['before、after、expected_metric'],['actionId 或审计失败警告'],['平台写入、回读'],['检查与归因'],'平台已执行而审计写入失败时，接口返回部分成功；并非可靠事务闭环。',[[meta+':220',".from('flywheel_actions').insert({ payload: { before, after }, expected_metric })"]]);
add('draft','接收广告草稿','existing','接收结构化 AdDraft，并从客户记录读取广告账户。',['AdDraft、客户账户与 Page'],['createDraftForApproval 请求'],['调用方准备的草稿'],['创建暂停广告'],'接口接收草稿不代表已接通 AI 创意生成、素材上传与自动调用。',[['src/app/api/clients/[id]/meta-ads/draft/route.ts','const outcome = await createDraftForApproval(draft, { ... })']]);
add('paused','创建暂停广告结构','existing','创建 Campaign → Ad Set → Creative → Ad，均先暂停。',['AdDraft、Meta token、账户'],['campaignId、adSetId、adIds'],['草稿接口'],['配置回读'],'部分失败清理存在；被阻止或否决后的完整终态清理另有缺口。',[['src/lib/meta/ad-publisher.ts:160','publishDraftPaused: status PAUSED；逐个创建广告对象。']]);
add('launchcheck','回读与草稿闸门','partial','创建后读取广告组与创意，再执行 checkLaunch。',['已创建广告对象'],['awaiting_approval / blocked / failed'],['暂停广告结构'],['审批等待'],'完整文案、预算排期与激活前重新验证存在已记录缺口。',[['src/lib/ads-strategy/draft-and-gate.ts:128','fetchAdSetReadback(...)\nfetchAdCreativesReadback(...)\ncheckLaunch(...)'],['docs/ROADMAP.md · AD-GATE-1','激活前重新回读、预算与排期一致性、审批并发等缺口。']]);
add('approval','审批后激活','partial','approveDraft 调用 activatePublished，按广告、广告组、系列激活。',['awaiting_approval 的草稿、批准动作'],['ACTIVE 或错误响应'],['草稿闸门、人工批准'],['检查与审计'],'当前保留审批；并发认领、重新回读与部分失败恢复需补齐。',[['src/lib/ads-strategy/draft-and-gate.ts:174','approveDraft → activatePublished'],['src/lib/meta/ad-publisher.ts:257','按 adIds → adSetId → campaignId 修改 ACTIVE。']]);
add('googlewrite','Google 平台动作','partial','执行 Campaign 暂停、恢复、预算调整或添加否定关键词。',['customer_id、campaign_id、动作参数'],['API 结果和审计记录'],['独立 Google execute 路由'],['后续检查与归因'],'客户账户归属仍有 TODO；不得直接作为多客户生产就绪证明。',[['src/app/api/clients/[id]/google-ads/execute/route.ts','setCampaignStatus / setCampaignBudget / addCampaignNegativeKeyword\nTODO: Validate google_ads_customer_id against client account.']]);
add('candidate','统一动作候选','planned','把处方编译成平台无关、带证据和验证方式的动作候选。',['处方、目标、对象身份'],['ActionCandidate、验证定义'],['Prescribe'],['统一执行治理'],'目标接线：需对接现有 Growth 契约与广告动作。',[product]);
add('gateway','统一执行治理 / 网关','planned','在共享入口处理授权、幂等、预算边界、失败恢复与追溯。',['动作候选、策略、对象身份'],['授权结果、执行任务与记录'],['统一动作候选'],['平台 Adapter'],'现有广告路由未接此链路。图上蓝色节点是目标接线。',[['docs/specs/2026-08-10-me2-wp00-contract-freeze-v1.0.md §3','Shared Capability / Kernel 的职责边界。']]);
add('adapter','平台执行能力','planned','通过统一契约调用 Meta / Google / TikTok 的已有或扩展能力。',['已授权的请求'],['平台结果、对象身份'],['统一网关'],['验证与审计'],'复用现有客户端；统一接口与治理接线待实现。',[product]);
add('verified','完整验证与结果回流','planned','验证对象与配置，将动作身份连到创意、线索和业务结果。',['平台回读、执行身份、业务结果'],['验证状态、学习证据'],['平台 Adapter'],['Check、学习、记忆、Tune'],'需补齐广告身份、来源币种口径和可信归因。',[product]);
add('draftrecord','保存待批草稿记录','partial','回读完成后将草稿、平台对象与状态写入账本，供后续审批读取。',['草稿、对象 ID、回读结果'],['actionId、awaiting_approval 或 blocked'],['回读与草稿闸门'],['审批后激活'],'状态持久化不等于平台对象完成清理或获得执行授权。',[['src/lib/ads-strategy/draft-and-gate.ts:158','record(deps.supabase, draft.clientId, { status, draft, summary, readback, campaignId, adSetId, adIds })']]);
add('activerecord','更新草稿为 active','partial','激活成功后更新原草稿账本的 payload 状态。',['已激活的广告对象、actionId'],['账本 active 状态'],['审批后激活'],['后续检查'],'此更新没有检查返回错误；平台激活与账本一致性不能视为已保证。',[['src/lib/ads-strategy/draft-and-gate.ts:204',".from('flywheel_actions').update({ payload: { ...p, status: 'active' } }).eq('id', actionId)"]]);
add('googlerequest','接收 Google 执行请求','partial','从请求体读取平台账户、Campaign 与动作类型。',['google_ads_customer_id、campaign_id、action_type、params'],['Google 客户端调用参数'],['Google execute 接口调用方'],['Google 平台动作'],'调用方账户 ID 的客户归属验证仍待补齐。',[['src/app/api/clients/[id]/google-ads/execute/route.ts','ExecuteBody 包含 google_ads_customer_id、campaign_id 与 params。']]);
add('googleaudit','记录 Google 执行结果','partial','将 Google 的前后状态、关键词参数和预期指标写入飞轮账本。',['before、after、关键词参数'],['actionId 或审计失败警告'],['Google 平台动作'],['检查与归因'],'审计失败可在平台动作已成功后发生；预期指标解析也有来源缺口。',[['src/app/api/clients/[id]/google-ads/execute/route.ts:252',".from('flywheel_actions').insert({ vendor: 'google_ads', payload: { before, after, ... }, expected_metric })"]]);
const paths={budget:{title:'Meta · 调整预算',ids:['request','ownership','guard','write','readback','audit']},publish:{title:'Meta · 创建与发布',ids:['draft','paused','launchcheck','draftrecord','approval','activerecord']},google:{title:'Google · 执行动作',ids:['googlerequest','googlewrite','googleaudit']}};
const targetPath=['candidate','gateway','adapter','verified'];
let edges=[];
const labels={existing:'代码已有',partial:'局部实现 / 有缺口',planned:'目标设计'};
function status(n){return '<span class="status '+n.status+'">'+labels[n.status]+'</span>'}
function node(id,extra=''){const n=nodes[id];return '<button class="node '+(state.selected===id?'selected':'')+'" data-node="'+id+'">'+extra+status(n)+'<strong>'+esc(n.title)+'</strong><p>'+esc(n.summary)+'</p></button>'}
function band(title,sub,html){return '<section class="band"><div class="band-head"><h2>'+title+'</h2><small>'+sub+'</small></div>'+html+'</section>'}
function foundations(){return band('共同底座','横跨所有业务域与阶段','<div class="foundation-grid">'+['infra','learning','memory','tuning'].map(id=>node(id)).join('')+'</div>')}
function edge(from,to,desc,gap=false){return {from,to,desc,gap}}
function render(){
 $('domains').innerHTML=domains.map(([id,title])=>'<button class="nav '+(state.domain===id?'selected':'')+'" data-domain="'+id+'">'+title+'</button>').join('');
 $('foundations').innerHTML=['infra','learning','memory','tuning'].map(id=>'<button class="nav" data-node="'+id+'">'+nodes[id].title+'</button>').join('');
 $('overview').classList.toggle('selected',!state.domain);$('current').setAttribute('aria-pressed',state.mode==='current');$('target').setAttribute('aria-pressed',state.mode==='target');
 $('breadcrumb').textContent='企业增长'+(state.domain?' / '+nodes[state.domain].title:'')+(state.stage?' / '+nodes[state.stage].title:'')+(state.action?' / '+paths[state.action].title:'');
 $('eyebrow').textContent=state.mode==='current'?'CURRENT / 本地证据视图':'TARGET / 产品设计视图';
 $('scope').textContent=state.mode==='target'?'目标能力 ≠ 已实现':state.domain==='ads'?'广告链路已查代码':'模块映射 · 非全面运行审计';
 let html='';
 if(!state.domain){
 $('title').textContent='ME 如何把信息变成增长结果';
 $('subtitle').textContent='从不同平台和屏幕汇总信息，让行业 Agent 沿 IMPACT 看、想、干、学习与复盘。选择业务支柱继续展开。';
 html=band('经营目标与跨平台信息','点击节点查看输入 / 输出','<div class="node-grid">'+['goal','sources','agent'].map(id=>node(id)).join('')+'</div>')+'<div class="flow-arrow">↓ 行业知识 + 客户上下文 → 业务判断</div>'+band('六大业务支柱','工作领域，不是技术层级','<div class="node-grid">'+domains.map(([id])=>node(id)).join('')+'</div>')+'<div class="flow-arrow">↓ 每个业务域都采用 IMPACT 路径</div>'+band('IMPACT','共同工作路径','<div class="impact-grid">'+stages.map(([id,,en],i)=>node(id,'<span class="number">'+(i+1)+' / '+en+'</span>')).join('')+'</div>')+foundations()+band('结果回流','Check → 学习 / 记忆 → Tune',node('results'));
 edges=[edge('sources','agent','有来源的信息 → 客户 / 行业上下文',true),edge('agent','prescribe','行业判断 → 动作候选',true),edge('act','results','动作证据 → 业务结果',true),edge('results','memory','复盘结论 → 可复用经验',true)];
 }else if(state.action){
 const path=paths[state.action],ids=state.mode==='current'?path.ids:targetPath;
 $('title').textContent=path.title+' · '+(state.mode==='current'?'实际调用链':'目标调用链');
 $('subtitle').textContent=state.mode==='current'?'按源码调用顺序展开。点击每一步检查参数、返回值、代码摘录与断点。':'统一动作候选进入治理网关，再调用平台执行能力；这是待实现的连接关系。';
 html='<div class="actions">'+Object.entries(paths).map(([id,p])=>'<button data-action="'+id+'" class="'+(state.action===id?'selected':'')+'">'+p.title+'</button>').join('')+'</div><div class="chain">'+ids.map((id,i)=>(i?'<div class="connector">↓ '+(state.mode==='target'?'计划接线':'调用 / 条件进入')+'</div>':'')+node(id,'<span class="number">0'+(i+1)+'</span>')).join('')+'</div>';
 if(state.mode==='current')html+='<div class="callout">缺失连接：AI 处方 → 统一动作候选 → 执行网关。当前入口直接调平台，不能展示成已经闭环。</div>';
 html+='<button class="drill" data-stage="act">← 返回广告执行能力</button>';
 edges=ids.slice(0,-1).map((id,i)=>edge(id,ids[i+1],nodes[ids[i+1]].input.join('；'),state.mode==='target'||nodes[ids[i+1]].status==='partial'));
 }else{
 $('title').textContent=nodes[state.domain].title+' · '+(state.stage?nodes[state.stage].title:'IMPACT 架构');
 $('subtitle').textContent=state.domain==='ads'?'当前重点核验广告执行路径。选择阶段，再进入预算调整或创建发布的实际调用链。':'该支柱已纳入产品定义；以下展示职责与文档映射，逐阶段源码接线仍待核验。';
 html=band('行业 Agent 与客户上下文','共享能力，服务当前业务域',node('agent'))+band('IMPACT','选择阶段查看工作边界','<div class="impact-grid">'+stages.map(([id,,en],i)=>node(id,'<span class="number">'+(i+1)+' / '+en+'</span>')).join('')+'</div>');
 if(state.stage){const n=nodes[state.stage];html+=band(nodes[state.domain].title+' / '+n.title,'阶段责任','<p>'+esc(n.summary)+'</p><p class="basis">'+esc(n.gap)+'</p>');}
 if(state.domain==='ads'&&state.stage==='act')html+=band('可展开的执行路径','点击进入代码调用链','<div class="actions">'+Object.entries(paths).map(([id,p])=>'<button class="primary" data-action="'+id+'">'+p.title+' ↗</button>').join('')+'</div>');
 html+=foundations();
 edges=stages.slice(0,-1).map(([id],i)=>edge(id,stages[i+1][0],nodes[stages[i+1][0]].input.join('；'),true));
 }
 if(state.mode==='target'&&!state.action)html=band('需要补齐的共同连接','目标架构 / 不代表已上线','<div class="node-grid">'+['candidate','gateway','verified'].map(id=>node(id)).join('')+'</div><p class="basis">下方保留已有组件作为复用依据；新增连接将处方、执行治理与结果验证连成闭环。</p>')+html;
 $('canvas').innerHTML=engineGraph();
 $('edges').innerHTML=edges.map((e,i)=>'<button data-edge="'+i+'" class="'+(e.gap?'gap':'')+'">'+esc(nodes[e.from].title)+' → '+esc(nodes[e.to].title)+'<span>'+esc(state.mode==='target'?'计划连接':e.gap?'存在接线 / 验证缺口':e.desc)+'</span></button>').join('');
 bind();bindGraph();showNode(state.selected,false);
}
function field(title,items){return '<div class="field"><h3>'+title+'</h3><ul>'+items.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul></div>'}
function evidence(n){return '<div class="field"><h3>实现 / 定义证据 · 点击展开</h3>'+n.evidence.map(([path,quote])=>'<details class="evidence"><summary>'+esc(path)+'</summary><pre>'+esc(quote)+'</pre></details>').join('')+'</div>'}
function openDetail(){document.querySelector('.inspector').classList.add('open')}
function showNode(id,open=true){
 const n=nodes[id]||nodes.goal;state.selected=n.id;
 document.querySelectorAll('.node').forEach(b=>b.classList.toggle('selected',b.dataset.node===id));
 highlightGraph(id);
 $('details').innerHTML=status(n)+'<h2>'+esc(n.title)+'</h2><p>'+esc(n.summary)+'</p>'+field('接收什么',n.input)+field('输出什么',n.output)+field('上游',n.up)+field('下游 / 消费者',n.down)+'<div class="warning"><strong>尚未闭合 / 需核验</strong><br>'+esc(n.gap)+'</div>'+evidence(n)+'<p class="basis">本页没有查询生产环境。“代码已有”不表示已经生产验证。</p>';
 if(domains.some(d=>d[0]===id))$('details').innerHTML+='<button class="primary drill" id="detailDrill">进入 '+esc(n.title)+' 的 IMPACT →</button>';
 else if(id==='act')$('details').innerHTML+='<button class="primary drill" id="detailDrill">展开广告执行调用链 →</button>';
 if($('detailDrill'))$('detailDrill').onclick=()=>{if(id==='act'){state.domain='ads';state.stage='act';state.action='budget';state.selected='request'}else{state.domain=id;state.stage=null;state.action=null}render();document.querySelector('.inspector').classList.remove('open')};
 if(open)openDetail();
}
function bind(){
 document.querySelectorAll('[data-domain]').forEach(b=>b.onclick=()=>{state.domain=b.dataset.domain;state.stage=null;state.action=null;state.selected=state.domain;render()});
 document.querySelectorAll('[data-node]').forEach(b=>b.onclick=()=>{const id=b.dataset.node;if(stages.some(s=>s[0]===id)&&state.domain&&!state.action){state.stage=id;state.selected=id;render();openDetail()}else showNode(id)});
 document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{state.action=b.dataset.action;state.stage='act';state.selected=state.mode==='current'?paths[state.action].ids[0]:'candidate';render()});
 document.querySelectorAll('[data-stage]').forEach(b=>b.onclick=()=>{state.action=null;state.stage=b.dataset.stage;state.selected=state.stage;render()});
 document.querySelectorAll('[data-edge]').forEach(b=>b.onclick=()=>{const e=edges[+b.dataset.edge],a=nodes[e.from],z=nodes[e.to];document.querySelectorAll('[data-edge]').forEach(x=>x.classList.toggle('selected',x===b));$('details').innerHTML='<span class="status '+(e.gap?'partial':'existing')+'">'+(state.mode==='target'?'目标连接':e.gap?'接线 / 验证缺口':'调用路径已见')+'</span><h2>'+esc(a.title)+' → '+esc(z.title)+'</h2>'+field('传递什么',[e.desc])+field('上游输出',a.output)+field('下游所需输入',z.input)+'<div class="warning">'+esc(z.gap)+'</div>'+evidence(z);openDetail()});
}
function home(){Object.assign(state,{domain:null,stage:null,action:null,selected:'goal'});render();document.querySelector('.inspector').classList.remove('open')}
 $('home').onclick=home;$('overview').onclick=home;
 ['current','target'].forEach(mode=>$(mode).onclick=()=>{state.mode=mode;if(state.action)state.selected=mode==='target'?'candidate':paths[state.action].ids[0];render()});
 $('closeDetail').onclick=()=>document.querySelector('.inspector').classList.remove('open');
 document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelector('.inspector').classList.remove('open')});
 $('full').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch{$('full').textContent='请用浏览器全屏'}};
 render();
