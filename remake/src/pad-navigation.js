// One input owner at a time. A button or stick used to exit a panel cannot
// also operate the aircraft until the controller has returned to neutral.
import {composePadText} from './pad-text.js';
let waitForNeutral=false;
const down=(p,i)=>p.buttons[i]?.pressed||p.buttons[i]?.value>.55;
const neutral=p=>!p.buttons.some((_,i)=>down(p,i))&&!p.axes.some(v=>Math.abs(v)>.25);
export function flightPadAllowed(p){
  if(!p)return false;
  if(waitForNeutral&&neutral(p))waitForNeutral=false;
  return !waitForNeutral;
}
const axis=(v,dead=.23)=>Math.abs(v||0)>dead?Math.sign(v)*(Math.abs(v)-dead)/(1-dead):0;
const direction=(x,y)=>Math.max(Math.abs(x),Math.abs(y))<.53?null:
  Math.abs(x)>Math.abs(y)?(x<0?'left':'right'):(y<0?'up':'down');
export function repeatDirection(){
  let last=null,due=0;
  return (value,now)=>{
    if(value!==last){last=value;due=now+320;return value;}
    if(value&&now>=due){due=now+95;return value;}
    return null;
  };
}
const controls='button,select,input:not([type=file]),textarea,a[href],[tabindex]:not([tabindex="-1"])';
function usable(el){
  return !el.matches(':disabled')&&!el.closest('[hidden],[inert]')&&el.getClientRects().length>0&&
    getComputedStyle(el).visibility!=='hidden';
}
function focus(el){
  if(!el)return;
  el.focus({preventScroll:true});el.scrollIntoView({block:'nearest',inline:'nearest'});
}
function options(select){
  return [...select.options].filter(opt=>!opt.disabled&&!opt.hidden&&!opt.parentElement?.disabled&&!opt.closest('[hidden]'));
}
function choose(select,opt){
  if(!opt||select.selectedIndex===opt.index)return;
  select.selectedIndex=opt.index;
  for(const type of ['input','change'])select.dispatchEvent(new Event(type,{bubbles:true}));
}
function adjust(el,step){
  if(el.tagName==='SELECT'){
    const opts=options(el),i=opts.findIndex(opt=>opt.index===el.selectedIndex);
    if(opts.length)choose(el,opts[(i+step+opts.length)%opts.length]);
    return true;
  }
  if(el.type==='range'||el.type==='number'){
    const old=el.value;
    if(el.step==='any')el.valueAsNumber+=step;else if(step<0)el.stepDown();else el.stepUp();
    if(old!==el.value)for(const type of ['input','change'])el.dispatchEvent(new Event(type,{bubbles:true}));
    return true;
  }
  return false;
}
function picker(title){
  const dialog=document.createElement('dialog');dialog.className='pad-picker';
  const caption=document.createElement('h2');caption.textContent=title;dialog.append(caption);
  dialog.setAttribute('aria-label',title);document.body.append(dialog);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  return dialog;
}
function button(text,fn){
  const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=fn;return b;
}
function fieldLabel(field,fallback){
  const label=field.labels?.[0];
  const direct=label?[...label.childNodes].filter(n=>n.nodeType===3||n.nodeType===1&&!n.contains(field)).map(n=>n.textContent.trim()).join(' ').trim():'';
  return field.getAttribute('aria-label')||direct||fallback;
}
function openSelect(select){
  const dialog=picker(fieldLabel(select,'항목 선택'));
  dialog.dataset.padList='';const list=document.createElement('div');list.className='pad-option-list';
  list.setAttribute('role','listbox');dialog.append(list);
  let selected;
  for(const opt of options(select)){
    const b=button(opt.label,()=>{choose(select,opt);dialog.close();});
    b.setAttribute('role','option');b.setAttribute('aria-selected',String(opt.selected));
    if(opt.selected)selected=b;list.append(b);
  }
  if(!list.children.length)return dialog.remove();
  dialog.showModal();focus(selected||list.firstElementChild);
}
function openText(input){
  const dialog=picker(fieldLabel(input,'검색')),preview=document.createElement('output');
  const grid=document.createElement('div');grid.className='pad-keys';
  let prefix=input.value,sequence=[],korean=false;
  const draft=()=>prefix+composePadText(sequence);
  const refresh=()=>{preview.textContent=draft()||'검색어 없음';};
  const accept=button('검색 적용',()=>{input.value=draft();input.dispatchEvent(new Event('input',{bubbles:true}));dialog.close();});
  const switchKeys=button('한글 자판',()=>{korean=!korean;keys();switchKeys.textContent=korean?'ABC 자판':'한글 자판';});
  function keys(){
    const rows=korean?['ㅂㅈㄷㄱㅅㅛㅕㅑㅐㅔ','ㅁㄴㅇㄹㅎㅗㅓㅏㅣ','ㅋㅌㅊㅍㅠㅜㅡ','ㅃㅉㄸㄲㅆㅒㅖ']:
      ['ABCDEFGHIJ','KLMNOPQRST','UVWXYZ','0123456789','-_'];
    grid.replaceChildren(...rows.map(row=>{
      const line=document.createElement('div');line.className='pad-key-row';
      line.append(...Array.from(row,c=>button(c,()=>{sequence.push(c);refresh();})));return line;
    }));
  }
  keys();
  const edits=document.createElement('div');edits.className='pad-edits';
  edits.append(button('띄어쓰기',()=>{sequence.push(' ');refresh();}),
    button('한 입력 삭제',()=>{if(sequence.length)sequence.pop();else prefix=Array.from(prefix).slice(0,-1).join('');refresh();}),
    button('지우기',()=>{prefix='';sequence=[];refresh();}));
  // Also offer exact names from the filtered catalogue as search shortcuts.
  const source=document.getElementById(input.id==='soundSearch'?'soundList':'objectSelect');
  const terms=[...new Set(Array.from(source?.options||[],o=>o.label.split(' · ').filter(s=>/[가-힣]/.test(s)).join(' · ')).filter(Boolean))];
  dialog.append(preview,accept,switchKeys,grid,edits);
  if(terms.length){
    const termSelect=document.createElement('select');termSelect.setAttribute('aria-label','한국어 검색어');
    termSelect.add(new Option('한국어 검색어 선택',''));
    for(const term of terms)termSelect.add(new Option(term,term));
    termSelect.onchange=()=>{if(termSelect.value){prefix=termSelect.value;sequence=[];refresh();}};
    dialog.append(termSelect);
  }
  dialog.append(button('취소',()=>dialog.close()));refresh();dialog.showModal();focus(accept);
}
function move(items,delta){
  if(!items.length)return;
  const i=items.indexOf(document.activeElement);
  focus(items[i<0?(delta<0?items.length-1:0):((i+delta)%items.length+items.length)%items.length]);
}
function cancel(dialog){
  // Native dialogs may veto cancellation while a transaction is in progress.
  const event=new Event('cancel',{cancelable:true});
  if(dialog.dispatchEvent(event)&&dialog.open)dialog.close();
}

export function createPadNavigation(){
  const order=new WeakMap(),openers=new WeakMap(),moveLeft=repeatDirection(),moveRight=repeatDirection();
  let sequence=0,lastScope=null,blocked=false,previous=0,axesHeld=false,requireNeutral=false;
  document.addEventListener('beforetoggle',event=>{
    const dialog=event.target;
    if(dialog.tagName==='DIALOG'&&event.newState==='open'){
      order.set(dialog,++sequence);openers.set(dialog,document.activeElement);
    }
  },true);
  document.addEventListener('close',event=>{
    const el=openers.get(event.target);
    queueMicrotask(()=>{
      const current=document.activeElement;
      if(current&&current!==document.body&&!event.target.contains(current))return;
      if(el?.isConnected&&el!==document.body&&usable(el)&&(!top()||top().contains(el)))focus(el);
    });
  },true);
  function top(){
    let best=null;
    for(const dialog of document.querySelectorAll('dialog[open]')){
      if(!best||(order.get(dialog)??0)>(order.get(best)??0))best=dialog;
    }
    return best;
  }
  function clear(pad){lastScope=null;blocked=false;previous=0;requireNeutral=!!pad&&!neutral(pad);
    axesHeld=!!pad&&pad.axes.some(v=>Math.abs(v)>.25);moveLeft(null,0);moveRight(null,0);waitForNeutral=true;}
  function poll(pad,edge,{mode,menu,paused,start,back,shop,reset}){
    const dialog=top(),scope=dialog??(mode==='menu'?menu:mode==='paused'?paused:null);
    const currentAxes=pad.axes.some(v=>Math.abs(v)>.25);
    const carried=axesHeld&&currentAxes||pad.buttons.some((_,i)=>down(pad,i)&&!edge(i));
    axesHeld=currentAxes;
    if(!scope){lastScope=null;return false;}
    waitForNeutral=!neutral(pad);
    const now=performance.now(),dt=Math.min(.05,(now-previous)/1000);previous=now;
    if(lastScope!==scope){
      blocked=(requireNeutral||carried)&&!neutral(pad);requireNeutral=false;lastScope=scope;moveLeft(null,now);moveRight(null,now);
    }
    if(blocked){if(neutral(pad))blocked=false;return true;}
    if(dialog&&(edge(1)||edge(9)||dialog.id==='network'&&edge(8))){cancel(dialog);return true;}
    if(!dialog&&mode==='paused'&&(edge(1)||edge(9))){back();return true;}
    if(!dialog&&mode==='menu'){
      if(edge(9)){start();return true;}
      if(edge(2)){shop();return true;}
      if(edge(3)){reset();return true;}
    }
    const x=pad.axes[2]||0,y=pad.axes[3]||0;
    const right=moveRight(direction(x,y),now);
    if(dialog?.hasAttribute('data-pad-scroll')&&axis(y)){
      const panel=dialog.querySelector('[data-pad-scroll-content]')??dialog;
      panel.scrollTop+=axis(y)*dt*440;
    }
    if(dialog&&['shop','hangarDesk','inspection','network'].includes(dialog.id)){
      const analog=axis(x)||axis(y)||down(pad,6)||down(pad,7);
      if(analog||right||[2,3,4,5,6,7].some(edge)){
        const detail={edge,right,dt,x:axis(x),y:axis(y),lt:pad.buttons[6]?.value??0,rt:pad.buttons[7]?.value??0};
        if(!dialog.dispatchEvent(new CustomEvent('padview',{detail,cancelable:true})))return true;
      }
    }
    const active=document.activeElement;
    const left=moveLeft(down(pad,12)?'up':down(pad,13)?'down':down(pad,14)?'left':down(pad,15)?'right':
      direction(pad.axes[0],pad.axes[1]),now);
    if(!left&&!edge(0)&&!(dialog?.hasAttribute('data-pad-list')&&(edge(4)||edge(5))))return true;
    const items=[...scope.querySelectorAll(controls)].filter(usable);
    if(dialog?.hasAttribute('data-pad-list')&&(edge(4)||edge(5))){move(items,edge(4)?-10:10);return true;}
    if(left){
      const step=left==='left'||left==='up'?-1:1;
      if((left==='left'||left==='right')&&items.includes(active)&&adjust(active,step))return true;
      const row=active?.closest('.pad-key-row');
      if(row&&(left==='up'||left==='down')){
        const sibling=step<0?row.previousElementSibling:row.nextElementSibling;
        if(sibling){const i=[...row.children].indexOf(active);focus(sibling.children[Math.min(i,sibling.children.length-1)]);return true;}
        const end=step<0?row.firstElementChild:row.lastElementChild;
        focus(items[items.indexOf(end)+step]);return true;
      }
      move(items,step);return true;
    }
    const el=items.includes(active)?active:null;
    if(!el){focus(items[0]);return true;}
    if(el.tagName==='SELECT')openSelect(el);
    else if(el.tagName==='INPUT'&&['search','text'].includes(el.type))openText(el);
    else el.click();
    return true;
  }
  return {poll,clear};
}
