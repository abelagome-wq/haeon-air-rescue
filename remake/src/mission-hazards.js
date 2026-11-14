import {createParticles} from './particles.js';
import {clone as cloneSkinned} from '../vendor/three/addons/utils/SkeletonUtils.js';
import {completion,riotCompletion,RIOT_SECONDS,MISSION_CONTROLS} from './original-mission-economy.js';
import {pickIncidentSite} from './incident-sites.js';

// Values in the local FIRE.TWK are source units (64 per 16 m city tile).
const FIRE = {douse:37.3, multiplier:21, life:190.3, spreadInterval:34.7, spreadChance:224/1024, radius:43.9*.25};
const SOURCE='models/complete/objects/SIM3D2/';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const TAU=Math.PI*2;
function random(seed){
    let s=(seed+1)>>>0;
    return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};
}
function closest(list,target){
    let chosen=null,score=Infinity;
    for(const p of list){const d=dist(p,target);if(d<score){score=d;chosen=p;}}
    return chosen;
}
function startPoint(api,type){
    const list=(type==='riot'?(api.sites.riot?.length?api.sites.riot:api.sites.street):api.sites.fire).filter(Boolean);
    if(api.origin&&type==='fire'){
        const p=point(api,api.origin.x,api.origin.z);
        if(p)return p;
    }
    if(api.origin&&list.length)return closest(list,api.origin);
    return pickIncidentSite(api,type,list)??api.origin??api.city.spawn;
}
function point(api,x,z){
    const b=api.city.bounds;
    if(b&&(x<b.minX||x>=b.maxX||z<b.minZ||z>=b.maxZ))return null;
    const tile=api.city.tileAt(x,z);
    if(!tile||tile.water)return null;
    return {x,z,y:api.city.surfaceAt(x,z)};
}
function walkPoint(api,x,z){
    if(api.city.buildingAt?.(x,z))return null;
    return point(api,x,z);
}
function model(api,name,clip){
    return api.model('models/complete/actors/'+name+'/'+name+'-LOD1.glb',clip);
}
function aimed(api,p){
    if(!api.near(p,49,48,31))return false;
    const at=api.flight.position,dx=p.x-at.x,dz=p.z-at.z,d=Math.hypot(dx,dz);
    if(d<12)return true;
    const h=(api.flight.state.heading??0)*Math.PI/180;
    return (dx*Math.sin(h)-dz*Math.cos(h))/d>.74;
}

export function particles(api){return createParticles(api.ctx.THREE,api.group);}

export function waterCannon(api){
    let burst=null;
    return {
        update(dt){if(burst){burst.age+=dt;if(burst.age>=1.1)burst=null;}},
        shoot(to){
            if(api.supplies.water<1||burst&&burst.age<.44)return 0;
            const scale=api.supplies.waterScale??1;
            const amount=Math.min(api.supplies.water*scale,21*(api.supplies.pumpFactor??1));
            api.supplies.water-=amount/scale;
            const p=api.flight.position;burst={from:{x:p.x,y:p.y-.7,z:p.z},to:{...to},age:0};return amount;
        },
        draw(fx){
            if(!burst)return;
            const {from,to,age}=burst;
            for(let j=0;j<24;j++){
                const u=age*1.4-j*.019;if(u<0||u>1)continue;
                const r=.14+u*.34;
                fx.add(from.x+(to.x-from.x)*u+Math.sin(j*2.4)*r,from.y+(to.y-from.y)*u-.28*Math.sin(u*Math.PI),
                    from.z+(to.z-from.z)*u+Math.cos(j*2.4)*r,.56,2,.42,0,j);
            }
        }
    };
}
function fireIncident(api,variant){
    const big=variant==='large',rng=random(api.serial*487+71),site=startPoint(api,'fire'),patches=[];
    const fx=particles(api),equipment=waterCannon(api);
    let elapsed=0,spreadClock=0,spreadCount=0,direct=0,ground=0,done=false,heatClock=0,nextId=0,casualty=false,fireman=null;
    function ignite(p,force=1){
        const hp=FIRE.douse*force;
        const lot=api.city.buildingAt?.(p.x,p.z);
        const building=lot?[lot.col??lot.x0??lot.x,lot.row??lot.z0??lot.z].join('/'):null;
        patches.push({x:p.x,y:p.y,z:p.z,hp,max:hp,age:0,id:nextId++,out:false,building});
        if(api.focused() && (nextId === 1 || elapsed > 0)) {
            api.sound?.('ignition',p);
            if (nextId === 1) api.sound?.('fireAlarm',p);
        }
    }
    ignite(site);
    if(big){
        for(const [dx,dz] of [[6,-4],[-6,3]]){const p=point(api,site.x+dx,site.z+dz);if(p)ignite(p,.9);}
    }
    const initial=patches.length;
    const initialBuildings=new Set(patches.map(p=>p.building).filter(Boolean));
    const living=()=>patches.filter(p=>p.hp>.001);
    function status(){
        const live=living(),burn=closest(live,api.flight.position)??site;
        const refill=(api.bucket.state.filling||api.supplies.water<1)&&api.bucket.source();
        const s=api.state;s.title=big?'대형 화재':'화재';s.phase=refill?'refill':'drop';s.target=refill||burn;
        s.destination=refill?'급수 수역':'화재 현장';s.incidentSite=burn;s.suggestedTool='bucket';
        s.progress=refill?api.supplies.water/100:clamp(1-live.reduce((a,p)=>a+p.hp,0)/patches.reduce((a,p)=>a+p.max,0),0,1);
        s.instruction=refill?(api.bucket.state.kind==='tank'?'수면 바로 위에서 호버해 물탱크 흡수관을 담그세요.':'수면 위에서 줄을 내린 뒤 양동이가 물에 닿도록 천천히 하강하세요.'):
            '불 위에서 투하 버튼을 누르는 동안 물이 나옵니다. 남은 불 '+live.length+'곳.';
        s.secondsLeft=Math.max(0,Math.ceil(Math.max(...live.map(p=>FIRE.life-p.age),0)));
        s.fireSites=live.length;s.spread=spreadCount;
    }
    function settle(){
        if(done||living().length)return;
        done=true;
        fx.begin(elapsed);fx.end();
        const playerOut=patches.filter(p=>p.out==='player').length,engineOut=patches.filter(p=>p.out==='engine').length;
        // 21REF confirms partial credit for fire crews. The proportion of
        // the fan game's modeled patches extinguished by each team is our
        // approximation of the original building/fire-size counters.
        const share=(playerOut+.5*engineOut)/patches.length;
        const buildings=new Set(patches.map(p=>p.building).filter(Boolean));
        const newlyThreatened=[...buildings].filter(id=>!initialBuildings.has(id)).length;
        const award=completion('fire',initial*share);
        award.points-=newlyThreatened*MISSION_CONTROLS['Fire Miss'][3][1];
        for(const id of buildings){
            const flames=patches.filter(p=>p.building===id);
            if(flames.some(p=>p.out==='player')&&flames.every(p=>p.out!=='expired'))
                api.event?.('buildingSaved',id);
        }
        const outcome=playerOut===patches.length?'success':playerOut||engineOut?'partial':'failed';
        const reason=outcome==='failed'?'fireExpired':patches.some(p=>p.out==='expired')?'fireLoss':engineOut?'groundFireCrew':undefined;
        api.finish({outcome,reason,...award,
            message:outcome==='success'?'공중팀이 화재를 진압했습니다.':reason==='groundFireCrew'?'소방대가 화재를 진압했습니다. 지상 지원분은 일부 보상됩니다.':
                direct||ground?'화재 종료. 직접 진압한 구역만 보상됩니다.':'화재가 스스로 꺼졌습니다. 진압 보상은 없습니다.'});
    }
    function spread(){
        for(const p of living()){
            if(patches.length>=initial+5||rng()>=FIRE.spreadChance)continue;
            const directions=[[16,0],[-16,0],[0,16],[0,-16]],first=Math.floor(rng()*4);
            for(let j=0;j<4;j++){
                const [dx,dz]=directions[(j+first)%4],q=point(api,p.x+dx,p.z+dz);
                if(!q||patches.some(v=>dist(v,q)<7))continue;
                const roof=api.city.roofAt?.(q.x,q.z);
                if(Number.isFinite(roof))q.y=Math.max(q.y,roof);
                ignite(q,.8);spreadCount++;api.event?.('fireSpread','patch/'+(nextId-1));api.updateVoice?.('D1022');
                api.notice('불이 이웃 구역으로 번졌습니다.');
                if(!casualty&&spreadCount>=2){casualty=true;api.secondary('medevac','street',site);}
                break;
            }
        }
    }
    function act(tool){
        if(done)return false;
        if(tool==='context')tool=api.state.suggestedTool;
        if(tool==='firetruck')return api.requestService('fire',closest(living(),api.flight.position)??site);
        if(tool!=='cannon')return false;
        if(api.supplies.water<1){api.notice('물이 부족합니다. 수면에 접근해 급수하세요.');return false;}
        const p=closest(living(),api.flight.position);if(!p)return false;
        if(!aimed(api,p)){api.notice('기수를 화점으로 돌리고 49m 이내로 접근하세요.');return false;}
        if(api.flight.position.y-p.y<5){api.notice('너무 낮습니다. 하강풍이 불길을 키웁니다.');return false;}
        const amount=equipment.shoot(p);if(!amount)return false;
        api.sound?.('water',p);
        douse(p,amount,4.6);
        return true;
    }
    function douse(p,amount,radius){
        let doused=false,hit=false;
        for(const q of living()){
            const r=dist(p,q);
            if(r>radius||Math.abs(p.y-q.y)>3)continue;
            hit=true;
            const power=amount*FIRE.multiplier/20*(1-r/(radius*1.55));
            direct+=Math.min(power,q.hp);q.hp=Math.max(0,q.hp-power);
            if(q.hp<=.001){q.hp=0;q.out='player';doused=true;api.event?.('flameDoused','patch/'+q.id);}
        }
        if(!hit)return;
        if(doused)api.sound?.('douse',p);
        settle();if(!done)status();
    }
    function update(dt){
        if(done)return;
        elapsed+=dt;equipment.update(dt);heatClock=Math.max(0,heatClock-dt);
        for(const p of living()){
            p.age+=dt;
            if(api.serviceAt('fire',p,44)){
                if(!fireman){fireman=model(api,'Fireman','Wave');const park=closest(api.sites.street,p)??site;
                    fireman.position.set(park.x,park.y,park.z);}
                const d=Math.min(p.hp,dt*1.48);ground+=d;p.hp-=d;if(p.hp<=.001){p.hp=0;p.out='engine';api.sound?.('douse',p);}
            }
            const h=api.flight.position.y-p.y;
            if(p.hp>0&&h>0&&h<4.5&&dist(api.flight.position,p)<7){p.hp=Math.min(p.max*1.25,p.hp+dt*.7);
                if(!heatClock&&api.focused()){heatClock=8;api.sound?.('heat',p);api.notice('열기와 하강풍이 불길을 키웁니다. 고도를 높이세요.');}}
            if(p.age>=FIRE.life&&p.hp>0){p.hp=0;p.out='expired';}
        }
        spreadClock+=dt;
        while(spreadClock>=FIRE.spreadInterval){spreadClock-=FIRE.spreadInterval;spread();}
        settle();if(done)return;
        status();fx.begin(elapsed);
        for(const p of living()){
            const size=clamp(p.hp/p.max,.12,1.2),seed=p.id*9.74;
            for(let j=0;j<7;j++){
                const u=(elapsed*.21+j/7)%1;
                fx.add(p.x+u*u*4+Math.sin(seed+j)*.85,p.y+2.5+u*14,p.z+Math.cos(seed+j)*.85,
                    (2.4+u*4.2)*(.65+.35*size),1,1.2,u*.81,seed+j);
            }
            for(let j=0;j<6;j++){
                const h=(4.1+1.8*Math.sin(j+elapsed*4.1))*(.42+.68*size);
                fx.add(p.x+Math.sin(j*2.4+seed)*1.5,p.y+h*.52,p.z+Math.cos(j*2.4+seed)*1.45,h,0,.69,0,seed+j);
            }
        }
        equipment.draw(fx);fx.end();
    }
    status();return {update,act,waterImpact:(p,amount)=>{if(!done)douse(p,amount,FIRE.radius);},activeFireSources:()=>done?[]:living().map(p=>({
        x:p.x,y:p.y,z:p.z,intensity:clamp(p.hp/p.max,0,1),radius:FIRE.radius})),
        dispose(){done=true;fx.dispose();}};
}

// Bake two poses from the supplied character rigs for the outer crowd. Four
// foreground witnesses remain animated. The rest use two instanced draws.
function crowdModels(api,people){
    const T=api.ctx.THREE,draws=[],matrix=new T.Object3D();
    const casts=['Badguy','Woman','BLUES','SHADES'];let disposed=false;
    for(let i=0;i<Math.min(4,people.length);i++){
        people[i].node=model(api,casts[i],i%2?'Wave':'Thro');
    }
    async function batch(type,slot){
        const template=await api.ctx.assets.load('models/complete/actors/'+type+'/'+type+'-LOD1.glb');
        if(disposed)return;
        const rig=cloneSkinned(template),mix=new T.AnimationMixer(rig);
        const clip=template.animations?.find(c=>c.name===(slot?'Wave':'Thro'));
        if(clip){mix.clipAction(clip).play();mix.update(clip.duration*.38);}
        rig.updateMatrixWorld(true);
        const positions=[],colors=[],v=new T.Vector3();
        rig.traverse(o=>{
            if(!o.isMesh)return;
            o.skeleton?.update();
            const g=o.geometry,idx=g.index,n=idx?.count??g.attributes.position.count;
            for(const pass of g.groups.length?g.groups:[{start:0,count:n,materialIndex:0}]){
                const m=Array.isArray(o.material)?o.material[pass.materialIndex]:o.material;
                const rgb=m.map?[.36,.215,.125]:[m.color.r,m.color.g,m.color.b];
                for(let j=pass.start;j<pass.start+pass.count;j++){
                    o.getVertexPosition(idx?idx.getX(j):j,v).applyMatrix4(o.matrixWorld);
                    positions.push(v.x,v.y,v.z);colors.push(...rgb);
                }
            }
        });
        mix.stopAllAction();mix.uncacheRoot(rig);
        if(!positions.length||disposed)return;
        const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
        geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();
        const mat=new T.MeshLambertMaterial({vertexColors:true,side:T.DoubleSide});
        const mesh=new T.InstancedMesh(geometry,mat,people.length);mesh.count=0;mesh.frustumCulled=false;
        mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);mesh.name='Riot crowd · '+type;draws.push({mesh,slot});api.group.add(mesh);
    }
    for(const [slot,cast] of ['SUIT','BLUES'].entries())batch(cast,slot).catch(()=>{
        if(!disposed&&api.focused())api.notice('군중 일부의 원작 모델을 읽지 못했습니다.');
    });
    function pose(o,p,t){
        o.position.set(p.x,p.y+(p.gone?0:.035*Math.abs(Math.sin(t*4+p.seed))),p.z);
        const wave=p.leaving?0:.085*Math.sin(t*3+p.seed);
        o.rotation.set(0,p.yaw+wave,p.stun>0?.25:0);o.updateMatrix();
    }
    return {update(t){
        for(const p of people)if(p.node){p.node.visible=!p.gone;if(!p.gone)pose(p.node,p,t);}
        for(const {mesh,slot} of draws){
            let n=0;
            for(let i=4+slot;i<people.length;i+=2){
                const p=people[i];if(p.gone)continue;pose(matrix,p,t);mesh.setMatrixAt(n++,matrix.matrix);
            }
            mesh.count=n;mesh.visible=n>0;mesh.instanceMatrix.needsUpdate=true;
        }
    },dispose(){disposed=true;for(const {mesh} of draws){mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();mesh.dispose();}}};
}

function riotIncident(api,variant){
    const major=variant==='major',site=startPoint(api,'riot'),rng=random(177+api.serial*733);
    const initial=major?26:18,reserves=major?4:3,people=[],fx=particles(api),wet=waterCannon(api),calls=new Set();
    let total=initial;
    let elapsed=0,done=false,warned=false,watered=false,gasUsed=false,penalty=0,injured=0,interventions=0;
    let nextJoin=28,nextPolice=0,nextNatural=RIOT_SECONDS*.82,lastAction=-Infinity,gasTime=-20,canister=null;
    const center={x:site.x,y:site.y,z:site.z};
    for(let i=0;i<initial+reserves;i++){
        const angle=TAU*(i*.61803398875%1),radius=i<initial*.40?1.8+rng()*2.6:5.4+rng()*4.4;
        const p=walkPoint(api,center.x+Math.cos(angle)*radius,center.z+Math.sin(angle)*radius)??center;
        people.push({...p,seed:rng()*100,yaw:Math.PI-angle,outer:radius>5,stun:0,leaving:false,reserve:i>=initial,gone:i>=initial,travel:0});
    }
    const models=crowdModels(api,people);
    const active=()=>people.filter(p=>!p.leaving&&!p.gone);
    const disperse=(members,n,stun=0,credited=true)=>{
        for(const p of members.slice(0,n)){p.leaving=true;p.stun=stun;p.credited=credited;
            p.yaw=Math.atan2(p.x-center.x,p.z-center.z)+(rng()-.5)*.55;
            const road=closest(api.sites.street,p);
            const exits=(road?.neighbors??[]).map(id=>api.sites.roads?.get(id)).filter(Boolean);
            if(exits.length){
                const dx=Math.sin(p.yaw),dz=Math.cos(p.yaw);
                exits.sort((a,b)=>(b.x-a.x)*dx+(b.z-a.z)*dz);
                p.route=[road,exits[0]].map(q=>({x:q.x+(rng()-.5)*2,z:q.z+(rng()-.5)*2}));
            }
        }
    };
    function secondary(type,variant,p=center){
        if(calls.has(type))return;
        calls.add(type);api.secondary(type,variant,p);
    }
    function injury(playerCaused=false){
        if(api.serviceAt('hospital',center,44))return;
        api.updateVoice?.('D2002');
        injured++;
        if(playerCaused)api.event?.('civilianHarmed','injury/'+injured,'최루탄으로 시민이 다쳤습니다');
        if(injured===1){
            const patient=model(api,'SUIT','Inju');
            const p=point(api,center.x+3.4,center.z-3.1)??center;
            patient.position.set(p.x,p.y,p.z);secondary('medevac','street',p);
        }
    }
    function status(){
        const count=active().length,s=api.state;
        s.title=major?'대규모 폭동':'폭동';s.phase='disperse';s.destination='군중 집결 도로';s.target=center;s.incidentSite=center;
        const departed=people.filter(p=>p.gone&&!p.reserve).length;
        s.progress=departed/total;s.remainingCrowd=count;s.departingCrowd=total-count-departed;s.injured=injured;s.spread=calls.size;
        s.provisionalPoints=people.filter(p=>p.gone&&p.credited).length*10;
        s.secondsLeft=Math.max(0,RIOT_SECONDS-elapsed);
        s.suggestedTool=!warned?'disperse':!watered?'cannon':count>3&&!gasUsed?'gas':'disperse';
        s.instruction=!warned?'군중 가장자리를 비추고 확성기로 해산을 안내하세요.':
            !watered?'수면에서 급수한 뒤 물대포나 물 투하로 중심 무리를 분리하세요.':
                !gasUsed?'강경한 중심 무리에는 최후 수단으로 최루탄을 쓰거나 경찰을 부르세요.':'남은 시민에게 해산을 안내하거나 경찰을 지원하세요.';
        if(warned&&!watered&&(api.bucket.state.filling||api.supplies.water<1)){
            const source=api.bucket.source();
            if(source){s.phase='refill';s.suggestedTool='bucket';s.target=source;s.destination='급수 수역';
                s.instruction=api.bucket.state.kind==='tank'?'수면 가까이 호버해 고정식 물탱크를 채우세요.':'수면 위에서 줄을 내리고 양동이가 물에 닿도록 하강하세요. 급수 후 군중에게 돌아오세요.';}
        }
        if(count<=Math.max(1,Math.floor(total*.11))){s.target=center;s.destination='폭동 현장';s.phase='departure';s.suggestedTool='disperse';
            s.instruction='시민들이 거리를 빠져나가고 있습니다. 부상 신고와 후속 출동을 확인하세요.';}
    }
    function finish(){
        if(done)return;
        const left=people.filter(p=>!p.gone).length;
        if(left>Math.max(1,Math.floor(total*.11))&&elapsed<RIOT_SECONDS)return;
        done=true;
        const handled=total-left;
        const award=interventions?riotCompletion(left):{points:0,cash:0};
        api.finish({outcome:!award.cash?'failed':penalty||left>2?'partial':'success',reason:'crowdReport',...award,
            message:'군중 '+handled+'명 해산 · 부상 '+injured+'명.'+(calls.size?' 후속 출동을 확인하세요.':'')});
        fx.begin(elapsed);fx.end();
    }
    function act(tool){
        if(done)return false;
        if(tool==='context')tool=api.state.suggestedTool;
        const service={police:'police',firetruck:'fire',ambulance:'hospital'}[tool];
        if(service)return api.requestService(service,center);
        if(!['disperse','evacuate','cannon','gas'].includes(tool))return false;

        if(elapsed-lastAction<.7)return false;
        const members=active(),periphery=members.filter(p=>p.outer);
        if(tool==='disperse'||tool==='evacuate'){
            if(!api.spotlit(center,30,95)){api.notice('확성기 메시지는 군중을 조명할 때 가장 잘 들립니다.');return false;}
            warned=true;
            const lit=members.filter(p=>api.spotlit(p,20,95));
            const respond=periphery.length?lit.filter(p=>p.outer):watered?lit.slice(0,gasUsed?4:1):[];
            disperse(respond,major?4:3);api.notice(respond.length?'시민들이 무리에서 빠져나옵니다.':'중심 무리는 경고를 무시합니다.');
        }else if(tool==='cannon'){
            if(!api.supplies.water){api.notice('수면에서 급수한 뒤 복귀하세요.');return false;}
            if(!aimed(api,center)){api.notice('물을 사용하려면 군중을 조준하거나 바로 위로 접근하세요.');return false;}
            const amount=wet.shoot(center);if(!amount)return false;
            api.sound?.('water',center);
            if(!warned){penalty++;api.notice('확성기 경고 전에 물을 사용했습니다.');}
            watered=true;
            const fraction=amount/21;
            const n=Math.max(1,Math.round((major?5:4)*fraction));disperse(members.filter(p=>!p.outer).concat(periphery),n,0,warned);
            for(const p of active().slice(0,2))p.outer=true;
        }else{
            if(!api.near(center,30,48,25)){api.notice('최루탄 투하 범위 밖입니다.');return false;}
            if(api.supplies.gas<=0){api.notice('최루탄이 없습니다. 기지에서 보급하세요.');return false;}
            api.supplies.gas--;gasTime=elapsed;gasUsed=true;
            api.sound?.('gasPop',api.flight.position);
            api.sound?.('gas',center);
            if(!canister)canister=api.model(SOURCE+'TEARGAS.glb');
            canister.visible=true;canister.position.set(center.x,center.y+.12,center.z);
            if(!warned||!watered){penalty++;injury(true);api.notice('단계적 경고 없이 최루탄을 사용했습니다.');}
            else if(members.length<=3){penalty++;injury(true);}
            else if(major&&members.length>9&&rng()<.32)injury(true);
            disperse(members.filter(p=>!p.outer).concat(periphery),major?9:7,3.5,warned&&watered&&members.length>3);
        }
        interventions++;lastAction=elapsed;status();finish();return true;
    }
    function update(dt){
        if(done)return;
        elapsed+=dt;wet.update(dt);
        for(const p of people){
            if(p.gone||!p.leaving)continue;
            if(p.stun>0){p.stun=Math.max(0,p.stun-dt);continue;}
            if(p.route?.length){
                const wp=p.route[0],d=Math.hypot(wp.x-p.x,wp.z-p.z);
                if(d<.55){p.route.shift();if(!p.route.length){p.gone=true;if(p.credited)api.event?.('rioterDispersed',people.indexOf(p));continue;}}
                else p.yaw=Math.atan2(wp.x-p.x,wp.z-p.z);
            }
            const step=dt*1.75,x=p.x+Math.sin(p.yaw)*step,z=p.z+Math.cos(p.yaw)*step;
            const q=walkPoint(api,x,z);
            if(q){p.x=x;p.z=z;p.y=q.y;}else p.yaw+=Math.PI*.65;
            p.travel+=step;if(!p.route&&(dist(p,center)>13||p.travel>22)){
                p.gone=true;if(p.credited)api.event?.('rioterDispersed',people.indexOf(p));
            }
        }
        if(elapsed>=nextJoin){
            nextJoin+=28;
            if(!warned&&active().length>total*.64){
                const p=people.find(p=>p.reserve);
                if(p){p.reserve=false;p.gone=false;total++;}
            }
        }
        const police=api.serviceAt('police',center,42),fire=api.serviceAt('fire',center,42);
        if(police&&elapsed>=nextPolice){
            nextPolice=elapsed+5;
            if(active().length<=total*.66||warned||fire){
                disperse(active().filter(p=>p.outer||watered||gasUsed),fire?3:2);interventions++;
            }
        }
        if(elapsed>55&&active().length>total*.60)secondary('traffic','gridlock');
        if(elapsed>86&&active().length>total*.55&&!fire)secondary('fire','small');
        if(elapsed>106&&active().length>total*.5&&!calls.has('medevac'))injury();
        if(elapsed>=nextNatural&&!interventions){nextNatural+=2.2;disperse(active(),1,0,false);}
        models.update(elapsed);status();finish();
        if(done)return;
        fx.begin(elapsed);wet.draw(fx);
        const age=(elapsed-gasTime)/8;
        if(age>=0&&age<1)for(let j=0;j<12;j++){
            const a=j*2.4,r=age*4+1;
            fx.add(center.x+Math.sin(a)*r+age*3,center.y+.55+age*1.2,center.z+Math.cos(a)*r,1.8+age*3,3,1.45,age,j);
        }
        if(canister&&age>=1)canister.visible=false;
        fx.end();
    }
    let accumulatedWater=0;
    function waterImpact(p,amount){
        if(done||dist(p,center)>11||Math.abs(p.y-center.y)>3)return;
        accumulatedWater+=amount;
        const perPerson=50/(major?5:4),n=Math.floor(accumulatedWater/perPerson);
        if(!n)return;
        accumulatedWater-=n*perPerson;
        if(!warned&&!watered){penalty++;api.notice('확성기 경고 전에 물을 사용했습니다.');}
        watered=true;interventions+=n;
        const members=active();
        disperse(members.filter(p=>!p.outer).concat(members.filter(p=>p.outer)),n,0,warned);
        for(const p of active().slice(0,2))p.outer=true;
        status();finish();
    }
    status();models.update(0);return {update,act,waterImpact,dispose(){done=true;models.dispose();fx.dispose();}};
}

export function createHazardIncident(api,type,variant){
    if(type==='fire')return fireIncident(api,variant);
    if(type==='riot')return riotIncident(api,variant);
    throw Error('지원하지 않는 재난 출동: '+type);
}
