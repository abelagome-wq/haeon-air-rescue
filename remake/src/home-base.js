import {createFlightScenery} from './flight-scenery.js';
import {createWindsock} from './windsock.js';
import {apronEquipmentSite,apronGearGeometry,apronEquipmentFinish} from './service-props.js';
const hangarModel = 'models/lod/Hangar-02-LOD1.glb';
// Door rectangles measured on the archived models in city-kit/geometry.bin.
// AP232 has two person-size, 2.5 m high door faces. AP246 has the 14 m bay
// on its -Z end. City rendering leaves both of these OBJX models unrotated.
const entrances = {
  232: [{x:1.05,z:-7.40,nx:0,nz:-1},{x:6.67,z:-1.05,nx:1,nz:0}],
  246: [{x:-.2,z:-13.60,nx:0,nz:-1}]
};
const hypot = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);
const surface = (city,x,z) => ({x,y:city.surfaceAt(x,z),z});
function passable(city,x,z) {
  const tile = city.tileAt(x,z);
  if (!tile || tile.water || tile.road || tile.rail || city.buildingAt(x,z)) return false;
  // Airport paving is walkable. The numbered trees, tracks, and utility
  // objects on other nonempty tiles do not always have a rooftop sampler.
  return tile.building===0 || tile.building===221 || tile.building===222 ||
    tile.building>=112 && !city.buildingAt(x,z);
}
function segmentSafe(city,a,b) {
  const steps = Math.max(1,Math.ceil(hypot(a,b)/.85));
  const dx=(b.x-a.x)/steps,dz=(b.z-a.z)/steps;
  const length=Math.hypot(dx,dz),sx=length?-.35*dz/length:0,sz=length?.35*dx/length:0;
  let previous=city.surfaceAt(a.x,a.z);
  for(let i=0;i<=steps;i++) {
    const x=a.x+i*dx,z=a.z+i*dz,y=city.surfaceAt(x,z);
    if(!passable(city,x,z)||!passable(city,x+sx,z+sz)||!passable(city,x-sx,z-sz)||Math.abs(previous-y)>.5)return false;
    previous=y;
  }
  return true;
}
function walkRoute(city,door) {
  const start=city.spawn;
  for(const points of [[start,door],[start,{x:door.x,z:start.z},door],[start,{x:start.x,z:door.z},door]]) {
    if(points.slice(1).every((p,i)=>segmentSafe(city,points[i],p)))
      return points.map(p=>surface(city,p.x,p.z));
  }
  return null;
}
function local(origin,yaw,u,v) {
  const c=Math.round(Math.cos(yaw)),s=Math.round(Math.sin(yaw));
  return {x:origin.x+c*u+s*v,z:origin.z-s*u+c*v};
}
function clearLot(city,origin,yaw,scale) {
  // Conservative bounds enclose the eaves, side-door step, and front apron.
  const corners=[[-11.6,-8.4],[11.6,-8.4],[-11.6,11.1],[11.6,11.1]].map(([u,v])=>local(origin,yaw,u*scale,v*scale));
  const xs=corners.map(p=>p.x),zs=corners.map(p=>p.z);
  const x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs);
  const angle=city.spawn.heading*Math.PI/180;
  const padMargin=7.78*(Math.abs(Math.cos(angle))+Math.abs(Math.sin(angle)));
  if(x0<city.spawn.x+padMargin&&x1>city.spawn.x-padMargin&&z0<city.spawn.z+padMargin&&z1>city.spawn.z-padMargin)return false;
  const lo=city.worldToTile(x0,z0),hi=city.worldToTile(x1,z1);
  for(let row=lo.row;row<=hi.row;row++)for(let col=lo.col;col<=hi.col;col++) {
    const p=city.tileToWorld(col,row),tile=city.tileAt(p.x,p.z);
    if(!tile||tile.water||tile.road||tile.rail)return false;
    if(tile.building!==0){
      if(tile.building<225||tile.building>232)return false;
      const lot=city.placements.find(l=>l.col<=col&&l.col+l.w>col&&l.row<=row&&l.row+l.h>row);
      if(!lot||!Number.isFinite(lot.x0)||x0<lot.x1+.5&&x1>lot.x0-.5&&z0<lot.z1+.5&&z1>lot.z0-.5)return false;
    }
  }
  let low=Infinity,high=-Infinity;
  for(let i=0;i<=6;i++)for(let j=0;j<=6;j++){
    const x=x0+(x1-x0)*i/6,z=z0+(z1-z0)*j/6,t=city.tileAt(x,z);
    if(!t||t.water||city.buildingAt(x,z))return false;
    low=Math.min(low,t.groundY);high=Math.max(high,t.groundY);
  }
  if(high-low>.22)return false;
  origin.y=high+.018;
  return true;
}
function deskSite(city) {
  for(const degrees of [135,225,45,315,90,180,0,270]) {
    const angle=(degrees+city.spawn.heading)*Math.PI/180;
    const nx=Math.sin(angle),nz=Math.cos(angle);
    const door=surface(city,city.spawn.x+nx*6.5,city.spawn.z+nz*6.5);
    const route=walkRoute(city,door);
    if(route)return {kind:'desk',door,route,nx:-nx,nz:-nz,title:'착륙장 정비 데스크'};
  }
  throw Error('착륙장에 보행 가능한 정비 데스크를 찾지 못했습니다: '+city.name);
}
function airportOffice(city) {
  // AP228 is an airport service building, not an XBLD hangar. Place a marked
  // reception point at its accessible exterior if the dedicated bay will not fit.
  const options=[];
  for(const lot of city.placements.filter(p=>p.code===228)){
    for(const [x,z,nx,nz] of [[lot.x,lot.z0-1.1,0,-1],[lot.x,lot.z1+1.1,0,1],
      [lot.x0-1.1,lot.z,-1,0],[lot.x1+1.1,lot.z,1,0]]){
      const door=surface(city,x,z),distance=hypot(door,city.spawn);
      if(distance>32||distance<6)continue;
      const route=walkRoute(city,door);
      if(route)options.push({kind:'office',lot,door,route,nx,nz,title:'공항 사무동 정비 접수처'});
    }
  }
  return options.sort((a,b)=>hypot(a.door,city.spawn)-hypot(b.door,city.spawn))[0];
}

export function planHomeBase(city) {
  const original=[];
  for(const lot of city.placements)for(const e of entrances[lot.code]||[]) {
    const door=surface(city,lot.x+e.x+e.nx*.95,lot.z+e.z+e.nz*.95);
    if(hypot(city.spawn,door)>80)continue;
    const route=walkRoute(city,door);
    if(route)original.push({kind:'original',lot,door,route,nx:e.nx,nz:e.nz,title:'원작 격납고 '+lot.model});
  }
  if(original.length)return original.sort((a,b)=>hypot(city.spawn,a.door)-hypot(city.spawn,b.door))[0];
  const candidates=[];
  for(let i=-6;i<=6;i++)for(let j=-6;j<=6;j++){
    const point={x:city.spawn.x+i*8,z:city.spawn.z+j*8};
    for(let q=0;q<4;q++)for(const scale of [1,.72,.60]){
      const yaw=q*Math.PI/2,origin={...point};
      // The fan hangar's sliding bay threshold is Blender y=-7.91,
      // which exports as glTF +Z. It also has a glazed personnel door on +X.
      for(const [u,v,nu,nv] of [[0,9.15,0,1],[11.45,6.18,1,0]]){
        const threshold=local(origin,yaw,u*scale,v*scale),dist=hypot(city.spawn,threshold);
        const normal=local({x:0,z:0},yaw,nu,nv),nx=normal.x,nz=normal.z;
        if(dist<8||dist>58||(city.spawn.x-threshold.x)*nx+(city.spawn.z-threshold.z)*nz<dist*.55)continue;
        candidates.push({origin,yaw,scale,nx,nz,threshold,dist});
      }
    }
  }
  candidates.sort((a,b)=>(a.dist+(1-a.scale)*55)-(b.dist+(1-b.scale)*55));
  for(const p of candidates) {
    if(!clearLot(city,p.origin,p.yaw,p.scale))continue;
    const door=surface(city,p.threshold.x,p.threshold.z),route=walkRoute(city,door);
    if(route)return {kind:'hangar',origin:p.origin,yaw:p.yaw,scale:p.scale,door,route,nx:p.nx,nz:p.nz,title:'시립 정비 격납고'};
  }
  return airportOffice(city)||deskSite(city);
}

function makeEntrance(T,site,owned) {
  const marker=new T.Group(),{door,nx,nz}=site;
  marker.position.set(door.x,door.y+.045,door.z);
  marker.rotation.y=Math.atan2(nx,nz);
  const canvas=document.createElement('canvas');canvas.width=384;canvas.height=108;
  const g=canvas.getContext('2d');g.fillStyle='#172e40';g.fillRect(0,0,384,108);
  g.fillStyle='#eb593e';g.fillRect(0,0,12,108);
  g.fillStyle='#f3f3e8';g.font='bold 38px sans-serif';
  g.fillText(site.kind==='desk'?'정비 데스크':site.kind==='office'?'정비 접수처':'해온 정비 격납고',27,51);
  g.fillStyle='#a4c7ce';g.font='bold 19px sans-serif';g.fillText('HAEON  /  AIR RESCUE',28,83);
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
  const signGeo=new T.PlaneGeometry(1.9,.54),signMat=new T.MeshBasicMaterial({map:texture,side:T.DoubleSide});
  const sign=new T.Mesh(signGeo,signMat);sign.position.set(-1.38,1.69,0);marker.add(sign);
  const postGeo=new T.BoxGeometry(.075,1.7,.09),postMat=new T.MeshLambertMaterial({color:0x57615d});
  const post=new T.Mesh(postGeo,postMat);post.position.set(-1.38,.86,-.055);marker.add(post);
  owned.push(texture,signGeo,signMat,postGeo,postMat);
  if(site.kind==='desk'||site.kind==='office'){
    const topGeo=new T.BoxGeometry(1.75,.12,.69),pedGeo=new T.BoxGeometry(1.30,.78,.54);
    const deskMat=new T.MeshLambertMaterial({color:0x50746d});
    const top=new T.Mesh(topGeo,postMat);top.position.set(-1.38,.87,0);marker.add(top);
    const ped=new T.Mesh(pedGeo,deskMat);ped.position.set(-1.38,.42,0);marker.add(ped);
    owned.push(topGeo,pedGeo,deskMat);
  }
  const lineGeo=new T.PlaneGeometry(1.65,.14),lineMat=new T.MeshBasicMaterial({color:0xe27752,polygonOffset:true,polygonOffsetFactor:-2});
  const line=new T.Mesh(lineGeo,lineMat);line.rotation.x=-Math.PI/2;line.position.y=.035;marker.add(line);
  owned.push(lineGeo,lineMat);
  marker.name='Home hangar entrance';
  return marker;
}

function nightStreetLights(T,city,owned) {
  const samples=city.streetLamps??[];
  if(!samples.length)return null;
  const group=new T.Group();group.name='Night street lighting';
  const geometry=new T.SphereGeometry(1,8,5);
  const lampMaterial=new T.MeshBasicMaterial({color:0xffe5ad});
  const lamps=new T.InstancedMesh(geometry,lampMaterial,samples.length);
  const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
  const c=canvas.getContext('2d'),gradient=c.createRadialGradient(32,32,0,32,32,31);
  gradient.addColorStop(0,'rgba(255,208,130,.26)');gradient.addColorStop(.48,'rgba(255,201,112,.13)');gradient.addColorStop(1,'rgba(255,201,112,0)');
  c.fillStyle=gradient;c.fillRect(0,0,64,64);
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
  const poolsMat=new T.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-3});
  const verts=[],uv=[],idx=[],pose=new T.Object3D();
  for(let i=0;i<samples.length;i++){
    const {x,y,z,angle}=samples[i];
    pose.position.set(x,y,z);pose.rotation.y=angle;pose.scale.set(.245,.04,.128);pose.updateMatrix();lamps.setMatrixAt(i,pose.matrix);
    const base=verts.length/3;
    for(const [u,v] of [[0,0],[0,1],[1,1],[1,0]]){
      const px=x+(u-.5)*8.4,pz=z+(v-.5)*8.4;
      verts.push(px,city.surfaceAt(px,pz)+.095,pz);uv.push(u,v);
    }
    idx.push(base,base+1,base+2,base,base+2,base+3);
  }
  const poolGeo=new T.BufferGeometry();
  poolGeo.setAttribute('position',new T.Float32BufferAttribute(verts,3));
  poolGeo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));poolGeo.setIndex(idx);
  const pools=new T.Mesh(poolGeo,poolsMat);pools.renderOrder=1;
  group.add(lamps,pools);
  owned.push(geometry,lampMaterial,lamps,texture,poolsMat,poolGeo);
  return group;
}

async function bakeHangar(T,template,owned) {
  const {mergeGeometries}=await import('../vendor/three/addons/utils/BufferGeometryUtils.js');
  const batches=new Map(),body=new T.Group(),finishes=new Map();
  const stationFinish={
    'Petrol enamel | fascia':0x1e394c,'Petrol enamel | lower wall course':0x233d50,
    'Faded petrol | fascia seams':0xd5684c,'Galvanized wall | warm grey':0xb5c6c9,
    'Galvanized wall | replacement sheet':0xc2ccca,'Roof | weathered zinc':0x96a9b0,
    'Faded safety amber':0xe8794c,'Fire / warning red':0xdc543a
  };
  template.updateWorldMatrix(true,true);
  template.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const geom=mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const format=Object.entries(geom.attributes).map(([key,a])=>
      [key,a.itemSize,a.normalized,a.array.constructor.name].join('/')).sort().join('|');
    const key=mesh.material.uuid+'|'+Boolean(geom.index)+'|'+format;
    if(!batches.has(key)){
      let material=mesh.material;
      if(Object.hasOwn(stationFinish,material.name)){
        if(!finishes.has(material)){
          const local=material.clone();local.color.setHex(stationFinish[material.name]);
          finishes.set(material,local);owned.push(local);
        }
        material=finishes.get(material);
      }
      batches.set(key,{material,parts:[]});
    }
    batches.get(key).parts.push(geom);
  });
  for(const {material,parts} of batches.values()){
    const geometry=parts.length===1?parts[0]:mergeGeometries(parts);
    if(geometry){
      if(parts.length>1)parts.forEach(part=>part.dispose());
      owned.push(geometry);body.add(new T.Mesh(geometry,material));
    }else for(const part of parts){owned.push(part);body.add(new T.Mesh(part,material));}
  }
  body.name='Hangar 02 / static material batches';
  return body;
}

export async function createHomeBase(ctx,city) {
  const T=ctx.THREE,group=new T.Group(),owned=[];
  group.name='Home air service';
  const scenery=city.flightScenery??createFlightScenery(T);
  let site=planHomeBase(city),originalRoof=null,roof=null;
  if(site.kind==='hangar'){
    let template;
    try { template=await ctx.assets.load(hangarModel); }
    catch { site=deskSite(city); }
    if(template){
      const body=await bakeHangar(T,template,owned);
      body.position.set(site.origin.x,site.origin.y,site.origin.z);body.rotation.y=site.yaw;body.scale.setScalar(site.scale);
      group.add(body);
      const bounds=new T.Box3().setFromObject(body,true);
      originalRoof=city.roofAt;
      roof=(x,z)=>{
        const y=originalRoof(x,z);
        if(x<bounds.min.x||x>bounds.max.x||z<bounds.min.z||z>bounds.max.z)return y;
        return Math.max(y,scenery.floorAt(x,z,bounds.max.y+.01));
      };
      city.roofAt=roof;
    }
  }
  group.add(makeEntrance(T,site,owned));
  const removeCollider=scenery.addObject(group,'building');
  city.windsock=createWindsock(T,city,site.door,group,scenery,ctx.night);
  const parking=apronEquipmentSite(city,site,group.getObjectByName('Airport windsock')?.position);
  let removeEquipment;
  if(parking){
    const geometry=apronGearGeometry(T),map=apronEquipmentFinish(T);
    const material=new T.MeshStandardMaterial({vertexColors:true,map,roughness:.71,metalness:.15});
    const cart=new T.Mesh(geometry,material);
    cart.name='Airfield power trailer and extinguisher';cart.position.set(parking.x,parking.y,parking.z);
    cart.rotation.y=parking.yaw;cart.receiveShadow=true;group.add(cart);
    removeEquipment=scenery.addObject(cart,'equipment');owned.push(geometry,map,material);
  }
  if(ctx.night){
    const light=new T.PointLight(0xffd69b,9,11,2);
    light.name='Hangar entrance lamp';
    light.position.set(site.door.x+site.nx*.7,site.door.y+2.9,site.door.z+site.nz*.7);
    group.add(light);
    const lights=nightStreetLights(T,city,owned);
    if(lights)group.add(lights);
  }
  ctx.scene.add(group);
  return {site,door:site.door,group,
    nearDoor(p){return !!p&&hypot(p,site.door)<=1.5&&Math.abs(p.y-site.door.y)<1.25;},
    dispose(){city.windsock?.dispose();city.windsock=null;removeEquipment?.();removeCollider?.();group.removeFromParent();if(roof&&city.roofAt===roof)city.roofAt=originalRoof;for(const item of owned)item.dispose();}};
}
