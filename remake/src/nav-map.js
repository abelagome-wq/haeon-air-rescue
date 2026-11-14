import {rankIncidents} from './incident-priority.js';
import {mapWindow,drawMapRaster} from './map-window.js';
import {generatedWaterMains} from './city-utilities.js';
const $=id=>document.getElementById(id);let active,classicDefinitions,sub=false,selected=null,ticket=0,zoom=1;
const offsets={L:[-1,0],R:[1,0],T:[0,-1],B:[0,1]};
function draw(){
  if(!active)return;
  const {city,flight,missions,raw,definitions}=active,cv=$('largeMap'),g=cv.getContext('2d');
  const position=flight.focusPosition??flight.position,b=city.bounds;
  const view=mapWindow(city,active.cursor??position,(b.maxX-b.minX)/zoom,(b.maxZ-b.minZ)/zoom);
  active.view=view;
  const px=cv.width/view.width,pz=cv.height/view.height;
  const projectX=x=>(x-view.x)*px,projectZ=z=>(z-view.z)*pz;
  g.save();g.fillStyle='#20373a';g.fillRect(0,0,cv.width,cv.height);g.imageSmoothingEnabled=false;
  drawMapRaster(g,city,view,cv.width,cv.height);
  if(sub){g.fillStyle='#0b1b24bf';g.fillRect(0,0,cv.width,cv.height);
    if(raw)for(let i=0;i<raw.length;i++){if(!raw[i])continue;const def=definitions[raw[i]];if(!def)continue;
      const p=city.tileToWorld(i%128,Math.floor(i/128)),x=projectX(p.x),y=projectZ(p.z);
      if(x< -8*px||x>cv.width+8*px||y< -8*pz||y>cv.height+8*pz)continue;
      const layer=(ports,color)=>{g.strokeStyle=g.fillStyle=color;g.lineWidth=1.9;g.beginPath();for(const port of ports||''){const v=offsets[port];if(v){g.moveTo(x,y);g.lineTo(x+v[0]*8*px,y+v[1]*8*pz);}}g.stroke();g.fillRect(x-1,y-1,2,2);};
      if(def.family==='crossing'){layer(def.railPorts,'#ffb871');layer(def.pipePorts,'#72dece');}
      else layer(def.ports||def.railPorts,def.family==='subway'||def.family==='station'?'#ffb871':'#72dece');}}
  function dot(x,z,style,r){g.fillStyle=style;g.strokeStyle='#182728';g.lineWidth=2;g.beginPath();g.arc(projectX(x),projectZ(z),r,0,Math.PI*2);g.fill();g.stroke();}
  const ranked=rankIncidents(missions.state.calls??[],position);
  const buttons=[];for(const {call,label,color,distance,deadline} of ranked){
    if(call.target&&!call.focused)dot(call.target.x,call.target.z,color,5);
    if(call.incidentSite&&call.target&&Math.hypot(call.target.x-call.incidentSite.x,call.target.z-call.incidentSite.z)>20)
      dot(call.incidentSite.x,call.incidentSite.z,'#ff765c',4);
    const b=document.createElement('button');b.dataset.callId=call.id;b.textContent=label+' · '+call.title+(Number.isFinite(distance)?'　'+Math.round(distance)+' m':'')+
      (Number.isFinite(deadline)?'　'+Math.ceil(deadline/60)+'분 이내':'');b.style.setProperty('--priority-color',color);b.setAttribute('aria-pressed',String(call.focused));
    b.onclick=()=>{missions.choose(call.id);active.routeId=call.id;draw();};buttons.push(b);
  }
  const focusedCall=document.activeElement?.dataset.callId;
  $('callList').replaceChildren(...buttons);
  if(focusedCall)buttons.find(button=>button.dataset.callId===focusedCall)?.focus({preventScroll:true});
  const recent=missions.state.history??[];
  const best=ranked[0];$('assignPriority').disabled=!best;
  $('assignPriority').textContent=best?'우선 출동 · '+best.call.title:'접수된 신고 없음';
  $('assignPriority').onclick=()=>{if(best){missions.choose(best.call.id);active.routeId=best.call.id;$('network').close();}};
  $('callLog').textContent=recent.slice(0,3).map(v=>v.message+' ('+v.points+'점 · §'+v.cash+')').join('　');
  for(const unit of missions.state.serviceUnits??[]){
    if(unit.position&&unit.status!=='station')dot(unit.position.x,unit.position.z,({police:'#80b4fd',fire:'#ff7863',hospital:'#e6eef2'})[unit.kind],3);
  }
  if(missions.state.target)dot(missions.state.target.x,missions.state.target.z,'#ffc66a',6);dot(position.x,position.z,'#fffdf0',4.5);
  if(selected){g.strokeStyle='#ffffff';g.lineWidth=1.5;const p=city.tileToWorld(selected.col,selected.row);g.strokeRect(projectX(p.x-8),projectZ(p.z-8),16*px,16*pz);}
  g.restore();$('mapZoomIn').disabled=zoom>=8;$('mapZoomOut').disabled=zoom<=1;
  $('surfaceTab').setAttribute('aria-pressed',String(!sub));$('networkTab').setAttribute('aria-pressed',String(sub));describe();
}
function describe(){const {city,raw,definitions}=active;const el=$('tileInfo');$('tileInspect').hidden=true;
  if(!selected){el.textContent=sub?(city.generated?'청록선은 도로 아래 상수도관입니다. 타일을 눌러 관의 연결 방향을 확인하세요.':'주황선은 지하철, 청록선은 수도관입니다. 시설을 선택하면 구조를 볼 수 있습니다.'):'지도를 클릭하면 좌표와 지상 시설을 확인할 수 있습니다.';return;}
  const {col,row}=selected,p=city.tileToWorld(col,row),tile=city.tileAt(p.x,p.z),id=raw?.[row*128+col],def=definitions?.[id];
  el.textContent=col+', '+row+'　'+(sub?(def?.label||'지하 시설 없음'):'지상 타일 '+tile.building+(tile.water?' · 수면':tile.road?' · 도로':''));if(sub&&def?.name)$('tileInspect').hidden=false;}
export async function showMap(city,flight,missions,close){
 const seq=++ticket;sub=false;selected=null;zoom=1;active={city,flight,missions,raw:null,definitions:null};$('mapTitle').textContent=city.name+' · 항법 지도';$('network').showModal();draw();
 $('network').onclose=()=>{ticket++;const routeId=active?.routeId;active=null;close(routeId);};
 if(city.generated){
   Object.assign(active,generatedWaterMains(city));draw();return;
 }
 try{const [defs,r]=await Promise.all([classicDefinitions||fetch('./data/networks/index.json').then(r=>r.json()),fetch('./data/networks/'+city.cityId+'.bin').then(r=>{if(!r.ok)throw Error(r.status);return r.arrayBuffer();})]);
   if(seq!==ticket||!active)return;classicDefinitions=defs;active.definitions=defs;active.raw=new Uint8Array(r);draw();
 }catch{if(active&&seq===ticket)$('tileInfo').textContent='이 도시의 지하 자료를 읽을 수 없습니다.';}
}
$('closeMap').onclick=()=>$('network').close();$('surfaceTab').onclick=()=>{sub=false;draw();};$('networkTab').onclick=()=>{sub=true;draw();};
$('largeMap').onclick=e=>{
  if(!active)return;
  const {city,view}=active,rect=e.target.getBoundingClientRect();
  const b=city.bounds;
  const x=Math.max(b.minX,Math.min(b.maxX-.01,view.x+(e.clientX-rect.left)/rect.width*view.width));
  const z=Math.max(b.minZ,Math.min(b.maxZ-.01,view.z+(e.clientY-rect.top)/rect.height*view.height));
  selected=city.worldToTile(x,z);draw();
};
$('tileInspect').onclick=()=>{const def=active?.definitions?.[active.raw?.[selected.row*128+selected.col]];if(def?.name)import('./inspect.js').then(m=>m.openInspection(def.name));};
$('mapZoomOut').onclick=()=>{zoom=Math.max(1,zoom/2);draw();};
$('mapZoomIn').onclick=()=>{zoom=Math.min(8,zoom*2);draw();};
$('network').addEventListener('padview',event=>{
  if(!active)return;
  const {edge,right}=event.detail;
  if(edge(4)||edge(5))$(edge(4)?'surfaceTab':'networkTab').click();
  else if(edge(6)||edge(7))$(edge(6)?'mapZoomOut':'mapZoomIn').click();
  else if(edge(2)&&!$('tileInspect').hidden)$('tileInspect').click();
  else if(edge(3)){active.cursor=null;selected=null;draw();}
  else if(right){
    const {city,flight}=active,b=city.bounds;
    const current=selected?city.tileToWorld(selected.col,selected.row):(flight.focusPosition??flight.position);
    const x=Math.min(b.maxX-8,Math.max(b.minX+8,current.x+16*((right==='right')-(right==='left'))));
    const z=Math.min(b.maxZ-8,Math.max(b.minZ+8,current.z+16*((right==='down')-(right==='up'))));
    selected=city.worldToTile(x,z);active.cursor=city.tileToWorld(selected.col,selected.row);draw();
  }else return;
  event.preventDefault();
});
