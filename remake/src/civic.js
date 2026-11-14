import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';

const facilities = new Map([[209,'City-Hospital'],[210,'Police-Station'],[211,'Fire-Station']]);
const padPath = 'models/helipad/helipad.glb';
const buildingPath = name => `models/world/buildings/${name}/${name}.glb`;
const padEnter = 65, padExit = 90;
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));

// Keep original UVs, embedded textures, metallic/roughness factors and night
// light colours. Untextured primitives share one vertex-PBR material. The
// authored brick, precast, and concrete maps keep independent sampler states.
function solidMaterial(T) {
  const material = new T.MeshStandardMaterial({side:T.DoubleSide,vertexColors:true});
  material.name='Civic / solid finishes';
  material.onBeforeCompile=s=>{
    s.vertexShader='attribute vec2 civicFinish; attribute vec3 civicGlow; varying vec2 vFinish; varying vec3 vGlow;\n'+s.vertexShader.replace('#include <color_vertex>','#include <color_vertex>\nvFinish=civicFinish;vGlow=civicGlow;');
    s.fragmentShader='varying vec2 vFinish; varying vec3 vGlow;\n'+s.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=vFinish.x;').replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\nmetalnessFactor=vFinish.y;').replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance=vGlow;');
  };
  return material;
}

function bake(T,original,solid,padWarp,facilityCode) {
  const parts=new Map(),group=new T.Group(),owned=[];
  original.updateMatrixWorld(true);
  original.traverse(o=>{
    if(!o.isMesh)return;
    const source=o.material, keep=!!(source.map||source.normalMap||source.emissiveMap||source.transparent);
    const material=keep?source:solid;
    const g=o.geometry.clone().applyMatrix4(o.matrixWorld);
    const p=g.attributes.position;
    if(padWarp){for(let i=0;i<p.count;i++)p.setY(i,p.getY(i)+padWarp(p.getX(i),p.getZ(i)));}
    // A solid geometry may carry unused UVs; normalize that attribute set so
    // Blender's different primitive layouts can be joined losslessly.
    if(!keep){
      for(const name of Object.keys(g.attributes))if(name!=='position'&&name!=='normal')g.deleteAttribute(name);
      const color=new Float32Array(p.count*3),finish=new Float32Array(p.count*2),glow=new Float32Array(p.count*3);
      const e=[source.emissive.r,source.emissive.g,source.emissive.b].map(v=>v*source.emissiveIntensity);
      const finishColor={
        '01 | warm aggregate concrete':0x616e73,'02 | cut concrete footing':0x4e5960,
        '04 | aged ivory deck paint':0xe6ebe6,'05 | ochre alignment paint':0xec8059,
        'Department enamel':facilityCode===211?0xbd533b:facilityCode===210?0x284c60:0x2d6271,
        'Membrane and roofing aggregate':0x3e5260,'Lettering and architectural ivory':0xe0e8e7,
        'Heat-control blue glass':0x446b7e,'Glass with raised interior blind':0x758e9a
      }[source.name];
      const tint=finishColor===undefined?source.color:new T.Color(finishColor);
      for(let i=0;i<p.count;i++){
        tint.toArray(color,i*3);glow.set(e,i*3);finish[2*i]=source.roughness;finish[2*i+1]=source.metalness;
      }
      g.setAttribute('color',new T.BufferAttribute(color,3));g.setAttribute('civicFinish',new T.BufferAttribute(finish,2));g.setAttribute('civicGlow',new T.BufferAttribute(glow,3));
    }
    if(!parts.has(material))parts.set(material,[]);parts.get(material).push(g);
  });
  for(const [material,geoms] of parts){
    const merged=geoms.length===1?geoms[0]:mergeGeometries(geoms);
    if(geoms.length>1)geoms.forEach(g=>g.dispose());
    if(!merged)throw Error('시립 시설 메시를 결합할 수 없습니다.');
    owned.push(merged);merged.computeBoundingSphere();
    const m=new T.Mesh(merged,material);m.name=material.name;m.receiveShadow=true;group.add(m);
  }
  const box=new T.Box3().setFromObject(group,true);
  return {group,box,owned};
}

// A rectangle at the source's tallest point would make a helicopter hover
// well above the authored H on these stepped roofs. Bin top-facing triangles
// in the facility's own horizontal plane once, then sample only the local bin.
function roofGrid(asset) {
  const box=asset.box, n=16, cells=Array.from({length:n*n},()=>[]);
  const ix=x=>clamp(Math.floor((x-box.min.x)/(box.max.x-box.min.x)*n),0,n-1);
  const iz=z=>clamp(Math.floor((z-box.min.z)/(box.max.z-box.min.z)*n),0,n-1);
  for(const o of asset.group.children){
    const g=o.geometry,p=g.attributes.position,indices=g.index?.array,total=indices?.length??p.count;
    for(let i=0;i<total;i+=3){
      const a=indices?indices[i]:i,b=indices?indices[i+1]:i+1,c=indices?indices[i+2]:i+2;
      const x=p.getX(a),z=p.getZ(a),y=p.getY(a);
      const dx1=p.getX(b)-x,dz1=p.getZ(b)-z,dx2=p.getX(c)-x,dz2=p.getZ(c)-z;
      const det=dx1*dz2-dx2*dz1;
      if(det>=-.00001||Math.max(y,p.getY(b),p.getY(c))<.30)continue;
      const t=[x,z,y,dx1,dz1,p.getY(b)-y,dx2,dz2,p.getY(c)-y,1/det];
      const x0=ix(Math.min(x,x+dx1,x+dx2)),x1=ix(Math.max(x,x+dx1,x+dx2));
      const z0=iz(Math.min(z,z+dz1,z+dz2)),z1=iz(Math.max(z,z+dz1,z+dz2));
      for(let j=z0;j<=z1;j++)for(let k=x0;k<=x1;k++)cells[j*n+k].push(t);
    }
  }
  return (x,z)=>{
    if(x<box.min.x||x>box.max.x||z<box.min.z||z>box.max.z)return -Infinity;
    let y=-Infinity;
    for(const t of cells[iz(z)*n+ix(x)]){
      const px=x-t[0],pz=z-t[1],u=(px*t[7]-pz*t[6])*t[9],v=(pz*t[3]-px*t[4])*t[9];
      if(u>=-.0001&&v>=-.0001&&u+v<=1.0001)y=Math.max(y,t[2]+u*t[5]+v*t[8]);
    }
    return y>.30?y:-Infinity;
  };
}

function fit(T,p,asset) {
  const b=asset.box;
  const loX=Math.max(p.x0,p.x-p.widthM/2),hiX=Math.min(p.x1,p.x+p.widthM/2);
  const loZ=Math.max(p.z0,p.z-p.depthM/2),hiZ=Math.min(p.z1,p.z+p.depthM/2);
  const sx=(hiX-loX)/(b.max.x-b.min.x),sz=(hiZ-loZ)/(b.max.z-b.min.z),sy=(p.roofY-p.y)/b.max.y;
  const tx=loX-sx*b.min.x,tz=loZ-sz*b.min.z;
  const matrix=new T.Matrix4().makeScale(sx,sy,sz).setPosition(tx,p.y,tz);
  const roof=(x,z)=>p.y+sy*asset.roof((x-tx)/sx,(z-tz)/sz);
  return {matrix,roof};
}

function distance(focus,p){
  return Math.hypot(Math.max(p.x0-focus.x,focus.x-p.x1,0),Math.max(p.z0-focus.z,focus.z-p.z1,0),
    Math.max(focus.y-p.roofY,p.y-focus.y,0));
}

export async function createCivic(ctx,city) {
  const {THREE:T,assets,scene}=ctx, group=new T.Group();group.name='Municipal facilities';
  const lots=city.placements.filter(p=>facilities.has(p.code)&&p.w===3&&p.h===3&&Number.isFinite(p.x0));
  const solid=solidMaterial(T),baked=new Map(),roofs=new Map(),batches=[],removeColliders=[];
  const last=new T.Vector3(city.spawn.x,city.spawn.y,city.spawn.z);
  let disposed=false,pad=null,padShown=false,hasFocus=false;
  const state={nearby:0,pad:false,assetErrors:[]};
  scene.add(group);
  function report(path,error){state.assetErrors.push(path);console.warn('Municipal detail:',path,error);}
  async function loadBuilding(code){
    const path=buildingPath(facilities.get(code));
    try{
      const template=await assets.load(path);
      const asset=bake(T,template,solid,null,code);asset.roof=roofGrid(asset);baked.set(code,asset);
    }catch(error){report(path,error);}
  }

  // Share the fitted Blender geometry and the same transform between rendering
  // and physics at every distance. Sector batches retain frustum culling for
  // large cities without replacing the stepped roof or moving a facade.
  function installBuildings(){
    const sectors=new Map();
    for(const p of lots){
      const asset=baked.get(p.code);if(!asset)continue;
      const {matrix,roof}=fit(T,p,asset);roofs.set(p,roof);
      const key=p.code+'/'+Math.floor(p.col/32)+'/'+Math.floor(p.row/32);
      if(!sectors.has(key))sectors.set(key,{asset,code:p.code,matrices:[]});
      sectors.get(key).matrices.push(matrix);
      for(const part of asset.group.children){
        const remove=city.flightScenery?.add(part.geometry,matrix,'building');if(remove)removeColliders.push(remove);
      }
    }
    for(const {asset,code,matrices} of sectors.values())for(const part of asset.group.children){
      const mesh=new T.InstancedMesh(part.geometry,part.material,matrices.length);
      mesh.name=facilities.get(code)+' / '+part.name;mesh.receiveShadow=true;
      matrices.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));mesh.computeBoundingSphere();
      group.add(mesh);batches.push(mesh);
    }
    city.setModelOverrides([...roofs.keys()],roofs);
  }
  function update(focus,force=false){
    if(disposed||!focus)return;
    if(!force&&hasFocus&&last.distanceToSquared(focus)<1)return;
    last.copy(focus);
    hasFocus=true;
    state.nearby=0;for(const p of roofs.keys())if(distance(focus,p)<65)state.nearby++;
    if(pad){
      const d=Math.hypot(focus.x-city.spawn.x,focus.y-city.spawn.y,focus.z-city.spawn.z);
      const show=d<(padShown?padExit:padEnter);
      if(show!==padShown){padShown=show;pad.group.visible=show;city.setPadOverride(show);state.pad=show;}
    }
  }

  // The original pad remains present if even one metre of deck lands on water.
  async function buildPad(){
    const {x,z,heading=0}=city.spawn, y=city.groundAt(x,z);
    const angle=-heading*Math.PI/180, c=Math.cos(angle),s=Math.sin(angle);
    const at=(u,v)=>({x:x+c*u+s*v,z:z-s*u+c*v});
    for(const u of [-7.65,0,7.65])for(const v of [-7.65,0,7.65]){
      const p=at(u,v),tile=city.tileAt(p.x,p.z);
      if(!tile||![0,221,222].includes(tile.building)||tile.water||Math.abs(city.groundAt(p.x,p.z)-y)>.75||Number.isFinite(city.roofAt(p.x,p.z)))return;
    }
    try{
      const template=await assets.load(padPath);if(disposed)return;
      const warp=(u,v)=>{const p=at(u,v);return city.groundAt(p.x,p.z)-y;};
      pad=bake(T,template,solid,warp);pad.group.position.set(x,y+.016,z);pad.group.rotation.y=angle;
      const canvas=document.createElement('canvas');canvas.width=512;canvas.height=72;
      const g=canvas.getContext('2d');
      g.fillStyle='#dc7450';g.fillRect(0,7,16,58);
      g.font='bold 53px sans-serif';g.fillStyle='#dfe8e5';g.fillText('HAEON  01',32,57);
      const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;tex.anisotropy=4;
      const material=new T.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2});
      const geometry=new T.PlaneGeometry(4.9,.68,4,1);geometry.rotateX(-Math.PI/2);
      const points=geometry.attributes.position;
      for(let i=0;i<points.count;i++){
        const u=points.getX(i)+3.88,v=points.getZ(i)+6.83;
        points.setXYZ(i,u,warp(u,v)+.03,v);
      }
      pad.group.add(new T.Mesh(geometry,material));pad.owned.push(geometry,material,tex);
      pad.group.name='Municipal departure helipad';pad.group.visible=false;group.add(pad.group);
    }catch(error){report(padPath,error);}
  }
  await Promise.all([buildPad(),...Array.from(new Set(lots.map(p=>p.code)),loadBuilding)]);
  installBuildings();
  update(last,true);
  function dispose(){
    if(disposed)return;disposed=true;city.setModelOverrides([],new Map());city.setPadOverride(false);
    for(const remove of removeColliders)remove();for(const mesh of batches)mesh.dispose();
    group.removeFromParent();for(const a of [...baked.values(),...(pad?[pad]:[])])a.owned.forEach(g=>g.dispose());
    solid.dispose();roofs.clear();state.nearby=0;state.pad=false;
  }
  return {update,dispose,state};
}
