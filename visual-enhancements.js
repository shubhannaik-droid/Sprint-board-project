(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const storageKey = 'sprintboard.v1';
  const el = (name, attrs = {}, text = '') => {
    const n = document.createElementNS(NS, name);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, String(v)));
    if (text) n.textContent = text;
    return n;
  };
  const parseDay = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d); };
  const fmtDay = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const shiftDay = (s,n) => { const d=parseDay(s);d.setDate(d.getDate()+n);return fmtDay(d); };
  const diffDays = (a,b) => Math.round((parseDay(b)-parseDay(a))/86400000);
  const niceDate = s => parseDay(s).toLocaleDateString(undefined,{month:'short',day:'numeric'});
  const readState = () => { try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { return {}; } };
  const sum = list => list.reduce((n,s)=>n+(Number(s.points)||0),0);
  const historyKey='sprintboard.burndown.v1';
  let history=(()=>{try{return JSON.parse(localStorage.getItem(historyKey)||'{"sprints":{}}');}catch{return {sprints:{}};}})();
  let lastState=readState();
  function saveHistory(){try{localStorage.setItem(historyKey,JSON.stringify(history));}catch{}}
  function initHistory(sprint,state,today){
    const stories=(state.stories||[]).filter(s=>s.sprintId===sprint.id);
    return {baseTotal:sum(stories),events:stories.filter(s=>s.status==='done').map(s=>({date:s.doneAt||today,delta:-Number(s.points||0)}))};
  }
  function syncHistory(state,today){
    const sprint=(state.sprints||[]).find(s=>s.state==='active');
    if(!sprint){if(!(state.sprints||[]).length)history={sprints:{}};lastState=state;saveHistory();return null;}
    const id=`${sprint.id}:${sprint.start}:${sprint.end}:${sprint.name}`;
    if(!history.sprints[id])history.sprints[id]=initHistory(sprint,state,today);
    const plan=history.sprints[id];
    const before=new Map((lastState.stories||[]).map(s=>[s.id,s]));
    const after=new Map((state.stories||[]).map(s=>[s.id,s]));
    for(const storyId of new Set([...before.keys(),...after.keys()])){
      const old=before.get(storyId),next=after.get(storyId),was=old?.sprintId===sprint.id,is=next?.sprintId===sprint.id;
      if(!was&&is){if(next.status!=='done')plan.events.push({date:today,delta:Number(next.points)||0});else plan.events.push({date:today,delta:0});continue;}
      if(was&&!is){if(old.status!=='done')plan.events.push({date:today,delta:-(Number(old.points)||0)});continue;}
      if(!was||!is||!old||!next)continue;
      if(old.status!=='done'&&next.status==='done')plan.events.push({date:next.doneAt||today,delta:-(Number(next.points)||0)});
      else if(old.status==='done'&&next.status!=='done')plan.events.push({date:today,delta:Number(old.points)||0});
      else if(old.status!=='done'&&next.status!=='done'&&Number(old.points)!==Number(next.points))plan.events.push({date:today,delta:(Number(next.points)||0)-(Number(old.points)||0)});
    }
    lastState=state;saveHistory();return plan;
  }

  function updateBurndown() {
    const svg=document.querySelector('#view-board svg.chart');
    if(!svg)return;
    const state=readState(), sprint=(state.sprints||[]).find(s=>s.state==='active');
    if(!sprint)return;
    const stories=(state.stories||[]).filter(s=>s.sprintId===sprint.id);
    const total=sum(stories), doneStories=stories.filter(s=>s.status==='done');
    const completed=sum(doneStories), wip=sum(stories.filter(s=>s.status==='inprogress'));
    const todo=sum(stories.filter(s=>s.status==='todo'));
    const today=fmtDay(new Date()), plan=syncHistory(state,today), sprintDays=Math.max(1,diffDays(sprint.start,sprint.end));
    const currentDay=Math.max(0,Math.min(sprintDays,diffDays(sprint.start,today)));
    const key=JSON.stringify({sprint,stories,today,plan});
    if(svg.dataset.enhancedKey===key)return;
    svg.dataset.enhancedKey=key;

    const W=760,H=330,L=58,R=24,T=34,B=48,chartW=W-L-R,chartH=H-T-B;
    const yMax=Math.max(total,1);
    const y=v=>T+chartH-(Math.max(0,Math.min(yMax,v))/yMax)*chartH;
    const days=Array.from({length:currentDay+1},(_,i)=>shiftDay(sprint.start,i));
    const remainingAt=d=>Math.max(0,(plan?.baseTotal||0)+(plan?.events||[]).filter(e=>e.date<=d).reduce((n,e)=>n+e.delta,0));
    const actual=days.map((d,i)=>({day:i,value:remainingAt(d),date:d}));
    const workingDays=Math.max(1,Array.from({length:currentDay+1},(_,i)=>parseDay(shiftDay(sprint.start,i))).filter(d=>![0,6].includes(d.getDay())).length);
    const pace=completed/workingDays;
    const forecastDays=pace>0?Math.ceil((total>completed?total-completed:0)/pace*1.4):0;
    const projectedDay=pace>0?currentDay+forecastDays:currentDay;
    const displayMax=Math.max(sprintDays,projectedDay);
    const X=d=>L+(Math.max(0,Math.min(displayMax,d))/displayMax)*chartW;

    svg.replaceChildren();svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.setAttribute('preserveAspectRatio','xMidYMid meet');
    svg.setAttribute('aria-label',`Sprint burndown: ${completed} of ${total} points completed, ${wip} points in progress, ${total-completed} points remaining.`);
    const title=el('title',{},'Sprint burndown: remaining work compared with the ideal pace');svg.append(title);
    const defs=el('defs');
    const grad=el('linearGradient',{id:'burn-fill',x1:'0',x2:'0',y1:'0',y2:'1'});
    grad.append(el('stop',{offset:'0%','stop-color':'#168c78','stop-opacity':'.22'}),el('stop',{offset:'100%','stop-color':'#168c78','stop-opacity':'.01'}));
    defs.append(grad);svg.append(defs);

    const yTicks=[...new Set([0,Math.round(yMax*.25),Math.round(yMax*.5),Math.round(yMax*.75),yMax])].sort((a,b)=>b-a);
    for(const value of yTicks){
      const yy=y(value);
      svg.append(el('line',{x1:L,y1:yy,x2:W-R,y2:yy,class:'burn-grid'}));
      svg.append(el('text',{x:L-12,y:yy+4,'text-anchor':'end',class:'burn-axis'},String(Math.round(value))));
    }
    const ticks=new Set([0,sprintDays]);
    if(currentDay>0&&currentDay<sprintDays)ticks.add(currentDay);
    for(let d=7;d<sprintDays;d+=7)ticks.add(d);
    [...ticks].sort((a,b)=>a-b).forEach(day=>{
      const xx=X(day),label=niceDate(shiftDay(sprint.start,day));
      svg.append(el('line',{x1:xx,y1:T,x2:xx,y2:H-B,class:'burn-vgrid'}));
      svg.append(el('text',{x:xx,y:H-18,'text-anchor':day===0?'start':day===sprintDays?'end':'middle',class:'burn-axis'},label));
    });
    const idealPath=`M ${X(0)} ${y(total)} L ${X(sprintDays)} ${y(0)}`;
    svg.append(el('path',{d:idealPath,class:'burn-ideal'}));

    let previous=actual[0]?.value??total;
    let actualPath=`M ${X(0)} ${y(total)} V ${y(previous)}`;
    for(const point of actual){
      if(point.day===0)continue;
      if(point.value!==previous){actualPath+=` H ${X(point.day)} V ${y(point.value)}`;previous=point.value;}
      else actualPath+=` H ${X(point.day)}`;
    }
    const endX=X(currentDay),endY=y(previous);
    svg.append(el('path',{d:`${actualPath} L ${endX} ${y(0)} L ${X(0)} ${y(0)} Z`,class:'burn-area'}));
    svg.append(el('path',{d:actualPath,class:'burn-actual'}));

    if(pace>0&&total>completed&&projectedDay>currentDay){
      const projectX=X(Math.min(projectedDay,displayMax));
      const projectY=y(projectedDay<=displayMax?0:total-completed);
      svg.append(el('path',{d:`M ${endX} ${endY} L ${projectX} ${projectY}`,class:'burn-forecast'}));
      svg.append(el('circle',{cx:projectX,cy:projectY,r:5,class:'burn-projection-dot'}));
      const label=projectedDay>sprintDays?'Forecast after sprint':'Projected finish';
      svg.append(el('text',{x:Math.min(projectX-4,W-R),y:Math.max(T+14,projectY-12),'text-anchor':projectX>W-R-110?'end':'middle',class:'burn-forecast-label'},label));
    }
    if(today>=sprint.start&&today<=sprint.end){
      const nowX=X(currentDay);
      svg.append(el('line',{x1:nowX,y1:T,x2:nowX,y2:H-B,class:'burn-today'}));
      svg.append(el('circle',{cx:endX,cy:endY,r:6,class:'burn-current-dot'}));
      svg.append(el('text',{x:Math.min(nowX+7,W-R-4),y:T+13,class:'burn-today-label'},'TODAY'));
    }
    const panel=svg.closest('.panel');
    if(panel){
      let summary=panel.querySelector('.burn-summary');
      if(!summary){summary=document.createElement('div');summary.className='burn-summary';svg.before(summary);}
      const paceText=pace>0?(projectedDay>sprintDays?`${projectedDay-sprintDays} days past sprint end at this pace`:`${Math.max(0,projectedDay-currentDay)} days to finish at this pace`):'Complete a story to establish a pace';
      summary.innerHTML=`<div class="burn-stat"><span>Remaining</span><strong>${Math.max(0,total-completed)}<small> pts</small></strong></div><div class="burn-stat"><span>In progress</span><strong>${wip}<small> pts</small></strong></div><div class="burn-stat"><span>Completed</span><strong>${completed}<small> / ${total} pts</small></strong></div><div class="burn-pace">${paceText}</div>`;
      let legend=panel.querySelector('.legend');
      if(legend)legend.innerHTML='<span><i class="actual"></i>Actual remaining</span><span><i class="ideal"></i>Ideal pace</span><span><i class="forecast"></i>Projected pace</span>';
      let note=panel.querySelector('.burn-note');
      if(!note){note=document.createElement('p');note.className='burn-note';panel.append(note);}
      note.textContent=`${stories.length} stories · ${todo} pts not started · ${wip} pts in progress · ${completed} pts done. Work only burns down when a story is Done.`;
    }
  }

  function polishBoard(){
    document.querySelectorAll('.column').forEach(col=>{
      const title=col.querySelector('.column-head span:first-child');
      if(title)col.dataset.label=title.textContent;
    });
  }
  function refresh(){updateBurndown();polishBoard();}
  const observer=new MutationObserver(records=>{
    if(records.every(r=>r.target.closest?.('svg.chart')||[...r.addedNodes].every(n=>n.nodeType===1&&(n.matches?.('svg.chart')||n.closest?.('svg.chart')))))return;
    refresh();
  });
  const board=document.querySelector('#view-board');
  if(board)observer.observe(board,{subtree:true,childList:true,characterData:true});
  setTimeout(refresh,0);
})();
