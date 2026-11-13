import {DIRECTIONS, VECTORS, bearing, tilePath,hasRoadSpline} from './road-path.js';

const TILE=16, HALF=8, CHUNK=16;
const surfaces={pavement:0,gutter:1,walk:2,paint:3,slab:4,steel:5};
const palette={
  asphalt:'#505653', gutter:'#626864', curb:'#a5a59a', pavement:'#919185',
  yellow:'#d8bc72', white:'#d6d4c7', concrete:'#797b78', verge:'#857d68',
};
function colorBytes(hex){
  return [1,3,5].map(i=>{
    const c=parseInt(hex.slice(i,i+2),16)/255;
    return Math.round(255*(c<=.04045?c/12.92:((c+.055)/1.055)**2.4));
  });
}
const colors=Object.fromEntries(Object.entries(palette).map(([key,value])=>[key,colorBytes(value)]));
const mix=(a,b,t)=>a+(b-a)*t;
const isTunnel=c=>c>=63&&c<=66;
export const isRoadCode=c=>(c>=29&&c<=43)||(c>=63&&c<=70)||(c>=73&&c<=89)||(c>=93&&c<=107);

function motorway(node){
  return node.level==='highway'||(node.level!=='street'&&((node.code>=73&&node.code<=80)||node.code>=97));
}
const settlementMasks=new WeakMap();
function settlementMask(city){
  if(settlementMasks.has(city))return settlementMasks.get(city);
  const mask=new Uint8Array(128*128);
  for(let row=0;row<128;row++)for(let col=0;col<128;col++){
    let score=0;
    for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
      const x=col+dx,z=row+dz;
      if(x<0||x>127||z<0||z>127)continue;
      const id=z*128+x,zone=city.layers.zone[id]&15;
      const developed=city.layers.building[id]>=112?1:zone>0&&zone<=8?.45:0;
      score+=developed*(dx===0||dz===0?.48:.25);
    }
    mask[row*128+col]=Math.round(Math.min(1,score)*255);
  }
  settlementMasks.set(city,mask);return mask;
}
function widths(node,mask){
  const wide=motorway(node);
  return {lane:wide?5.1:3.65,walk:wide?.58:.62+.83*mask[node.row*128+node.col]/255};
}
function blendWidth(a,b,t){return {lane:mix(a.lane,b.lane,t),walk:mix(a.walk,b.walk,t)};}
function localPoint(x,z,dy=0){return {x,z,dy};}
function side(sample,offset,dy=0){return localPoint(sample.x+(sample.nx??-sample.dz)*offset,sample.z+(sample.nz??sample.dx)*offset,dy);}
function crossSection(sample,width){
  const w=width.lane,h=w+width.walk;
  return [-h,-w-.27,-w-.12,-w,w,w+.12,w+.27,h].map((offset,i)=>
    side(sample,offset,[.085,.085,.008,0,0,.008,.085,.085][i]));
}
const bands=[['pavement',2],['curb',1],['gutter',1],['asphalt',0],['gutter',1],['curb',1],['pavement',2]];

// Split every polygon on the terrain's own diagonal. Even a four-metre saddle
// cannot poke a triangular hole through a correctly connected street.
function splitOnTerrain(points,otherDiagonal){
  const dist=p=>otherDiagonal?p.x+p.z:p.x-p.z;
  const distances=points.map(dist);
  if(!distances.some(v=>v>.000001)||!distances.some(v=>v<-.000001))return [points];
  const left=[],right=[];
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],da=distances[i],db=distances[(i+1)%points.length];
    if(da<=0)left.push(a);if(da>=0)right.push(a);
    if((da<0&&db>0)||(da>0&&db<0)){
      const t=da/(da-db),hit=localPoint(mix(a.x,b.x,t),mix(a.z,b.z,t),mix(a.dy,b.dy,t));
      left.push(hit);right.push(hit);
    }
  }
  return [left,right];
}

class RoadChunk {
  constructor(){this.positions=[];this.colors=[];this.kinds=[];this.indices=[];}
}
function tileWriter(city,node,chunk){
  const profile=city.roadProfileAt?.(node.col,node.row,node.level);
  const height=profile?.heightAt??((x,z)=>city.roadHeightAt(x,z,node.level));
  const otherDiagonal=city.split[node.row*128+node.col];
  const vertices=new Map();
  function vertex(p,color,kind){
    const key=Math.round(p.x*2000)+','+Math.round(p.z*2000)+','+Math.round(p.dy*2000)+','+color;
    if(vertices.has(key))return vertices.get(key);
    const x=node.x+p.x,z=node.z+p.z,index=chunk.positions.length/3;
    chunk.positions.push(x,height(x,z)+.035+p.dy,z);chunk.colors.push(...colors[color]);chunk.kinds.push(kind);
    vertices.set(key,index);return index;
  }
  const face=(points,color,kind)=>{
    for(const polygon of splitOnTerrain(points,otherDiagonal)){
      if(polygon.length<3)continue;
      const ids=polygon.map(p=>vertex(p,color,kind)),a=polygon[0];
      for(let j=1;j<polygon.length-1;j++){
        const b=polygon[j],c=polygon[j+1];
        const signed=(b.z-a.z)*(c.x-a.x)-(b.x-a.x)*(c.z-a.z);
        if(Math.abs(signed)<.0000001 && Math.max(a.dy,b.dy,c.dy)-Math.min(a.dy,b.dy,c.dy)<.01)continue;
        if(signed>=0)chunk.indices.push(ids[0],ids[j],ids[j+1]);
        else chunk.indices.push(ids[0],ids[j+1],ids[j]);
      }
    }
  };
  // Original road beds sit above terrain. Close the sides of ordinary roads
  // down to the actual ground, including raised approaches on a river bank.
  face.verge=(a,b,c,d)=>{
    const toe=p=>{
      const x=node.x+p.x,z=node.z+p.z;
      return {...p,dy:city.groundAt(x,z)-height(x,z)-.041};
    };
    face([a,b,toe(c),toe(d)],'verge',surfaces.slab);
  };
  return face;
}

function ribbon(writer,at,widthAt,steps,raised,barrier=false){
  let previous,previousFeet;
  let previousGuard;
  for(let i=0;i<=steps;i++){
    const t=i/steps,sample=at(t),width=widthAt(t),row=crossSection(sample,width);
    const feet=[-1,1].map(sign=>side(sample,sign*(width.lane+width.walk+.42)));
    if(previous){
      // Both LODs keep the same kerb cross-section at every boundary. The
      // distant mesh saves longitudinal samples, markings and parapet detail.
      for(let j=0;j<bands.length;j++)writer([previous[j],previous[j+1],row[j+1],row[j]],...bands[j]);
      if(raised)for(const j of [0,row.length-1]){
        const a=previous[j],b=row[j];writer([a,b,{...b,dy:-.5},{...a,dy:-.5}],'concrete',surfaces.slab);
      }
      else for(const [k,j] of [[0,0],[1,row.length-1]])
        writer.verge(previous[j],row[j],feet[k],previousFeet[k]);
    }
    if(barrier){
      const sample=at(t),outer=widthAt(t).lane+.38;
      const guards=[-1,1].map(s=>[side(sample,s*(outer-.10),.06),side(sample,s*(outer-.055),.64),
        side(sample,s*(outer+.055),.64),side(sample,s*(outer+.10),.06)]);
      if(previousGuard)for(let g=0;g<2;g++)for(let k=0;k<3;k++)
        writer([previousGuard[g][k],previousGuard[g][k+1],guards[g][k+1],guards[g][k]],'concrete',4);
      previousGuard=guards;
    }
    previous=row;previousFeet=feet;
  }
}
function stripe(writer,at,offsetAt,begin,end,width,color,steps){
  let previous;
  for(let i=0;i<=steps;i++){
    const t=mix(begin,end,i/steps),sample=at(t),offset=offsetAt(t);
    const row=[side(sample,offset-width/2,.033),side(sample,offset+width/2,.033)];
    if(previous)writer([previous[0],previous[1],row[1],row[0]],color,surfaces.paint);
    previous=row;
  }
}
function paintRun(writer,at,widthAt,n,curve,highway){
  // Both sides of a boundary land in the centre of a gap, independent of
  // segment orientation; partial paint tiles never meet at arbitrary angles.
  const count=curve?2:3;
  for(let i=0;i<count;i++){
    const start=(i+.23)/count,end=(i+.77)/count;
    stripe(writer,at,()=>0,start,end,highway?.18:.145,'yellow',curve?3:1);
  }
  if(highway)for(const sign of [-1,1])
    stripe(writer,at,t=>sign*(widthAt(t).lane-.23),0,1,.13,'white',n);
}
function terminalCap(writer,center,dir,width,raised){
  const [dx,dz]=dir,turn=Math.atan2(dz,dx);
  const radii=[width.lane,width.lane+.12,width.lane+.27,width.lane+width.walk];
  const lifts=[0,.008,.085,.085];let prev,previousFoot;
  for(let j=0;j<=10;j++){
    const a=turn-Math.PI/2+j*Math.PI/10;
    const arc=radii.map((r,i)=>localPoint(center.x+Math.cos(a)*r,center.z+Math.sin(a)*r,lifts[i]));
    const edge=radii[3]+.42,foot=localPoint(center.x+Math.cos(a)*edge,center.z+Math.sin(a)*edge);
    if(prev){writer([center,prev[0],arc[0]],'asphalt',0);
      for(let k=0;k<3;k++)writer([prev[k],arc[k],arc[k+1],prev[k+1]],...bands[4+k]);
      if(raised)writer([prev[3],arc[3],{...arc[3],dy:-.5},{...prev[3],dy:-.5}],'concrete',4);
      else writer.verge(prev[3],arc[3],foot,previousFoot);
    }
    prev=arc;previousFoot=foot;
  }
}

function run(writer,node,ports,edgeWidth,base,far){
  const raised=motorway(node)||node.code>=81&&node.code<=89||node.code>=93&&node.code<=96;
  if(ports.length===2){
    const [a,b]=ports,curve=VECTORS[a][0]+VECTORS[b][0]!==0||VECTORS[a][1]+VECTORS[b][1]!==0;
    const wa=edgeWidth(a),wb=edgeWidth(b),widthAt=t=>blendWidth(wa,wb,t);
    const at=t=>tilePath(a,b,t,node),steps=curve||hasRoadSpline(node)?(far?5:10):(far?2:4);
    ribbon(writer,at,widthAt,steps,raised,!far&&motorway(node)&&node.code<=105);
    if(!far)paintRun(writer,at,widthAt,steps,curve||hasRoadSpline(node),motorway(node));
    return;
  }
  if(ports.length===1){
    const d=ports[0],[dx,dz]=VECTORS[d],through=isTunnel(node.code);
    const end=through?-6:0,at=t=>({x:dx*mix(8,end,t),z:dz*mix(8,end,t),dx:-dx,dz:-dz});
    const wa=edgeWidth(d),widthAt=t=>blendWidth(wa,base,t);
    ribbon(writer,at,widthAt,far?2:3,raised);
    if(!through)terminalCap(writer,localPoint(0,0),[-dx,-dz],base,raised);
    if(!far)stripe(writer,at,()=>0,.17,.5,.14,'yellow',1);
    return;
  }
  const [dx,dz]=VECTORS[node.shapePorts?.[0]??'E'];
  const at=t=>({x:mix(-1.7,1.7,t)*dx,z:mix(-1.7,1.7,t)*dz,dx,dz});
  ribbon(writer,at,()=>base,2,raised);
  terminalCap(writer,localPoint(-1.7*dx,-1.7*dz),[-dx,-dz],base,raised);
  terminalCap(writer,localPoint(1.7*dx,1.7*dz),[dx,dz],base,raised);
}

function mouth(d,offset,dy=0,along=8){
  const [x,z]=VECTORS[d];return localPoint(x*along-z*offset,z*along+x*offset,dy);
}
function contour(from,to,a,b,steps=7){
  const p=mouth(from,a),q=mouth(to,-b),parallel=(DIRECTIONS.indexOf(to)-DIRECTIONS.indexOf(from)+4)%4===2;
  if(parallel)return [p,localPoint((p.x+q.x)/2,(p.z+q.z)/2),q];
  // Quadratic fillet with tangents parallel to each incoming curb.
  const u=VECTORS[from],v=VECTORS[to],corner=localPoint(u[0]*b+v[0]*a,u[1]*b+v[1]*a);
  return Array.from({length:steps+1},(_,i)=>{
    const t=i/steps,k=1-t;
    return localPoint(k*k*p.x+2*k*t*corner.x+t*t*q.x,k*k*p.z+2*k*t*corner.z+t*t*q.z);
  });
}
function junction(writer,ports,edgeWidth,cityBlock,wide,far){
  const center=localPoint(0,0);
  for(let i=0;i<ports.length;i++){
    const a=ports[i],b=ports[(i+1)%ports.length],wa=edgeWidth(a),wb=edgeWidth(b);
    writer([center,mouth(a,-wa.lane),mouth(a,wa.lane)],'asphalt',0);
    const radii=w=>[w.lane,w.lane+.12,w.lane+.27,w.lane+w.walk];
    const ra=radii(wa),rb=radii(wb),lifts=[0,.008,.085,.085];
    const lines=ra.map((r,j)=>contour(a,b,r,rb[j],far?3:7).map(p=>({...p,dy:lifts[j]})));
    const toes=wide?null:contour(a,b,ra[3]+.42,rb[3]+.42,far?3:7);
    for(let j=0;j<lines[0].length-1;j++){
      writer([center,lines[0][j],lines[0][j+1]],'asphalt',0);
      for(let k=0;k<3;k++)writer([lines[k][j],lines[k][j+1],lines[k+1][j+1],lines[k+1][j]],...bands[4+k]);
      if(toes)writer.verge(lines[3][j],lines[3][j+1],toes[j+1],toes[j]);
    }
    if(wide||far)continue;
    if(cityBlock){
      for(let u=-wa.lane+.38;u+.36<wa.lane-.15;u+=.92)
        writer([mouth(a,u,.034,5.55),mouth(a,u+.36,.034,5.55),mouth(a,u+.36,.034,7.02),mouth(a,u,.034,7.02)],'white',3);
    }
    const stop=cityBlock?7.45:6.55;
    writer([mouth(a,-wa.lane+.25,.036,stop),mouth(a,-.24,.036,stop),mouth(a,-.24,.036,stop+.24),mouth(a,-wa.lane+.25,.036,stop+.24)],'white',3);
  }
}

export function buildRoadSurfaces(city,far=false){
  const chunks=new Map(),mask=settlementMask(city),nodes=new Map(city.roads.map(n=>[n.id??n.row*128+n.col,n]));
  for(const node of city.roads){
    if(node.code===89)continue; // Raised drawbridge leaves a real opening.
    const key=Math.floor(node.col/CHUNK)+(128/CHUNK)*Math.floor(node.row/CHUNK);
    if(!chunks.has(key))chunks.set(key,new RoadChunk());
    const neighbors=new Map();
    for(const id of node.neighbors){const other=nodes.get(id);if(other)neighbors.set(bearing(node,other),other);}
    const ports=DIRECTIONS.filter(d=>{
      if(neighbors.has(d))return true;
      const [u,v]=VECTORS[d];
      return (node.col+u<0||node.col+u>=128||node.row+v<0||node.row+v>=128)&&node.shapePorts?.includes(d);
    });
    const width=widths(node,mask),edgeWidth=d=>neighbors.has(d)?blendWidth(width,widths(neighbors.get(d),mask),.5):width;
    const writer=tileWriter(city,node,chunks.get(key));
    if(ports.length<3){run(writer,node,ports,edgeWidth,width,far);continue;}
    const built=DIRECTIONS.some(d=>{const v=VECTORS[d];return (city.layers.building[(node.row+v[1])*128+node.col+v[0]]||0)>=112;});
    junction(writer,ports,edgeWidth,built,motorway(node),far);
  }
  return chunks;
}

function surfaceMaterial(T,owned,city){
  const size=128,pixels=new Uint8Array(size*size*4);let seed=31482;
  for(let i=0;i<pixels.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const v=seed>>>24;
    pixels[i]=pixels[i+1]=pixels[i+2]=v;pixels[i+3]=255;}
  const aggregate=new T.DataTexture(pixels,size,size);aggregate.wrapS=aggregate.wrapT=T.RepeatWrapping;
  aggregate.magFilter=T.LinearFilter;aggregate.minFilter=T.LinearMipmapLinearFilter;aggregate.generateMipmaps=true;aggregate.needsUpdate=true;
  const settlement=new T.DataTexture(settlementMask(city),128,128,T.RedFormat);settlement.magFilter=settlement.minFilter=T.LinearFilter;settlement.needsUpdate=true;
  const material=new T.MeshLambertMaterial({vertexColors:true,side:T.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  material.name='Street pavement, kerbs and lane paint';
  material.onBeforeCompile=sh=>{
    sh.uniforms.aggregate={value:aggregate};sh.uniforms.settlement={value:settlement};
    sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute float roadKind;varying vec2 roadXZ;varying float kind;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nroadXZ=position.xz;kind=roadKind;');
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nuniform sampler2D aggregate;uniform sampler2D settlement;varying vec2 roadXZ;varying float kind;')
      .replace('#include <color_fragment>',`#include <color_fragment>
        float grit=texture2D(aggregate,roadXZ*.21).r-.5;
        float warmth=texture2D(aggregate,roadXZ*.019).r-.5;
        if(kind<.5){diffuseColor.rgb*=1.+.29*grit+.12*warmth;}
        else if(kind>1.5 && kind<2.5){
          float built=texture2D(settlement,roadXZ/2048.+.5).r;
          vec2 cell=abs(fract(roadXZ/2.+.5)-.5)*2.;
          vec2 joint=1.-smoothstep(vec2(.014),vec2(.014)+fwidth(roadXZ),cell);
          diffuseColor.rgb=mix(vec3(.15,.14,.105)*(1.+.34*grit),diffuseColor.rgb*(1.+.11*grit-.13*max(joint.x,joint.y)),built);
        }else if(kind>.5 && kind<1.5){diffuseColor.rgb*=.70+.30*texture2D(settlement,roadXZ/2048.+.5).r;}
        else if(kind>2.5 && kind<3.5){
          diffuseColor.rgb=mix(diffuseColor.rgb*(.92+.17*grit),vec3(.081,.093,.087),smoothstep(150.,230.,distance(cameraPosition.xz,roadXZ)));
        }
      `);
  };
  owned.push(aggregate,settlement,material);return material;
}
export function addRoadSurfaces(T,city,group,owned){
  const material=surfaceMaterial(T,owned,city),blocks=[];
  const close=buildRoadSurfaces(city),far=buildRoadSurfaces(city,true);
  function meshFor(batch,name){
    const g=new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute(batch.positions,3));
    g.setAttribute('color',new T.Uint8BufferAttribute(batch.colors,3,true));
    g.setAttribute('roadKind',new T.Uint8BufferAttribute(batch.kinds,1));
    g.setIndex(batch.indices);g.computeVertexNormals();g.computeBoundingSphere();
    const mesh=new T.Mesh(g,material);mesh.name=name;mesh.receiveShadow=true;
    group.add(mesh);owned.push(g);return mesh;
  }
  const span=CHUNK*TILE;
  for(const [key,batch] of close){
    const x=key%(128/CHUNK)*span-1024,z=Math.floor(key/(128/CHUNK))*span-1024;
    blocks.push({x,z,near:meshFor(batch,'Continuous roads '+key),far:meshFor(far.get(key),'Continuous roads distant '+key)});
  }
  let lastX=Infinity,lastZ=Infinity,lastY=Infinity;
  function update(p){
    if(Math.hypot(p.x-lastX,p.z-lastZ,p.y-lastY)<14)return;
    lastX=p.x;lastZ=p.z;lastY=p.y;
    for(const b of blocks){
      const dx=Math.max(b.x-p.x,0,p.x-b.x-span),dz=Math.max(b.z-p.z,0,p.z-b.z-span);
      const dy=Math.max(0,p.y-b.near.geometry.boundingSphere.center.y);
      const limit=b.near.visible?272:242;
      b.near.visible=dx*dx+dz*dz+dy*dy<limit*limit;
      b.far.visible=!b.near.visible;
    }
  }
  update(city.spawn);return {update};
}

export function drawRoadMap(ctx,city){
  const metresPerPixel=2048/ctx.canvas.width;
  ctx.save();ctx.setTransform(1/metresPerPixel,0,0,1/metresPerPixel,ctx.canvas.width/2,ctx.canvas.height/2);
  ctx.lineJoin=ctx.lineCap='round';
  for(const high of [false,true]){
    ctx.strokeStyle=high?'#f6d1a3':'#c6d3d6';ctx.lineWidth=high?9.7:6;
    ctx.beginPath();
    for(const n of city.roads){
      if(motorway(n)!==high)continue;
      if(n.ports.length===2){
        for(let i=0;i<=8;i++){
          const p=tilePath(...n.ports,i/8,n);
          if(i===0)ctx.moveTo(n.x+p.x,n.z+p.z);else ctx.lineTo(n.x+p.x,n.z+p.z);
        }
      }else{
        for(const d of n.ports){
          const [x,z]=VECTORS[d];ctx.moveTo(n.x,n.z);ctx.lineTo(n.x+x*8,n.z+z*8);
        }
        if(!n.ports.length){ctx.moveTo(n.x-1,n.z);ctx.lineTo(n.x+1,n.z);}
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}
