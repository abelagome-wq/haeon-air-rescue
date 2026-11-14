import {createAircraftInstruments} from './aircraft-instruments.js';
import {guestLabel} from './guest-passenger.js';
import {mapWindow,drawMapRaster} from './map-window.js';
const $=id=>document.getElementById(id);
const scales=[208,416,832,2048];
const seatNames={patient:'부상자',passenger:'승객',doctor:'의사',officer:'경관'};
const equipmentTools={hook:'hook',bucket:'bucket',megaphone:'traffic',harness:'harness',cannon:'cannon',gas:'gas'};

export function createCockpitDisplay(use){
  const instruments=createAircraftInstruments(document.querySelector('.instruments'),$('airframeSystems'));
  let level=1,targetId=null,lastRack='',lastSeats='';
  // A new sortie follows dispatch. Zero means the pilot explicitly selected the base.
  function radarCall(calls){
    if(targetId===0)return null;
    if(targetId!==null){
      const pinned=calls.find(call=>call.id===targetId);
      if(pinned)return pinned;
      targetId=null;
    }
    return calls.find(call=>call.focused);
  }
  function changeTarget(direction,missions){
    const ids=[0,...missions.state.calls.map(call=>call.id)];
    const current=ids.indexOf(radarCall(missions.state.calls)?.id??0);
    targetId=ids[(current+direction+ids.length)%ids.length];
    if(targetId)missions.choose(targetId);
  }
  function drawRadar(city,flight,missions){
    const canvas=$('radar'),g=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
    const p=flight.focusPosition??flight.position,b=city.bounds;
    const fullRange=b.maxX-b.minX;
    const ranges=scales.map(n=>Math.min(n,fullRange)).filter((n,i,a)=>!i||a[i-1]!==n);
    if(ranges.at(-1)!==fullRange)ranges.push(fullRange);
    level=Math.min(level,ranges.length-1);
    const range=ranges[level],px=w/range,view=mapWindow(city,p,range,h/px);
    const selected=radarCall(missions.state.calls);
    const target=selected?selected.target:city.spawn;
    const originX=-view.x*px,originY=-view.z*px;
    const shipX=originX+p.x*px,shipY=originY+p.z*px;
    g.fillStyle='#15364c';g.fillRect(0,0,w,h);g.imageSmoothingEnabled=false;
    drawMapRaster(g,city,view,w,h);
    if(level<2){
      const cell=64*px;g.beginPath();g.strokeStyle='#183c4b44';g.lineWidth=1;
      for(let x=(originX-1024*px)%cell;x<w;x+=cell){g.moveTo(x,0);g.lineTo(x,h);}
      for(let y=(originY-1024*px)%cell;y<h;y+=cell){g.moveTo(0,y);g.lineTo(w,y);}
      g.stroke();
    }
    if(target){
      g.strokeStyle='#cee8f0';g.lineWidth=1.3;g.beginPath();g.moveTo(shipX,shipY);
      g.lineTo(originX+target.x*px,originY+target.z*px);g.stroke();
    }
    for(const call of missions.state.calls){
      if(!call.target)continue;
      const refill=call.phase==='refill'&&call.incidentSite;
      const site=refill||call.target;
      const x=Math.min(w-7,Math.max(7,originX+site.x*px));
      const y=Math.min(h-7,Math.max(7,originY+site.z*px));
      g.fillStyle=call.type==='fire'?(Math.floor(missions.state.clock*2)%2?'#ff846a':'#c45845'):'#94d7e8';
      if(call.type==='medevac'){g.fillStyle='#fff';g.fillRect(x-2,y-6,4,12);g.fillRect(x-6,y-2,12,4);}
      else{g.beginPath();g.arc(x,y,4,0,Math.PI*2);g.fill();}
      if(refill&&call.id===selected?.id){
        const wx=Math.min(w-7,Math.max(7,originX+call.target.x*px));
        const wy=Math.min(h-7,Math.max(7,originY+call.target.z*px));
        g.strokeStyle='#9fe1ff';g.lineWidth=1.5;g.beginPath();g.arc(wx,wy,5,0,Math.PI*2);g.stroke();
      }
    }
    const angle=flight.state.heading*Math.PI/180;
    g.strokeStyle=g.fillStyle='#e6f8ff';g.lineWidth=2;g.beginPath();g.moveTo(shipX,shipY);
    g.lineTo(shipX+Math.sin(angle)*25,shipY-Math.cos(angle)*25);g.stroke();g.fillRect(shipX-3,shipY-3,6,6);
    $('navlabel').textContent=selected?selected.title+' '+selected.id+(selected.phase==='refill'?' · 급수':''):'기지';$('radarRange').textContent=range+' m';
    $('radarIn').disabled=level===0;$('radarOut').disabled=level===ranges.length-1;
  }
  function update(flight,missions){
    const s=flight.state,m=missions.state;
    document.body.classList.toggle('on-foot',s.onFoot);
    instruments.update(s);
    $('boardBtn').textContent=s.onFoot?'기체 탑승':'기체 하차';
    $('boardBtn').disabled=!s.onFoot&&(!s.grounded||s.speed>1||!!m.hook?.attached);
    $('engineState').textContent=s.engine;$('fuel').textContent=Math.round(s.fuel);
    $('damage').value=s.damage;$('damageValue').textContent=Math.round(s.damage)+'%';
    const needle=(id,angle)=>$(id).parentElement.style.setProperty('--gauge-angle',angle+'deg');
    needle('fuel',-135+2.7*s.fuel);needle('spd',-135+Math.min(270,s.speed*3.6*.9));
    needle('alt',(s.altitudeAGL%1000)*.36);needle('hdg',s.heading);
    const equipment=Object.keys(equipmentTools).filter(id=>m.loadout?.[id]);
    const rack=equipment.join(',')+' '+(m.bucket?.name??'');
    if(lastRack!==rack){
      lastRack=rack;$('toolRack').replaceChildren(...equipment.map(id=>{
        const b=document.createElement('button');b.type='button';b.dataset.equipment=id;
        b.textContent=({hook:'화물 고리',bucket:m.bucket?.name??'급수 장비',megaphone:'확성기',harness:'구조 밧줄',cannon:'방화수포',gas:'최루가스'})[id];
          b.onclick=()=>{const suggested=m.suggestedTool;const tool=id==='megaphone'&&['traffic','stop','evacuate','disperse'].includes(suggested)?suggested:equipmentTools[id];$('fieldTool').value=tool;$('fieldTool').dispatchEvent(new Event('change'));if(id!=='bucket'&&id!=='hook')use(tool);};
        return b;
      }));
    }
    const seats=(m.roster??[]).join(',')+'|'+(m.cabinPortraits??[]).join(',');
    if(seats!==lastSeats){
      lastSeats=seats;$('seatRoster').replaceChildren(...(m.roster??[]).map((role,index)=>{
        const face=document.createElement('img');face.className='seat-person';
        const portrait=Object.hasOwn(seatNames,role)?role:'passenger';
        const guest=role==='passenger'&&guestLabel(m.cabinPortraits?.[index]);
        face.alt=guest||seatNames[role]||'탑승자';face.title=face.alt;
        face.src='./art/cabin/'+(guest?m.cabinPortraits[index]:portrait)+'.png';face.width=28;face.height=33;
        face.style.backgroundColor='#192a32';
        face.style.borderColor=role==='patient'?'#e37a55':'#6196a1';
        return face;
      }));
    }
    $('eventLog').textContent=(m.events??[]).filter(e=>m.clock-e.at<12).map(e=>e.text).join('\n');
  }
  return {update,drawRadar,changeTarget,trackIncident(id){targetId=id;},zoom(delta){level=Math.max(0,Math.min(scales.length-1,level+delta));}};
}
