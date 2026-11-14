import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';

const size = 128, TAU = 2 * Math.PI;
const direction = {N:[0,-1,'S'],E:[1,0,'W'],S:[0,1,'N'],W:[-1,0,'E']};
const source = id => `models/complete/objects/SIM3D2/${id}.glb`;
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
const dist = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);
const mid = (a,b) => ({x:(a.x+b.x)/2,z:(a.z+b.z)/2});

// XBLD 0x2C–0x3E identify rails, 0x45–48 and 0x4D–4E crossovers,
// 0x5A/5B bridges. Runways are 0xDD and 0xDE. Port orientation is shared
// with the city renderer, so a visually adjacent parallel line never connects.
// https://github.com/OpenCity2k/SC2k-docs/blob/master/sc2%20file%20spec.md#xbld
function survey(city) {
  const rails=new Map(), paved=new Map();
  for(let row=0;row<size;row++) for(let col=0;col<size;col++) {
    const p=city.tileToWorld(col,row),bounds=city.bounds;
    if(bounds&&(p.x<bounds.minX||p.x>=bounds.maxX||p.z<bounds.minZ||p.z>=bounds.maxZ))continue;
    const tile=city.tileAt(p.x,p.z);
    if(!tile)continue;
    const code=tile.building, id=row*size+col;
    const node={x:p.x,z:p.z,row,col,id,links:[]};
    if(code===221 || code===222)paved.set(id,node);
    if(!tile.rail)continue;
    const ports=city.networkPorts(code,!!(tile.rotate ?? tile.rotated),'rail');
    node.ports=new Set(ports);rails.set(id,node);
  }
  for(const a of rails.values()) for(const d of a.ports) {
    const v=direction[d]; if(!v)continue;
    const c=a.col+v[0],r=a.row+v[1]; if(c<0||r<0||c>=size||r>=size)continue;
    const b=rails.get(r*size+c);if(!b?.ports.has(v[2]))continue;
    // A painted network can meet a bridge at a different physical elevation.
    // Keep such disconnected decks separate rather than jumping the train up.
    const edge=mid(a,b), stepX=v[0]*.12, stepZ=v[1]*.12;
    const from=city.tileAt(edge.x-stepX,edge.z-stepZ)?.railY;
    const to=city.tileAt(edge.x+stepX,edge.z+stepZ)?.railY;
    if(Number.isFinite(from)&&Number.isFinite(to)&&Math.abs(from-to)>1.1)continue;
    a.links.push(b);
  }
  return {rails,paved};
}

function traverse(first) {
  const q=[first], parents=new Map([[first,null]]), depth=new Map([[first,0]]);
  for(let i=0;i<q.length;i++) for(const next of q[i].links) if(!parents.has(next)) {
    parents.set(next,q[i]);depth.set(next,depth.get(q[i])+1);q.push(next);
  }
  return {q,parents,depth};
}
function treePath(a,b,tree) {
  const left=[],right=[];
  while(a!==b) {
    if(tree.depth.get(a)>=tree.depth.get(b)) {left.push(a);a=tree.parents.get(a);}
    else {right.push(b);b=tree.parents.get(b);}
  }
  return [...left,a,...right.reverse()];
}

function chooseRail(rails,spawn) {
  const seen=new Set();let best=null;
  function consider(nodes,loop) {
    if(nodes.length<8)return;
    const nearby=nodes.reduce((n,p)=>Math.min(n,dist(p,spawn)),Infinity);
    const score=Math.min(nodes.length,50) + (loop ? 30 : 0) - nearby*.035;
    if(!best || score>best.score)best={nodes,loop,score};
  }
  for(const first of rails.values()) {
    if(seen.has(first))continue;
    const tree=traverse(first); tree.q.forEach(p=>seen.add(p));
    if(tree.q.length<8)continue;
    for(const a of tree.q) for(const b of a.links) {
      if(a.id<b.id && tree.parents.get(a)!==b && tree.parents.get(b)!==a)consider(treePath(a,b,tree),true);
    }
    const longest=traverse(tree.q.at(-1));
    consider(treePath(longest.q[0],longest.q.at(-1),longest),false);
  }
  return best;
}

function railPath(route) {
  const {nodes,loop}=route, n=nodes.length, samples=[], lengths=[];
  function add(p) {const last=samples.at(-1);if(last&&dist(p,last)<.001)return;
    lengths.push(last?lengths.at(-1)+dist(p,last):0);samples.push(p);}
  const count=loop?n:n-2;
  if(!loop)add(nodes[0]);
  for(let j=0;j<count;j++) {
    const i=loop?j:j+1, p=nodes[i], a=mid(nodes[(i+n-1)%n],p), b=mid(p,nodes[(i+1)%n]);
    add(a);
    // Precisely follow the rail tile's quarter-circle, tangent at each edge.
    if(a.x===b.x||a.z===b.z){add(b);continue;}
    const centre={x:a.x+b.x-p.x,z:a.z+b.z-p.z};
    const start=Math.atan2(a.z-centre.z,a.x-centre.x),end=Math.atan2(b.z-centre.z,b.x-centre.x);
    const sweep=Math.atan2(Math.sin(end-start),Math.cos(end-start));
    for(let k=1;k<=8;k++){const t=start+sweep*k/8, radius=dist(a,centre);add({x:centre.x+radius*Math.cos(t),z:centre.z+radius*Math.sin(t)});}
  }
  if(loop)add(samples[0]);else add(nodes.at(-1));
  const length=lengths.at(-1);
  function sample(d) {
    d=loop?((d%length)+length)%length:clamp(d,0,length);
    let l=0,r=lengths.length-1;
    while(r-l>1){const m=(l+r)>>1;if(lengths[m]<=d)l=m;else r=m;}
    const t=(d-lengths[l])/(lengths[r]-lengths[l]);
    return {x:samples[l].x+(samples[r].x-samples[l].x)*t,z:samples[l].z+(samples[r].z-samples[l].z)*t};
  }
  return {length,sample,loop};
}

function chooseAirport(paved,city) {
  const seen=new Set();let best=null;
  for(const first of paved.values()) {
    if(seen.has(first))continue;
    const group=[first];seen.add(first);
    for(let i=0;i<group.length;i++)for(const [dc,dr] of Object.values(direction)) {
      const tile=group[i],col=tile.col+dc,row=tile.row+dr;
      if(col<0||col>=size||row<0||row>=size)continue;
      const next=paved.get(row*size+col); if(next&&!seen.has(next)){seen.add(next);group.push(next);}
    }
    if(group.length<3)continue;
    const box={x0:Infinity,x1:-Infinity,z0:Infinity,z1:-Infinity};
    for(const p of group){box.x0=Math.min(box.x0,p.x);box.x1=Math.max(box.x1,p.x);box.z0=Math.min(box.z0,p.z);box.z1=Math.max(box.z1,p.z);}
    const airport={x:(box.x0+box.x1)/2,z:(box.z0+box.z1)/2,alongX:box.x1-box.x0>box.z1-box.z0};
    const score=group.length - dist(airport,city.spawn)*.015;
    if(!best||score>best.score)best={...airport,score};
  }
  return best;
}

// These four direct GLBs have solid factors and authored normals, with no
// texture maps. Pack diffuse/roughness/metalness/emission into vertex data
// so each carriage needs one draw. Keep PLANE1's prop pivot and alpha sweep.
function compact(THREE,template,resources) {
  template.updateMatrixWorld(true);
  const body=new THREE.Group(), rotorSource=template.getObjectByName('PLANE1_|_Propeller');
  const rotor=rotorSource?new THREE.Group():null;
  if(rotor){rotor.name=rotorSource.name;rotorSource.matrixWorld.decompose(rotor.position,rotor.quaternion,rotor.scale);body.add(rotor);}
  const opaque=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide});
  opaque.onBeforeCompile=shader=>{
    shader.vertexShader='attribute vec2 transitSurface; attribute vec3 transitGlow; varying vec2 vTransitSurface; varying vec3 vTransitGlow;\n'+shader.vertexShader.replace('#include <color_vertex>','#include <color_vertex>\nvTransitSurface=transitSurface;vTransitGlow=transitGlow;');
    shader.fragmentShader='varying vec2 vTransitSurface; varying vec3 vTransitGlow;\n'+shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=vTransitSurface.x;').replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\nmetalnessFactor=vTransitSurface.y;').replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance=vTransitGlow;');
  };
  resources.push(opaque);
  const groups=new Map([[body,[]]]);if(rotor)groups.set(rotor,[]);
  function visit(node,target) {
    if(node===rotorSource)target=rotor;
    if(node.isMesh){
      const matrix=node.matrixWorld.clone();
      if(target===rotor)matrix.premultiply(rotorSource.matrixWorld.clone().invert());
      const src=node.material;
      if(src.transparent){const mesh=new THREE.Mesh(node.geometry,src);mesh.applyMatrix4(matrix);target.add(mesh);}
      else {
        const g=node.geometry.clone().applyMatrix4(matrix);
        for(const attr of Object.keys(g.attributes))if(attr!=='position'&&attr!=='normal')g.deleteAttribute(attr);
        const n=g.attributes.position.count;
        const rgb=new Float32Array(n*3), surface=new Float32Array(n*2), glow=new Float32Array(n*3);
        for(let i=0;i<n;i++){
          src.color.toArray(rgb,i*3);surface[i*2]=src.roughness;surface[i*2+1]=src.metalness;
          glow[i*3]=src.emissive.r*src.emissiveIntensity;glow[i*3+1]=src.emissive.g*src.emissiveIntensity;glow[i*3+2]=src.emissive.b*src.emissiveIntensity;
        }
        g.setAttribute('color',new THREE.BufferAttribute(rgb,3));g.setAttribute('transitSurface',new THREE.BufferAttribute(surface,2));g.setAttribute('transitGlow',new THREE.BufferAttribute(glow,3));groups.get(target).push(g);
      }
    }
    node.children.forEach(child=>visit(child,target));
  }
  visit(template,body);
  for(const [target,geoms] of groups)if(geoms.length){
    const joined=mergeGeometries(geoms);geoms.forEach(g=>g.dispose());
    if(!joined)throw Error('철도·항공 교통 모델을 합칠 수 없습니다.');
    resources.push(joined);target.add(new THREE.Mesh(joined,opaque));
  }
  return {body,rotor};
}

export function hasTrainRoute(city){
  return !!chooseRail(survey(city).rails,city.spawn);
}

export async function createTransit(ctx,city,{rng=Math.random}={}) {
  const {THREE,assets,scene}=ctx, {rails,paved}=survey(city);
  const line=chooseRail(rails,city.spawn),airport=chooseAirport(paved,city);
  const group=new THREE.Group();group.name='Rail and air traffic';
  const resources=[],cars=[],state={trains:0,planes:0,railTiles:line?.nodes.length||0,railLoop:!!line?.loop,visibleTrains:0,visiblePlanes:0};
  const runawayCalls=new Set();
  let nextTrainSound=0;
  let path,plane,prop,angle=0,head=0,speed=0,sign=1,dwell=0,span=0,orbit,disposed=false;
  function cleanup(){if(disposed)return;disposed=true;group.removeFromParent();resources.forEach(r=>r.dispose());}
  try {
    if(line){
      path=railPath(line);
      const templates=await Promise.all(['TRAIN1','TRAIN2','TRAIN3'].map(id=>assets.load(source(id))));
      let lastLength=0;
      for(const template of templates){
        const {body}=compact(THREE,template,resources),box=new THREE.Box3().setFromObject(body,true);
        const length=box.max.z-box.min.z;
        if(cars.length)span+=(lastLength+length)/2+.14;
        cars.push({body,offset:span,foot:box.min.y,roof:box.max.y,axle:length*.28});lastLength=length;group.add(body);
      }
      // Start on the real route. Keep both ends of a shuttle's consist inside
      // its track; a loop can start anywhere. Rescue then follows the live car.
      const first=span+7.4,last=path.length-7.4;
      head=path.loop?rng()*path.length:first+rng()*Math.max(0,last-first);
      state.trains=1;
    }
    if(airport){
      const template=await assets.load(source('PLANE1'));
      ({body:plane,rotor:prop}=compact(THREE,template,resources));
      if(!prop)throw Error('PLANE1 프로펠러 축을 찾을 수 없습니다.');
      const b=city.bounds;
      const rx=Math.min(airport.alongX?220:145,(b.maxX-b.minX)/2-16);
      const rz=Math.min(airport.alongX?145:220,(b.maxZ-b.minZ)/2-16);
      orbit={rx,rz,x:clamp(airport.x,b.minX+rx+16,b.maxX-rx-16),z:clamp(airport.z,b.minZ+rz+16,b.maxZ-rz-16),y:0};
      for(let i=0;i<160;i++){
        const t=TAU*i/160,x=orbit.x+rx*Math.cos(t),z=orbit.z+rz*Math.sin(t);
        orbit.y=Math.max(orbit.y,city.surfaceAt(x,z),city.roofAt?.(x,z)??-Infinity);
      }
      orbit.y+=76;plane.rotation.order='YXZ';group.add(plane);state.planes=1;
    }
    scene.add(group);
  }catch(error){cleanup();throw error;}

  const railHeight=p=>city.tileAt(p.x,p.z)?.railY ?? Math.max(city.groundAt(p.x,p.z)+.62,city.surfaceAt(p.x,p.z));
  function placeCar(c){
    const a=path.sample(head-c.offset+c.axle),b=path.sample(head-c.offset-c.axle);
    const ay=railHeight(a),by=railHeight(b),dx=a.x-b.x,dz=a.z-b.z;
    c.body.position.set((a.x+b.x)/2,(ay+by)/2-c.foot,(a.z+b.z)/2);
    // Shuttles brake, wait, then reverse without spinning the consist.
    c.body.rotation.set(-Math.atan2(ay-by,Math.hypot(dx,dz)),Math.atan2(dx,dz),0,'YXZ');
  }
  function trainRoof(index=0){
    const c=cars[index];if(disposed||!c)return null;
    if(!c.body.visible)placeCar(c);
    return c.body.localToWorld(new THREE.Vector3(0,c.roof,0));
  }
  function setRunaway(serial,active){
    if(disposed||!path)return false;
    if(active)runawayCalls.add(serial);else runawayCalls.delete(serial);
    if(runawayCalls.size&&dwell>.75)dwell=.75;
    return true;
  }
  function update(dt,focus=city.spawn){
    if(disposed||!Number.isFinite(dt)||dt<0)return;
    const elapsed=Math.min(dt,.25);
    if(path){
      if(dwell>0){dwell-=elapsed;if(dwell<=0)sign*=-1;}
      else {
        const lo=span+7.4,hi=path.length-7.4;
        const remaining=sign>0?hi-head:head-lo;
        const cruise=runawayCalls.size?20:12;
        const desired=path.loop?cruise:Math.min(cruise,Math.sqrt(2*1.8*Math.max(0,remaining)));
        speed=Math.min(desired,speed+elapsed*1.7); head+=sign*speed*elapsed;
        if(path.loop)head=((head%path.length)+path.length)%path.length;
        else if(remaining<.18 || head<lo || head>hi){head=sign>0?hi:lo;speed=0;dwell=runawayCalls.size?.75:4.5;}
      }
      const position=path.sample(head-span/2),range=dist(position,focus);
      const visible=range<540;state.visibleTrains=+visible;
      nextTrainSound=Math.max(0,nextTrainSound-elapsed);
      if(speed>2 && range<105 && !nextTrainSound){
        ctx.sound?.sceneCue?.('train',Math.hypot(range,(focus.y??0)-railHeight(position)));
        nextTrainSound=7;
      }
      for(const c of cars){c.body.visible=visible;if(visible)placeCar(c);}
    }
    if(plane){
      const c=Math.cos(angle),s=Math.sin(angle),dx=-orbit.rx*s,dz=orbit.rz*c,localSpeed=Math.hypot(dx,dz);
      plane.position.set(orbit.x+orbit.rx*c,orbit.y,orbit.z+orbit.rz*s);
      plane.visible=dist(plane.position,focus)<900;state.visiblePlanes=+plane.visible;
      const curvature=orbit.rx*orbit.rz/localSpeed**3;
      // With the +Z-nose artwork, positive local roll lowers the starboard
      // wing into this clockwise turn when viewed on the city's X/Z chart.
      plane.rotation.set(0,Math.atan2(dx,dz),Math.atan(32**2*curvature/9.81),'YXZ');
      prop.rotation.z=(prop.rotation.z+elapsed*99)%TAU;
      angle=(angle+elapsed*32/localSpeed)%TAU;
    }
  }
  update(0,city.spawn);
  const collisionObjects=cars.map(c=>({kind:'train',body:c.body,get speed(){return sign*speed;}}));
  if(plane)collisionObjects.push({kind:'aircraft',body:plane,speed:32});
  return {state,update,trainRoof,setRunaway,collisionObjects,dispose:cleanup};
}
