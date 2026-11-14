import {clone as cloneRig} from '../vendor/three/addons/utils/SkeletonUtils.js';
import {PILOT_SEATS} from './pilot.js';

// Place the pilot's left hand on the moving litter handle over the normal gait.
// Restore the source pose before every animation tick, including after release.
function towingArm(T,body){
  const bones={};
  body.traverse(o=>{if(o.isBone)bones[o.name.replace(/[^a-z]/gi,'')]=o;});
  const upper=bones.UpperArmL,fore=bones.ForearmL,hand=bones.HandL,finger=bones.MiddleL;
  if(!upper||!fore||!hand||!finger)return null;
  const chain=[upper,fore,hand],saved=chain.map(b=>b.quaternion.clone());
  const vec=()=>new T.Vector3(),a=vec(),b=vec(),w=vec(),axis=vec(),bend=vec(),elbow=vec(),wrist=vec(),grip=vec();
  const from=vec(),to=vec(),pivot=vec(),tmp=vec(),rotation=new T.Quaternion(),parentQ=new T.Quaternion(),worldQ=new T.Quaternion();
  let overridden=false;
  function aim(joint,child,target){
    joint.getWorldPosition(pivot);from.copy(child.getWorldPosition(tmp)).sub(pivot).normalize();to.copy(target).sub(pivot).normalize();
    rotation.setFromUnitVectors(from,to);joint.getWorldQuaternion(worldQ);joint.parent.getWorldQuaternion(parentQ);
    joint.quaternion.copy(parentQ.invert()).multiply(rotation).multiply(worldQ);joint.updateWorldMatrix(false,true);
  }
  return {
    restore(){if(overridden)chain.forEach((joint,i)=>joint.quaternion.copy(saved[i]));overridden=false;},
    hold(point){
      chain.forEach((joint,i)=>saved[i].copy(joint.quaternion));overridden=true;
      upper.getWorldPosition(a);fore.getWorldPosition(b);hand.getWorldPosition(w);
      grip.copy(point);wrist.copy(grip);wrist.y+=.078;axis.copy(wrist).sub(a);
      const u=a.distanceTo(b),v=b.distanceTo(w),d=Math.max(Math.abs(u-v)+.001,Math.min(u+v-.001,axis.length()));
      axis.normalize();wrist.copy(a).addScaledVector(axis,d);
      bend.set(.85,.05,-.36).transformDirection(body.matrixWorld);
      bend.addScaledVector(axis,-bend.dot(axis)).normalize();
      const along=(u*u-v*v+d*d)/(2*d);
      elbow.copy(a).addScaledVector(axis,along).addScaledVector(bend,Math.sqrt(Math.max(0,u*u-along*along)));
      aim(upper,fore,elbow);aim(fore,hand,wrist);aim(hand,finger,grip);
    }
  };
}

export function createWalkingPilot(ctx,city,aircraft,state,render=true,collision={}) {
  const T=ctx.THREE,group=new T.Group(),position=group.position;
  group.name='Player on foot';
  let heading=0,mixer,body,idle,walk,arm,walking=false,disposed=false,doorLock=0;
  const doorPoint=new T.Vector3(),probe=new T.Vector3(),radius=.28;
  const floor=(x,z,feet)=>collision.floorAt?.(x,z,feet+.55)??
    Math.max(city.surfaceAt?.(x,z)??city.groundAt(x,z),city.roofAt?.(x,z)??-Infinity);
  if(render)ctx.scene.add(group);
  const ready=render?ctx.assets.load('models/traffic/people/lod1/City-Pilot-LOD1.glb').then(template=>{
    if(disposed)return;
    body=cloneRig(template);group.add(body);mixer=new T.AnimationMixer(body);arm=towingArm(T,body);
    const clips=template.animations||[];
    const idleClip=clips.find(clip=>clip.name==='Listen to dispatch'),walkClip=clips.find(clip=>clip.name==='Walk on foot');
    if(idleClip){idle=mixer.clipAction(idleClip);idle.play();}
    if(walkClip)walk=mixer.clipAction(walkClip);
  }).catch(error=>{state.pilotError=String(error.message||error);}):Promise.resolve();
  function door(side=1,extra=0) {
    const seat=PILOT_SEATS[state.id];
    // The Apache's aft seat lies beside the wing stores. Its forward canopy
    // boarding step is modeled at |x|=1.0, z=2.65 and has a clear approach.
    const apache=state.id==='APACHE';
    doorPoint.set(side*((apache?1.0:(seat?.[0]??.3)+.62)+extra),0,apache?2.65:seat?.[2]??.7);
    aircraft.updateWorldMatrix(true,false);
    return aircraft.localToWorld(doorPoint);
  }
  function distanceToDoor(x,y,z){
    let best=Infinity;
    for(const side of [-1,1]){
      const p=door(side);
      best=Math.min(best,Math.hypot(x-p.x,z-p.z)+Math.abs(y-p.y)*.6);
    }
    return best;
  }
  const doorDistance=()=>distanceToDoor(position.x,position.y,position.z);
  function blocked(x,y,z,allowBoarding=false){
    if(collision.blockWorld?.(x,y,z,radius,1.65)||ctx.walkingActorAt?.(x,y,z,radius,position))return true;
    if(!collision.contactAircraft || allowBoarding&&distanceToDoor(x,y,z)<.84)return false;
    for(const h of [.37,.89,1.43]){
      if(collision.contactAircraft(probe.set(x,y+h,z),radius))return true;
    }
    return false;
  }
  function nearestDoor(){
    const left=door(-1).clone(),right=door(1);
    return position.distanceToSquared(left)<position.distanceToSquared(right)?left:right.clone();
  }
  function leave() {
    // Choose the unobstructed side if a roof edge or wall covers the usual door.
    let target,doorSide;
    for(const side of [1,-1]){
      const p=door(side,1.65).clone(),y=floor(p.x,p.z,aircraft.position.y);
      const tile=city.tileAt?.(p.x,p.z);
      const dry=!tile?.water||!Number.isFinite(tile.waterY)||y>tile.waterY+.3;
      if(dry&&Math.abs(y-aircraft.position.y)<1.3&&!blocked(p.x,y,p.z)){p.y=y;target=p;doorSide=side;break;}
    }
    if(!target)return false;
    position.copy(target);
    const entry=door(doorSide);
    heading=Math.atan2(entry.x-position.x,position.z-entry.z);
    group.rotation.y=Math.PI-heading;
    state.pilotHeading=(heading*180/Math.PI+360)%360;
    state.walkSpeed=0;doorLock=.15;state.onFoot=true;group.visible=true;return true;
  }
  function board(){state.onFoot=false;state.walkSpeed=0;group.visible=false;position.copy(aircraft.position);}
  function animate(moving,dt){
    if(walking!==moving){
      walking=moving;
      const next=moving?walk:idle,last=moving?idle:walk;
      if(next){next.reset().play();if(last)next.crossFadeFrom(last,.18,false);}
    }
    arm?.restore();mixer?.update(dt);
    if(state.patientGrip)arm?.hold(state.patientGrip);
  }
  function move(x,z){
    const y=floor(x,z,position.y),b=city.bounds,tile=city.tileAt?.(x,z);
    if(b&&(x<b.minX+radius||x>b.maxX-radius||z<b.minZ+radius||z>b.maxZ-radius))return false;
    if(Math.abs(y-position.y)>=.65||tile?.water&&Number.isFinite(tile.waterY)&&y<=tile.waterY+.3)return false;
    if(blocked(x,y,z,!doorLock))return false;
    position.set(x,y,z);return true;
  }
  function update(dt,input){
    if(!state.onFoot){position.copy(aircraft.position);return false;}
    doorLock=Math.max(0,doorLock-dt);heading+=input.turn*2.5*dt;
    const speed=input.forward>=0?3.1:2.0;
    const forward=input.forward*speed,side=input.lateral*2.3;
    const x=position.x+(Math.sin(heading)*forward+Math.cos(heading)*side)*dt;
    const z=position.z+(-Math.cos(heading)*forward+Math.sin(heading)*side)*dt;
    const oldX=position.x,oldZ=position.z;
    if(dt>0 && (x!==oldX||z!==oldZ) && !move(x,z)){
      if(x!==oldX)move(x,position.z);
      if(z!==oldZ)move(position.x,z);
    }
    if(dt>0)state.walkSpeed=Math.hypot(position.x-oldX,position.z-oldZ)/dt;
    state.pilotHeading=(heading*180/Math.PI+360)%360;
    group.rotation.y=Math.PI-heading;animate(state.walkSpeed>.08,dt);
    return !doorLock&&Math.hypot(forward,side)>.05&&doorDistance()<.84;
  }
  function dispose(){
    disposed=true;mixer?.stopAllAction();if(body){mixer?.uncacheRoot(body);body.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.dispose();});}
    group.removeFromParent();
  }
  return {position,get heading(){return heading;},doorDistance,nearestDoor,leave,board,update,ready,dispose};
}
