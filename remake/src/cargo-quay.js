// Follow the axis from the generated port to its moored ship. The apron is
// fitted entirely on dry, vacant ground, leaving the water route navigable.
export function planCargoQuay(city){
  if(!city.generated)return null;
  const port=city.landmarks.find(p=>p.code===224),ship=city.ships[0];
  if(!port||!ship)return null;
  const dx=ship.x-port.x,dz=ship.z-port.z;
  const u=Math.abs(dx)>=Math.abs(dz)?[Math.sign(dx),0]:[0,Math.sign(dz)];
  const at=(s,t)=>({x:port.x+u[0]*s-u[1]*t,z:port.z+u[1]*s+u[0]*t});
  const tile=(s,t)=>{const p=at(s,t);return city.tileAt(p.x,p.z);};
  const vacant=t=>t&&!t.water&&!t.road&&!t.rail&&!t.building;
  for(const width of [28,20,14])for(const shift of [0,5,-5]){
    let front=100;
    for(const offset of [-width/2,0,width/2]){
      let s=10;
      while(s<100&&!tile(s,shift+offset)?.water)s++;
      front=Math.min(front,s-1);
    }
    if(front<22||front>=99)continue;
    const back=front-9,half=width/2;let clear=true,top=-Infinity;
    for(let s=back;clear&&s<=front;s++)for(let t=-half;t<=half;t++){
      const p=at(s,t+shift);
      if(!vacant(tile(s,t+shift))){clear=false;break;}
      top=Math.max(top,city.groundAt(p.x,p.z));
    }
    for(let s=9;clear&&s<back;s++)for(const dt of [-2.85,0,2.85]){
      if(!vacant(tile(s,shift*(s-9)/(back-9)+dt))){clear=false;break;}
    }
    if(clear)return {at,u,front,back,half,shift,top:top+.13};
  }
  return null;
}

export function addCargoQuay(T,city,group,owned){
  const plan=planCargoQuay(city);
  if(!plan)return;
  const {at,u,front,back,half,shift,top}=plan;
  const positions=[],normals=[],colors=[],indices=[],color=new T.Color();
  const box=new T.BoxGeometry(),post=new T.CylinderGeometry(1,1,1,8),up=new T.Vector3(0,1,0);
  const yaw=new T.Quaternion().setFromAxisAngle(up,-Math.atan2(u[1],u[0]));
  const vertex=(s,t,y)=>{const p=at(s,t);return new T.Vector3(p.x,y,p.z);};
  function emit(shape,transform,hex){
    color.setHex(hex);
    const attr=shape.attributes,base=positions.length/3,normalMatrix=new T.Matrix3().getNormalMatrix(transform),v=new T.Vector3();
    for(let i=0;i<attr.position.count;i++){
      v.fromBufferAttribute(attr.position,i).applyMatrix4(transform);positions.push(v.x,v.y,v.z);
      v.fromBufferAttribute(attr.normal,i).applyMatrix3(normalMatrix).normalize();normals.push(v.x,v.y,v.z);colors.push(color.r,color.g,color.b);
    }
    for(const index of shape.index.array)indices.push(base+index);
  }
  function beam(a,b,r,hex){
    const axis=b.clone().sub(a),rotation=new T.Quaternion().setFromUnitVectors(up,axis.clone().normalize());
    emit(post,new T.Matrix4().compose(a.clone().lerp(b,.5),rotation,new T.Vector3(r,axis.length(),r)),hex);
  }
  function block(s,t,y,length,width,height,hex){
    emit(box,new T.Matrix4().compose(vertex(s,t,y),yaw,new T.Vector3(length,height,width)),hex);
  }
  city.noLandingTiles??=new Set();
  function reserve(s,t){
    const p=at(s,t),cell=city.worldToTile(p.x,p.z);city.noLandingTiles.add(cell.row*128+cell.col);
  }
  const mid=(front+back)/2;
  block(mid,shift,top-1.9,9,half*2,3.8,0x777d78);
  block(mid,shift,top-.09,9.15,half*2+.1,.18,0xa3a297);
  for(let t=-half+.4;t<half;t+=1)block(front-.07,shift+t,top-1.32,.20,.38,2.4,0x485d63);
  for(let t=-half+1;t<=half-1;t+=3.8){
    block(front-.24,shift+t,top+.017,.32,2,.026,0xe8be58);
    block(front+.09,shift+t,top-.98,.21,.68,1.38,0x303b3b);
  }
  function rampCross(s,side){
    const t=shift*(s-9)/(back-9)+side*2.85,p=at(s,t);
    const y=city.groundAt(p.x,p.z)+.12;
    return vertex(s,t,y+(top-y)*Math.max(0,1-(back-s)/4));
  }
  for(let s=9;s<back;s+=2){
    const end=Math.min(back,s+2),quad=[rampCross(s,-1),rampCross(s,1),rampCross(end,1),rampCross(end,-1)];
    const n=new T.Vector3().subVectors(quad[1],quad[0]).cross(new T.Vector3().subVectors(quad[2],quad[0])).normalize();
    const base=positions.length/3;color.setHex(0x979a91);
    for(const p of quad){positions.push(p.x,p.y,p.z);normals.push(n.x,n.y,n.z);colors.push(color.r,color.g,color.b);}
    indices.push(base,base+1,base+2,base,base+2,base+3);
    for(const side of [-2.85,0,2.85])reserve(s,shift*(s-9)/(back-9)+side);
  }
  for(let s=back;s<=front;s++)for(let t=-half;t<=half;t++)reserve(s,shift+t);
  // Braced loading gantry, operator's cab, travelling trolley and hoist.
  // The boom runs along the apron rather than over the ship's route.
  const mastT=shift-half*.43,paint=0xda8a44,steel=0x435863;
  for(const sign of [-1,1]){
    const s=mid+sign*1.15;
    for(const side of [-1,1])beam(vertex(s,mastT+side*1.3,top),vertex(s,mastT+side*.87,top+7.6),.14,paint);
    beam(vertex(s,mastT-1.15,top+1.2),vertex(s,mastT+.98,top+5.7),.07,steel);
    beam(vertex(s,mastT+1.15,top+1.2),vertex(s,mastT-.98,top+5.7),.07,steel);
    beam(vertex(s,mastT-2,top+7.4),vertex(s,mastT+6.8,top+7.4),.16,paint);
    beam(vertex(s,mastT-1.45,top+9),vertex(s,mastT+6.8,top+7.4),.095,paint);
    beam(vertex(s,mastT-1.45,top+9),vertex(s,mastT-1.45,top+7.4),.1,paint);
  }
  block(mid,mastT-.85,top+6.8,2.65,1.7,1.25,0x37656a);
  block(mid+1.32,mastT-.85,top+7.03,.045,1.25,.48,0x85aeb3);
  block(mid,mastT+5.1,top+7.45,2.6,.8,.42,steel);
  for(const sign of [-1,1])beam(vertex(mid+sign*.65,mastT+5.1,top+7.3),vertex(mid+sign*.65,mastT+5.1,top+4.5),.035,steel);
  block(mid,mastT+5.1,top+4.4,1.65,.42,.22,steel);
  for(const t of [-half+1.8,half-1.8]){
    beam(vertex(front-.9,shift+t,top),vertex(front-.9,shift+t,top+.52),.19,0x393d38);
    block(front-.9,shift+t,top+.55,.54,.78,.13,0x504f41);
  }
  box.dispose();post.dispose();
  const geometry=new T.BufferGeometry();
  for(const [key,data] of [['position',positions],['normal',normals],['color',colors]])geometry.setAttribute(key,new T.Float32BufferAttribute(data,3));
  geometry.setIndex(indices);geometry.computeBoundingSphere();
  const mat=new T.MeshLambertMaterial({vertexColors:true}),quay=new T.Mesh(geometry,mat);
  quay.name='Harbor quay and loading gantry';quay.castShadow=quay.receiveShadow=true;group.add(quay);owned.push(geometry,mat);
  city.flightScenery.add(geometry,quay.matrix,'equipment');
}
