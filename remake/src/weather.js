// Local, simulated weather. Speeds are m/s, visibility is metres, and wind
// bearings are meteorological (clockwise from north, naming the source).
export const WEATHER_PRESETS = {
  calm:   {label:'맑음',       mean:0, gust:0,  vertical:0,  rain:0,   cloud:.05, visibility:1600},
  breeze: {label:'산들바람',   mean:3, gust:2,  vertical:.22,rain:0,   cloud:.30, visibility:1400},
  drywind:{label:'건조한 강풍', mean:9, gust:5.2,vertical:.95,rain:0,   cloud:.22, visibility:1450},
  fog:    {label:'안개',       mean:1.1,gust:.7,vertical:.12,rain:0,   cloud:.85, visibility:300},
  rain:   {label:'비',         mean:4.6,gust:3.1,vertical:.7,rain:.55,cloud:.88, visibility:760},
  squall: {label:'돌풍·폭우',  mean:8, gust:5.5,vertical:1.6,rain:1,  cloud:1,   visibility:480},
};
const fronts = {
  calm:['breeze','breeze','fog'], breeze:['calm','fog','rain','drywind'], drywind:['breeze','breeze','rain'],
  fog:['calm','breeze','rain'], rain:['breeze','fog','squall'], squall:['rain','breeze'],
};
const radians=Math.PI/180;
const mix=(a,b,t)=>a+(b-a)*t;
const bearing=angle=>(angle%360+360)%360;
const mixBearing=(a,b,t)=>bearing(a+(((b-a+540)%360)-180)*t);

function randomStream(key){
  let state=2166136261;
  for(const char of key)state=Math.imul(state^char.charCodeAt(0),16777619);
  return ()=>{
    state=(Math.imul(state,1664525)+1013904223)>>>0;
    return state/4294967296;
  };
}

export function createWeather({cityId='',mode='auto',seed=Math.random(),fromDeg}={}){
  const random=randomStream(cityId+'|'+seed);
  const automatic=!Object.hasOwn(WEATHER_PRESETS,mode);
  const choose=items=>items[Math.floor(random()*items.length)];
  const phase=random()*Math.PI*2;
  let current=automatic?choose(['calm','breeze','breeze','fog','rain','drywind']):mode;
  let next=automatic?choose(fronts[current]):current;
  let direction=Number.isFinite(fromDeg)?bearing(fromDeg):random()*360;
  const nextDirection=dir=>Number.isFinite(fromDeg)?direction:bearing(dir+(random()-.5)*110);
  let nextDir=nextDirection(direction);
  let elapsed=0,frontStart=0,duration=240+random()*150;
  function update(dt){
    if(!Number.isFinite(dt)||dt<=0)return;
    elapsed+=dt;
    while(automatic&&elapsed-frontStart>=duration){
      frontStart+=duration;
      current=next;direction=nextDir;
      next=choose(fronts[current]);nextDir=nextDirection(direction);
      duration=240+random()*150;
    }
  }
  function sample(position,agl=10,out={}){
    const progress=automatic?Math.max(0,1-(duration-(elapsed-frontStart))/65):0;
    const blend=progress*progress*(3-2*progress);
    const a=WEATHER_PRESETS[current],b=WEATHER_PRESETS[next];
    const field=(key)=>mix(a[key],b[key],blend);
    // A continuous wind field across districts; gusts retain their phase as
    // the aircraft flies through them. Surface friction weakens low winds.
    const x=position?.x??0,z=position?.z??0;
    const wave=Math.sin(elapsed*.29+x*.011+z*.006+phase)*.62+
      Math.sin(elapsed*.55-x*.017+z*.009-phase)*.38;
    const exposure=Math.min(1.28,.42+.58*Math.log1p(Math.max(0,agl)*.5)/Math.log(6));
    const gust=field('gust'),mean=field('mean');
    const speed=(mean+gust*(.32+.68*wave))*exposure;
    const from=mixBearing(direction,nextDir,blend)+(Number.isFinite(fromDeg)?0:
      10*Math.sin(phase+elapsed*.075+x*.004-z*.005)+4*wave);
    const angle=from*radians;
    const eddy=Math.sin(elapsed*.71+z*.021+phase)*.65+Math.sin(elapsed*1.11-x*.023)*.35;
    out.kind=blend<.5?current:next;
    out.label=WEATHER_PRESETS[out.kind].label;
    out.speed=speed;
    out.gustSpeed=(mean+gust)*exposure;
    out.fromDeg=speed>0?bearing(from):null;
    // In this city coordinate system +x is east and -z is north.
    out.windX=speed>0?-Math.sin(angle)*speed:0;
    out.windZ=speed>0?Math.cos(angle)*speed:0;
    const gustDelta=speed-mean*exposure;
    out.gustX=-Math.sin(angle)*gustDelta;
    out.gustZ=Math.cos(angle)*gustDelta;
    out.windUp=speed>0?field('vertical')*exposure*eddy:0;
    out.turbulence=Math.min(1,gust*exposure*(.055+.075*Math.abs(eddy)));
    out.rain=field('rain');out.cloud=field('cloud');out.visibility=field('visibility');
    out.elapsed=elapsed;
    return out;
  }
  return {update,sample};
}
