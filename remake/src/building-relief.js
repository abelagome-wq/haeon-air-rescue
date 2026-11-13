// Fit architectural components to the building's actual wall and roof triangles.
// The result is cached per model, then used for both rendering and contact.
import {facadeFinish} from './district-architecture.js';
const finishes={
  brick:[85,48,35,1], masonry:[102,101,90,2], rim:[78,86,84,0],
  steel:[48,61,65,3], zinc:[111,123,121,3], pitch:[57,69,73,3],
  asphalt:[47,53,54,4], glass:[48,73,79,5], reveal:[25,33,36,0],
  cream:[172,157,127,0], iron:[43,55,56,0], drainage:[104,116,112,0],
  display:[44,68,72,8], plinth:[75,72,64,0],
  homePaint:[178,159,125,facadeFinish.house], clay:[146,98,73,facadeFinish.tiledRoof],
  factoryWall:[161,121,92,facadeFinish.works], factoryDeck:[157,169,161,facadeFinish.factoryRoof],
  fascia:[126,150,145,facadeFinish.sign], crown:[150,160,153,facadeFinish.crown],
  timber:[114,76,42,0], primer:[104,52,31,0], rail:[160,97,30,0],
};
const awnings=[[142,62,43,0],[46,114,94,0],[57,97,133,0],[172,123,51,0]];
const industrial=code=>(code>=132&&code<=135)||(code>=158&&code<=165)||
  (code>=188&&code<=193)||[201,202,203,206,207,227,232,240,244,246].includes(code);
const residential=code=>code>=112&&code<=123||code>=140&&code<=147||code>=174&&code<=177;
const commercial=code=>code>=124&&code<=131||code>=148&&code<=157||code>=178&&code<=187&&code!==182&&code!==185||[212,214,217,245].includes(code);

function planes(T,geometry){
  const p=geometry.attributes.position,idx=geometry.index,faces=new Map();
  const count=idx?.count??p.count;
  for(let j=0;j<count;j+=3){
    const points=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(p,idx?idx.getX(j+k):j+k));
    const [a,b,c]=points;
    const n=b.clone().sub(a).cross(c.clone().sub(a)),area=n.length()*.5;
    if(area<.02)continue;
    n.normalize();
    const key=[n.x,n.y,n.z,n.dot(a)].map((v,i)=>Math.round(v*(i===3?14:140))).join(',');
    let f=faces.get(key);
    if(!f){
      let u;
      if(Math.abs(n.y)>.995)u=new T.Vector3(1,0,0).addScaledVector(n,-n.x).normalize();
      else u=new T.Vector3(n.z,0,-n.x).normalize();
      // Vertical faces use a vertical second axis. Roofs use the downslope axis.
      const v=Math.abs(n.y)<.34?new T.Vector3().crossVectors(n,u):new T.Vector3().crossVectors(u,n);
      f={n,u,v,origin:n.clone().multiplyScalar(n.dot(a)),u0:Infinity,u1:-Infinity,v0:Infinity,v1:-Infinity,area:0,tris:[]};faces.set(key,f);
    }
    f.area+=area;
    const coords=points.map(pt=>{
      const u=pt.dot(f.u),v=pt.dot(f.v);
      f.u0=Math.min(f.u0,u);f.u1=Math.max(f.u1,u);f.v0=Math.min(f.v0,v);f.v1=Math.max(f.v1,v);
      return [u,v];
    });
    f.tris.push({points,coords});
  }
  return [...faces.values()].sort((a,b)=>b.area-a.area);
}

function onFace(f,u,v){
  for(const {coords:[a,b,c]} of f.tris){
    const side=(j,k)=>(k[0]-j[0])*(v-j[1])-(k[1]-j[1])*(u-j[0]);
    const x=side(a,b),y=side(b,c),z=side(c,a);
    if(Math.min(x,y,z)>=-.002||Math.max(x,y,z)<=.002)return true;
  }
  return false;
}
function fits(f,u,v,w,h){
  return [-.5,.5].every(s=>[-.5,.5].every(t=>onFace(f,u+w*s,v+h*t)))&&onFace(f,u,v);
}
function world(f,u,v,n=0){return f.origin.clone().addScaledVector(f.u,u).addScaledVector(f.v,v).addScaledVector(f.n,n);}
function exposure(point,roofs){
  // Exclude roofs buried under another wing, chimney or overlapping tier.
  return !roofs.some(f=>{
    const y=(f.origin.dot(f.n)-point.x*f.n.x-point.z*f.n.z)/f.n.y;
    if(y<=point.y+.12)return false;
    const u=point.x*f.u.x+y*f.u.y+point.z*f.u.z;
    const v=point.x*f.v.x+y*f.v.y+point.z*f.v.z;
    return onFace(f,u,v);
  });
}
function spot(f,w,h,roofs,options=[.5,.25,.75]){
  for(const a of options)for(const b of options){
    const u=f.u0+(f.u1-f.u0)*a,v=f.v0+(f.v1-f.v0)*b;
    if(fits(f,u,v,w,h)&&[-.5,0,.5].every(s=>[-.5,0,.5].every(t=>exposure(world(f,u+w*s,v+h*t),roofs))))return [u,v];
  }
  return null;
}

function meshWriter(T,book){
  const positions=[],normals=[],colors=[],types=[],texcoords=[];
  function vertex(p,n,c,u=-1,v=-1){
    positions.push(p.x,p.y,p.z);normals.push(...n.toArray().map(v=>Math.round(127*v)));
    colors.push(c[0],c[1],c[2]);types.push(c[3]);
    texcoords.push(u,v);
  }
  function tri(a,b,c,finish,desired){
    const n=b.clone().sub(a).cross(c.clone().sub(a));
    if(n.lengthSq()<.00000001)return;n.normalize();
    if(desired&&n.dot(desired)<0){[b,c]=[c,b];n.negate();}
    for(const p of [a,b,c])vertex(p,n,finish);
  }
  function quad(a,b,c,d,finish,normal){tri(a,b,c,finish,normal);tri(a,c,d,finish,normal);}
  function panel(f,u,v,w,h,depth,color){
    const point=(x,y)=>world(f,u+x*w/2,v+y*h/2,depth);
    quad(point(-1,-1),point(1,-1),point(1,1),point(-1,1),color,f.n);
  }
  function glazing(f,u,v,w,h,depth,finish=finishes.glass){
    // Negative U keeps these untextured panes out of the source atlas. Its
    // integer part identifies a room, its fraction locates a point inside it.
    const room=Math.abs(Math.round(u*17+v*31))%251;
    const corners=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]];
    for(const i of [0,1,2,0,2,3]){
      const [a,b]=corners[i];
      vertex(world(f,u+a*w,v+b*h,depth),f.n,finish,-(2+room+.5+a*.98),.5-b*.98);
    }
  }
  function box(f,u,v,w,h,back,front,color){
    const points=[[-1,-1],[1,-1],[1,1],[-1,1]];
    const ring=d=>points.map(([x,y])=>world(f,u+x*w/2,v+y*h/2,d));
    const a=ring(back),b=ring(front);
    quad(...b,color,f.n);
    for(let j=0;j<4;j++){
      const k=(j+1)%4,dir=world(f,u+points[j][0]*w/2,v+points[j][1]*h/2).add(world(f,u+points[k][0]*w/2,v+points[k][1]*h/2)).multiplyScalar(.5).sub(world(f,u,v));
      quad(a[j],a[k],b[k],b[j],color,dir);
    }
  }
  function skin(f,color,offset){
    for(const {points} of f.tris)tri(...points.map(p=>p.clone().addScaledVector(f.n,offset)),color,f.n);
  }
  function tube(f,start,end,r,finish){
    const a=world(f,...start),b=world(f,...end),axis=b.clone().sub(a).normalize();
    const cross=axis.clone().cross(Math.abs(axis.y)<.9?new T.Vector3(0,1,0):new T.Vector3(1,0,0)).normalize();
    const across=axis.clone().cross(cross);
    const ring=[];
    for(let j=0;j<8;j++){
      const angle=j*Math.PI/4;
      ring.push(cross.clone().multiplyScalar(r*Math.cos(angle)).addScaledVector(across,r*Math.sin(angle)));
    }
    for(let j=0;j<8;j++){
      const p=ring[j],q=ring[(j+1)%8];
      quad(a.clone().add(p),a.clone().add(q),b.clone().add(q),b.clone().add(p),finish,p.clone().add(q));
    }
  }
  function awning(f,u,v,w,color){
    const sections=Math.max(3,Math.round(w/.79));
    function strip(left,right,finish){
      quad(world(f,left,v,.14),world(f,right,v,.14),world(f,right,v-.41,1.19),world(f,left,v-.41,1.19),finish,new T.Vector3(0,1,0));
      quad(world(f,left,v-.41,1.19),world(f,right,v-.41,1.19),world(f,right,v-.64,1.19),world(f,left,v-.64,1.19),finish,f.n);
    }
    for(let i=0;i<sections;i++){
      const left=u-w/2+w*i/sections,right=u-w/2+w*(i+1)/sections;
      strip(left,right-.075,color);strip(right-.075,right,finishes.cream);
    }
    for(const sign of [-1,1]){
      const x=u+sign*w*.43;
      tube(f,[x,v-.91,.13],[x,v-.43,1.12],.035,finishes.iron);
    }
  }
  function window(f,u,v,w,h){
    const rw=w*.5,rh=h*.5,jamb=Math.min(.135,rh*.2,rw*.2);
    const rim=[[u-rw,v-rh],[u+rw,v-rh],[u+rw,v+rh],[u-rw,v+rh]];
    const glass=[[u-rw+jamb,v-rh+jamb],[u+rw-jamb,v-rh+jamb],[u+rw-jamb,v+rh-jamb],[u-rw+jamb,v+rh-jamb]];
    glazing(f,u,v,w-2*jamb,h-2*jamb,.078);
    for(let j=0;j<4;j++){
      const k=(j+1)%4;
      quad(world(f,...rim[j],.21),world(f,...rim[k],.21),world(f,...glass[k],.08),world(f,...glass[j],.08),finishes.rim,f.n);
    }
    panel(f,u,v,.066,h-2*jamb,.13,finishes.steel);
    if(h>1.6)panel(f,u,v+.11*h,w-2*jamb,.061,.13,finishes.steel);
  }
  function stamp(name,f,u,v,scales=[1,1,1]){
    const [offset,count]=book.index[name],d=book.raw;
    const axes=[f.u,f.n,new T.Vector3().crossVectors(f.u,f.n)],start=world(f,u,v,.028);
    for(let j=offset;j<offset+count;j++){
      const b=j*16,p=start.clone(),n=new T.Vector3();
      for(let k=0;k<3;k++){
        p.addScaledVector(axes[k],d.getInt16(b+k*2,true)/512*scales[k]);
        n.addScaledVector(axes[k],d.getInt8(b+6+k)/(127*scales[k]));
      }
      vertex(p,n.normalize(),[d.getUint8(b+9),d.getUint8(b+10),d.getUint8(b+11),d.getUint8(b+12)]);
    }
  }
  function geometry(original){
    if(!positions.length)return original;
    const n=positions.length/3,old=original?.attributes.position.count??0;
    const total=old+n,geom=new T.BufferGeometry();
    const buffer=(name,array,size,norm=false)=>{
      if(original?.attributes[name])array.set(original.attributes[name].array);
      geom.setAttribute(name,new T.BufferAttribute(array,size,norm));
      return array;
    };
    buffer('position',new Float32Array(total*3),3).set(positions,old*3);
    buffer('normal',new Int8Array(total*3),3,true).set(normals,old*3);
    buffer('color',new Uint8Array(total*3),3,true).set(colors,old*3);
    buffer('urbanKind',new Uint8Array(total),1).set(types,old);
    buffer('uv',new Float32Array(total*2),2).set(texcoords,old*2);
    const originalIndices=original?.index?.array??[];
    const ids=new (total>65535?Uint32Array:Uint16Array)(originalIndices.length+n);
    ids.set(originalIndices);for(let k=0;k<n;k++)ids[k+originalIndices.length]=old+k;
    geom.setIndex(new T.BufferAttribute(ids,1));geom.computeBoundingSphere();
    return geom;
  }
  return {panel,glazing,box,skin,tube,awning,window,stamp,geometry,tri,quad};
}

// Fit the principal entrance to a street-level wall. Filtering the actual
// triangles here also handles residences with stepped or wedge-shaped plans.
function streetWalls(faces){
  return faces.filter(f=>f.v0<.65&&f.v1-f.v0>2.8&&f.u1-f.u0>4.5).sort((a,b)=>{
    const score=f=>Math.min(16,f.u1-f.u0)*(1-.18*f.n.z-.1*f.n.x);
    return score(b)-score(a);
  });
}
function framedDoor(writer,f,u,floor,w,h,depth=0){
  const v=floor+h/2;
  writer.box(f,u,v,w,h,depth+.025,depth+.19,finishes.iron);
  writer.glazing(f,u,v+.22,w-.19,h-.63,depth+.201);
  writer.panel(f,u,v-h*.35,w-.19,.34,depth+.204,finishes.rim);
  writer.box(f,u-w*.31,v-.03,.045,.34,depth+.21,depth+.29,finishes.cream);
}
function homeEntry(writer,f){
  const w=Math.min(3.6,(f.u1-f.u0)*.61),u=(f.u0+f.u1)/2,v=f.v0;
  if(!fits(f,u,v+1.40,w+.12,2.78))return;
  framedDoor(writer,f,u,v+.25,1.18,2.07);
  writer.box(f,u,v+.14,w,.25,.035,1.06,finishes.masonry);
  writer.box(f,u,v+.07,w*.63,.13,1.06,1.37,finishes.masonry);
  writer.box(f,u,v+2.62,w+.17,.18,.04,1.23,finishes.zinc);
  for(const side of [-1,1]){
    writer.box(f,u+side*(w/2-.18),v+1.40,.13,2.30,.92,1.05,finishes.cream);
  }
}
function balconies(writer,f){
  const width=f.u1-f.u0,height=f.v1-f.v0;
  const floors=Math.min(4,Math.floor(height/3.3)-1),w=Math.min(3.7,width*.58);
  if(floors<1||w<2.3)return;
  const pitch=height/(floors+1);
  for(let level=1;level<=floors;level++){
    const u=(f.u0+f.u1)/2,y=f.v0+level*pitch;
    if(!fits(f,u,y+1.10,w+.16,2.46))continue;
    framedDoor(writer,f,u,y+.11,1.56,2.03);
    writer.box(f,u,y,w,.19,.04,1.16,finishes.masonry);
    writer.box(f,u,y+1.12,w,.072,1.07,1.15,finishes.drainage);
    writer.box(f,u,y+.49,w-.13,.48,1.06,1.10,finishes.rim);
    const posts=Math.ceil(w/.9);
    for(let i=0;i<=posts;i++){
      writer.box(f,u+(w-.14)*(i/posts-.5),y+.60,.057,1.03,1.08,1.13,finishes.iron);
    }
    for(const side of [-1,1])writer.box(f,u+side*(w-.08)/2,y+1.12,.066,.072,.13,1.12,finishes.drainage);
  }
}
function commercialEntry(writer,f,code,shop){
  const w=Math.min(11.4,(f.u1-f.u0)*.84),u=(f.u0+f.u1)/2,y=f.v0;
  const height=Math.min(3.16,f.v1-y-.10);
  if(height<2.75||!fits(f,u,y+height/2,w,height-.04))return;
  writer.box(f,u,y+height/2,w,height-.04,.035,.10,finishes.iron);
  const entrance=Math.min(1.72,w*.37),display=w-entrance,bays=Math.max(1,Math.round(display/2.32));
  const left=u-w/2,doorAt=left+entrance/2;
  framedDoor(writer,f,doorAt,y+.09,Math.min(1.28,entrance-.10),2.18,.08);
  writer.box(f,doorAt,y+.045,entrance,.09,.10,.70,finishes.masonry);
  for(const edge of [left+.05,left+entrance]){
    writer.box(f,edge,y+1.31,.10,2.55,.12,.61,finishes.rim);
  }
  writer.box(f,u+entrance/2,y+.245,display-.06,.48,.12,.58,finishes.plinth);
  writer.box(f,u+entrance/2,y+.50,display+.03,.085,.15,.69,finishes.cream);
  for(let i=0;i<bays;i++){
    const bay=display/bays,x=left+entrance+(i+.5)*bay;
    writer.glazing(f,x,y+1.52,bay-.095,1.96,.56,finishes.display);
    writer.box(f,x+bay/2-.035,y+1.55,.071,2.09,.50,.65,finishes.rim);
    writer.box(f,x,y+2.23,bay-.09,.055,.55,.64,finishes.rim);
  }
  writer.box(f,u,y+2.56,w+.06,.11,.08,.70,finishes.cream);
  const header=y+height-.12;
  if(shop){
    writer.awning(f,u,header-.16,w+.14,awnings[code%awnings.length]);
    const signH=Math.max(.45,Math.min(.96,f.v1-header-.08)),signY=header+signH*.43;
    if(fits(f,u,signY,w,signH)){
      writer.box(f,u,signY,w+.04,signH,.055,.29,finishes.iron);
      writer.glazing(f,u,signY,w-.06,signH-.045,.30,finishes.fascia);
    }
  }
  else{
    writer.box(f,u,header,w+.36,.21,.19,1.15,finishes.zinc);
    for(const side of [-1,1])writer.box(f,u+side*(w/2-.21),y+height/2,.15,height-.33,.92,1.07,finishes.iron);
  }
}

function rainwaterGoods(writer,f){
  const w=f.u1-f.u0,h=f.v1-f.v0;
  if(w<5||h<3.3||h>24)return;
  const x=f.u1-.34,head=f.v1-.20,toe=f.v0+.24;
  if(!fits(f,x,(head+toe)/2,.36,head-toe))return;
  writer.tube(f,[x,head,.35],[x,head-.32,.18],.083,finishes.drainage);
  writer.tube(f,[x,head-.32,.18],[x,toe+.22,.18],.083,finishes.drainage);
  writer.tube(f,[x,toe+.22,.18],[x,toe,.40],.083,finishes.drainage);
  for(let v=toe+.65;v<head-.45;v+=3.3)writer.box(f,x,v,.20,.065,.04,.28,finishes.iron);
  if(fits(f,(f.u0+f.u1)/2,head+.04,w-.38,.22)){
    writer.box(f,(f.u0+f.u1)/2,head+.04,w-.38,.13,.08,.42,finishes.drainage);
    writer.box(f,(f.u0+f.u1)/2,head+.13,w-.38,.055,.35,.44,finishes.zinc);
  }
}
function serviceFittings(writer,f){
  const w=f.u1-f.u0,h=f.v1-f.v0,span=Math.min(w*.26,3.3),u=f.u0+w*.72,v=f.v0+h*.65;
  if(span<1.6||!fits(f,u,v,span+.28,1.56))return;
  // An industrial wall extraction plenum: raised metal case, air inlet
  // recessed behind separate louvre blades, and a flashed drip hood.
  writer.box(f,u,v,span,1.37,.05,.51,finishes.zinc);
  writer.panel(f,u,v,span-.15,1.16,.52,finishes.reveal);
  for(let i=0;i<6;i++)writer.box(f,u,v-.46+i*.18,span-.18,.067,.52,.61,finishes.drainage);
  writer.box(f,u,v+.74,span+.27,.10,.07,.72,finishes.zinc);
  const x=f.u0+w*.91,r=.26;
  if(!fits(f,x,(f.v1+v)/2,r*2+.12,f.v1-v-.06))return;
  const end=f.v1+.27;
  writer.tube(f,[u+span/2-.16,v,.43],[x-.31,v,.43],r,finishes.drainage);
  writer.tube(f,[x-.31,v,.43],[x,v+.31,.43],r,finishes.drainage);
  writer.tube(f,[x,v+.31,.43],[x,end,.43],r,finishes.drainage);
  for(const height of [v+.48,(v+end)/2,end-.16]){
    writer.tube(f,[x,height-.036,.43],[x,height+.036,.43],r+.044,finishes.iron);
  }
  writer.box(f,x,end+.10,.77,.12,.045,.82,finishes.zinc);
}

function wallWindows(writer,f,factory){
  const w=f.u1-f.u0,h=f.v1-f.v0;
  const bays=Math.min(10,Math.max(1,Math.floor(w/(factory?3.8:4.1))));
  const floors=Math.max(1,Math.min(4,Math.floor(h/(factory?4:3.3))));
  const pitch=w/bays,level=h/floors;
  for(let i=0;i<bays;i++){
    const u=f.u0+(i+.5)*pitch;
    for(let j=0;j<floors;j++){
      const v=f.v0+(j+.61)*level,pw=Math.min(3.0,pitch*.72),ph=Math.min(2.55,level*.58);
      if(fits(f,u,v,pw+.14,ph+.13))writer.window(f,u,v,pw,ph);
    }
    if(i&&factory){
      const x=u-pitch/2,y=(f.v0+f.v1)*.5;
      if(fits(f,x,y,.35,h-.56))writer.box(f,x,y,.35,h-.56,.043,.29,finishes.brick);
    }
  }
}
function loadingDoor(writer,f){
  const w=Math.min(3.9,(f.u1-f.u0)*.33),h=3.3,u=f.u0+(f.u1-f.u0)*.28,v=f.v0+.36+h/2;
  if(w<2.6||!fits(f,u,v,w+.52,h+.52))return;
  writer.box(f,u,v,w+.4,h+.22,.26,.34,finishes.rim);
  writer.panel(f,u,v,w,h,.35,finishes.steel);
  for(let s=1;s<9;s++)writer.panel(f,u,v-h/2+h*s/9,w,.035,.36,finishes.reveal);
  writer.box(f,u,v-h/2,w+.44,.21,.27,.78,finishes.masonry);
  writer.box(f,u,v+h/2+.17,w+.72,.12,.24,1.11,finishes.zinc);
}
function northlightWall(writer,f){
  const w=f.u1-f.u0,h=f.v1-f.v0;
  const count=Math.max(2,Math.floor(w/2.65));
  writer.skin(f,finishes.steel,.04);
  for(let i=0;i<count;i++){
    const u=f.u0+(i+.5)*w/count,v=(f.v0+f.v1)*.5;
    if(fits(f,u,v,w/count-.12,h-.32))writer.window(f,u,v,w/count-.12,h-.32);
  }
  for(const y of [f.v0+.09,f.v1-.09])if(fits(f,(f.u1+f.u0)*.5,y,w-.15,.10))
    writer.box(f,(f.u1+f.u0)*.5,y,w-.15,.10,.04,.23,finishes.zinc);
}
function seams(writer,f){
  const w=f.u1-f.u0,h=f.v1-f.v0,count=Math.min(16,Math.floor(w/1.25));
  for(let j=1;j<count;j++){
    const u=f.u0+j*w/count,v=(f.v0+f.v1)*.5;
    for(const fraction of [.97,.7,.38]){
      const length=h*fraction;
      if(fits(f,u,v,.055,length)){
        writer.box(f,u,v,.055,length,.042,.104,finishes.zinc);break;
      }
    }
  }
}
function coping(writer,f,roofs){
  const edges=new Map(),key=point=>point.map(n=>Math.round(n*100)).join(',');
  for(const {coords} of f.tris){
    for(let i=0;i<3;i++){
      const a=coords[i],b=coords[(i+1)%3],id=[key(a),key(b)].sort().join('/');
      edges.set(id,edges.has(id)?null:[a,b]);
    }
  }
  for(const edge of edges.values()){
    if(!edge)continue;
    const [a,b]=edge,dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
    if(length<2.2)continue;
    const u=(a[0]+b[0])/2,v=(a[1]+b[1])/2,tx=dx/length,ty=dy/length;
    const inward=onFace(f,u-ty*.15,v+tx*.15)?1:-1;
    const nx=-ty*inward,ny=tx*inward;
    // Skip a triangulation seam, buried wing or internal courtyard partition.
    if(onFace(f,u-nx*.07,v-ny*.07)||![.05,.5,.95].every(t=>exposure(world(f,a[0]+dx*t+nx*.12,a[1]+dy*t+ny*.12),roofs)))continue;
    const rail={origin:world(f,u+nx*.15,v+ny*.15),n:f.n,
      u:f.u.clone().multiplyScalar(tx).addScaledVector(f.v,ty),v:f.u.clone().multiplyScalar(nx).addScaledVector(f.v,ny)};
    writer.box(rail,0,0,length-.07,.24,.024,.34,finishes.masonry);
    writer.box(rail,0,0,length-.025,.31,.34,.395,finishes.zinc);
  }
}
function capStacks(writer,faces){
  // The highest vertices in IN164 are smoke emitters in midair. The solid
  // chimneys end at their horizontal cap faces, not at the model bounds.
  for(const f of faces){
    const y=f.tris.flatMap(t=>t.points.map(p=>p.y));
    if(f.n.y>.99&&Math.min(...y)>18&&f.area>1){
      // Each rectangular chimney top is two triangles. A real coping band
      // follows each individual top without connecting the two close stacks.
      const caps=new Map();
      for(const {coords} of f.tris){
        const uu=coords.map(p=>p[0]),vv=coords.map(p=>p[1]);
        const u=(Math.min(...uu)+Math.max(...uu))/2,v=(Math.min(...vv)+Math.max(...vv))/2;
        caps.set(u.toFixed(2)+'/'+v.toFixed(2),[u,v,Math.max(...uu)-Math.min(...uu),Math.max(...vv)-Math.min(...vv)]);
      }
      for(const [u,v,w,h] of caps.values()){
        writer.box(f,u,v,w+.4,h+.4,-.20,.17,finishes.masonry);
        writer.panel(f,u,v,w-.24,h-.24,.175,finishes.reveal);
        for(const side of [-1,1]){
          writer.box(f,u+side*(w-.15)/2,v,.15,h,.17,.43,finishes.brick);
          writer.box(f,u,v+side*(h-.15)/2,w-.29,.15,.17,.43,finishes.brick);
        }
      }
    }else if(Math.abs(f.n.y)<.15&&Math.min(...y)>8&&Math.max(...y)>18&&f.u1-f.u0<12){
      writer.skin(f,finishes.brick,.05);
      const u=(f.u0+f.u1)/2;
      for(const fraction of [.15,.65,.95]){
        const v=f.v0+(f.v1-f.v0)*fraction;
        for(const ratio of [.92,.74,.56,.4]){
          const w=(f.u1-f.u0)*ratio;
          if(fits(f,u,v,w,.13)){writer.box(f,u,v,w,.13,.05,.17,finishes.zinc);break;}
        }
      }
    }
  }
}
function tankFittings(writer,faces){
  // Follow each facet on the actual cylindrical shell: the joint bands
  // and ladder must not cross the gap between adjacent storage vessels.
  const walls=faces.filter(f=>Math.abs(f.n.y)<.07&&f.v1-f.v0>3&&f.u1-f.u0>.7);
  let ladder=false;
  for(const f of walls){
    const w=f.u1-f.u0,h=f.v1-f.v0,u=(f.u0+f.u1)/2;
    for(const y of [.23,.70,.965]){
      const v=f.v0+h*y;
      if(fits(f,u,v,w-.06,.13))writer.box(f,u,v,w-.06,.13,.025,.105,finishes.zinc);
    }
    if(ladder||!fits(f,u,(f.v0+f.v1)/2,.62,h*.87))continue;
    for(const side of [-1,1])writer.box(f,u+side*.23,(f.v0+f.v1)/2,.053,h*.88,.16,.24,finishes.steel);
    const steps=Math.max(4,Math.floor(h*.86/.32));
    for(let j=0;j<=steps;j++)writer.box(f,u,f.v0+h*(.08+.84*j/steps),.47,.043,.17,.23,finishes.zinc);
    ladder=true;
  }
}
function roofDuct(writer,f,u,v,roofs){
  // A short sheet-metal run connects the existing machine to a roof curb.
  // Check the whole route so it never bridges a roof step or an empty shaft.
  for(const sign of [-1,1]){
    const mid=u+sign*2.55,end=u+sign*3.72;
    if(!fits(f,mid,v,2.9,1.04)||!exposure(world(f,mid,v),roofs)||!exposure(world(f,end,v),roofs))continue;
    writer.box(f,mid,v,2.38,.74,.32,.83,finishes.zinc);
    writer.box(f,end,v,.64,.93,.035,.86,finishes.steel);
    for(const shift of [-.72,0,.72])writer.box(f,mid+shift,v,.048,.78,.31,.85,finishes.rim);
    break;
  }
}
// Build a cross gable upright, even when the host roof has an asymmetric pitch.
// Its street-facing window and both roof cheeks share the solid roof mesh.
function dormer(T,writer,f,roofs){
  if(f.n.y<.56||f.n.y>.94||f.area<16)return false;
  const width=2.05,length=1.63,anchor=spot(f,width+.28,length+.22,roofs,[.64,.40,.53]);
  if(!anchor)return false;
  const [u,v]=anchor,up=new T.Vector3(0,1,0),out=new T.Vector3(f.n.x,0,f.n.z).normalize();
  const towardStreet=f.v.dot(out)>0?1:-1;
  const front=world(f,u,v+towardStreet*length/2,.045),back=world(f,u,v-towardStreet*length/2,.045);
  const eave=back.y+.32;
  const corner=(base,x,y)=>base.clone().addScaledVector(f.u,x).setY(y);
  const edge=(base,y)=>[-1,1].map(side=>corner(base,side*width*.5,y));
  const [fl,fr]=edge(front,front.y),[bl,br]=edge(back,back.y);
  const [fle,fre]=edge(front,eave),[ble,bre]=edge(back,eave);
  const ridgeFront=corner(front,0,eave+.48),ridgeBack=corner(back,0,eave+.48);
  writer.quad(fl,fr,fre,fle,finishes.homePaint,out);
  writer.tri(fle,fre,ridgeFront,finishes.homePaint,out);
  writer.quad(fl,bl,ble,fle,finishes.homePaint,f.u.clone().negate());
  writer.quad(fr,br,bre,fre,finishes.homePaint,f.u);
  writer.quad(fle,ble,ridgeBack,ridgeFront,finishes.clay,up);
  writer.quad(ridgeFront,ridgeBack,bre,fre,finishes.clay,up);
  const wall={origin:front,u:f.u,v:up,n:out},height=eave-front.y;
  writer.glazing(wall,0,height*.51,1.29,height*.66,.055);
  writer.box(wall,0,height*.51,.085,height*.73,.060,.105,finishes.cream);
  writer.box(wall,0,height*.15,1.41,.09,.04,.16,finishes.cream);
  return true;
}

function mechanicalPenthouse(writer,f,roofs,avoid,code){
  if(f.n.y<.995||f.area<125)return false;
  const width=Math.min(7.8,(f.u1-f.u0)*.42),depth=Math.min(5.2,(f.v1-f.v0)*.37);
  if(width<3.2||depth<2.6)return false;
  const anchor=spot(f,width+.35,depth+.35,roofs,[.72,.29,.50]);
  if(!anchor||Math.abs(anchor[0]-avoid[0])<width*.5+1.8&&Math.abs(anchor[1]-avoid[1])<depth*.5+1.5)return false;
  const [u,v]=anchor,height=1.48+(code%3)*.34;
  writer.box(f,u,v,width,depth,.04,height,finishes.crown);
  for(const side of [-1,1]){
    // Horizontal louvres extend along the penthouse's two exposed long sides.
    for(const fraction of [.31,.48,.65,.82])writer.box(f,u,v+side*depth/2,width-.55,.14,height*fraction,height*fraction+.085,finishes.zinc);
  }
  writer.box(f,u,v,width+.23,depth+.20,height,height+.19,finishes.cream);
  return true;
}

function roofMonitors(T,writer,f,roofs){
  const width=Math.min(11.7,(f.u1-f.u0)*.67),depth=2.18;
  if(width<4.9||f.v1-f.v0<5.2)return false;
  let fitted=0,last=-Infinity;
  for(const t of [.26,.54,.79]){
    const u=(f.u0+f.u1)*.5,v=f.v0+(f.v1-f.v0)*t;
    if(v-last<depth+1.4||!fits(f,u,v,width+.23,depth+.16))continue;
    if(![-.5,0,.5].every(a=>[-.5,0,.5].every(b=>exposure(world(f,u+width*a,v+depth*b),roofs))))continue;
    writer.box(f,u,v,width,depth,.035,.22,finishes.zinc);
    const lo=world(f,u,v+depth*.49,.22),hi=world(f,u,v-depth*.20,1.33);
    const slant=hi.clone().sub(lo),length=slant.length();slant.normalize();
    const normal=new T.Vector3().crossVectors(f.u,slant).normalize();if(normal.dot(f.n)<0)normal.negate();
    const glazing={origin:hi.clone().lerp(lo,.5),u:f.u,v:slant,n:normal};
    writer.glazing(glazing,0,0,width-.18,length-.10,.018);
    const back=world(f,u,v-depth*.49,.22);
    const ends=(p)=>[-1,1].map(s=>p.clone().addScaledVector(f.u,s*width*.5));
    const [al,ar]=ends(lo),[bl,br]=ends(back),[cl,cr]=ends(hi);
    writer.tri(al,bl,cl,finishes.factoryDeck,f.u.clone().negate());
    writer.tri(ar,br,cr,finishes.factoryDeck,f.u);
    writer.quad(bl,br,cr,cl,finishes.factoryDeck,f.n);
    const lights=Math.ceil(width/1.52);
    for(let j=0;j<=lights;j++)writer.box(glazing,width*(j/lights-.5),0,.085,length,.024,.085,finishes.zinc);
    writer.box(glazing,0,length*.48,width+.10,.14,.025,.10,finishes.zinc);
    last=v;fitted++;
  }
  return fitted>0;
}

function worksInProgress(writer,faces,roofs,code){
  // The CA models depict an unfinished skeleton or an exposed foundation.
  // Stock and scaffolding rest on the actual slab; voids and shafts stay open.
  for(const f of roofs){
    if(f.n.y<.99||f.area<13)continue;
    const anchor=spot(f,3.8,1.68,roofs,[.66,.31,.51]);
    if(!anchor||world(f,...anchor).y>4.4)continue;
    const [u,v]=anchor;
    for(const side of [-1,1])writer.box(f,u+side*1.18,v,.24,1.68,.026,.19,finishes.timber);
    if(code%2){
      for(const side of [-1,0,1])writer.tube(f,[u-1.86,v+side*.37,.39],[u+1.86,v+side*.37,.39],.18,finishes.drainage);
    }else{
      for(let j=0;j<3;j++)writer.box(f,u,v,3.68,1.32,.20+j*.18,.35+j*.18,finishes.timber);
      for(const side of [-1,1])writer.box(f,u+side*.94,v,.065,1.34,.19,.72,finishes.iron);
    }
    break;
  }
  if(code<166)return;
  const wall=faces.find(f=>Math.abs(f.n.y)<.10&&f.u1-f.u0>5&&f.v1-f.v0>4.4&&f.v0<1.5);
  if(!wall)return;
  const span=Math.min(8.4,(wall.u1-wall.u0)*.82),u=(wall.u0+wall.u1)*.5,base=wall.v0+.10;
  const levelCount=Math.min(3,Math.floor((wall.v1-base-.98)/2.16));
  if(!levelCount||!fits(wall,u,base+(levelCount*2.16+.91)*.5,span,levelCount*2.16+.91))return;
  const bays=Math.ceil(span/3),top=base+levelCount*2.16+.91;
  for(let j=0;j<=bays;j++){
    const x=u+span*(j/bays-.5);
    writer.box(wall,x,(top+base)*.5,.088,top-base,.96,1.06,finishes.drainage);
    if(j<bays)writer.tube(wall,[x,base+.09,1.01],[x+span/bays,base+2.04,1.01],.044,finishes.drainage);
  }
  for(let level=1;level<=levelCount;level++){
    const y=base+level*2.16;
    writer.box(wall,u,y,span+.13,.14,.045,1.16,finishes.timber);
    writer.box(wall,u,y+.89,span,.071,.98,1.06,finishes.rail);
  }
}

export function buildArchitecturalRelief(T,code,base,original,book){
  const works=industrial(code),home=residential(code),office=commercial(code);
  const site=code>=136&&code<=139||code>=166&&code<=169;
  if(!works&&!home&&!office&&!site)return original;
  const faces=planes(T,base),roofs=faces.filter(f=>f.n.y>.33&&f.area>1);
  const writer=meshWriter(T,book);
  if(site){
    worksInProgress(writer,faces,roofs,code);
    return writer.geometry(original);
  }
  const walls=faces.filter(f=>Math.abs(f.n.y)<.06&&f.area>20);
  const front=streetWalls(walls);
  if(code===133)tankFittings(writer,faces);
  else if(works){
    for(const f of walls.filter(f=>f.u1-f.u0>=6).slice(0,8)){
      const h=f.v1-f.v0;
      if(h>=1.4&&h<=4.2&&f.tris.every(t=>t.points.every(p=>p.y>5.5))){
        northlightWall(writer,f);continue;
      }
      if(h<4.5||f.v0>4.5)continue;
      writer.skin(f,finishes.factoryWall,.041);
      wallWindows(writer,f,true);
    }
    const service=walls.find(f=>f.u1-f.u0>9&&f.v1-f.v0>4.5&&f.v0<1);
    if(service){loadingDoor(writer,service);serviceFittings(writer,service);}
    const returnWall=service&&front.find(f=>Math.abs(f.n.dot(service.n))<.55&&f.v1-f.v0>5);
    if(returnWall)serviceFittings(writer,returnWall);
    if(code===164)capStacks(writer,faces);
  }else if(office){
    if(front.length)commercialEntry(writer,front[0],code,code<=131||code>=148&&code<=153);
    for(const f of walls.filter(f=>f.u1-f.u0>5&&f.v1-f.v0>4).slice(0,4)){
      // Copings and slab edges give depth without blanketing source-aligned windows.
      const w=f.u1-f.u0,u=(f.u0+f.u1)/2,h=f.v1-f.v0;
      const stories=Math.min(10,Math.floor(h/3.45));
      for(let j=1;j<=stories;j++){
        const v=f.v0+j*h/stories-.21;
        if(fits(f,u,v,w-.21,.15))writer.box(f,u,v,w-.21,.15,.04,.23,finishes.masonry);
      }
    }
  }else if(home&&front.length){
    homeEntry(writer,front[0]);
    balconies(writer,front[0]);
    const side=front.find(f=>Math.abs(f.n.dot(front[0].n))<.6&&f.v1-f.v0>10);
    if(side)balconies(writer,side);
  }
  for(const wall of front.slice(0,works?2:1))rainwaterGoods(writer,wall);
  let furnished=0,hasDormer=false,hasPenthouse=false;
  for(const f of roofs){
    if(f.area<(home?6:15))continue;
    const flat=f.n.y>.982;
    const anchor=spot(f,home?1.1:2.35,home?.88:1.65,roofs);
    if(!anchor||world(f,...anchor).y<2.8)continue;
    if(works&&!flat){
      writer.skin(f,finishes.factoryDeck,.031);seams(writer,f);
      continue;
    }
    if(!flat){
      if(home&&!hasDormer&&f.area>=roofs[0].area*.26){
        hasDormer=dormer(T,writer,f,roofs);
        if(hasDormer)continue;
      }
      if(home&&!furnished){writer.stamp('Chimney',f,...anchor,[.86,1,.86]);furnished++;}
      continue;
    }
    if(furnished>=2)continue;
    if(office&&!hasPenthouse&&world(f,...anchor).y>21)hasPenthouse=mechanicalPenthouse(writer,f,roofs,anchor,code);
    if(f.area>55)coping(writer,f,roofs);
    if(home){
      if(f.area<30)writer.stamp('Chimney',f,...anchor);
      else writer.stamp('Air handler',f,...anchor,[.70,.76,.70]);
    }else if(code===133||f.area<38){
      writer.stamp('Turbine cowl',f,...anchor);
    }else if(works&&f.area>80&&furnished===0){
      if(!roofMonitors(T,writer,f,roofs)){
        const rooflight=spot(f,7.1,2.60,roofs);
        if(rooflight)writer.stamp('Northlight',f,...rooflight,[1.48,1.10,1]);
        else {writer.stamp('Air handler',f,...anchor);roofDuct(writer,f,...anchor,roofs);}
      }
    }else{
      const name=office&&f.area>115?'Roof access':'Air handler';
      const clear=spot(f,2.8,2.38,roofs,[.3,.7,.5]);
      if(clear){
        writer.stamp(name,f,...clear);
        if(name==='Air handler')roofDuct(writer,f,...clear,roofs);
      }
      const second=spot(f,.95,.95,roofs,[.78,.19]);
      if(second&&(!clear||Math.hypot(second[0]-clear[0],second[1]-clear[1])>2.4))writer.stamp('Turbine cowl',f,...second);
    }
    furnished++;
  }
  return writer.geometry(original);
}
