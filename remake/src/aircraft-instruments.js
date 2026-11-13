import {FLEET} from './fleet.js';
// Instrument layouts are selected by aircraft type.
const panelLayouts = {
  SCWZR300: ['#89dcef', '#152f40', ['fuel','alt','spd','hdg'], ['column','arc','tape','drum'], 'rpm'],
  JETRANG:  ['#e4eef2', '#193343', ['spd','alt','hdg','fuel'], ['arc','tape','drum','column'], 'vario'],
  HUGH500:  ['#ff9a7d', '#182e3d', ['alt','spd','fuel','hdg'], ['tape','arc','column','drum'], 'rpm'],
  MD520:    ['#96dce8', '#162e3c', ['spd','hdg','alt','fuel'], ['arc','drum','tape','column'], 'vario'],
  BELL212:  ['#ffd49f', '#183448', ['fuel','spd','alt','hdg'], ['column','dial','dial','drum'], 'load'],
  AGUSTA:   ['#abcdf2', '#142b40', ['hdg','alt','spd','fuel'], ['drum','dial','arc','column'], 'vario'],
  DAUPHIN:  ['#a6e6f5', '#17364a', ['alt','hdg','spd','fuel'], ['tape','drum','arc','column'], 'load'],
  MDEXPLRR: ['#a2e1d4', '#133643', ['spd','alt','fuel','hdg'], ['tape','tape','column','drum'], 'water'],
  APACHE:   ['#ade2bf', '#1a363f', ['hdg','spd','alt','fuel'], ['drum','tape','tape','column'], 'rpm'],
};
// Models with the same cockpit layout still show their own fleet name and readouts.
const layoutFor={GARAM:'SCWZR300',GIRIN:'BELL212',NOEUL:'BELL212',HEUKSON:'APACHE',GYEOPNAL:'MDEXPLRR',
  BYEOL:'JETRANG',MARU:'AGUSTA',DURUM:'DAUPHIN',DUSOL:'BELL212',HAEMOR:'DAUPHIN',SANBI:'APACHE'};
const panels=Object.fromEntries(FLEET.map(h=>[h.id,[h.name,...panelLayouts[layoutFor[h.id] ?? h.id]]]));
const instruments = {
  fuel: ['연료','%',100], alt: ['지상 고도','m',600],
  spd: ['대지 속도','km/h',300], hdg: ['방위','°',360],
};
const clamp = (n,min,max) => Math.min(max,Math.max(min,n));
const reading = (s,id) => ({fuel:s.fuel,alt:s.altitudeAGL,spd:s.speed*3.6,hdg:s.heading})[id] || 0;

function dial(g, x, y, radius, fraction, maximum, accent, open) {
  const arc = (r, start, end, color, width) => {
    g.beginPath();g.arc(x,y,r,start,end);g.lineWidth=width;g.strokeStyle=color;g.stroke();
  };
  if(!open){
    const face=g.createLinearGradient(x,y-radius,x,y+radius);
    face.addColorStop(0,'#203a4b');face.addColorStop(.46,'#162e3f');face.addColorStop(1,'#193342');
    g.beginPath();g.arc(x,y,radius+3,0,2*Math.PI);g.fillStyle=face;g.fill();
    arc(radius+2,0,2*Math.PI,'#737674',2);arc(radius+3,Math.PI,1.55*Math.PI,'#aaa99e',1);
  }
  const start=.75*Math.PI,sweep=1.5*Math.PI;
  arc(radius,start,start+sweep,'#58625e',open?5:1);
  for(let i=0;i<=12;i++){
    const a=start+sweep*i/12,inner=radius-(i%3===0?6:3);
    g.beginPath();g.moveTo(x+inner*Math.cos(a),y+inner*Math.sin(a));
    g.lineTo(x+radius*Math.cos(a),y+radius*Math.sin(a));g.strokeStyle=i%3===0?'#e5e4d6':'#9caaa1';g.lineWidth=1;g.stroke();
    if(i%3===0&&radius>=25){
      g.font='bold 9px Consolas, monospace';g.textAlign='center';g.fillStyle='#d4d6cc';
      g.fillText(String(Math.round(i*maximum/12)),x+(radius-13)*Math.cos(a),y+(radius-13)*Math.sin(a)+3);
    }
  }
  const angle=start+sweep*fraction;
  if(open&&fraction>0)arc(radius,start,angle,accent,4);
  g.beginPath();g.moveTo(x,y);g.lineTo(x+(radius-2)*Math.cos(angle),y+(radius-2)*Math.sin(angle));
  g.strokeStyle=accent;g.lineWidth=2;g.stroke();
  g.beginPath();g.arc(x,y,3,0,Math.PI*2);g.fillStyle='#deddd2';g.fill();
}
function tape(g,x,y,w,h,value,max,accent,column) {
  g.fillStyle='#102938';g.fillRect(x-w/2,y,w,h);
  g.strokeStyle='#658897';g.lineWidth=1;g.strokeRect(x-w/2,y,w,h);
  if(column){
    for(let i=0;i<12;i++){
      g.fillStyle=(i+.5)/12<=value/max?accent:'#365668';
      g.fillRect(x-w/2+4,y+h-(i+1)*h/12+1,w-8,h/12-2);
    }
    return;
  }
  const step=max===600?20:10,center=y+h/2;
  g.save();g.beginPath();g.rect(x-w/2,y,w,h);g.clip();
  for(let n=Math.floor(value/step)-3;n<=Math.floor(value/step)+3;n++){
    if(n<0)continue;
    const markY=center+(value-n*step)*h/(step*4);
    g.fillStyle='#c4d6cc';g.fillRect(x-w/2+2,markY,6,1);
    g.font='9px Consolas, monospace';g.textAlign='left';g.fillText(String(n*step),x-w/2+10,markY+3);
  }
  g.fillStyle=accent;g.beginPath();g.moveTo(x+w/2,center-4);g.lineTo(x+w/2-7,center);g.lineTo(x+w/2,center+4);g.fill();g.restore();
}

export function createAircraftInstruments(root, systems) {
  const cells=Object.fromEntries(Object.keys(instruments).map(id=>[id,document.getElementById(id).parentElement]));
  const canvas=document.createElement('canvas');canvas.className='aircraft-faces';canvas.setAttribute('aria-hidden','true');
  root.append(canvas);
  let current=null;
  function update(s) {
    const panel=panels[s.id];if(!panel)return;
    const [name,accent,metal,order,faces,extra]=panel;
    if(current!==s.id){
      current=s.id;root.dataset.aircraft=s.id;document.getElementById('hud').dataset.aircraft=s.id;
      root.style.setProperty('--panel-accent',accent);root.style.setProperty('--panel-metal',metal);
      systems.style.setProperty('--panel-accent',accent);
      order.forEach((id,i)=>{cells[id].style.order=i;cells[id].dataset.face=faces[i];});
    }
    const perf=s.rotorPerformance;
    const tw=perf?.thrustToWeight??0;
    const extraReading={rpm:'로터 '+Math.round(s.rpm*100)+'%',vario:'승강 '+(s.verticalSpeed||0).toFixed(1)+' m/s',
      load:'탑재 '+Math.round(perf?.payloadKg??0)+' kg',water:'소화수 '+Math.round(perf?.waterKg??0)+' kg'}[extra];
    systems.textContent=name+'  ·  '+extraReading+'  |  총중량 '+Math.round(perf?.massKg??0)+' kg  ·  가용 추중비 '+tw.toFixed(2);
    for(const id of order)cells[id].style.setProperty('--reading',clamp(reading(s,id)/instruments[id][2]*100,0,100)+'%');
    const w=canvas.clientWidth,h=canvas.clientHeight;if(w<10||h<10)return;
    const dpr=Math.min(devicePixelRatio||1,2),pw=Math.round(w*dpr),ph=Math.round(h*dpr);
    if(canvas.width!==pw||canvas.height!==ph){canvas.width=pw;canvas.height=ph;}
    const g=canvas.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);
    g.fillStyle=metal;g.fillRect(0,0,w,h);
    g.fillStyle='#0d202c';g.fillRect(0,0,w,18);
    g.font='bold 11px Consolas, monospace';g.textAlign='left';g.fillStyle=accent;g.fillText('HAEON  /  '+name,7,13);
    g.textAlign='right';g.fillText(extraReading,w-7,13);
    const cell=w/4, radius=Math.max(8,Math.min(cell*.37,(h-52)/2)),cy=22+radius;
    order.forEach((id,i)=>{
      const x=cell*(i+.5),value=reading(s,id),[label,unit,max]=instruments[id],face=faces[i];
      g.fillStyle='#476070';g.fillRect(i*cell,19,1,h-19);
      if(face==='dial'||face==='arc')dial(g,x,cy,radius,clamp(value/max,0,1),max,accent,face==='arc');
      else if(face==='drum'){
        g.fillStyle='#101514';g.fillRect(x-cell*.43,cy-12,cell*.86,24);
        const dirs=['N','NE','E','SE','S','SW','W','NW'];g.textAlign='center';
        g.fillStyle=accent;g.font='bold 16px Consolas, monospace';g.fillText(dirs[Math.round(value/45)%8],x,cy+5);
        g.fillStyle='#e8e8da';g.fillRect(x-1,cy-16,2,6);
      }else tape(g,x,cy-radius,Math.min(cell*.60,face==='tape'?50:23),radius*2,value,max,accent,face==='column');
      g.textAlign='center';g.fillStyle='#f1f8fb';g.font='bold 14px Consolas, monospace';
      g.fillText((id==='hdg'?String(Math.round(value)%360).padStart(3,'0'):Math.round(value))+' '+unit,x,h-15);
      g.fillStyle='#adc9d5';g.font='10px sans-serif';g.fillText(label,x,h-3);
    });
  }
  return {update};
}
