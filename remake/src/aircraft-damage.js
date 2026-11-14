import {createParticles} from './particles.js';

const clamp=(n,lo,hi)=>Math.min(hi,Math.max(lo,n));
const ramp=(n,start,end)=>clamp((n-start)/(end-start),0,1);

// Deform the outer third of one blade in rotor space. Geometry from the
// loader is shared by future sorties, so only the damaged instance is edited.
function bentBlade(T, rotor, radius) {
  rotor.updateWorldMatrix(true,true);
  const intoRotor=rotor.matrixWorld.clone().invert();
  const parts=[],point=new T.Vector3(),axis=new T.Vector3();
  let longest=0;
  rotor.traverse(mesh=>{
    if(!mesh.isMesh||!mesh.geometry?.attributes.position)return;
    const original=mesh.geometry,positions=original.attributes.position;
    const toRotor=new T.Matrix4().multiplyMatrices(intoRotor,mesh.matrixWorld);
    for(let i=0;i<positions.count;i++){
      point.fromBufferAttribute(positions,i).applyMatrix4(toRotor);
      const r=Math.hypot(point.x,point.z);
      if(r>longest){longest=r;axis.set(point.x/r,0,point.z/r);}
    }
    parts.push({mesh,original,toRotor});
  });
  // Axial displacements are transformed back into each source mesh's units.
  for(const part of parts){
    const p=part.original.attributes.position;
    part.weights=new Float32Array(p.count);let affected=false;
    for(let i=0;i<p.count;i++){
      point.fromBufferAttribute(p,i).applyMatrix4(part.toRotor);
      const radial=Math.hypot(point.x,point.z);
      const along=radial?point.dot(axis)/radial:0;
      const w=ramp(radial/radius,.58,1)**2*ramp(along,.72,.95);
      part.weights[i]=w;affected ||= w>0;
    }
    if(!affected)continue;
    const back=part.toRotor.invert();
    part.offset=new T.Vector3(0,-radius*.24,0).applyMatrix4(back)
      .sub(new T.Vector3().applyMatrix4(back));
    part.geometry=part.original.clone();part.mesh.geometry=part.geometry;
  }
  return {
    set(amount){
      for(const part of parts){
        if(!part.geometry)continue;
        const original=part.original.attributes.position,p=part.geometry.attributes.position;
        for(let i=0;i<p.count;i++){
          const w=part.weights[i]*amount;
          if(w)p.setXYZ(i,original.getX(i)+part.offset.x*w,original.getY(i)+part.offset.y*w,original.getZ(i)+part.offset.z*w);
        }
        p.needsUpdate=true;part.geometry.computeBoundingSphere();part.geometry.computeBoundingBox();
      }
    },
    dispose(){
      for(const part of parts)if(part.geometry){part.mesh.geometry=part.original;part.geometry.dispose();}
    },
  };
}

export function createAirframeDamageVisuals(T,scene,model,main,tail,diameter){
  const restPosition=model.position.clone(),restRotation=model.rotation.clone();
  const rotorX=main.rotation.x,rotorZ=main.rotation.z,tailZ=tail?.rotation.z;
  const hub=model.worldToLocal(main.getWorldPosition(new T.Vector3()));
  const exhaust=hub.clone().add(new T.Vector3(0,-diameter*.12,-diameter*.14));
  const emission=new T.Vector3(),smokeGroup=new T.Group();smokeGroup.name='Aircraft engine smoke';
  const puffs=[],shake={x:0,y:0,z:0,pitch:0,roll:0};
  let clock=0,phase=0,debt=0,serial=0,blade=null,lastBend=0,smoke=null;

  function update(damage,rpm,dt){
    const severity=clamp(damage/100,0,1);
    const bend=Math.round(ramp(severity,.24,1)*100)/100;
    if(bend!==lastBend){
      if(bend){blade??=bentBlade(T,main,diameter/2);blade.set(bend);}
      else {blade?.dispose();blade=null;}
      lastBend=bend;
    }
    clock+=dt;phase=(phase+dt*(5+23*rpm))%(Math.PI*200);
    const vibration=severity*rpm*(.25+.75*severity);
    const oscillation=Math.sin(phase),beat=Math.sin(phase*.51+1.7);
    shake.x=.038*vibration*oscillation;
    shake.y=.058*vibration*(.7*beat+.3*Math.sin(phase*1.67));
    shake.z=.017*vibration*beat;
    shake.pitch=.025*vibration*beat;
    shake.roll=.048*vibration*oscillation;
    model.position.copy(restPosition);model.position.x+=shake.x;model.position.y+=shake.y;model.position.z+=shake.z;
    model.rotation.copy(restRotation);model.rotation.x+=shake.pitch;model.rotation.z+=shake.roll;
    main.rotation.x=rotorX+vibration*.074*beat;
    main.rotation.z=rotorZ+vibration*.096*oscillation;
    if(tail)tail.rotation.z=tailZ+vibration*.12*Math.sin(phase*1.4);

    const plume=ramp(severity,.52,.95);
    if(!plume){
      if(smoke){smoke.dispose();smoke=null;smokeGroup.removeFromParent();}
      debt=0;puffs.length=0;return;
    }
    if(!smoke){
      scene.add(smokeGroup);smoke=createParticles(T,smokeGroup,36,'Damaged engine exhaust');
    }
    debt+=dt*(2+8*plume);
    if(debt>=1){
      model.localToWorld(emission.copy(exhaust));
      while(debt>=1){debt--;puffs.push({x:emission.x,y:emission.y,z:emission.z,age:0,seed:++serial});}
    }
    smoke.begin(clock);
    for(let i=puffs.length-1;i>=0;i--){
      const p=puffs[i];p.age+=dt;
      if(p.age>=2.8){puffs.splice(i,1);continue;}
      p.y+=dt*(.65+.7*plume);p.x+=dt*(.35+Math.sin(p.seed*1.7)*.14);
      smoke.add(p.x,p.y,p.z,diameter*(.07+p.age*.105)*(.7+.6*plume),1,1.14,p.age/2.8,p.seed);
    }
    smoke.end();
  }
  return {shake,update,dispose(){
    blade?.dispose();smoke?.dispose();smokeGroup.removeFromParent();
    model.position.copy(restPosition);model.rotation.copy(restRotation);
    main.rotation.x=rotorX;main.rotation.z=rotorZ;if(tail)tail.rotation.z=tailZ;
  }};
}
