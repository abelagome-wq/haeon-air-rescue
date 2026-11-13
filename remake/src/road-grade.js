// Drivable height profiles in metres. The original OBJX asphalt lies at
// +.25 (ordinary road), +8 (single-deck highway/road bridge), or +16 on
// RD106's reinforced highway bridge; the +23.51 steelwork is not a road.
// BR86's +16.25 upper slab similarly covers its +8.00 roadway. TL63–66
// have a local zero-height portal floor beneath an approximately 8m cap.
import {networkPorts} from './road-topology.js';

const N=128,TILE=16,HALF=TILE/2,EXTENT=N*HALF;
const SIDES=['N','E','S','W'],DX=[0,1,0,-1],DZ=[-1,0,1,0];
const knots=[0,.10,.5,.90]; // the whole 12.8m carriageway keeps its mouth grade
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const roadBridge=code=>code>=81&&code<=88||code===106||code===107;
const railBridge=code=>code===90||code===91;
const tunnel=code=>code>=63&&code<=66;
const atIndex=(col,row)=>col>=0&&row>=0&&col<N&&row<N?row*N+col:-1;
const xx=col=>col*TILE-EXTENT+HALF;

function ringXY(side,t){
  if(side===0)return [2*t-1,-1];if(side===1)return [1,2*t-1];
  if(side===2)return [1-2*t,1];return [-1,1-2*t];
}
const ringPoints=SIDES.flatMap((_,i)=>knots.map(t=>ringXY(i,t)));

function edgeDistance(side,u,v){
  return side==='N'?v:side==='S'?1-v:side==='E'?1-u:u;
}

// Each profile has its own four corners. Join only those that belong to
// physically reciprocal edges of the same network. This matters at RD75/76:
// a city grid coordinate can carry overpass, underpass and terrain elevations.
function matchCorners(total){
  const parent=Int32Array.from({length:total},(_,i)=>i);
  function root(i){while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;}
  return {root,join(a,b){parent[root(a)]=root(b);}};
}

export function createRoadGrade(layers,roads,groundAt,compass=0){
  const profiles=[],byTile=new Array(N*N),byRoad=new Map();
  function add(tile,level,ports,ramp){
    const col=tile%N,row=tile>>7,code=layers.building[tile];
    const profile={i:profiles.length,tile,col,row,x:xx(col),z:xx(row),code,level,shape:ports,ramp,
      edges:new Array(4),ring:new Float64Array(16),center:0};
    profile.bridge=level==='rail'?railBridge(code):roadBridge(code);
    profiles.push(profile);(byTile[tile]??=[]).push(profile);return profile;
  }
  for(const node of roads)byRoad.set(node.id,add(node.tileId,node.level,node.shapePorts,node.ramp));
  for(const node of roads){
    const p=byRoad.get(node.id);
    node.ports.forEach((side,i)=>{p.edges[SIDES.indexOf(side)]=byRoad.get(node.neighbors[i]);});
  }
  for(let i=0;i<N*N;i++){
    const rail=networkPorts(layers.building[i],!!(layers.flags[i]&2),'rail',compass,layers.zone[i]>>4);
    if(rail.length)add(i,'rail',rail,null);
  }
  for(const p of profiles)if(p.level==='rail')for(const side of p.shape){
    const d=SIDES.indexOf(side),i=atIndex(p.col+DX[d],p.row+DZ[d]);
    const q=byTile[i]?.find(s=>s.level==='rail'&&s.shape.includes(SIDES[(d+2)%4]));
    if(q)p.edges[d]=q;
  }

  // A bridge's support datum is shared along its connected span. Depth of
  // the underwater terrain must not bend successive decks into a staircase.
  for(const p of profiles)if(p.bridge&&p.datum===undefined){
    const chain=[p];p.datum=0;let datum=-Infinity;
    for(let i=0;i<chain.length;i++){
      const a=chain[i];datum=Math.max(datum,layers.water[a.tile]*4,groundAt(a.x,a.z));
      for(const b of a.edges)if(b?.bridge&&b.datum===undefined){b.datum=0;chain.push(b);}
    }
    chain.forEach(a=>{a.datum=datum;});
  }
  function nominal(p,rx,rz){
    const x=p.x+rx*HALF,z=p.z+rz*HALF,ground=groundAt(x,z),u=(rx+1)/2,v=(rz+1)/2;
    if(p.bridge)return p.datum+(p.code>=106?16:8)+(p.level==='rail'?.62:0);
    if(tunnel(p.code))return p.mouth;
    if(p.ramp){
      const low=edgeDistance(p.ramp.street,u,v),high=edgeDistance(p.ramp.highway,u,v);
      return ground+.25+7.75*(low+high>1e-8?low/(low+high):.5);
    }
    if(p.level==='rail'){
      if(p.code>=108&&p.code<=111){const t=edgeDistance(SIDES[p.code-108],u,v);return ground-1.7+2.32*t;}
      return ground+((p.code===69||p.code===70)?.89:.62);
    }
    return ground+(p.level==='highway'?8:.25);
  }
  for(const p of profiles){
    if(tunnel(p.code)){
      const side=SIDES.indexOf(p.shape[0]);
      p.mouth=groundAt(p.x+DX[side]*HALF,p.z+DZ[side]*HALF)+.25;
    }
    p.center=nominal(p,0,0);p.priority=p.bridge?3:tunnel(p.code)?2:1;
    ringPoints.forEach(([rx,rz],i)=>{p.ring[i]=nominal(p,rx,rz);});
  }

  const corners=matchCorners(4*profiles.length);
  for(const p of profiles)for(let d=0;d<4;d++){
    const q=p.edges[d];if(!q||q.i<=p.i)continue;
    const other=(d+2)%4;
    // Rings walk clockwise, hence the reversed orientation on the other tile.
    corners.join(p.i*4+d,q.i*4+(other+1)%4);corners.join(p.i*4+(d+1)%4,q.i*4+other);
    for(let j=1;j<=3;j++){
      const a=d*4+j,b=other*4+4-j,y=p.priority>q.priority?p.ring[a]:p.priority<q.priority?q.ring[b]:(p.ring[a]+q.ring[b])/2;
      p.ring[a]=q.ring[b]=y;
    }
  }
  const cornerCache=new Map();
  for(const p of profiles)for(let d=0;d<4;d++){
    const id=corners.root(p.i*4+d),v=cornerCache.get(id);
    if(!v||p.priority>v.priority)cornerCache.set(id,{priority:p.priority,sum:p.ring[d*4],count:1});
    else if(p.priority===v.priority){v.sum+=p.ring[d*4];v.count++;}
  }
  for(const p of profiles){
    for(let d=0;d<4;d++){const a=cornerCache.get(corners.root(p.i*4+d));p.ring[d*4]=a.sum/a.count;}
    if(p.shape.length!==2||p.bridge||p.ramp)continue;
    const a=SIDES.indexOf(p.shape[0]),b=SIDES.indexOf(p.shape[1]);
    if((a+2)%4!==b)continue;
    // A slope leading onto a bridge honors the shore mouth and the higher
    // bridge mouth over a FULL tile, not a steep last half-tile at the edge.
    // Leave terrain ridges intact on normal, unadjusted streets.
    const changed=[a,b].some(d=>Math.abs(p.ring[d*4+2]-nominal(p,DX[d],DZ[d]))>.05);
    if(!changed)continue;
    p.center=(p.ring[a*4+2]+p.ring[b*4+2])/2;
    for(let d=0;d<4;d++)if(!p.edges[d]&&d!==a&&d!==b){
      const y0=p.ring[d*4],y1=p.ring[((d+1)%4)*4];
      for(let j=1;j<4;j++)p.ring[d*4+j]=y0+(y1-y0)*knots[j];
    }
  }

  function baseHeight(p,x,z){
    const rx=clamp((x-p.x)/HALF,-1,1),rz=clamp((z-p.z)/HALF,-1,1),w=Math.max(Math.abs(rx),Math.abs(rz));
    if(w<1e-9)return p.center;
    const d=Math.abs(rx)>Math.abs(rz)?rx>0?1:3:rz>0?2:0;
    const t=clamp(((d===0?rx:d===1?rz:d===2?-rx:-rz)/w+1)/2,0,1);
    const j=t<.1?0:t<.5?1:t<.9?2:3,start=knots[j],end=j===3?1:knots[j+1];
    const a=p.ring[d*4+j],b=p.ring[(d*4+j+1)%16];
    return p.center+w*(a+(b-a)*(t-start)/(end-start)-p.center);
  }
  function evaluate(p,x,z){
    const base=baseHeight(p,x,z);
    if(p.level!=='street'||p.code!==69&&p.code!==70)return base;
    // The solid crossing panel finishes just beneath both railheads. Its
    // shoulders taper back down inside the tile; neither adjacent rail nor
    // street mouth acquires a vertical step. 69 has a north/south track.
    const longitudinal=Math.abs(p.code===69?x-p.x:z-p.z);
    const t=clamp((longitudinal-2.25)/5.5,0,1),weight=1-t*t*(3-2*t);
    if(!weight)return base;
    const track=byTile[p.tile].find(slot=>slot.level==='rail');
    return track?base+weight*(baseHeight(track,x,z)-.015-base):base;
  }
  function select(tile,level){
    const entries=byTile[tile];if(!entries)return null;
    if(level==='rail')return entries.find(p=>p.level==='rail')??null;
    if(SIDES.includes(level))return entries.find(p=>p.level!=='rail'&&p.shape.includes(level))??null;
    if(level==='top'||level==null)return entries.find(p=>p.level==='highway')??entries.find(p=>p.level!=='rail')??null;
    return entries.find(p=>p.level===level)??entries.find(p=>p.level==='ramp')??null;
  }
  function heightInTile(tile,x,z,level='top'){
    const p=select(tile,level);return p?evaluate(p,x,z):null;
  }
  function heightAt(x,z,level='top'){
    const gx=(x+EXTENT)/TILE,gz=(z+EXTENT)/TILE,col=Math.floor(gx),row=Math.floor(gz);
    let y=heightInTile(atIndex(col,row),x,z,level);if(y!==null)return y;
    // A precisely shared mouth also belongs to the previous cell. This is
    // significant when requesting 'ramp' on the first centimetre of a highway
    // or when sampling an endcap whose next tile has no roadway at all.
    const borderX=gx-col<1e-9,borderZ=gz-row<1e-9;
    if(borderX)y=heightInTile(atIndex(col-1,row),x,z,level);
    if(y===null&&borderZ)y=heightInTile(atIndex(col,row-1),x,z,level);
    if(y===null&&borderX&&borderZ)y=heightInTile(atIndex(col-1,row-1),x,z,level);
    return y??groundAt(x,z);
  }
  function profileAt(col,row,level='top'){
    const p=select(atIndex(col,row),level);if(!p)return null;
    if(!p.view){
      const ports={};for(const d of p.shape)ports[d]=p.ring[SIDES.indexOf(d)*4+2];
      p.view={center:evaluate(p,p.x,p.z),corners:[p.ring[0],p.ring[4],p.ring[8],p.ring[12]],ports,level:p.level,
        heightAt:(x,z)=>evaluate(p,x,z)};
    }
    return p.view;
  }
  return {heightAt,heightInTile,profileAt};
}
