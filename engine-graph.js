'use strict';
let graphLayout={},graphWidth=1200,graphHeight=910;
let graphTransform={x:0,y:0,k:1};
function engineGraph(){
 graphLayout={};edges=[];graphTransform={x:0,y:0,k:1};
 const place=(id,x,y,w=154,h=76)=>{graphLayout[id]={x,y,w,h};};
 const link=(from,to,desc,gap=true,route='vertical')=>edges.push({...edge(from,to,desc,gap),route});
 let lanes='';
 const lane=(y,label)=>'<text class="lane-title" x="38" y="'+y+'">'+label+'</text><line class="lane-rule" x1="38" y1="'+(y+12)+'" x2="1162" y2="'+(y+12)+'"/>';
 graphWidth=1200;graphHeight=910;
 if(state.action){
 graphHeight=730;
 const ids=state.mode==='target'?targetPath:paths[state.action].ids;
 const positions=[[210,165],[600,165],[990,165],[990,370],[600,370],[210,370]];
 ids.forEach((id,i)=>place(id,...positions[i],246,104));
 ids.slice(0,-1).forEach((id,i)=>link(id,ids[i+1],nodes[ids[i+1]].input.join('；'),state.mode==='target'||nodes[ids[i+1]].status==='partial',i===2?'vertical':'horizontal'));
 lanes=lane(56,state.mode==='current'?'ACT / 当前代码调用顺序':'ACT / 目标执行架构');
 if(state.mode==='current'){
 place('gateway',600,605,300,92);
 link(ids[0],'gateway','缺失接线：动作入口尚未接统一执行网关',true,'feedback');
 lanes+=lane(492,'待接入的共同治理 / 虚线表示缺口');
 }
 }else{
 place('sources',215,107,260,76);place('goal',600,107,228,76);place('agent',990,107,260,76);
 link('sources','agent','跨平台证据进入行业上下文',true,'overhead');link('goal','agent','企业目标约束行业判断',true,'horizontal');
 lanes=lane(28,'01 / 信息与行业判断');
 if(state.domain){place(state.domain,600,285,340,88);link('agent',state.domain,'行业 Agent 为当前业务域提供判断',true);link(state.domain,'inspect','业务问题进入 IMPACT',true);}
 else domains.forEach(([id],i)=>{place(id,145+i*182,285);link('agent',id,'行业判断服务业务支柱',true);link(id,'inspect','按共同 IMPACT 路径开展工作',true,'bus')});
 lanes+=lane(202,'02 / 六大业务支柱'+(state.domain?' / '+nodes[state.domain].title:''));
 stages.forEach(([id],i)=>place(id,145+i*182,472,154,90));
 stages.slice(0,-1).forEach(([id],i)=>link(id,stages[i+1][0],nodes[stages[i+1][0]].input.join('；'),true,'horizontal'));
 lanes+=lane(377,'03 / IMPACT 工作路径');
 place('results',600,624,300,74);link('check','results','回读与业务结果进入复盘',true);link('tune','inspect','新计划进入下一轮 IMPACT',true,'loop');
 ['infra','learning','memory','tuning'].forEach((id,i)=>place(id,235+i*245,795,202,82));
 link('results','learning','从结果提取适用经验',true);link('learning','memory','将可复用经验写入记忆',true,'horizontal');
 link('memory','tuning','历史经验支持下一轮调整',true,'horizontal');
 link('infra','act','共享基建支撑执行治理；广告尚未统一接线',true,'feedback');
 link('memory','agent','客户与行业记忆回到推理上下文',true,'outer');
 lanes+=lane(708,'04 / 共同 AI 底座 · 学习与记忆回流');
 if(state.mode==='target'){
 place('candidate',225,624,230,74);place('gateway',985,624,244,74);
 link('prescribe','candidate','生成统一动作候选',true);link('candidate','gateway','候选进入共享授权与执行治理',true,'under');
 link('gateway','act','已授权动作调用平台能力',true,'vertical');
 }
 }
 graphWidth=1610;
 lanes+='<text x="1250" y="'+(graphHeight-48)+'" fill="#77bdf0" font-size="13">蓝线 → 读取 / 响应 / 业务回传</text><text x="1250" y="'+(graphHeight-28)+'" fill="#ebcb8b" font-size="13">金线 → 发布 / 状态 / 预算动作</text>';
 lanes+='<rect class="platform-zone" x="1220" y="20" width="365" height="'+(graphHeight-45)+'" rx="20"/><text class="platform-title" x="1250" y="54">外部平台与业务系统</text><text class="platform-subtitle" x="1250" y="78">ME 之外 · 信息来源 / 执行目的地</text>';
 const platformLink=(from,to,desc,kind,gap=true)=>{link(from,to,desc,gap,kind==='read'?'platform-read':'platform-write');edges[edges.length-1].kind=kind;};
 if(state.action){
 const provider=state.action==='google'?'platform_google':'platform_meta';
 place(provider,1400,240,290,100);
 const sender=state.mode==='target'?'adapter':state.action==='google'?'googlewrite':state.action==='publish'?'paused':'write';
 const receiver=state.mode==='target'?'verified':state.action==='publish'?'launchcheck':state.action==='google'?'googleaudit':'readback';
 platformLink(sender,provider,'提交平台动作：'+nodes[sender].output.join('；'),'write',state.mode==='target');
 platformLink(provider,receiver,'平台响应 / 回读：'+nodes[provider].output.join('；'),'read',true);
 }else{
 ['platform_meta','platform_google','platform_tiktok','platform_web','platform_crm'].forEach((id,i)=>{
 place(id,1400,158+i*153,290,94);
 platformLink(id,id==='platform_crm'?'results':'sources',id==='platform_crm'?'目标回传：线索质量、成交和收入':'读取数据：'+nodes[id].output.join('；'),'read',true);
 if(i<3&&(!state.domain||state.domain==='ads'))platformLink('act',id,'广告动作：'+nodes[id].input.join('；'),'write',true);
 });
 }
 const arrows=edges.map((e,i)=>'<g class="graph-edge '+(e.kind||'')+' '+(e.gap?'uncertain':'')+'" data-graph-edge="'+i+'"><path class="edge-hit" data-edge="'+i+'" role="button" tabindex="0" aria-label="'+esc(nodes[e.from].title+'到'+nodes[e.to].title)+'" d="'+graphPath(e)+'"/><path class="wire" d="'+graphPath(e)+'" marker-end="url(#arrow)"/><path class="signal" d="'+graphPath(e)+'"/></g>').join('');
 const nodeMarkup=Object.entries(graphLayout).map(([id,p])=>{
 const n=nodes[id],short=n.status==='existing'?'代码已有':n.status==='planned'?'目标设计':'局部实现 / 待核验';
 const title=p.w>=260?[n.title]:n.title.length>13?[n.title.slice(0,13),n.title.slice(13)]:[n.title];
 return '<g class="graph-node '+n.status+'" data-graph-node="'+id+'" role="button" tabindex="0" aria-label="'+esc(n.title)+'，点击查看，双击进入" transform="translate('+(p.x-p.w/2)+','+(p.y-p.h/2)+')"><rect class="node-glow" x="-4" y="-4" width="'+(p.w+8)+'" height="'+(p.h+8)+'" rx="17"/><rect class="node-body" width="'+p.w+'" height="'+p.h+'" rx="12"/><circle class="port in" cx="0" cy="'+p.h/2+'" r="4"/><circle class="port" cx="'+p.w+'" cy="'+p.h/2+'" r="4"/><circle class="state-dot" cx="14" cy="16" r="3"/><text class="node-status" x="24" y="20">'+short+'</text>'+title.map((t,i)=>'<text class="node-name" x="14" y="'+(44+i*20)+'">'+esc(t)+'</text>').join('')+(stages.some(s=>s[0]===id)?'<text class="node-sub" x="14" y="'+(p.h-12)+'">'+stages.find(s=>s[0]===id)[2].toUpperCase()+'</text>':'')+(domains.some(d=>d[0]===id)||id==='act'?'<text class="drill-icon" x="'+(p.w-22)+'" y="'+(p.h-15)+'">↗</text>':'')+'</g>';
 }).join('');
 const actions=state.action?'<div class="actions">'+Object.entries(paths).map(([id,p])=>'<button data-action="'+id+'" class="'+(state.action===id?'selected':'')+'">'+p.title+'</button>').join('')+'<button data-stage="act">← 返回 IMPACT</button></div>':'';
 return actions+'<div class="graph-shell"><div class="graph-controls"><span>ENGINE GRAPH</span><button id="zoomOut" aria-label="缩小">−</button><output id="zoomValue">100%</output><button id="zoomIn" aria-label="放大">＋</button><button id="fitGraph">适配画布</button><button id="followGraph">追踪连接</button><button id="flowGraph" aria-pressed="false">信息流</button></div><svg id="engineGraph" viewBox="0 0 '+graphWidth+' '+graphHeight+'" role="group" aria-label="Magic Engine 可缩放关系图"><defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="#577087" opacity=".3"/></pattern><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L8 4 L0 8" fill="#688d98"/></marker><linearGradient id="nodeFill" x2="1" y2="1"><stop stop-color="#182f41"/><stop offset="1" stop-color="#111d2b"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#grid)"/><g id="graphViewport">'+lanes+arrows+nodeMarkup+'</g></svg><div class="graph-help">拖动空白平移 · 滚轮缩放 · 单击看证据 · 双击业务域 / 执行进入下一层<br><span>实线：代码调用已见　虚线：概念关系 / 接线待核验　信息流动画仅解释方向</span></div></div>';
}
function graphPath(e){
 const a=graphLayout[e.from],b=graphLayout[e.to];
 if(!a||!b)return '';
 if(e.route==='platform-write'){const x1=a.x+a.w/2,x2=b.x-b.w/2;return 'M'+x1+' '+a.y+' C'+(x1+90)+' '+a.y+',1190 '+b.y+','+x2+' '+b.y}
 if(e.route==='platform-read'){
 const x1=a.x-a.w/2,x2=b.x+b.w/2;
 if(e.to==='sources')return 'M'+x1+' '+(a.y-18)+' C1200 '+(a.y-18)+',1200 6,1150 6 L'+b.x+' 6 Q'+b.x+' 18,'+b.x+' '+(b.y-b.h/2);
 return 'M'+x1+' '+(a.y+18)+' C1195 '+(a.y+18)+','+(x2+90)+' '+b.y+','+x2+' '+b.y;
 }
 if(e.route==='horizontal'){const sign=b.x>a.x?1:-1,x1=a.x+sign*a.w/2,x2=b.x-sign*b.w/2;return 'M'+x1+' '+a.y+' C'+(x1+sign*45)+' '+a.y+','+(x2-sign*45)+' '+b.y+','+x2+' '+b.y}
 if(e.route==='overhead'){const y=48;return 'M'+a.x+' '+(a.y-a.h/2)+' C'+a.x+' '+y+','+b.x+' '+y+','+b.x+' '+(b.y-b.h/2)}
 if(e.route==='outer'){return 'M'+(a.x+a.w/2)+' '+a.y+' C1180 '+a.y+',1180 '+b.y+','+(b.x+b.w/2)+' '+b.y}
 if(e.route==='loop'){const y=a.y+93;return 'M'+a.x+' '+(a.y+a.h/2)+' C'+a.x+' '+y+','+b.x+' '+y+','+b.x+' '+(b.y+b.h/2)}
 if(e.route==='feedback'){const x=56;return 'M'+(a.x-a.w/2)+' '+a.y+' C'+x+' '+a.y+','+x+' '+b.y+','+(b.x-b.w/2)+' '+b.y}
 if(e.route==='under'){const y=a.y+65;return 'M'+a.x+' '+(a.y+a.h/2)+' C'+a.x+' '+y+','+b.x+' '+y+','+b.x+' '+(b.y+b.h/2)}
 const down=b.y>a.y,y1=a.y+(down?1:-1)*a.h/2,y2=b.y-(down?1:-1)*b.h/2,m=(y1+y2)/2;
 return 'M'+a.x+' '+y1+' C'+a.x+' '+m+','+b.x+' '+m+','+b.x+' '+y2;
}
function applyGraphTransform(){
 const v=$('graphViewport');if(!v)return;
 v.setAttribute('transform','translate('+graphTransform.x+' '+graphTransform.y+') scale('+graphTransform.k+')');
 $('zoomValue').textContent=Math.round(graphTransform.k*100)+'%';
}
function graphZoom(factor,cx=graphWidth/2,cy=graphHeight/2){
 const old=graphTransform.k,k=Math.max(.45,Math.min(3,old*factor)),r=k/old;
 graphTransform.x=cx-(cx-graphTransform.x)*r;graphTransform.y=cy-(cy-graphTransform.y)*r;graphTransform.k=k;applyGraphTransform();
}
function highlightGraph(id){
 const active=new Set([id]);edges.forEach(e=>{if(e.from===id)active.add(e.to);if(e.to===id)active.add(e.from)});
 document.querySelectorAll('[data-graph-node]').forEach(n=>{n.classList.toggle('selected',n.dataset.graphNode===id);n.classList.toggle('neighbor',active.has(n.dataset.graphNode));n.classList.toggle('dim',!active.has(n.dataset.graphNode))});
 document.querySelectorAll('[data-graph-edge]').forEach(g=>{const e=edges[+g.dataset.graphEdge];g.classList.toggle('lit',e.from===id||e.to===id)});
}
function graphEnter(id){
 if(domains.some(d=>d[0]===id)){state.domain=id;state.stage=null;state.action=null;state.selected=id;render()}
 else if(id==='act'){state.domain=state.domain||'ads';state.stage='act';if(state.domain==='ads'){state.action='budget';state.selected=state.mode==='target'?'candidate':'request'}render()}
 document.querySelector('.inspector').classList.remove('open');
}
function bindGraph(){
 const svg=$('engineGraph');if(!svg)return;
 const point=e=>{const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;return p.matrixTransform(svg.getScreenCTM().inverse())};
 let drag=null;
 svg.addEventListener('pointerdown',e=>{if(e.target.closest('[data-graph-node],[data-edge]'))return;const p=point(e);drag={x:p.x,y:p.y,tx:graphTransform.x,ty:graphTransform.y};svg.setPointerCapture(e.pointerId);svg.classList.add('panning')});
 svg.addEventListener('pointermove',e=>{if(!drag)return;const p=point(e);graphTransform.x=drag.tx+p.x-drag.x;graphTransform.y=drag.ty+p.y-drag.y;applyGraphTransform()});
 ['pointerup','pointercancel','lostpointercapture'].forEach(t=>svg.addEventListener(t,()=>{drag=null;svg.classList.remove('panning')}));
 svg.addEventListener('wheel',e=>{e.preventDefault();const p=point(e);graphZoom(Math.exp(-e.deltaY*.0015),p.x,p.y)},{passive:false});
 document.querySelectorAll('[data-graph-node]').forEach(n=>{
 n.onclick=()=>showNode(n.dataset.graphNode);
 n.ondblclick=()=>graphEnter(n.dataset.graphNode);
 n.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();if(e.shiftKey)graphEnter(n.dataset.graphNode);else showNode(n.dataset.graphNode)}if(e.key===' '){e.preventDefault();showNode(n.dataset.graphNode)}};
 });
 document.querySelectorAll('.edge-hit').forEach(n=>n.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();n.dispatchEvent(new MouseEvent('click',{bubbles:true}))}});
 $('zoomIn').onclick=()=>graphZoom(1.2);$('zoomOut').onclick=()=>graphZoom(1/1.2);
 $('fitGraph').onclick=()=>{graphTransform={x:0,y:0,k:1};applyGraphTransform();document.querySelectorAll('.graph-node').forEach(n=>n.classList.remove('dim'))};
 $('followGraph').onclick=()=>{const n=graphLayout[state.selected];if(!n)return;graphTransform={k:1.65,x:graphWidth/2-n.x*1.65,y:graphHeight/2-n.y*1.65};applyGraphTransform();highlightGraph(state.selected)};
 $('flowGraph').onclick=()=>{const on=svg.classList.toggle('flowing');$('flowGraph').setAttribute('aria-pressed',on);$('flowGraph').textContent=on?'停止信息流':'信息流'};
}
