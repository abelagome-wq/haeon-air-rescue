// Korean help 22/23/25/33/36REF. The original harness reaches 50 feet and
// carries one person. Walking durations and health clocks are remake tuning.
import {passengerCompletion,REMAKE_SERVICE_FEES} from './original-mission-economy.js';
import {createParticles} from './particles.js';
import {selectGuest,guestWalk} from './guest-passenger.js';
import {pickIncidentSite} from './incident-sites.js';
const RANGE = 15.24;
const distance = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);
const point = p => ({x:p.x,y:p.y,z:p.z});
const actor = id => `models/complete/actors/${id}/${id}-LOD1.glb`;
const people = id => `models/traffic/people/lod1/${id}-LOD1.glb`;
const clamp = n => Math.max(0,Math.min(1,n));
const carriedByPilot = new WeakMap();

function nearest(list, origin, predicate = () => true) {
    let best = null, range = Infinity;
    for (const p of list) {
        if (!predicate(p)) continue;
        const d = distance(origin,p);
        if (d < range) { best = p; range = d; }
    }
    return best;
}

function hospitalPads(api) {
    const pads=[];
    for (const h of api.city.landmarks.filter(l => l.kind==='hospital')) {
        // The target must be inside this actual HO209 envelope. A nearby
        // larger tower may share its zoning boundary.
        // civic.fit maps the City-Hospital GLB's 32.4 × 26.4 m parcel into
        // the physical HO209 lot. The painted pad is at (-3.85,-1.86) in
        // that GLB, offset from the lot center and from its roof penthouse.
        const x0=Math.max(h.x0??h.x-16.2,h.x-(h.widthM||32.4)/2),x1=Math.min(h.x1??h.x+16.2,h.x+(h.widthM||32.4)/2);
        const z0=Math.max(h.z0??h.z-13.2,h.z-(h.depthM||26.4)/2),z1=Math.min(h.z1??h.z+13.2,h.z+(h.depthM||26.4)/2);
        const x=x0+(16.2-3.85)/32.4*(x1-x0),z=z0+(13.2-1.86)/26.4*(z1-z0);
        const box=api.city.buildingAt(x,z);
        if (!box || box.code!==209) continue;
        const y=api.city.roofAt(x,z);
        if (Number.isFinite(y)) pads.push({x,y,z,code:209,radius:Math.max(4,6.15*Math.min((x1-x0)/32.4,(z1-z0)/26.4))});
    }
    return pads;
}

function groundSpot(api, desired, away = null, min = 0) {
    const ok = p => {
        const tile=api.city.tileAt(p.x,p.z);
        return tile && !tile.water && !api.city.buildingAt(p.x,p.z) && (!away || distance(p,away)>=min);
    };
    if (desired && ok(desired)) return {x:desired.x,y:api.city.surfaceAt(desired.x,desired.z),z:desired.z};
    const p=nearest([...(api.sites.street||[]), ...(api.sites.hospitals||[]), api.sites.airport],desired||api.city.spawn,ok);
    return p ? {x:p.x,y:api.city.surfaceAt(p.x,p.z),z:p.z} : null;
}

function roofSpot(api, desired) {
    const candidates=[];
    for (const lot of api.city.placements) {
        if (lot.code===209 || lot.code===210 || lot.code===211) continue;
        const b=api.city.buildingAt(lot.x,lot.z), y=api.city.roofAt(lot.x,lot.z);
        if (b && b.code===lot.code && Number.isFinite(y) && y-lot.y>=2.2) candidates.push({x:lot.x,y,z:lot.z});
    }
    return desired?nearest(candidates,desired):pickIncidentSite(api,'rescue-roof',candidates);
}

function flightPoint(api) { return api.flight.position || api.flight.state.position; }
function touched(api,p,r=14) {
    return !api.flight.state.onFoot && api.flight.state.grounded && api.near(p,r,2.5,2.5);
}

export function createPassengerIncident(api,type,variant) {
    const T=api.ctx.THREE, st=api.state, craft=() => flightPoint(api), serial=api.serial;
    const med=type==='medevac', vip=type==='transport', rescue=type==='rescue';
    const own=[], riders=[], doctorKey=`passengers/${serial}/doctor`;
    const seed=api.origin || api.city.spawn;
    let source=null, routeEnd=null, shelter=null, pad=null, wreck=null, hazard=null, runaway=false;
    let helper=null, helperRole='', phase='', operation=null, waiting, age=0, finished=false, disposed=false;
    let requestedHelp=false,ambulanceReported=false;
    let elapsed=0, delivered=0, partial=0, lost=0, rideTime=0, cable=null,doctorAirborne=false,receiver=null;
    let picked=0,roofHeat=1,roofParticles=null,transfer=null;
    const mode=variant || (rescue?'boat':vip?'vip':'street');
    let setting=mode;
    const candidatePads=hospitalPads(api);
    const set = (name, target, label, text, tool) => {
        phase=name;
        Object.assign(st,{phase:name,target:target?point(target):null,destination:label,instruction:text,
            suggestedTool:tool,progress:0});
    };
    const show=(p,v) => { if (p) p.visible=v; };
    const move=(o,p) => o.position.set(p.x,p.y,p.z);
    function end(outcome,message,points,cash,reason) {
        if(finished || disposed)return;
        finished=true; cleanCabin(); stopTrain();api.finish({outcome,points,cash,message,reason});
    }
    function stopTrain(){if(runaway){api.ctx.transit?.setRunaway?.(serial,false);runaway=false;}}
    function cleanCabin() {
        if(carriedByPilot.get(api.flight)?.owner===serial){carriedByPilot.delete(api.flight);api.flight.state.patientGrip=null;}
        for(const r of riders) { if(api.cabin.has(r.key))api.cabin.remove(r.key); }
        if(api.cabin.has(doctorKey))api.cabin.remove(doctorKey);
    }
    function refreshPad(p) {
        if(p){const current=api.city.roofAt(p.x,p.z);if(Number.isFinite(current))p.y=current;}
        return p;
    }
    function targetPad(p) {return refreshPad(nearest(candidatePads,p));}
    function safeLanding() {
        const p=craft(), t=api.city.tileAt(p.x,p.z);
        if (!api.flight.state.grounded || !t || t.water || api.flight.state.speed>2.5) return false;
        // A reachable incident roof/train is still hazardous.
        if(source && distance(source,p)<27)return false;
        const roof=api.city.roofAt(p.x,p.z), floor=api.city.surfaceAt(p.x,p.z);
        return Math.min(Math.abs(p.y-floor),Math.abs(p.y-roof))<2.5;
    }
    function atHospital() {
        if(!api.flight.state.grounded)return null;
        return candidatePads.find(p=>distance(craft(),p)<=p.radius && touched(api,refreshPad(p),p.radius));
    }
    function nearestSafe(p) {
        return nearest(api.sites.pickup??[],p,q=>distance(q,p)>=42)||groundSpot(api,null,p,42)||api.sites.airport;
    }
    function makeLine() {
        const g=new T.BufferGeometry(), a=new T.Float32BufferAttribute(new Float32Array(6),3);
        g.setAttribute('position',a); const m=new T.LineBasicMaterial({color:0xf2cd69});
        const o=new T.Line(g,m);o.frustumCulled=false;own.push(g,m);api.group.add(o);o.visible=false;return o;
    }
    function drawLine(to) {
        if(!cable)cable=makeLine();
        const p=craft(),a=cable.geometry.getAttribute('position');
        a.setXYZ(0,p.x,p.y+.25,p.z);a.setXYZ(1,to.x,to.y,to.z);
        a.needsUpdate=true;cable.visible=true;
    }
    function makeFire(p) {
        const group=new T.Group();api.group.add(group);move(group,p);
        roofParticles=createParticles(T,group,16,'Rooftop rescue flame and smoke');own.push(roofParticles);
        drawRoofFire();
        return group;
    }
    function drawRoofFire(){
        roofParticles.begin(elapsed);
        const size=Math.sqrt(roofHeat),seed=serial*.71;
        for(let i=0;i<7;i++){
            const u=(elapsed*.21+i/7)%1,theta=i*2.4+seed;
            roofParticles.add(Math.sin(theta)*1.8+u*u*3.2,1.4+u*9,Math.cos(theta)*1.8,
                (1.9+u*3.3)*size,1,1.2,u*.81,theta);
        }
        for(let i=0;i<6;i++){
            const theta=i*2.4+seed,h=(3.0+1.1*Math.sin(theta+elapsed*4.1))*size;
            roofParticles.add(Math.sin(theta)*2.1,h*.51,Math.cos(theta)*2.1,h,0,.72,0,theta);
        }
        roofParticles.end();
    }
    function addRider(kind,offset,body,clip) {
        const r={kind,offset,key:`passengers/${serial}/${riders.length}`,status:'waiting',health:med?325:395,model:api.model(body,clip)};
        if(kind==='injured'){
            // Keep the swimmer's waterline and tread-water clip until boarding.
            r.patient=setting==='boat'?api.model(people('Medevac-Patient'),'Resting breath'):r.model;
            if(r.patient!==r.model)show(r.patient,false);
            r.litter=api.model(people('Patient-Litter'));show(r.litter,false);
        }
        riders.push(r);return r;
    }
    function hideRider(r){
        show(r.model,false);show(r.patient,false);show(r.litter,false);show(r.bridle,false);r.trolley=null;
    }
    function carryOnLitter(r,walker,yaw,dt,floor){
        const dx=Math.sin(yaw),dz=Math.cos(yaw);
        const tx=walker.x-dx*1.22+dz*.10,tz=walker.z-dz*1.22-dx*.10;
        const t=r.trolley??={x:r.patient.position.x,z:r.patient.position.z,yaw};
        const follow=1-Math.exp(-dt*8);
        t.x+=(tx-t.x)*follow;t.z+=(tz-t.z)*follow;
        t.yaw+=Math.atan2(Math.sin(yaw-t.yaw),Math.cos(yaw-t.yaw))*follow;
        const y=(floor??api.city.surfaceAt(t.x,t.z))+.025;
        move(r.litter,{x:t.x,y,z:t.z});r.litter.rotation.y=t.yaw;
        move(r.patient,{x:t.x,y:y+.422,z:t.z});r.patient.rotation.y=t.yaw;
        show(r.litter,true);show(r.patient,true);
    }
    function suspendPatient(r,endPoint){
        if(!r.bridle){
            const g=new T.BufferGeometry(),m=new T.LineBasicMaterial({color:0xffc670});
            g.setAttribute('position',new T.Float32BufferAttribute(new Float32Array(24),3));
            r.bridle=new T.LineSegments(g,m);r.bridle.frustumCulled=false;api.group.add(r.bridle);own.push(g,m);
        }
        const floor=Math.max(where(r).y+.025,endPoint.y-1.28);
        move(r.litter,{x:endPoint.x,y:floor,z:endPoint.z});
        move(r.model,{x:endPoint.x,y:floor+.422,z:endPoint.z});
        r.model.rotation.y=r.litter.rotation.y=0;
        const lines=r.bridle.geometry.getAttribute('position');
        let i=0;
        for(const x of [-.26,.26])for(const z of [-.55,.63]){
            lines.setXYZ(i++,endPoint.x,Math.max(floor+.45,endPoint.y),endPoint.z);
            lines.setXYZ(i++,endPoint.x+x,floor+.425,endPoint.z+z);
        }
        lines.needsUpdate=true;show(r.litter,true);show(r.bridle,true);
    }
    function where(r) {
        const p=source;
        return {x:p.x+r.offset,y:p.y,z:p.z};
    }
    function arrangeWaiting() {
        for(const r of riders)if(r.status==='waiting') {
            if(r.guest){r.guest.waitAt(source);continue;}
            const p=where(r);if(setting==='boat')p.y-=.82;
            if(r.patient===r.model){p.y=(med?api.city.surfaceAt(p.x,p.z):p.y)+.035;r.model.rotation.y=r.offset?-.66:.32;}
            show(r.litter,false);show(r.bridle,false);r.trolley=null;
            move(r.model,p);show(r.model,true);
        }
    }
    function maybeFinish() {
        if(riders.some(r=>!['delivered','partial','lost'].includes(r.status)))return false;
        const {points,cash}=passengerCompletion(type,delivered,picked,lost,setting==='train');
        const result=delivered===riders.length?'success':delivered+partial>0?'partial':'failed';
        end(result,`${vip?'귀빈 수송':med?'환자 후송':'구조'} 종료 · 완료 ${delivered}명${partial?' · 현장 인계 '+partial+'명':''}${lost?' · 사망 '+lost+'명':''}`,points,cash,
            result==='partial'?'incompleteTransfer':result==='failed'?'casualty':undefined);
        return true;
    }
    function release(r,full) {
        if(api.cabin.has(r.key))api.cabin.remove(r.key);
        r.status=full?'delivered':'partial'; if(full)delivered++;else partial++;
        if(full){
            const clip=r.kind==='injured'?'FIELD_HOSPITAL':r.kind==='healthy'?'FIELD_SAFE':
                r.portrait==='guest-delegate'?'FIELD_VIP_EXIT':'FIELD_DROPOFF';
            api.event?.(med?'patientDelivered':vip?'personTransported':'personRescued',r.key+'/arrival',undefined,clip);
        } else api.fieldVoice?.('FIELD_GROUND');
        if(r.guest||r.patient && r.trolley)return;
        const p=craft(),land=r.patient??r.model;
        show(land,true);move(land,{x:p.x+2.6,y:p.y+.035,z:p.z+1.5});
    }
    function pickup(r){
        if(r.pickupPaid)return;
        r.pickupPaid=true;picked++;
        const clip=r.kind==='injured'?'FIELD_MEDIC':r.kind==='healthy'?'FIELD_RESCUE':
            r.portrait==='guest-delegate'?'FIELD_VIP_BOARD':'FIELD_BOARD';
        api.event?.('personPickedUp',r.key+'/pickup',r.kind==='injured'?'환자 탑승':vip?'승객 탑승':'구조자 탑승',clip);
    }
    function choosePhase() {
        if(finished || maybeFinish())return;
        const aboard=riders.filter(r=>r.status==='aboard');
        waiting=riders.find(r=>r.status==='waiting');
        if(vip) {
            if(aboard.length) set('vip-dropoff',routeEnd,'귀빈 지정 목적지','시간 안에 표시된 목적지에 착륙하세요. 귀빈이 내립니다.','board');
            else set('vip-pickup',source,'귀빈 탑승 지점','요청 지점에 착륙해 귀빈을 태우세요. 승객 좌석 한 칸이 필요합니다.','board');
            return;
        }
        if(aboard.length && (!waiting || api.cabin.used>=api.cabin.capacity)) {
            if(aboard.some(r=>r.kind==='injured')) {
                pad=targetPad(craft());
                set('hospital',pad,'병원 옥상 H','병원 옥상 H에 착륙하면 의료진이 환자를 인계받습니다.','board');
            } else {
                shelter=nearestSafe(source);
                set('safe-release',shelter,'안전한 착륙 지점','위험 지점을 벗어나 안전한 곳에 착륙하면 건강한 시민이 자동으로 내립니다.','board');
            }
            return;
        }
        if(!waiting)return;
        set(med?'patient-scene':'harness-pickup',where(waiting),med?'환자 위치':setting==='boat'?'전복 선박':setting==='roof'?'불타는 옥상':'탈주 열차',
            med?'현장 근처에 착륙하고 헬기에서 내리세요. 환자에게 걸어간 뒤 헬기 문으로 돌아오세요.':
                '시민 바로 위에서 호버하고 구조 밧줄을 내리세요. 밧줄의 최대 길이는 15 m입니다.',med?'board':'harness');
    }
    function init() {
        if(rescue && setting==='train') {
            const p=api.ctx.transit?.trainRoof?.();
            if(!p) {set('await-train',null,'열차 확인','운행 중인 열차를 확인하고 있습니다.','harness');return;}
            source=point(p);
            runaway=true;api.ctx.transit?.setRunaway?.(serial,true);
        } else if(rescue && setting==='roof')source=roofSpot(api,api.origin);
        else if(rescue){
            const water=api.sites.rescueWater??api.sites.harbor;
            source=api.origin?nearest(water,api.origin):pickIncidentSite(api,'rescue-water',water);
        }
        else if(med) {
            const scene=api.origin || pickIncidentSite(api,'medical',api.sites.medical??api.sites.fire);
            source=scene?groundSpot(api,scene):null;
        } else {
            const stops=api.sites.pickup??[...api.sites.hospitals,...api.sites.fire];
            const pickup=api.origin||pickIncidentSite(api,'passenger-pickup',stops);
            source=pickup?groundSpot(api,pickup):null;
            if(source){
                const destinations=stops.filter(p=>distance(p,source)>=160);
                routeEnd=pickIncidentSite(api,'passenger-dropoff',destinations);
            }
        }
        if(!source || (!candidatePads.length && !vip) || (vip && !routeEnd)) {
            set('unavailable',null,'관제','이 도시에서 안전한 출동 지점을 찾을 수 없습니다.','context');return;
        }
        source=point(source);
        st.incidentSite=source;
        if(!vip){
            receiver=api.model(people('Medevac-Responder'),'Attendant walk');show(receiver,false);
        }
        if(rescue && setting==='boat') {
            wreck=api.model('models/traffic/lod1/Capsized-Cabin-Boat-LOD1.glb');
            move(wreck,{x:source.x+4,y:source.y,z:source.z+3});wreck.rotation.y=.62;
            addRider('injured',0,people('Harbor-Swimmer'),'Tread water');
        } else if(rescue) {
            if(setting==='roof')hazard=makeFire(source);
            addRider('healthy',-.80,actor('SUIT'),'Wave');
            addRider('injured',.80,people('Medevac-Patient'),'Resting breath');
        } else if(med) {
            addRider('injured',0,people('Medevac-Patient'),'Resting breath');
            if(!api.origin && serial%4===0)addRider('injured',2.1,people('Medevac-Patient'),'Resting breath');
        } else {
            const profile=selectGuest();
            const r=addRider('vip',0,people('Passenger-'+profile.stem),'Await pickup');
            r.portrait=profile.portrait;r.guest=guestWalk(api,r.model,profile);
            rideTime=210+distance(source,seed)/12;
        }
        st.title=vip?'귀빈 수송':med?'응급 의료 후송':setting==='roof'?'불타는 옥상 구조':setting==='train'?'탈주 열차 구조':'전복 선박 구조';
        arrangeWaiting();choosePhase();
    }
    function remainingRoom(key) {return api.cabin.has(key) || api.cabin.used<api.cabin.capacity;}
    function boardSeat(key) {
        if(api.cabin.has(key))return true;
        if(!remainingRoom(key)){api.notice('빈 승객석이 없습니다. 먼저 승객이나 의사를 내려주세요.');return false;}
        const rider=riders.find(r=>r.key===key);
        api.cabin.add(key,1,key===doctorKey?'doctor':rider?.kind==='injured'?'patient':'passenger',rider?.portrait);return api.cabin.has(key);
    }
    function doctorAction() {
        if(operation?.kind==='walk'){api.notice('의료 인력이 환자를 운반하고 있습니다.');return false;}
        if(!api.flight.state.grounded){api.notice('의사는 병원 옥상에서 태우고, 착륙한 곳에서 내릴 수 있습니다.');return false;}
        if(api.cabin.has(doctorKey)) {
            api.cabin.remove(doctorKey);doctorAirborne=false;api.notice('의사가 내렸습니다. 환자용 좌석 한 칸이 비었습니다.');return true;
        }
        if(!atHospital()){api.notice('의사를 태우려면 병원 옥상에 착륙하세요.');return false;}
        if(!boardSeat(doctorKey))return false;
        if(api.charge?.(REMAKE_SERVICE_FEES.doctor,'의사 탑승')===false){api.cabin.remove(doctorKey);api.notice('의사 탑승 비용이 부족합니다.');return false;}
        doctorAirborne=false;api.fieldVoice?.('FIELD_DOCTOR');
        api.notice(`의사 탑승 · ${REMAKE_SERVICE_FEES.doctor}달러 차감. 지상에서 같은 도구로 하차시킬 수 있습니다.`);return true;
    }
    function evacuate() {
        if(vip){
            const r=riders[0];
            if(r.status!=='aboard'||!touched(api,routeEnd))return false;
            r.guest.leave();api.cabin.remove(r.key);r.status='exiting';
            st.instruction='승객이 헬기 문에서 내려 목적지로 걸어가는 중입니다.';
            return true;
        }
        if(!api.flight.state.grounded){api.notice('환자 인계는 착륙 후에 가능합니다.');return false;}
        const on=riders.filter(r=>r.status==='aboard');
        if(!on.length)return false;
        const hospital=atHospital(), safe=safeLanding();
        if(!hospital && !safe){api.notice('병원 옥상이나 위험 지점 밖의 안전한 땅에 착륙하세요.');return false;}
        if(hospital&&on.some(r=>r.patient))return true; // The roof team meets the actual aircraft door.
        for(const r of on) {
            release(r,!!hospital || r.kind!=='injured');
        }
        if(api.cabin.has(doctorKey))api.cabin.remove(doctorKey);
        if(!maybeFinish())choosePhase();return true;
    }
    function unloadingLane(){
        const flight=api.flight,origin=craft(),door=flight.doorPosition??origin;
        const doors=[point(door)];
        if(flight.object&&door.clone){
            const other=flight.object.worldToLocal(door.clone());other.x*=-1;
            doors.push(flight.object.localToWorld(other));
        }
        const lanes=doors.map(p=>{
            let dx=p.x-origin.x,dz=p.z-origin.z;
            if(Math.hypot(dx,dz)<.1){dx=1;dz=0;}
            const len=Math.hypot(dx,dz);dx/=len;dz/=len;
            const at=d=>({x:p.x+dx*d,z:p.z+dz*d});
            return {bed:at(.55),start:at(1.75),exit:at(4.15)};
        });
        return lanes.find(lane=>Object.values(lane).every(p=>
            api.city.buildingAt(p.x,p.z)?.code===209&&Math.abs(api.city.roofAt(p.x,p.z)-pad.y)<.35))??lanes[0];
    }
    function hospitalHandoff(dt){
        if(!receiver.visible){
            show(receiver,true);
            move(receiver,{x:pad.x+pad.radius*.8,y:pad.y,z:pad.z});
        }
        if(!atHospital()||api.flight.state.onFoot){
            if(transfer){hideRider(transfer.rider);transfer=null;}
            return;
        }
        const arrived=riders.filter(r=>r.status==='aboard');
        const patient=arrived.find(r=>r.patient);
        if(!patient){evacuate();return;}
        const lane=transfer??unloadingLane();
        const dest=transfer?lane.exit:lane.start,p=receiver.position;
        const dx=dest.x-p.x,dz=dest.z-p.z,d=Math.hypot(dx,dz),step=Math.min(d,dt*(transfer?1.45:2.1));
        if(d>.03){receiver.rotation.y=Math.atan2(dx,dz);p.x+=dx*step/d;p.z+=dz*step/d;}
        p.y=pad.y;
        if(!transfer){
            if(d>.36)return;
            transfer={rider:patient,...lane};
            move(patient.patient,{...lane.bed,y:pad.y+.45});
            st.instruction='옥상 의료진이 환자를 들것으로 인계받고 있습니다.';
            return;
        }
        carryOnLitter(patient,p,receiver.rotation.y,dt,pad.y);
        if(d>.12)return;
        release(patient,true);transfer=null;
        // Keep delivered patients at the roof while any remaining riders unload.
        if(arrived.some(r=>r!==patient&&r.patient))return;
        for(const other of arrived)if(other!==patient)release(other,true);
        if(api.cabin.has(doctorKey))api.cabin.remove(doctorKey);
        if(!maybeFinish())choosePhase();
    }
    function lower() {
        if(operation) {
            if(operation.kind==='attached') {
                api.sound?.('winch',craft());
                operation.kind='reeling';operation.elapsed=0;set('reeling',craft(),'밧줄 감기','시민이 매달려 있습니다. 기내로 끌어올리는 중입니다.','harness');return true;
            }
            if(operation.kind==='lower') {operation=null;show(cable,false);choosePhase();api.notice('밧줄을 회수했습니다.');return true;}
            return false;
        }
        if(!waiting || waiting.status!=='waiting' || !rescue)return false;
        if(api.flight.state.grounded){api.notice('시민 바로 위로 이륙한 뒤 구조 밧줄을 내리세요.');return false;}
        if(!remainingRoom(waiting.key)){api.notice('좌석이 모두 찼습니다. 병원 인계 또는 안전한 곳에서 하차하세요.');return false;}
        const p=where(waiting);
        if(distance(craft(),p)>30 || craft().y-p.y>RANGE+9){api.notice('시민 가까이 접근하세요. 구조 밧줄의 길이는 약 15 m입니다.');return false;}
        api.sound?.('winch',craft());
        operation={kind:'lower',r:waiting,elapsed:0};
        set('harness-down',p,'밧줄 내림','시민 바로 위에서 낮게 호버하세요. 시민이 밧줄에 닿으면 자동으로 붙잡습니다.','harness');return true;
    }
    function collectPatient() {
        if(operation || !waiting || waiting.status!=='waiting')return false;
        if(api.flight.playerPosition&&!api.cabin.has(doctorKey)){
            api.notice('헬기에서 내려 환자에게 걸어가세요. 돌아와 문에 접근하면 함께 탑승합니다.');return false;
        }
        if(!touched(api,source,17)){api.notice('의료 후송은 환자 근처에 착륙해야 합니다.');return false;}
        const withDoctor=api.cabin.has(doctorKey);
        if(!withDoctor && !remainingRoom(waiting.key)){api.notice('환자를 태울 좌석이 없습니다.');return false;}
        if(withDoctor)api.cabin.remove(doctorKey);
        const who=withDoctor?'doctor':'pilot';
        if(!helper || helperRole!==who) {show(helper,false);helper=api.model(people(withDoctor?'Medevac-Responder':'City-Pilot'),withDoctor?'Attendant walk':'Walk on foot');helperRole=who;}
        const start=point(craft()),dest=where(waiting);
        move(helper,start);show(helper,true);
        operation={kind:'walk',r:waiting,start,dest,elapsed:0,withDoctor,duration:Math.max(1,distance(start,dest)/2.7)};
        set('patient-carry',dest,'환자 운반',withDoctor?'의사가 걸어가 환자를 한 명씩 데려옵니다. 이륙하지 마세요.':'조종사가 내려 환자를 데려옵니다. 운반이 끝날 때까지 지상에 머무세요.','board');return true;
    }
    function boardVip() {
        if(!waiting || waiting.status!=='waiting' || !touched(api,source))return false;
        if(!remainingRoom(waiting.key)){api.notice('승객 좌석이 필요합니다.');return false;}
        if(!waiting.guest.approach()){st.instruction='승객이 옆문까지 걸어올 공간을 두고 착륙하세요.';return false;}
        waiting.status='approaching';
        st.instruction='승객이 옆문까지 걸어오는 동안 기체를 지상에 유지하세요.';return true;
    }
    function transferVip(dt){
        const r=riders[0];
        if(r.status==='approaching'){
            if(!touched(api,source)){
                r.status='waiting';r.guest.waitAt(source);choosePhase();return;
            }
            if(!r.guest.step(dt))return;
            if(!boardSeat(r.key)){r.status='waiting';r.guest.waitAt(source);choosePhase();return;}
            r.status='aboard';r.guest.board(r.key);pickup(r);
            rideTime=220+distance(source,routeEnd)/11;api.notice('귀빈이 탑승했습니다. 지정한 목적지로 비행하세요.');choosePhase();
        }else if(r.status==='aboard'){
            r.guest.sit(r.key);if(touched(api,routeEnd))evacuate();
        }else if(r.status==='exiting'){
            if(r.guest.step(dt)){r.guest.stop();release(r,true);maybeFinish();}
        }else if(r.status==='waiting'&&api.focused()&&touched(api,source)&&remainingRoom(r.key))boardVip();
    }
    function act(tool='context') {
        if(finished || disposed || phase==='await-train' || phase==='unavailable')return false;
        if(tool==='ambulance') {
            const ok=api.requestService('hospital',source);
            api.notice(ok?'구급차에 현장 출동을 요청했습니다.':'이 현장에 닿을 수 있는 구급차 진입로가 없습니다.');return ok;
        }
        if(tool==='doctor' && !vip)return doctorAction();
        if(tool==='context')tool=st.suggestedTool;
        if(tool==='harness' && rescue)return lower();
        if(tool==='board' && vip)return phase==='vip-pickup'?boardVip():evacuate();
        if(tool==='board' && med) {
            if(riders.some(r=>r.status==='aboard') && atHospital())return evacuate();
            return phase==='patient-scene'?collectPatient():evacuate();
        }
        if(tool==='board' && rescue && (phase==='safe-release' || phase==='hospital'))return evacuate();
        return false;
    }
    function updateOperation(dt) {
        if(!operation)return;
        const op=operation,r=op.r,p=craft();op.elapsed+=dt;
        if(op.kind==='walk') {
            if(!api.flight.state.grounded || distance(p,op.start)>8) {
                if(r.status==='carrying')r.status='waiting';
                if(op.withDoctor && remainingRoom(doctorKey))boardSeat(doctorKey);
                show(helper,false);operation=null;arrangeWaiting();choosePhase();api.notice('이륙으로 환자 운반이 중단됐습니다. 다시 착륙하세요.');return;
            }
            const t=clamp(op.elapsed/op.duration),back=op.elapsed>=op.duration, f=back?1-clamp((op.elapsed-op.duration)/op.duration):t;
            const loc={x:op.start.x+(op.dest.x-op.start.x)*f,y:op.start.y+(op.dest.y-op.start.y)*f,z:op.start.z+(op.dest.z-op.start.z)*f};
            move(helper,loc);helper.rotation.y=Math.atan2((op.dest.x-op.start.x)*(back?-1:1),(op.dest.z-op.start.z)*(back?-1:1));
            if(back){
                if(op.withDoctor&&r.status!=='carrying')api.fieldVoice?.('FIELD_TRIAGE');
                r.status='carrying';carryOnLitter(r,loc,helper.rotation.y,dt);
            }
            st.progress=clamp(op.elapsed/(2*op.duration));
            if(op.elapsed < 2*op.duration)return;
            operation=null;show(helper,false);
            if(!boardSeat(r.key)){r.status='waiting';arrangeWaiting();choosePhase();return;}
            r.status='aboard';hideRider(r);
            pickup(r);
            if(op.withDoctor && remainingRoom(doctorKey))boardSeat(doctorKey);
            api.notice(op.withDoctor && !api.cabin.has(doctorKey)?'환자가 유일한 좌석에 탔습니다. 의사는 현장에 남습니다.':'환자가 탑승했습니다. 병원 옥상으로 후송하세요.');choosePhase();return;
        }
        const wp=where(r);
        if(op.kind==='lower') {
            const len=Math.min(RANGE,op.elapsed*8);
            drawLine({x:p.x,y:p.y-len,z:p.z});
            st.progress=len/RANGE;st.target=point(wp);
            const dy=p.y-wp.y;
            if(distance(p,wp)<=3.5 && dy>=-.3 && dy<=len+1.1 && !api.flight.state.grounded && boardSeat(r.key)) {
                r.status='attached';op.kind='attached';op.length=Math.max(.5,Math.min(RANGE,dy));
                api.fieldVoice?.(r.kind==='injured'?'FIELD_RIGGED':'FIELD_HARNESS');
                set('attached',p,'시민이 밧줄을 잡음','밧줄을 다시 작동해 시민을 기내로 끌어올리세요.','harness');
            }
            return;
        }
        const len=op.length*(op.kind==='reeling'?1-clamp(op.elapsed/2):1);
        const endPoint={x:p.x,y:p.y-len,z:p.z};drawLine(endPoint);
        if(r.patient===r.model)suspendPatient(r,endPoint);
        else move(r.model,endPoint);
        st.target=point(p);
        if(op.kind==='reeling') {
            st.progress=clamp(op.elapsed/2);
            if(st.progress>=1){r.status='aboard';hideRider(r);show(cable,false);operation=null;pickup(r);api.notice('시민이 기내에 탔습니다.');choosePhase();}
        }
    }
    function walkPatient(dt){
        if(!med||!api.flight.playerPosition||operation)return;
        const walker=api.flight.playerPosition;
        let carry=carriedByPilot.get(api.flight);
        if(!carry&&api.flight.state.onFoot&&waiting?.status==='waiting'&&remainingRoom(waiting.key)){
            const at=where(waiting);
            if(distance(walker,at)<=2.2&&Math.abs(walker.y-at.y)<2.6){
                carry={owner:serial,rider:waiting};carriedByPilot.set(api.flight,carry);
                waiting.status='carrying';
                set('patient-carry',api.flight.doorPosition??craft(),'헬기 옆문','환자와 함께 기체 옆으로 돌아 문에 접근하세요.','board');
                api.notice('환자에게 도착했습니다. 헬기로 돌아가세요.');
            }
        }
        if(carry?.owner!==serial)return;
        const rider=carry.rider;
        if(rider.status==='lost'){carriedByPilot.delete(api.flight);api.flight.state.patientGrip=null;return;}
        if(api.flight.state.onFoot){
            st.target=point(api.flight.doorPosition??craft());
            carryOnLitter(rider,walker,Math.PI-(api.flight.state.pilotHeading??0)*Math.PI/180,dt);
            const t=rider.trolley,p=rider.litter.position,s=Math.sin(t.yaw),c=Math.cos(t.yaw);
            api.flight.state.patientGrip={x:p.x+c*.196+s*1.205,y:p.y+.731,z:p.z-s*.196+c*1.205};return;
        }
        carriedByPilot.delete(api.flight);
        api.flight.state.patientGrip=null;
        if(!boardSeat(rider.key)){rider.status='waiting';arrangeWaiting();choosePhase();return;}
        rider.status='aboard';hideRider(rider);pickup(rider);
        api.notice('환자가 탑승했습니다. 병원 옥상 H로 가세요.');choosePhase();
    }
    function update(dt) {
        if(finished || disposed)return;
        dt=Math.max(0,dt);age+=dt;elapsed+=dt;
        if(phase==='unavailable'){end('failed','안전한 출동 지점이 없어 관제에서 배정을 취소했습니다.',0,0,'unavailable');return;}
        if(phase==='await-train') {
            if(api.ctx.transit?.trainRoof?.())init();
            else if(age>2){setting='roof';st.variant=setting;api.notice('운행 열차가 없어 실제 옥상 구조 요청을 대신 배정합니다.');init();}
            return;
        }
        if(!source)return;
        if(!requestedHelp && (med || rescue) && waiting?.status==='waiting' && api.focused() && api.near(source,52,55)) {
            requestedHelp=true;api.fieldVoice?.(med?'FIELD_WITNESS':'FIELD_HELP');
        }
        if(phase==='hospital' && pad)st.target=point(refreshPad(pad));
        if(setting==='train'){
            const next=api.ctx.transit?.trainRoof?.();
            if(next){source=point(next);st.incidentSite=source;arrangeWaiting();if(phase==='harness-pickup'&&waiting)st.target=where(waiting);}
        } else if(rescue && setting==='roof') {
            const y=api.city.roofAt(source.x,source.z);
            if(Number.isFinite(y) && y!==source.y){source.y=y;arrangeWaiting();move(hazard,source);if(phase==='harness-pickup'&&waiting)st.target=where(waiting);}
        }
        if(hazard?.visible)drawRoofFire();
        // Clinicians stay aboard when hired, then get out on the next landing.
        // At an actual medevac scene that exit starts the walk to the patient.
        if(api.cabin.has(doctorKey)) {
            if(!api.flight.state.grounded)doctorAirborne=true;
            else if(doctorAirborne) {
                doctorAirborne=false;
                if(med && phase==='patient-scene' && touched(api,source,17))collectPatient();
                else {
                    api.cabin.remove(doctorKey);
                    api.notice('착륙하자 의사가 내렸습니다.');
                }
            }
        }
        updateOperation(dt); if(finished)return;
        walkPatient(dt);
        if(phase==='hospital'&&pad&&riders.some(r=>r.status==='aboard')){
            hospitalHandoff(dt);if(finished)return;
        }
        if(vip) {
            if(riders[0].status!=='exiting')rideTime-=dt;st.secondsLeft=Math.max(0,Math.ceil(rideTime));
            if(rideTime<=0){
                const missed=riders.filter(r=>r.status!=='delivered').length;
                const pay=passengerCompletion(type,delivered,picked,missed);
                end('failed',phase==='vip-pickup'?'늦게 도착해 다른 조종사가 귀빈을 태웠습니다.':'약속한 도착 시간이 지나 수송 계약을 잃었습니다.',pay.points,pay.cash,'reservationExpired');return;
            }
            transferVip(dt);
            return;
        }
        let least=Infinity;
        for(const r of riders) {
            if(r.kind!=='injured' || ['delivered','partial','lost'].includes(r.status))continue;
            const supported=(api.cabin.has(doctorKey) && ['attached','aboard'].includes(r.status)) || operation?.withDoctor;
            const ambulance=med && ['waiting','carrying'].includes(r.status) && api.serviceAt('hospital',source,40);
            if(ambulance && !ambulanceReported && api.focused()){
                ambulanceReported=true;api.fieldVoice?.('FIELD_AMBULANCE');
            }
            const rate=supported ? .45 : ambulance ? .68 : 1;
            r.health-=dt*rate;
            if(r.health<=0){
                r.status='lost';lost++;hideRider(r);if(transfer?.rider===r)transfer=null;
                if(api.cabin.has(r.key))api.cabin.remove(r.key);
                if(operation?.r===r){operation=null;show(helper,false);show(cable,false);}
                api.notice('환자가 사망했습니다.');
                if(maybeFinish())return;choosePhase();
            } else least=Math.min(least,r.health/rate);
        }
        st.secondsLeft=Number.isFinite(least)?Math.ceil(least):null;
        const healthy=riders.filter(r=>r.status==='aboard'&&r.kind==='healthy');
        if(healthy.length && safeLanding()) {
            for(const r of healthy)release(r,true);
            if(maybeFinish())return;choosePhase();
        }
    }
    init();
    return {update,act,waterImpact(p,amount){
        if(finished||disposed||!hazard?.visible||distance(source,p)>7||Math.abs(source.y-p.y)>3)return;
        roofHeat=Math.max(0,roofHeat-amount/40);
        if(roofHeat===0){hazard.visible=false;api.sound?.('douse',source);api.event?.('flameDoused','rescue-roof');}
    },activeFireSources:()=>!finished&&!disposed&&hazard?.visible&&source?
        [{...point(source),intensity:.65*roofHeat,radius:7}]:[],dispose() {
        if(disposed)return;disposed=true;cleanCabin();stopTrain();
        for(const r of own)r.dispose();
    }};
}
