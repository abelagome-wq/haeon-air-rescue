// The operations board uses the same commands as the flight HUD. A panel action
// resumes the sortie before calling a handler that expects live flight input.
const pages=[
  ['field','현장',[
    ['현장 작업',[['use-context','권장 작업'],['board','기체 탑승·하차'],['service','기체 검사'],['hangar','격납고 입장']]],
    ['탑승자·장비',[['use-board','승객 탑승·인계'],['use-doctor','의사 탑승·하차'],['use-officer','경관 탑승·하차'],['use-harness','구조 밧줄'],['cable','장비 줄 전환'],['use-bucket','물 투하 준비'],['use-hook','화물 고리 선택'],['use-cannon','물대포'],['use-gas','최루탄']]],
  ]],
  ['support','지원·방송',[
    ['출동 요청',[['use-firetruck','소방차'],['use-ambulance','구급차'],['use-police','경찰차'],['use-follow','경찰 추적']]],
    ['지원 복귀',[['recall-firetruck','소방차 복귀'],['recall-ambulance','구급차 복귀'],['recall-police','경찰차 복귀'],['recall-follow','추적 중지']]],
    ['확성기',[['use-traffic','교통 우회'],['use-stop','정차'],['use-evacuate','대피'],['use-disperse','해산'],['use-greet','인사']]],
  ]],
  ['nav','항법·라디오',[
    ['항법',[['map','관제 지도'],['next-call','다음 호출'],['radar-prev','이전 목적지'],['radar-next','다음 목적지'],['radar-out','레이더 축소'],['radar-in','레이더 확대']]],
    ['설정',[['pause','일시 정지·설정'],['help','Xbox 버튼 배치']]],
  ]],
  ['camera','시점·조명',[
    ['카메라',[['camera-chase','추적'],['cockpit','조종석'],['camera-overhead','상공'],['camera-drop','투하 시점'],['camera-center','시점 초기화']]],
    ['추적 카메라',[['camera-near','가까이'],['camera-far','멀리'],['camera-up','높이기'],['camera-down','낮추기'],['tilt-up','위로 기울이기'],['tilt-down','아래로 기울이기']]],
    ['탐조등',[['aim-left','왼쪽'],['aim-right','오른쪽'],['aim-up','더 멀리'],['aim-down','더 가까이']]],
  ]],
];

export function createPadActions({available,run,onClose}){
  const dialog=document.querySelector('#padActions'),tabs=dialog.querySelector('.pad-tabs'),body=dialog.querySelector('.pad-pages');
  const tools=document.querySelector('#fieldTool'),station=document.querySelector('#station');
  let pending=null,current='field';
  const panels=new Map(),tabButtons=new Map(),commands=new Map(),selects=[];
  function selectPage(id){
    current=id;
    for(const [key,panel] of panels){
      panel.hidden=key!==id;
      tabButtons.get(key).setAttribute('aria-pressed',String(key===id));
    }
  }
  function addSelector(panel,source,id,label){
    const wrap=document.createElement('label'),select=document.createElement('select');
    wrap.className='pad-selector';wrap.textContent=label;select.id=id;
    wrap.append(select);panel.append(wrap);
    select.addEventListener('change',()=>{
      source.value=select.value;
      source.dispatchEvent(new Event('change',{bubbles:true}));
    });
    selects.push({source,select});
  }
  for(const [id,label,groups] of pages){
    const tab=document.createElement('button'),panel=document.createElement('section');
    tab.type='button';tab.textContent=label;tab.dataset.padTab=id;
    panel.id='padPage-'+id;tab.setAttribute('aria-controls',panel.id);
    tab.onclick=()=>selectPage(id);tabs.append(tab);body.append(panel);
    panels.set(id,panel);tabButtons.set(id,tab);
    if(id==='field')addSelector(panel,tools,'padToolSelect','활성 장비');
    if(id==='nav')addSelector(panel,station,'padStationSelect','라디오 방송국');
    for(const [heading,items] of groups){
      const fieldset=document.createElement('fieldset'),title=document.createElement('legend'),buttons=document.createElement('div');
      title.textContent=heading;fieldset.append(title,buttons);panel.append(fieldset);
      for(const [command,label] of items){
        const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.command=command;
        b.onclick=()=>{
          if(!available(command))return;
          if(command==='help'){run(command);return;}
          pending=command;dialog.close();
        };
        commands.set(command,b);buttons.append(b);
      }
    }
  }
  dialog.querySelector('.pad-close').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{
    const command=pending;pending=null;onClose();
    if(command&&command!=='help')run(command);
  });
  function open(){
    if(dialog.open)return;
    pending=null;
    for(const {source,select} of selects){
      select.replaceChildren(...Array.from(source.options,opt=>opt.cloneNode(true)));select.value=source.value;
    }
    for(const [command,button] of commands)button.disabled=!available(command);
    selectPage(current);dialog.showModal();tabButtons.get(current).focus();
  }
  return {open};
}
