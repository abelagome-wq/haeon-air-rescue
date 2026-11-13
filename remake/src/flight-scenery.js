// Fixed city objects keep their render geometry and world transform even while
// a batch is culled or swaps visual LOD. Tile bins find nearby instances. The
// small local triangle grid is shared by all instances of the same mesh.
export function createFlightScenery(T) {
  const tiles=new Map(),shapes=new WeakMap(),overridden=new Set();
  const local=new T.Box3(),tri=new T.Triangle(),sample=new T.Box3();
  const tile=v=>Math.floor((v+1024)/16);
  const gridSize=6;
  const sampleCell=(v,min,max)=>Math.max(0,Math.min(gridSize-1,Math.floor(gridSize*(v-min)/(max-min||1))));
  let queryNumber=0,instanceNumber=0;

  function prepare(geometry){
    let shape=shapes.get(geometry);
    if(shape)return shape;
    const pos=geometry.attributes.position,indices=geometry.index;
    if(!geometry.boundingBox)geometry.computeBoundingBox();
    const bounds=geometry.boundingBox,bins=Array.from({length:gridSize**2},()=>[]);
    const count=Math.floor((indices?.count??pos.count)/3);
    for(let f=0;f<count;f++){
      const a=indices?indices.getX(f*3):f*3,b=indices?indices.getX(f*3+1):f*3+1,c=indices?indices.getX(f*3+2):f*3+2;
      const x0=sampleCell(Math.min(pos.getX(a),pos.getX(b),pos.getX(c)),bounds.min.x,bounds.max.x);
      const x1=sampleCell(Math.max(pos.getX(a),pos.getX(b),pos.getX(c)),bounds.min.x,bounds.max.x);
      const z0=sampleCell(Math.min(pos.getZ(a),pos.getZ(b),pos.getZ(c)),bounds.min.z,bounds.max.z);
      const z1=sampleCell(Math.max(pos.getZ(a),pos.getZ(b),pos.getZ(c)),bounds.min.z,bounds.max.z);
      for(let r=z0;r<=z1;r++)for(let col=x0;col<=x1;col++)bins[r*gridSize+col].push(f);
    }
    shape={pos,indices,bounds,bins,seen:new Float64Array(count),sequence:0};
    shapes.set(geometry,shape);return shape;
  }
  function add(geometry,matrix,kind,placement=null) {
    if(!geometry?.attributes.position?.count)return;
    if(!geometry.boundingBox)geometry.computeBoundingBox();
    const bounds=geometry.boundingBox.clone().applyMatrix4(matrix);
    const entry={geometry,matrix:matrix.clone(),inverse:matrix.clone().invert(),bounds,kind,placement,query:0,id:'scenery-'+(++instanceNumber)};
    const ids=[];
    for(let row=tile(bounds.min.z);row<=tile(bounds.max.z);row++)for(let col=tile(bounds.min.x);col<=tile(bounds.max.x);col++){
      const id=row*128+col;
      if(!tiles.has(id))tiles.set(id,[]);
      tiles.get(id).push(entry);ids.push(id);
    }
    return ()=>{for(const id of ids){
      const entries=tiles.get(id);if(!entries)continue;
      const i=entries.indexOf(entry);if(i!==-1)entries.splice(i,1);
      if(!entries.length)tiles.delete(id);
    }};
  }
  function visit(bounds,check,accept=null){
    const q=++queryNumber;
    for(let r=tile(bounds.min.z);r<=tile(bounds.max.z);r++)for(let col=tile(bounds.min.x);col<=tile(bounds.max.x);col++){
      for(const entry of tiles.get(r*128+col)||[]){
        if(entry.query===q)continue;entry.query=q;
        if(overridden.has(entry.placement)||!entry.bounds.intersectsBox(bounds)||accept&&!accept(entry))continue;
        const shape=prepare(entry.geometry),b=shape.bounds;
        local.copy(bounds).applyMatrix4(entry.inverse);
        const x0=sampleCell(local.min.x,b.min.x,b.max.x),x1=sampleCell(local.max.x,b.min.x,b.max.x);
        const z0=sampleCell(local.min.z,b.min.z,b.max.z),z1=sampleCell(local.max.z,b.min.z,b.max.z);
        const token=++shape.sequence,v=shape.pos,ids=shape.indices;
        for(let j=z0;j<=z1;j++)for(let i=x0;i<=x1;i++)for(const f of shape.bins[j*gridSize+i]){
          if(shape.seen[f]===token)continue;shape.seen[f]=token;
          const first=f*3;
          tri.a.fromBufferAttribute(v,ids?ids.getX(first):first);
          tri.b.fromBufferAttribute(v,ids?ids.getX(first+1):first+1);
          tri.c.fromBufferAttribute(v,ids?ids.getX(first+2):first+2);
          if(Math.max(tri.a.y,tri.b.y,tri.c.y)<local.min.y || Math.min(tri.a.y,tri.b.y,tri.c.y)>local.max.y)continue;
          tri.a.applyMatrix4(entry.matrix);tri.b.applyMatrix4(entry.matrix);tri.c.applyMatrix4(entry.matrix);
          const result=check(tri,entry.kind,entry.id);
          if(result)return result;
        }
      }
    }
    return null;
  }
  function floorAt(x,z,top){
    let floor=-Infinity;
    sample.min.set(x,-100000,z);sample.max.set(x,Math.min(100000,top),z);
    visit(sample,t=>{
      const {a,b,c}=t,dx=b.x-a.x,dz=b.z-a.z,ex=c.x-a.x,ez=c.z-a.z,det=dx*ez-dz*ex;
      if(Math.abs(det)<.00001)return;
      const u=((x-a.x)*ez-(z-a.z)*ex)/det,v=(dx*(z-a.z)-dz*(x-a.x))/det;
      if(u<-.00001||v<-.00001||u+v>1.00001)return;
      const height=a.y+u*(b.y-a.y)+v*(c.y-a.y);
      if(height<=top)floor=Math.max(floor,height);
    },e=>e.kind!=='tree'&&e.kind!=='powerline');
    return floor;
  }
  function setOverrides(placements){overridden.clear();for(const p of placements)overridden.add(p);}
  function addObject(object,kind){
    object.updateWorldMatrix(true,true);
    const clean=[];
    object.traverse(mesh=>{if(mesh.isMesh){
      const remove=add(mesh.geometry,mesh.matrixWorld,kind);
      if(remove)clean.push(remove);
    }});
    return ()=>{for(const remove of clean)remove();};
  }
  function forEachSolid(fn){
    const seen=new Set();
    for(const entries of tiles.values())for(const entry of entries){
      if(seen.has(entry)||overridden.has(entry.placement))continue;
      seen.add(entry);fn(entry);
    }
  }
  return {add,addObject,visit,floorAt,setOverrides,forEachSolid};
}
