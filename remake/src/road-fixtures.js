// Grade crossings, elevated road piers and preserved tunnel portals.
// River-crossing structures are assembled once per span in bridge-spans.js.
const HALF=8;
const tunnel=code=>code>=63&&code<=66;
const crossing=code=>[69,70,77,78].includes(code);
function tunnelTriangles(geometry){
  const {position,normal,uv,color,farRect}=geometry.attributes;
  const out=[];
  for(let i=0;i<position.count;i+=3){
    if(Math.max(position.getY(i),position.getY(i+1),position.getY(i+2))<=.22)continue;
    // The SC2 compass uses the transposed OBJX longitudinal axis: also fix winding.
    for(const j of [i,i+2,i+1]){
      out.push({x:position.getZ(j),y:position.getY(j),z:position.getX(j),
        nx:normal.getZ(j),ny:normal.getY(j),nz:normal.getX(j),
        u:uv.getX(j),v:uv.getY(j),r:color.getX(j),g:color.getY(j),b:color.getZ(j),
        rect:[farRect.getX(j),farRect.getY(j),farRect.getZ(j),farRect.getW(j)]});
    }
  }
  return out;
}
function boxes(T,items,group,owned){
  if(!items.length)return;
  const geometry=new T.BoxGeometry(1,1,1), material=new T.MeshLambertMaterial({color:0xffffff});
  const mesh=new T.InstancedMesh(geometry,material,items.length),matrix=new T.Object3D();
  for(const [i,b] of items.entries()){
    matrix.position.set(b.x,b.y,b.z);matrix.scale.set(b.w,b.h,b.d);matrix.rotation.set(b.rx||0,b.ry||0,b.rz||0);
    matrix.updateMatrix();mesh.setMatrixAt(i,matrix.matrix);mesh.setColorAt(i,new T.Color(b.color));
  }
  mesh.name='Crossing rails and viaduct supports';mesh.receiveShadow=true;mesh.computeBoundingSphere();
  group.add(mesh);owned.push(geometry,material,mesh);
}
export function addRoadFixtures(T,city,kit,lookup,group,owned){
  const templates=new Map(),batches=new Map(),blocks=[];
  function crossingRails(node){
    const ports=city.networkPorts(node.code,false,'rail');
    const east=ports.includes('E'),alongX=east?1:0,alongZ=east?0:1;
    const railY=(x,z)=>city.railHeightAt(x,z)+.035;
    function beam(start,end,offset,w,h,lift,color){
      const x1=node.x+alongX*start-alongZ*offset,z1=node.z+alongZ*start+alongX*offset;
      const x2=node.x+alongX*end-alongZ*offset,z2=node.z+alongZ*end+alongX*offset;
      const y1=railY(x1,z1)+lift,y2=railY(x2,z2)+lift,len=end-start;
      blocks.push({x:(x1+x2)/2,y:(y1+y2)/2,z:(z1+z2)/2,w:east?Math.hypot(len,y2-y1):w,
        d:east?w:Math.hypot(len,y2-y1),h,color,rz:east?Math.atan2(y2-y1,len):0,rx:east?0:-Math.atan2(y2-y1,len)});
    }
    for(const side of [-1,1])for(const [a,b] of [[-HALF,0],[0,HALF]]){
      beam(a,b,side*.74,.27,.08,-.042,0x394141);
      beam(a,b,side*.74,.095,.08,0,0xb3b7b3);
    }
    if([71,72,77,78].includes(node.code)){
      for(let a=-7.5;a<8;a+=1.45){
        const x=node.x+a*alongX,z=node.z+a*alongZ;
        blocks.push({x,z,y:railY(x,z)-.16,w:east?.24:2.35,d:east?2.35:.24,h:.17,color:0x655b4e});
      }
    }
  }
  // Rail-only wire crossings have no road node; keep their rails and sleepers.
  for(let i=0;i<city.layers.building.length;i++){
    const code=city.layers.building[i];
    if(code===71||code===72)crossingRails({...city.tileToWorld(i%128,i>>7),code});
  }
  const preferred=new Map();
  for(const n of city.roads){
    if(!preferred.has(n.tileId)||n.level==='highway')preferred.set(n.tileId,n);
  }
  for(const n of preferred.values()){
    const id=n.row*128+n.col;
    if(crossing(n.code))crossingRails(n);
    if(n.level==='highway'&&n.code<=105){
      const axis=city.networkPorts(n.code,!!(city.layers.flags[id]&2)).includes('E');
      const cross=n.code===75||n.code===76||n.code===77||n.code===78;
      if(cross||(n.col+n.row)%2===0){
        const profile=city.roadProfileAt(n.col,n.row,'highway');
        if(profile)for(const shift of cross?[-6.8,6.8]:[0]){
          // Offset supports along the elevated deck, clear of the road/track below.
          const ew=n.code===75||n.code===77||!cross&&axis;
          const x=n.x+(ew?shift:0),z=n.z+(ew?0:shift);
          const top=profile.heightAt(x,z)-.35,bottom=city.groundAt(x,z)-.12;
          if(top>bottom+1.3)blocks.push({x,z,y:(top+bottom)/2,w:ew?1.05:2.5,d:ew?2.5:1.05,h:top-bottom,color:0x858780});
        }
      }
    }
    if(!tunnel(n.code))continue;
    if(!templates.has(n.code)){
      const geo=kit.get(lookup(n.code).id)?.geometry;
      templates.set(n.code,geo?tunnelTriangles(geo):[]);
    }
    const vertices=templates.get(n.code);if(!vertices.length)continue;
    const key=(n.row>>5)*4+(n.col>>5);
    if(!batches.has(key))batches.set(key,{p:[],normal:[],uv:[],color:[],rect:[]});
    const out=batches.get(key);
    const profile=city.roadProfileAt(n.col,n.row,n.level);
    for(const v of vertices){
      out.p.push(n.x+v.x,profile.center+v.y,n.z+v.z);
      out.normal.push(v.nx,v.ny,v.nz);
      out.color.push(v.r,v.g,v.b);out.uv.push(v.u,v.v);out.rect.push(...v.rect);
    }
  }
  for(const [key,data] of batches){
    const g=new T.BufferGeometry();
    for(const [name,values,size] of [['position',data.p,3],['normal',data.normal,3],['color',data.color,3],['uv',data.uv,2],['farRect',data.rect,4]])
      g.setAttribute(name,new T.Float32BufferAttribute(values,size));
    g.computeBoundingSphere();const mesh=new T.Mesh(g,kit.material);mesh.name='Original road structures '+key;
    group.add(mesh);owned.push(g);
  }
  boxes(T,blocks,group,owned);
}
