import {acquireUrbanFinish,applyFacadeFinish} from './urban-finishes.js';
import {districtFace} from './district-architecture.js';

function finishFor(id,ny,high,peak){
  // IN133 is the chemical storage vessel. Its perimeter uses archived
  // commercial window UVs, but those faces are plates and have no apertures.
  if(id==='IN133'||id==='WT235'&&high>20)return 6;
  const coated=districtFace(id,ny,high,peak);
  if(coated)return coated;
  if(!/^(IN|CO|RE|AB|CA|HO|FS|PO)\d/.test(id))return 0;
  const industrial=id.startsWith('IN')||id.startsWith('PP');
  if(industrial&&peak>25&&high>peak*.76)return 7;
  if(ny>.28)return industrial?3:4;
  if(ny<-.35)return 2;
  return industrial||id.startsWith('RE')||id.startsWith('AB')?1:2;
}

// Original meshes at city scale, grouped by one shared atlas / material.
// UVs stay unwrapped until the fragment shader, so repeated source windows do not stretch.
export async function loadFarKit(T,{night=false,glass=null}={}){
  const base=new URL('../data/city-kit/',import.meta.url).href;
  const fetchOK=async(file,method)=>{const r=await fetch(base+file);if(!r.ok)throw Error(file+' '+r.status);return r[method]();};
  const loader=new T.TextureLoader();
  const [j,raw,map,panes,finish]=await Promise.all([fetchOK('index.json','json'),fetchOK('geometry.bin','arrayBuffer'),loader.loadAsync(base+'atlas.webp'),
    loader.loadAsync(new URL('../art/urban-window-panes.png',import.meta.url).href),acquireUrbanFinish(T)]);
  if(raw.byteLength!==j.vertices*j.stride)throw Error('원경 도시 형상 크기가 잘못되었습니다.');
  map.colorSpace=T.SRGBColorSpace;map.flipY=false;map.anisotropy=2;
  panes.flipY=false;panes.colorSpace=T.NoColorSpace;panes.anisotropy=2;
  const material=new T.MeshLambertMaterial({map,vertexColors:true,alphaTest:.42,side:T.DoubleSide});
  material.name='원작 도시 아틀라스';material.onBeforeCompile=sh=>{
    sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute vec4 farRect; varying vec4 cell;').replace('#include <uv_vertex>','#include <uv_vertex>\ncell=farRect;');
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec4 cell;').replace('#include <map_fragment>','vec2 tileUV=fract(vMapUv);vec4 texel=textureGrad(map,cell.xy+tileUV*cell.zw,dFdx(vMapUv)*cell.zw,dFdy(vMapUv)*cell.zw);diffuseColor*=texel;');
  };
  material.customProgramCacheKey=()=>'city-architecture-v1';
  applyFacadeFinish(material,{night,texture:finish.texture,panes,glass});
  const cache=new Map(),dv=new DataView(raw);
  function get(id){
    if(cache.has(id))return cache.get(id);const m=j.models[id];if(!m)return null;
    const pos=new Float32Array(m.count*3),nor=new Int8Array(m.count*3),uv=new Float32Array(m.count*2),colors=new Uint8Array(m.count*3),rect=new Float32Array(m.count*4);
    const kind=new Float32Array(m.count);
    let high=0;
    for(let i=0;i<m.count;i++){const k=(i+m.first)*j.stride;
      for(let c=0;c<3;c++){pos[3*i+c]=dv.getFloat32(k+4*c,true);nor[3*i+c]=dv.getInt8(k+12+c);colors[3*i+c]=dv.getUint8(k+24+c);}
      if(i%3===0)high=Math.max(pos[3*i+1],dv.getFloat32(k+j.stride+4,true),dv.getFloat32(k+2*j.stride+4,true));
      kind[i]=finishFor(id,nor[3*i+1]/127,high,m.max[1]);
      uv[2*i]=dv.getFloat32(k+16,true);uv[2*i+1]=dv.getFloat32(k+20,true);rect.set(j.rects[dv.getUint16(k+28,true)],4*i);}
    const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(pos,3));g.setAttribute('normal',new T.BufferAttribute(nor,3,true));g.setAttribute('uv',new T.BufferAttribute(uv,2));g.setAttribute('color',new T.BufferAttribute(colors,3,true));g.setAttribute('farRect',new T.BufferAttribute(rect,4));g.computeBoundingSphere();
    g.setAttribute('urbanKind',new T.BufferAttribute(kind,1));
    const obj={geometry:g,material,min:m.min,max:m.max};cache.set(id,obj);return obj;
  }
  return {get,material,dispose(){for(const e of cache.values())e.geometry.dispose();map.dispose();panes.dispose();finish.release();material.dispose();cache.clear();}};
}
