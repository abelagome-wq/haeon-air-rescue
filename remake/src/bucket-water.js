import {createParticles} from './particles.js';
import {BASE_WATER_LITRES} from './aircraft-loadout.js';

// HELI.TWK, [Heli Ropestuff]. The original gives rates 30 and 21 without
// timing units. Each unit represents 1% of the starter bucket's volume.
export const FILL_RATE = 30, DUMP_RATE = 21;
const GRAVITY = 9.81, EXIT_SPEED = 2;
// Bulk stream keeps its release velocity initially, then approaches the
// horizontal air velocity as it breaks up. Time constant in seconds.
const WIND_RESPONSE = 2.5;
const carriedTime=t=>-WIND_RESPONSE*Math.expm1(-t/WIND_RESPONSE);
const range = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);

function floor(city,x,z,ceiling) {
    let ground=city.surfaceAt(x,z),roof=city.roofAt?.(x,z)??-Infinity;
    if(ground>ceiling){
        // A bridge deck may be above a bucket that paid out alongside it.
        // Water released underneath hits the lake or a lower road surface.
        const t=city.tileAt?.(x,z);
        if(t&&Number.isFinite(t.groundY)){
            ground=Math.max(t.groundY,t.waterY??-Infinity);
            for(const y of [t.roadY,t.railY])if(Number.isFinite(y)&&y<=ceiling)ground=Math.max(ground,y);
        }
    }
    if(roof>ceiling)roof=city.flightScenery?.floorAt(x,z,ceiling)??-Infinity;
    return Math.max(ground,roof);
}

// The sight and the stream share this first-contact trajectory. Sweeping the
// path catches a roof crossed in flight even if the final ground point is clear.
export function waterLanding(city,outlet,velocity,weather) {
    const vx=velocity.x, vy=velocity.y-EXIT_SPEED, vz=velocity.z;
    const wx=weather?.windX??0,wz=weather?.windZ??0;
    const interval=Math.min(.10,2/Math.max(1,Math.hypot(vx,vz),Math.hypot(wx,wz)));
    const ceiling=outlet.y+Math.max(0,vy)**2/(2*GRAVITY)+.03;
    const at=t=>{
        const carried=carriedTime(t);
        return floor(city,outlet.x+vx*carried+wx*(t-carried),outlet.z+vz*carried+wz*(t-carried),ceiling);
    };
    const height=t=>outlet.y+vy*t-.5*GRAVITY*t*t;
    let t=0;
    while(t<30 && height(t)>at(t))t+=interval;
    let lo=Math.max(0,t-interval),hi=t;
    for(let i=0;i<7;i++){
        const mid=(lo+hi)/2;
        if(height(mid)>at(mid))lo=mid;else hi=mid;
    }
    const carried=carriedTime(hi);
    const x=outlet.x+vx*carried+wx*(hi-carried),z=outlet.z+vz*carried+wz*(hi-carried);
    return {x,z,y:floor(city,x,z,ceiling),time:hi};
}

export function createBucketWater({T,parent,city,flight,sites,rig,supplies,owns,notice,sound,impact,now=()=>performance.now()}) {
    const fx=createParticles(T,parent,384,'Bucket water stream and splashes'),drops=[],splashes=[];
    const carrier=()=>flight.state.fit?.water;
    const pump=()=>flight.state.fit?.modifiers.pumpFactor??1;
    const state={deployed:false,extension:0,touchingWater:false,filling:false,dispensing:false,outlet:rig.outlet,velocity:rig.velocity,
        get kind(){return carrier()?.kind??'bucket';},
        get capacityLitres(){return equipped() ? carrier()?.capacityLitres??BASE_WATER_LITRES : 0;},
        get name(){return carrier()?.name??'물양동이';}};
    let held=false,lastStamp=null,clock=0,sequence=0,aircraft=flight.state.id,carrierId=carrier()?.id;
    const equipped=()=>owns('bucket');
    const airborne=()=>!flight.state.onFoot&&!flight.state.grounded&&!flight.state.destroyed;
    const hasFlow=()=>held&&rig.canDischarge&&airborne()&&equipped()&&supplies.water>0;
    function syncContents() {
        state.dispensing=hasFlow();
        rig.setContents(supplies.water/100,state.dispensing);
    }
    function emit(seconds) {
        if(seconds<=0||!hasFlow())return;
        const volumeScale=state.capacityLitres/BASE_WATER_LITRES;
        const amount=Math.min(supplies.water*volumeScale,DUMP_RATE*pump()*seconds);
        supplies.water-=amount/volumeScale;
        const last=drops.at(-1),p=rig.outlet,v=rig.velocity;
        if(last&&last.age<.034&&range(last,p)<.25&&Math.abs(last.y-p.y)<.25){last.amount+=amount;return;}
        const wind=flight.state.weather,hit=waterLanding(city,p,v,wind);
        drops.push({x:p.x,y:p.y,z:p.z,vx:v.x,vy:v.y-EXIT_SPEED,vz:v.z,wx:wind?.windX??0,wz:wind?.windZ??0,hit,age:0,amount,id:sequence++});
    }
    // For DOM/controller input the timestamp includes the fraction before
    // the first frame and after the last frame, even for a single-frame tap.
    function elapsedInput(stamp,dt) {
        if(lastStamp===null)return dt;
        const seconds=Math.max(0,(stamp-lastStamp)/1000);
        lastStamp=Math.max(stamp,lastStamp);
        return seconds;
    }
    function begin(stamp) {
        if(!equipped()){notice('급수 장비가 없습니다. 기지 상점에서 물양동이나 물탱크를 장착하세요.');return false;}
        if(!airborne()){notice('물을 투하하려면 헬기에 탑승해 이륙하세요.');return false;}
        if(state.kind==='bucket'&&!state.deployed){notice('먼저 양동이 줄을 내리세요.');return false;}
        if(held)return true;
        if(!supplies.water){notice(state.name+'에 물이 없습니다. 수면 가까이에서 급수하세요.');return false;}
        held=true;lastStamp=Number.isFinite(stamp)?stamp:null;
        sound('water',rig.outlet);syncContents();return true;
    }
    function end(stamp) {
        if(held&&lastStamp!==null)emit(elapsedInput(Number.isFinite(stamp)?stamp:now(),0));
        held=false;lastStamp=null;syncContents();
    }
    function toggle() {
        if(!equipped()){notice('급수 장비가 없습니다. 기지 상점에서 물양동이나 물탱크를 장착하세요.');return false;}
        if(state.kind==='tank'){notice('고정식 물탱크는 수면 가까이 호버하면 흡수관으로 물을 채웁니다.');return false;}
        if(!airborne()){notice('양동이 줄은 이륙 후 조작하세요.');return false;}
        end();state.deployed=!state.deployed;
        notice(state.deployed?'양동이 줄을 내립니다. 수면에 닿으면 급수합니다.':'양동이 줄을 감아 올립니다.');
        return true;
    }
    function update(dt) {
        clock+=dt;
        const changed=aircraft!==flight.state.id||carrierId!==carrier()?.id;
        if(!equipped()||!airborne()||changed){
            held=false;lastStamp=null;state.deployed=false;
            if(changed){supplies.water=0;aircraft=flight.state.id;carrierId=carrier()?.id;}
        }
        rig.update(dt,{equipped:equipped(),deployed:state.deployed,waterFraction:supplies.water/100,dispensing:state.dispensing,
            kind:state.kind,sizeScale:Math.cbrt(state.capacityLitres/BASE_WATER_LITRES)});
        state.extension=rig.extension;
        state.touchingWater=!!rig.inWater;
        const wasFilling=state.filling;
        state.filling=airborne()&&(state.deployed||state.kind==='tank')&&state.touchingWater&&!held&&supplies.water<100;
        if(state.filling){
            if(!wasFilling)sound('splash',rig.outlet);
            supplies.water=Math.min(100,supplies.water+FILL_RATE*pump()*BASE_WATER_LITRES/state.capacityLitres*dt);
            if(supplies.water>=100){state.filling=false;notice(state.name+' 급수 완료.');}
        }
        fx.begin(clock);
        for(let i=drops.length-1;i>=0;i--){
            const d=drops[i];d.age+=dt;
            if(d.age>=d.hit.time){
                // The original tutorial warns that water evaporates on high
                // drops. Interpolate the remake's loss over the last 20 m.
                const remaining=Math.max(0,Math.min(1,(48-(d.y-d.hit.y))/20));
                if(remaining>0){
                    impact(d.hit,d.amount*remaining);
                    splashes.push({...d.hit,age:0,id:d.id});
                }
                drops.splice(i,1);continue;
            }
            const t=d.age,carried=carriedTime(t),drift=t-carried;
            const x=d.x+d.vx*carried+d.wx*drift,y=d.y+d.vy*t-.5*GRAVITY*t*t,z=d.z+d.vz*carried+d.wz*drift;
            const radius=.15+.18*t;
            fx.add(x,y,z,1.1+.55*t,2,.44,Math.min(.74,t/5),d.id);
            fx.add(x+Math.sin(d.id)*radius,y+.12,z+Math.cos(d.id)*radius,.6+.45*t,2,.64,.32,d.id+4);
        }
        for(let i=splashes.length-1;i>=0;i--){
            const s=splashes[i];s.age+=dt;
            if(s.age>.32){splashes.splice(i,1);continue;}
            fx.add(s.x,s.y+.12+s.age*.8,s.z,.5+4*s.age,2,1.6,s.age/.32,s.id);
        }
        if(held)emit(elapsedInput(lastStamp===null?0:now(),dt));
        syncContents();fx.end();
    }
    function source() {
        // Dispatch sites are validated open water centers. Harbor is only
        // a navigation hint and never determines contact or changes supplies.
        const candidates=sites.harbor?.length?sites.harbor:sites.water?.values()??[];
        let best=null,distance=Infinity;
        for(const p of candidates){const d=range(p,flight.position);if(d<distance){best=p;distance=d;}}
        return best;
    }
    return {state,source,begin,end,toggle,update,getAim:()=>equipped()&&rig.canDischarge?waterLanding(city,rig.outlet,rig.velocity,flight.state.weather):null,
        dispose(){held=false;lastStamp=null;drops.length=0;splashes.length=0;fx.dispose();rig.dispose();}};
}
