const mastHeight=4.8;

export function windsockSite(city,door) {
  const start=city.spawn,dx=door.x-start.x,dz=door.z-start.z;
  for(const radius of [22,30,38,48,60,72]) {
    for(const side of [65,-65,90,-90,115,-115,45,-45,140,-140]) {
      const angle=(start.heading+side)*Math.PI/180;
      const x=start.x+radius*Math.sin(angle),z=start.z-radius*Math.cos(angle),y=city.surfaceAt(x,z);
      const t=Math.max(0,Math.min(1,((x-start.x)*dx+(z-start.z)*dz)/(dx*dx+dz*dz||1)));
      if(Math.hypot(x-start.x-t*dx,z-start.z-t*dz)<6)continue;
      // Check the pole and the full swinging envelope against surfaces,
      // streets, scenery and the path between the hangar door and the pad.
      let clear=true;
      for(const a of [-3,0,3])for(const b of [-3,0,3]){
        const px=x+a,pz=z+b,tile=city.tileAt(px,pz);
        if(!tile||tile.water||tile.road||tile.railY!=null||Math.abs(city.surfaceAt(px,pz)-y)>1
          ||city.roofAt(px,pz)>y+.18||city.flightScenery?.floorAt(px,pz,y+8)>y+.3)clear=false;
      }
      if(clear)return {x,y,z};
    }
  }
  return null;
}

export function createWindsock(T,city,door,parent,scenery,night) {
  const site=windsockSite(city,door);
  if(!site)return null;
  const group=new T.Group();
  group.position.set(site.x,site.y,site.z);group.name='Airport windsock';parent.add(group);
  const mastProfile=[[.33,0],[.33,.15],[.12,.24],[.065,mastHeight],[.09,mastHeight+.05],[0,mastHeight+.10]];
  const pole=new T.Mesh(new T.LatheGeometry(mastProfile.map(([x,y])=>new T.Vector2(x,y)),10),
    new T.MeshStandardMaterial({color:0xaeb6b7,roughness:.67,metalness:.32}));
  group.add(pole);group.updateWorldMatrix(true,true);
  const remove=scenery.addObject(pole,'pole');
  const sleeve=new T.BufferGeometry(),bands=5,segments=10,vertices=bands*2*(segments+1);
  const positions=new Float32Array((vertices+9)*3),colors=new Float32Array((vertices+9)*3),indices=[];
  const bright=new T.Color(0xf47623),pale=new T.Color(0xf1e7d3);
  for(let band=0;band<bands;band++)for(let ring=0;ring<2;ring++)for(let step=0;step<=segments;step++){
    const i=(band*2+ring)*(segments+1)+step;
    (band%2?pale:bright).toArray(colors,i*3);
    if(!ring&&step<segments)indices.push(i,i+segments+1,i+1,i+1,i+segments+1,i+segments+2);
  }
  // Three bridle cords connect the rotating mouth to the top of the mast.
  for(let cord=0;cord<3;cord++){const i=vertices+3*cord;indices.push(i,i+1,i+2);colors.fill(.46,i*3,(i+3)*3);}
  const pos=new T.BufferAttribute(positions,3);
  pos.setUsage(T.DynamicDrawUsage);sleeve.setAttribute('position',pos);
  sleeve.setAttribute('color',new T.BufferAttribute(colors,3));sleeve.setIndex(indices);
  const cloth=new T.Mesh(sleeve,new T.MeshLambertMaterial({vertexColors:true,side:T.DoubleSide,emissive:night?0x312720:0x000000}));
  cloth.position.y=mastHeight-.03;group.add(cloth);
  const out={},sensor={x:site.x,y:site.y+mastHeight,z:site.z};
  function pose(sample) {
    const taut=Math.min(1,sample.speed/7.7);
    if(sample.speed>.05)cloth.rotation.y=-Math.atan2(sample.windZ,sample.windX);
    for(let band=0;band<bands;band++)for(let ring=0;ring<2;ring++){
      const along=(band+ring)/bands;
      const x=.54+along*(.43+2.36*taut);
      const y=-(1-taut)*(1.3*along+1.05*along*along);
      const z=Math.sin(sample.elapsed*5-along*7)*.11*taut*along*along;
      const tilt=Math.atan2(-(1-taut)*(1.3+2.1*along),.43+2.36*taut);
      const radius=.42-.25*along;
      for(let s=0;s<=segments;s++){
        const angle=s/segments*Math.PI*2,radial=radius*Math.cos(angle);
        const i=(band*2+ring)*(segments+1)+s;
        pos.setXYZ(i,x-Math.sin(tilt)*radial,y+Math.cos(tilt)*radial,z+radius*Math.sin(angle));
      }
    }
    for(let cord=0;cord<3;cord++){
      const i=vertices+3*cord,mouth=Math.round(cord*segments/3);
      pos.setXYZ(i,0,-.018,0);pos.setXYZ(i+1,0,.018,0);
      pos.setXYZ(i+2,pos.getX(mouth),pos.getY(mouth),pos.getZ(mouth));
    }
    pos.needsUpdate=true;sleeve.computeVertexNormals();
  }
  pose({windX:0,windZ:0,speed:0,elapsed:0});
  // All possible sleeve poses fit within this fixed local bound.
  sleeve.boundingSphere=new T.Sphere(new T.Vector3(1.4,-.9,0),2.55);
  let lastPose=-1,wasCalm=false;
  return {
    update(flight,camera) {
      group.visible=Math.hypot(camera.position.x-site.x,camera.position.z-site.z)<320;
      if(!group.visible)return;
      const sample=flight.sampleWeather?.(sensor,mastHeight,out);
      if(!sample||sample.elapsed>=lastPose&&sample.elapsed-lastPose<1/20)return;
      if(sample.speed>.05||!wasCalm)pose(sample);
      wasCalm=sample.speed<=.05;lastPose=sample.elapsed;
    },
    dispose(){remove();group.removeFromParent();pole.geometry.dispose();pole.material.dispose();sleeve.dispose();cloth.material.dispose();}
  };
}
