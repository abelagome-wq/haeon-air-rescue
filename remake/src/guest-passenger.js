import {PILOT_SEATS} from './pilot.js';

const profiles=[
  {stem:'Surveyor',portrait:'guest-surveyor',name:'현장 조사원',height:.969},
  {stem:'Delegate',portrait:'guest-delegate',name:'회의 참석자',height:1.058},
  {stem:'Traveler',portrait:'guest-traveler',name:'여행객',height:1.005},
];
const rotation={bag:[],last:null};
export const guestLabel=portrait=>profiles.find(g=>g.portrait===portrait)?.name;
export function selectGuest(){
  if(!rotation.bag.length){
    const choices=profiles.slice();
    for(let i=choices.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));[choices[i],choices[j]]=[choices[j],choices[i]];
    }
    if(choices.at(-1)===rotation.last)[choices[0],choices[choices.length-1]]=[choices.at(-1),choices[0]];
    rotation.bag=choices;
  }
  rotation.last=rotation.bag.pop();return rotation.last;
}

export function guestWalk(api,model,profile){
  const T=api.ctx.THREE,flight=api.flight,city=api.city,vec=new T.Vector3();
  const anchor=()=>flight.position||flight.state.position;
  const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
  const floor=(x,z)=>city.surfaceAt(x,z);
  const dry=p=>city.tileAt(p.x,p.z)&&!city.tileAt(p.x,p.z).water&&!city.buildingAt(p.x,p.z);
  const clip=(name,instant=false)=>api.setClip?.(model,name,instant);
  let path=[],side=1;
  function positionNear(center,dx,dz,range){
    const angle=Math.atan2(dx,dz);
    for(const size of [range,range*.65,range*.35]){
      for(const turn of [0,.64,-.64,1.28,-1.28,Math.PI]){
        const x=center.x+Math.sin(angle+turn)*size,z=center.z+Math.cos(angle+turn)*size;
        const p={x,y:floor(x,z)+.018,z};
        if(dry(p)&&Math.abs(p.y-center.y)<.95&&canWalk(center,p))return p;
      }
    }
    return {x:center.x,y:floor(center.x,center.z)+.018,z:center.z};
  }
  function canWalk(a,b){
    const samples=Math.max(1,Math.ceil(dist(a,b)/.45));
    let h=floor(a.x,a.z);
    for(let i=1;i<=samples;i++){
      const t=i/samples,p={x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t},y=floor(p.x,p.z);
      if(!dry(p)||Math.abs(y-h)>.54||city.flightScenery?.floorAt(p.x,p.z,y+1.8)>y+.42)return false;
      h=y;
    }
    return true;
  }
  function waitAt(center){
    const p=positionNear(center,1,.55,4.4);
    model.visible=true;model.scale.setScalar(1);model.rotation.set(0,-1.8,0);
    model.position.set(p.x,p.y,p.z);path=[];clip('Await pickup');
  }
  function door(s,extra=0){
    const origin=anchor(),nearest=flight.doorPosition;
    if(!flight.object||!nearest?.clone)return {x:origin.x+s*(1+extra),y:origin.y,z:origin.z};
    const v=flight.object.worldToLocal(nearest.clone());v.x=s*(Math.abs(v.x)+extra);v.y=0;
    return flight.object.localToWorld(v);
  }
  function approach(){
    const start=model.position,candidates=[];
    for(const s of [-1,1]){
      const outer=door(s,1.05),inner=door(s);
      outer.y=floor(outer.x,outer.z);inner.y=floor(inner.x,inner.z);
      if(canWalk(start,outer)&&canWalk(outer,inner))candidates.push({s,outer,inner,cost:dist(start,outer)});
    }
    candidates.sort((a,b)=>a.cost-b.cost);
    if(!candidates.length)return false;
    const route=candidates[0];side=route.s;path=[route.outer,route.inner];clip('Walk to aircraft');return true;
  }
  function step(dt){
    let travel=1.55*Math.min(dt,.25);
    while(path.length){
      const p=path[0],pos=model.position,d=dist(p,pos);
      if(d<.06){path.shift();continue;}
      if(travel<=0)break;
      const take=Math.min(travel,d),dx=(p.x-pos.x)/d,dz=(p.z-pos.z)/d;
      pos.x+=dx*take;pos.z+=dz*take;pos.y=floor(pos.x,pos.z)+.018;
      model.rotation.set(0,Math.atan2(dx,dz),0);travel-=take;
    }
    return !path.length;
  }
  function sit(key){
    if(!flight.object||!PILOT_SEATS[flight.state.id]){model.visible=false;return;}
    const [x,y,z,scale]=PILOT_SEATS[flight.state.id],index=Math.max(0,api.cabin.indexOf?.(key)??0);
    if(flight.state.id==='HEUKSON'){
      // Both cockpit seats are on the centreline. Riders use the six places in the aft cabin.
      vec.set(index%2?.43:-.43,1.73,1.20-.83*Math.floor(index/2));
    }else{
      // The first rider uses the front companion cushion, subsequent pairs sit aft.
      vec.set(index%2?x:-x,y,z-.82*Math.floor((index+1)/2));
    }
    vec.y-=.80*profile.height*scale;
    flight.object.localToWorld(vec);model.position.copy(vec);model.scale.setScalar(scale);
    model.quaternion.copy(flight.object.quaternion);model.visible=flight.object.visible;
  }
  function board(key){path=[];clip(flight.state.id==='SCWZR300'?'High floor seat':'Cabin seat',true);sit(key);}
  function leave(){
    const p=door(side);p.y=floor(p.x,p.z);
    model.position.set(p.x,p.y+.018,p.z);model.scale.setScalar(1);
    model.rotation.set(0,0,0);model.visible=true;
    const axis=door(side,1),target=positionNear(p,axis.x-p.x,axis.z-p.z,3.2);
    path=[target];clip('Walk to aircraft',true);
  }
  function stop(){clip('Await pickup');}
  return {waitAt,approach,step,sit,board,leave,stop};
}

