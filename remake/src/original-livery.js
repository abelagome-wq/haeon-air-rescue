import {Color,Float32BufferAttribute} from 'three';

// SCWZR300 uses palettes 16 (orange), 80 (olive), and 0 (canopy).
// SIM3D2.MAX stores 16 shades per paint ramp. The catalog photo uses a
// lighter buff on the same canopy perimeter and tail boom.
const airframes = /\/models\/fleet\/(?:schweizer\/Schweizer-300|lod1\/Schweizer-300-LOD1)\.glb$/i;
const pilots = /\/models\/traffic\/people\/(?:City-Pilot|lod1\/City-Pilot-LOD1)\.glb$/i;
const cloth = {
  // The procedural near maps and upscaled distance maps have different
  // median dyes. Keep their existing yarn, wear, alpha and UV sampling.
  'fabric':      {near:0x666c4a, distance:0x626a44, day:0x658095, night:0x809faf},
  'fabric dark': {near:0x50593e, distance:0x4b5138, day:0x3f5f6f, night:0x658095},
  'pants':       {near:0x545d43, distance:0x565f3f, day:0x004f95, night:0x0f64a6},
  'pants dark':  {near:0x475039, distance:0x3f4730, day:0x063b70, night:0x004f95}
};

function paintDomain(mesh) {
  for(let node=mesh;node;node=node.parent){
    const name=(node.name||'').toLowerCase().replace(/[^a-z0-9]/g,'');
    if(name.includes('01airframeandglazing')||name.includes('04tailassembly'))return true;
  }
  return false;
}
function dye(material,values,distant,night) {
  const dye=new Color(values[night?'night':'day']);
  if(material.map){
    const base=new Color(values[distant?'distance':'near']);
    dye.r/=base.r;dye.g/=base.g;dye.b/=base.b;
  }
  material.color.copy(dye);
}

function headset(mesh) {
  // The helmet dome and its two ear defenders share one material. Identify
  // their three disconnected surfaces by position, including duplicated UV
  // seam vertices, so only the ear shells receive the archived blue.
  const original=mesh.geometry,pos=original.getAttribute('position');
  const parent=Array.from({length:pos.count},(_,i)=>i),at=new Map();
  function find(i){while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;}
  function join(i,j){parent[find(i)]=find(j);}
  for(let i=0;i<pos.count;i++){
    const key=[pos.getX(i),pos.getY(i),pos.getZ(i)].map(v=>Math.round(v*1e5)).join('/');
    if(at.has(key))join(i,at.get(key));else at.set(key,i);
  }
  const index=original.index;
  for(let i=0;i<(index?.count??pos.count);i+=3){
    const a=index?index.getX(i):i,b=index?index.getX(i+1):i+1,c=index?index.getX(i+2):i+2;
    join(a,b);join(b,c);
  }
  const bounds=new Map();
  for(let i=0;i<pos.count;i++){
    const id=find(i),x=pos.getX(i),extent=bounds.get(id)||[Infinity,-Infinity];
    extent[0]=Math.min(extent[0],x);extent[1]=Math.max(extent[1],x);bounds.set(id,extent);
  }
  const ears=new Set([...bounds].filter(([,e])=>Math.abs((e[0]+e[1])*.5)>.072&&e[1]-e[0]<.075).map(([id])=>id));
  if(!ears.size)return;
  const blue=new Color(0x145a92),white=new Color(0xffffff),rgb=new Float32Array(pos.count*3);
  blue.r/=mesh.material.color.r;blue.g/=mesh.material.color.g;blue.b/=mesh.material.color.b;
  for(let i=0;i<pos.count;i++)(ears.has(find(i))?blue:white).toArray(rgb,i*3);
  mesh.geometry=original.clone();
  mesh.geometry.setAttribute('color',new Float32BufferAttribute(rgb,3));
  mesh.material=mesh.material.clone();
  mesh.material.vertexColors=true;
}

export function applyOriginalLivery(scene,url,{night=false}={}) {
  const path=new URL(url,import.meta.url).pathname;
  const airframe=airframes.test(path),pilot=pilots.test(path);
  if(!airframe&&!pilot)return scene;
  if(scene.userData.originalLivery)return scene;
  const distant=path.toLowerCase().includes('-lod1.');
  const copies=new Map();
  const orange=night?0xda850a:0xcf750a;
  const aircraftColors={
    'Catalog | ochre trim':orange,
    'Catalog | sage enamel':0x6f7545,
    'Catalog | forest lower cabin':0x50502a,
    '06 | Canopy rubber extrusion':orange
  };
  function prepare(source) {
    if(copies.has(source))return copies.get(source);
    const name=source.name;
    const aircraftColor=airframe?aircraftColors[name]:undefined;
    const fabric=pilot?cloth[name]:undefined;
    const seam=pilot&&name==='seam';
    if(aircraftColor===undefined&&!fabric&&!seam)return source;
    const copy=source.clone();
    if(fabric)dye(copy,fabric,distant,night);
    else copy.color.setHex(seam?(night?0x8098a2:0x667c87):aircraftColor);
    // The indexed renderer retained warm paint even on the shaded side.
    // Give only that finish a small night fill in the PBR scene.
    if(night&&aircraftColor===orange&&copy.emissive){
      copy.emissive.copy(copy.color);
      copy.emissiveIntensity=.09;
    }
    copies.set(source,copy);
    return copy;
  }
  scene.traverse(mesh=>{
    if(!mesh.isMesh||airframe&&!paintDomain(mesh))return;
    if(pilot&&mesh.material.name==='helmet'){headset(mesh);return;}
    mesh.material=Array.isArray(mesh.material)?mesh.material.map(prepare):prepare(mesh.material);
  });
  scene.userData.originalLivery=true;
  return scene;
}
