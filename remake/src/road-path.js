// Coordinates are local to a 16 m tile. A quarter-circle joins two road mouths
// tangentially; both the asphalt and vehicles use this same centreline.
export const DIRECTIONS = ['N','E','S','W'];
export const VECTORS = {N:[0,-1], E:[1,0], S:[0,1], W:[-1,0]};
export const HALF_TILE = 8;

export function bearing(from,to){
  return Math.abs(to.x-from.x)>Math.abs(to.z-from.z) ? (to.x>from.x?'E':'W') : (to.z>from.z?'S':'N');
}

// A diagonal in SC2 is stored as a staircase of alternating corner tiles.
// Their shared mouth centres are collinear. Match the actual diagonal tangent
// at these seams, but keep an axial tangent where the next tile is straight or
// a junction. Hermite transitions then blend into and out of the diagonal.
const diagonals=new WeakMap();
export const hasRoadSpline=node=>diagonals.has(node);
function ordinaryBend(n){
  if(!n||n.code<35||n.code>38||n.ports.length!==2)return false;
  const [a,b]=n.ports.map(d=>VECTORS[d]);
  return a[0]*b[0]+a[1]*b[1]===0;
}
export function prepareRoadPaths(roads){
  const nodes=new Map(roads.map(n=>[n.id,n]));
  const fillets=new Map();
  function setFillet(node,edge,points){
    if(!fillets.has(node))fillets.set(node,new Map());
    fillets.get(node).set(edge,points);
  }
  for(const n of roads){
    if(!ordinaryBend(n))continue;
    const joined=new Set();
    for(const id of n.neighbors){
      const q=nodes.get(id);
      if(!ordinaryBend(q))continue;
      const d=bearing(n,q),back=bearing(q,n);
      const u=VECTORS[n.ports.find(p=>p!==d)],v=VECTORS[q.ports.find(p=>p!==back)];
      if(u[0]+v[0]===0&&u[1]+v[1]===0)joined.add(d);
    }
    if(!joined.size)continue;
    const [a,b]=n.ports,u=VECTORS[a],v=VECTORS[b];
    const chord=[(v[0]-u[0])*Math.SQRT1_2,(v[1]-u[1])*Math.SQRT1_2];
    const start=joined.has(a)?chord:[-u[0],-u[1]];
    const end=joined.has(b)?chord:v;
    const cut=(t,face)=>(t[1]*face[0]-t[0]*face[1])/(t[0]*face[0]+t[1]*face[1]);
    diagonals.set(n,{a,b,u,v,start,end,k0:cut(start,u),k1:cut(end,v),linear:joined.size===2,tables:new Map()});
    for(const id of n.neighbors){
      const straight=nodes.get(id),edge=bearing(n,straight);
      if(joined.has(edge)||straight.code<29||straight.code>34||straight.ports.length!==2)continue;
      const other=n.ports.find(d=>d!==edge),dir=VECTORS[edge],v=VECTORS[other];
      const incoming=[-dir[0],-dir[1]],outgoing=[(v[0]-dir[0])*Math.SQRT1_2,(v[1]-dir[1])*Math.SQRT1_2];
      const mouth=[n.x+8*dir[0],n.z+8*dir[1]],trim=4.6;
      // The bend straddles the unchanged SC2 boundary. Its crossing can move
      // slightly along that face, instead of forcing an S-turn into 16 m.
      const split=1/(1+Math.sqrt(incoming[0]*outgoing[0]+incoming[1]*outgoing[1]));
      function arm(node,finish){
        const samples=[],reverse=finish===0?-1:1;
        for(let i=0;i<=10;i++){
          const t=split+(finish-split)*i/10,k=1-t;
          const dx=(k*incoming[0]+t*outgoing[0])*reverse,dz=(k*incoming[1]+t*outgoing[1])*reverse,len=Math.hypot(dx,dz);
          samples.push({x:mouth[0]-node.x+trim*(-k*k*incoming[0]+t*t*outgoing[0]),
            z:mouth[1]-node.z+trim*(-k*k*incoming[1]+t*t*outgoing[1]),dx:dx/len,dz:dz/len});
        }
        return samples;
      }
      setFillet(n,edge,arm(n,1));setFillet(straight,bearing(straight,n),arm(straight,0));
    }
  }
  for(const [node,arms] of fillets){
    const [a,b]=node.ports,u=VECTORS[a],v=VECTORS[b],length=Math.hypot(v[0]-u[0],v[1]-u[1]);
    const dx=(v[0]-u[0])/length,dz=(v[1]-u[1])/length;
    const first=arms.get(a)??[{x:u[0]*8,z:u[1]*8,dx,dz}];
    const last=arms.get(b)??[{x:v[0]*8,z:v[1]*8,dx:-dx,dz:-dz}];
    const line=[...first,...last.slice().reverse().map(p=>({...p,dx:-p.dx,dz:-p.dz}))];
    let total=0;
    for(let i=0;i<line.length;i++){
      if(i)total+=Math.hypot(line[i].x-line[i-1].x,line[i].z-line[i-1].z);
      line[i].distance=total;
    }
    const cut=(p,d)=>(p.dz*d[0]-p.dx*d[1])/(p.dx*d[0]+p.dz*d[1]);
    diagonals.set(node,{a,b,u,v,line,total,k0:cut(line[0],u),k1:cut(line.at(-1),v),tables:new Map()});
  }
}
function diagonalSample(curve,t){
  if(curve.line){
    const line=curve.line,s=t*curve.total;let lo=0,hi=line.length-1;
    while(hi-lo>1){const i=(lo+hi)>>1;if(line[i].distance<s)lo=i;else hi=i;}
    const a=line[lo],b=line[hi],f=(s-a.distance)/(b.distance-a.distance||1);
    let dx=a.dx+f*(b.dx-a.dx),dz=a.dz+f*(b.dz-a.dz);const len=Math.hypot(dx,dz);
    dx/=len;dz/=len;
    const w=t*t*(3-2*t),skew=curve.k0*(1-w)+curve.k1*w;
    return {x:a.x+f*(b.x-a.x),z:a.z+f*(b.z-a.z),dx,dz,nx:-dz+skew*dx,nz:dx+skew*dz};
  }
  const {u,v,start,end}=curve,k=1-t,h=curve.linear?8*Math.SQRT2/3:4.1;
  const ax=8*u[0],az=8*u[1],bx=ax+h*start[0],bz=az+h*start[1];
  const ex=8*v[0],ez=8*v[1],cx=ex-h*end[0],cz=ez-h*end[1];
  const x=k*k*k*ax+3*k*k*t*bx+3*k*t*t*cx+t*t*t*ex,z=k*k*k*az+3*k*k*t*bz+3*k*t*t*cz+t*t*t*ez;
  let dx=k*k*(bx-ax)+2*k*t*(cx-bx)+t*t*(ex-cx),dz=k*k*(bz-az)+2*k*t*(cz-bz)+t*t*(ez-cz);
  const norm=Math.hypot(dx,dz);dx/=norm;dz/=norm;
  const blend=t*t*(3-2*t),skew=curve.k0*(1-blend)+curve.k1*blend;
  return {x,z,dx,dz,nx:-dz+skew*dx,nz:dx+skew*dz};
}
export function tilePath(a,b,t,node){
  const curve=node&&diagonals.get(node);
  if(curve){
    const forward=a===curve.a,p=diagonalSample(curve,forward?t:1-t);
    if(!forward){p.dx=-p.dx;p.dz=-p.dz;p.nx=-p.nx;p.nz=-p.nz;}
    return p;
  }
  const u=VECTORS[a],v=VECTORS[b];
  if(u[0]+v[0]===0 && u[1]+v[1]===0){
    return {x:8*u[0]*(1-2*t),z:8*u[1]*(1-2*t),dx:v[0],dz:v[1]};
  }
  const angle=t*Math.PI/2, s=Math.sin(angle),c=Math.cos(angle);
  return {x:8*(u[0]*(1-s)+v[0]*(1-c)),z:8*(u[1]*(1-s)+v[1]*(1-c)),
    dx:-u[0]*c+v[0]*s,dz:-u[1]*c+v[1]*s};
}

// Arc-length table for the actual chosen lane, including its oblique cuts at
// tile faces. Quantise only the table key while allowing continuous pull-over
// offsets in the returned position.
const STEPS=20;
function diagonalArc(curve,edge,leaving,lane){
  const reverse=leaving?edge===curve.a:edge===curve.b;
  const key=Math.round((reverse?-lane:lane)*20);
  let lengths=curve.tables.get(key);
  if(!lengths){
    lengths=new Float32Array(STEPS+1);let prev;
    for(let i=0;i<=STEPS;i++){
      const p=diagonalSample(curve,i/STEPS),x=p.x+p.nx*key/20,z=p.z+p.nz*key/20;
      if(prev)lengths[i]=lengths[i-1]+Math.hypot(x-prev[0],z-prev[1]);
      prev=[x,z];
    }
    curve.tables.set(key,lengths);
  }
  const mouth=edge===curve.a?0:STEPS,from=leaving?STEPS/2:mouth,to=leaving?mouth:STEPS/2;
  return {lengths,start:lengths[from],end:lengths[to],reverse};
}
function halfLength(node,edge,leaving,lane){
  const curve=diagonals.get(node);
  if(curve){const a=diagonalArc(curve,edge,leaving,lane);return Math.abs(a.end-a.start);}
  const ports=node.ports||[],other=ports.length===2?ports.find(d=>d!==edge):null;
  if(!other||!ports.includes(edge))return HALF_TILE;
  const a=VECTORS[leaving?other:edge],b=VECTORS[leaving?edge:other];
  const turn=(-a[0])*b[1]+a[1]*b[0];
  return turn?Math.PI*.25*(HALF_TILE-turn*lane):HALF_TILE;
}
export function roadEdgeLength(from,to,lane=0){
  return halfLength(from,bearing(from,to),true,lane)+halfLength(to,bearing(to,from),false,lane);
}

// Sample the second half of the departing tile or the first half of the
// entering tile. A junction keeps a free centre for any legal turn.
export function roadDrivingPoint(from,to,along,lane=0){
  const first=halfLength(from,bearing(from,to),true,lane);
  const second=halfLength(to,bearing(to,from),false,lane);
  const s=Math.max(0,Math.min(first+second,along)),leaving=s<first,node=leaving?from:to;
  const progress=leaving?s/first:(s-first)/second;
  const edge=bearing(node,leaving?to:from),v=VECTORS[edge];
  const ports=node.ports||[],other=ports.length===2?ports.find(d=>d!==edge):null;
  let sample;
  const curve=diagonals.get(node);
  if(curve){
    const arc=diagonalArc(curve,edge,leaving,lane),s=arc.start+(arc.end-arc.start)*progress;
    let lo=0,hi=STEPS;
    while(hi-lo>1){const mid=(lo+hi)>>1;if(arc.lengths[mid]<s)lo=mid;else hi=mid;}
    const t=(lo+(s-arc.lengths[lo])/(arc.lengths[hi]-arc.lengths[lo]||1))/STEPS;
    sample=diagonalSample(curve,t);
    if(arc.reverse){sample.dx=-sample.dx;sample.dz=-sample.dz;sample.nx=-sample.nx;sample.nz=-sample.nz;}
  }else if(other&&ports.includes(edge)){
    sample=leaving?tilePath(other,edge,.5+.5*progress):tilePath(edge,other,.5*progress);
  }else{
    const radius=leaving?progress*8:(1-progress)*8;
    const sign=leaving?1:-1;
    sample={x:radius*v[0],z:radius*v[1],dx:sign*v[0],dz:sign*v[1]};
    // Fade the offset just inside a junction so changing direction at its
    // centre does not teleport a car sideways into a different lane.
    if(ports.length>=3)lane*=Math.min(1,radius/4);
  }
  return {x:node.x+sample.x+(sample.nx??-sample.dz)*lane,z:node.z+sample.z+(sample.nz??sample.dx)*lane,
    dx:sample.dx,dz:sample.dz,level:node.level};
}
