// Fixed street equipment uses the same world matrices for the visible solids and flight collisions.
import {hydrantGeometry} from './service-props.js';
const library='remake/art/streetscape/Coastal-Distribution.glb';
const canopyURL=new URL('../art/streetscape/Coastal-Canopy.webp',import.meta.url).href;
const cablePorts=['EW','NS','NS','EW','NS','EW','SE','SW','NW','NE','ENS','SWE','NWS','WNE','NWSE'];
const crossingPorts={67:'NS',68:'EW',71:'NS',72:'EW',79:'NS',80:'EW'};
const grove=[
  [[.44,-1]], [[-5.24,1.5],[2.78,-3.25]],
  [[-4.58,1.5],[3.48,-3.25],[3.80,4.25]],
  [[-5.67,-3.5],[-5.45,1.5],[3.09,-3.25],[4.65,4.25]],
  [[-5.70,-3.5],[-5.41,1.5],[-2.09,-.25],[3.66,-3.25],[4.18,4.25],[4.98,-.5]],
  [[-6,4.5],[-5.92,-3.5],[-5.05,1.5],[-2.17,-.25],[3.18,-3.25],[3.61,1.75],[4.68,4.25],[4.84,-.5],[5.34,-5.5]],
  [[-6.19,-3.5],[-6.06,-.75],[-5.56,4.5],[-5.38,1.5],[-4.01,-6],[-2.21,-.25],[-1.9,5.5],[3.31,1.75],[3.7,-3.25],[4.75,4.25],[5.11,-.5],[5.39,-5.5]]
];
export function powerPorts(code,rotate){
  return code===92?(rotate?'EW':'NS'):cablePorts[code-14]||crossingPorts[code]||'';
}
export function isStreetProp(code){
  return code>=6&&code<=12||code>=14&&code<=28||code===92||Object.hasOwn(crossingPorts,code);
}
function meshFrom(template,name){
  let match;
  template.traverse(o=>{if(o.isMesh&&(o.userData.name===name||o.name===name||o.name===name.replaceAll(' ','_')))match=o;});
  if(!match)throw new Error('도시 설비 모델 누락 · '+name);
  return match.geometry;
}

export async function addStreetObjects(ctx,city,group,owned){
  const T=ctx.THREE;
  const [asset,trees,cover]=await Promise.all([ctx.assets.load(library),
    ctx.assets.load('remake/art/streetscape/Coastal-Trees.glb'),new T.TextureLoader().loadAsync(canopyURL)]);
  cover.colorSpace=T.SRGBColorSpace;cover.anisotropy=4;
  const paint=new T.MeshLambertMaterial({vertexColors:true});
  const foliage=new T.MeshBasicMaterial({map:cover,color:ctx.night?0x526a7a:0xcdd9c8,vertexColors:true,
    side:T.DoubleSide,alphaTest:.25});
  // Both sides of a thin leafy spray receive skylight. Lit crown tops and
  // sheltered lower forks stay distinct, including in the downward camera.
  foliage.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <color_vertex>',
      '#include <color_vertex>\nvec3 leafNormal=normalize(mat3(instanceMatrix)*normal);\n'+
      'float sky=.68+.24*dot(leafNormal,normalize(vec3(-.4,.82,.35)));\n'+
      'vColor.rgb*=sky*(.64+.36*clamp((position.y-.2)/.72,0.,1.));');
  };
  foliage.customProgramCacheKey=()=>'coastal-leaf-skylight-v1';
  const conductor=new T.MeshLambertMaterial({color:0x343a3b});
  const lens=new T.MeshBasicMaterial({color:ctx.night?0xffedbf:0xc1cbc8});
  const envelope=new T.SphereGeometry(1,8,5).scale(.39,.33,.36).translate(0,.64,0);
  const pin=new T.CylinderGeometry(1,1,1,5,1,true);
  const lensGeo=new T.SphereGeometry(1,8,5);
  const crowns=['Street elm sprays','Shore pine sprays'].map(n=>meshFrom(trees,n));
  const stems=['Street elm branches','Shore pine branches'].map(n=>meshFrom(trees,n));
  owned.push(cover,paint,foliage,conductor,lens,envelope,pin,lensGeo);
  const parts=new Map();
  function place(name,geo,mat,matrix,kind=null){
    const e=matrix.elements;
    const sector=Math.floor((e[12]+1024)/256)+8*Math.floor((e[14]+1024)/256);
    const key=name+'/'+sector;
    let b=parts.get(key);
    if(!b){b={name,geo,mat,items:[]};parts.set(key,b);}
    b.items.push(matrix);if(kind)city.flightScenery.add(geo,matrix,kind);
  }
  const poleGeo=meshFrom(asset,'Distribution mast'),transformer=meshFrom(asset,'Pole transformer');
  const streetLamp=meshFrom(asset,'Galvanized outreach lamp');
  const pose=new T.Object3D(),up=new T.Vector3(0,1,0);
  function matrix(x,y,z,angle=0,sx=1,sy=1,sz=1){
    pose.position.set(x,y,z);pose.rotation.set(0,angle,0);pose.scale.set(sx,sy,sz);pose.updateMatrix();return pose.matrix.clone();
  }
  const poles=new Map();
  for(let i=0;i<city.layers.building.length;i++){
    const code=city.layers.building[i];
    if(!isStreetProp(code))continue;
    const col=i%128,row=i>>7,{x,z}=city.tileToWorld(col,row);
    if(code>=6&&code<=12){
      for(const [j,[dx,dz]] of grove[code-6].entries()){
        const seed=((Math.imul(i+143,2654435761) ^ Math.imul(j+11,1597334677))>>>0);
        const pine=(seed%9)<4?1:0;
        const h=5.4+(seed%35)*.075+(code-6)*.17;
        const width=h*(pine?.72:.82)*(1+(seed%7-3)*.035);
        const m=matrix(x+dx,city.groundAt(x+dx,z+dz)-.035,z+dz,(seed%197)/31,width,h,width);
        place(pine?'Shore pine branches':'Street elm branches',stems[pine],paint,m,'tree');
        place(pine?'Shore pine crowns':'Street elm crowns',crowns[pine],foliage,m);
        city.flightScenery.add(envelope,m,'tree');
      }
      continue;
    }
    const ports=powerPorts(code,!!(city.layers.flags[i]&2)),alongX=ports.includes('E')||ports.includes('W');
    const cross=Object.hasOwn(crossingPorts,code),side=((i&2)?1:-1)*(code>=79?7.6:6.45);
    const px=x+(cross&&alongX?side:0),pz=z+(cross&&!alongX?side:0);
    const base=code===92?city.surfaceAt(px,pz):city.groundAt(px,pz);
    const sy=code===79||code===80?1.62:1;
    const m=matrix(px,base,pz,alongX?Math.PI/2:0,1,sy,1);
    place('Concrete distribution masts',poleGeo,paint,m,'powerline');
    if(!cross&&code!==92&&(i*37+row)%7===0)place('Pole-mounted distribution transformers',transformer,paint,m,'powerline');
    poles.set(i,{m,ports,col,row});
  }
  function terminal(p,line){
    return new T.Vector3(line*1.19,(line?7.68:8.53)+.31,0).applyMatrix4(p.m);
  }
  const dir=new T.Vector3(),mid=new T.Vector3();
  function span(p,q){
    for(const line of [-1,0,1]){
      const a=terminal(p,line),b=terminal(q,line);
      const sag=Math.min(1.14,.035*Math.hypot(b.x-a.x,b.z-a.z)),steps=4;
      let prev=a;
      for(let j=1;j<=steps;j++){
        const t=j/steps,next=a.clone().lerp(b,t);next.y-=4*sag*t*(1-t);
        dir.subVectors(next,prev);const length=dir.length();
        pose.position.copy(mid.copy(prev).add(next).multiplyScalar(.5));
        pose.quaternion.setFromUnitVectors(up,dir.divideScalar(length));
        pose.scale.set(.032,length,.032);pose.updateMatrix();
        place('Suspended distribution conductors',pin,conductor,pose.matrix.clone(),'powerline');prev=next;
      }
    }
  }
  for(const [id,p] of poles){
    if(p.col<127&&p.ports.includes('E')&&poles.get(id+1)?.ports.includes('W'))span(p,poles.get(id+1));
    if(p.row<127&&p.ports.includes('S')&&poles.get(id+128)?.ports.includes('N'))span(p,poles.get(id+128));
  }
  city.streetLamps=[];
  const hydrant=hydrantGeometry(T),hydrantPaint=new T.MeshStandardMaterial({vertexColors:true,roughness:.72,metalness:.21});
  owned.push(hydrant,hydrantPaint);
  const hydrantSites=[];
  for(const node of city.roads){
    if(node.code!==29&&node.code!==30)continue;
    const hash=((node.col*73856093)^(node.row*19349663))>>>0;
    const ns=city.networkPorts(node.code,false,'road').includes('N');
    const along=ns?node.row:node.col,street=ns?node.col:node.row;
    let side=hash&16?1:-1;
    if(city.generated){
      if((along+street)%4!==0||Math.hypot(node.x-city.spawn.x,node.z-city.spawn.z)<32)continue;
      const developed=[-1,1].some(sign=>{
        const code=city.tileAt(node.x+(ns?16*sign:0),node.z+(ns?0:16*sign))?.building;
        return code>=112&&code<221;
      });
      if(!developed)continue;
      side=((along+street)>>2)&1?1:-1;
    }else if(hash%9!==0||city.streetLamps.length>=185)continue;
    const x=node.x+(ns?side*5.12:0),z=node.z+(ns?0:side*5.12);
    const t=city.tileAt(x,z);
    if(!t||t.water||t.rail||city.buildingAt(x,z))continue;
    const y=city.surfaceAt(x,z),angle=ns?(side>0?Math.PI:0):(side>0?Math.PI/2:-Math.PI/2);
    const m=matrix(x,y,z,angle);
    place('Galvanized outreach street lamps',streetLamp,paint,m,'powerline');
    const bulb=matrix(1.43,5.957,0,0,.245,.04,.128).premultiply(m);
    if(!ctx.night)place('Prismatic streetlight lenses',lensGeo,lens,bulb);
    city.streetLamps.push({x:bulb.elements[12],y:bulb.elements[13],z:bulb.elements[14],angle});
    if((node.col+node.row)%3!==1&&hydrantSites.length<30){
      // Use the opposite curb only where the adjacent block is built up.
      const hx=node.x+(ns?-side*6.8:0),hz=node.z+(ns?0:-side*6.8);
      const neighbor=city.tileAt(node.x+(ns?-side*16:0),node.z+(ns?0:-side*16)),curb=city.tileAt(hx,hz);
      if(neighbor?.building>=112&&curb&&!curb.water&&curb.railY==null&&!city.buildingAt(hx,hz)
        &&Math.hypot(hx-city.spawn.x,hz-city.spawn.z)>20
        &&hydrantSites.every(p=>Math.hypot(p.x-hx,p.z-hz)>30)){
        const facing=Math.atan2(node.x-hx,node.z-hz);
        place('Cast street hydrants',hydrant,hydrantPaint,matrix(hx,city.surfaceAt(hx,hz),hz,facing),'equipment');
        hydrantSites.push({x:hx,z:hz});
      }
    }
  }
  const batches=[];
  for(const b of parts.values()){
    const mesh=new T.InstancedMesh(b.geo,b.mat,b.items.length);
    mesh.name=b.name;mesh.receiveShadow=true;
    b.items.forEach((m,i)=>mesh.setMatrixAt(i,m));
    mesh.computeBoundingSphere();
    group.add(mesh);owned.push(mesh);batches.push(mesh);
  }
  let lastX=Infinity,lastZ=Infinity;
  function update(focus){
    if(Math.hypot(focus.x-lastX,focus.z-lastZ)<20)return;
    lastX=focus.x;lastZ=focus.z;
    const range=800+Math.min(420,Math.max(0,focus.y-city.groundAt(focus.x,focus.z)));
    for(const mesh of batches){
      const sphere=mesh.boundingSphere;
      mesh.visible=(sphere.center.x-focus.x)**2+(sphere.center.z-focus.z)**2<(range+sphere.radius)**2;
    }
  }
  update(city.spawn);
  return update;
}

