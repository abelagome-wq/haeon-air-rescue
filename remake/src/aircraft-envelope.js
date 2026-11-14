const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

// Use only triangles submitted by the renderer. Some GLB primitives share
// vertex buffers but select different parts with their own index buffers.
function addMesh(T,mesh,inverse,data){
  const {position}=mesh.geometry.attributes,index=mesh.geometry.index;
  const toModel=new T.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld);
  const p=new T.Vector3(),base=data.positions.length/3;
  for(let i=0;i<position.count;i++){
    p.fromBufferAttribute(position,i).applyMatrix4(toModel);
    data.positions.push(p.x,p.y,p.z);
  }
  for(let i=0;i<(index?.count??position.count);i++)data.indices.push(base+(index?index.getX(i):i));
}

// The outer tip and the raised hub are at different heights. Slice the
// rendered triangles along their spin axis. Each slice sweeps its own disk.
function sweptRotor(data,center,axis,omega){
  const {positions:p,indices}=data,ax=axis==='y'?1:0,side=axis==='y'?0:1;
  let low=Infinity,high=-Infinity;
  for(const i of indices){low=Math.min(low,p[3*i+ax]);high=Math.max(high,p[3*i+ax]);}
  const count=Math.max(1,Math.ceil((high-low)/.04)),step=(high-low)/count;
  const band=value=>clamp(Math.floor((value-low)/(step||1)),0,count-1);
  const radii=new Float64Array(count),lateral=axis==='y'?center.x:center.y;
  function extend(i,x,z){radii[i]=Math.max(radii[i],(x-lateral)**2+(z-center.z)**2);}
  for(let k=0;k<indices.length;k+=3){
    for(let j=0;j<3;j++){
      const a=3*indices[k+j],b=3*indices[k+(j+1)%3],av=p[a+ax],bv=p[b+ax];
      const ai=band(av),bi=band(bv);extend(ai,p[a+side],p[a+2]);
      // A triangle clipped to a strip reaches its maximum radius at a
      // vertex or an edge intersection with one of the strip boundaries.
      for(let i=Math.min(ai,bi)+1;i<=Math.max(ai,bi);i++){
        const t=(low+i*step-av)/(bv-av);
        const x=p[a+side]+t*(p[b+side]-p[a+side]),z=p[a+2]+t*(p[b+2]-p[a+2]);
        extend(i-1,x,z);extend(i,x,z);
      }
    }
  }
  const slices=[];
  for(let i=0;i<count;i++)if(radii[i]>0){
    const origin=center.clone();origin[axis]=low+(i+.5)*step;
    slices.push({center:origin,axis,radius:Math.sqrt(radii[i]),half:step*.5,omega});
  }
  const outer=slices.reduce((best,d)=>!best||d.radius>best.radius?d:best,null);
  return {...outer,slices};
}

export function aircraftEnvelope(T,model,main,tail,diameter){
  model.updateWorldMatrix(true,true);
  const inverse=model.matrixWorld.clone().invert();
  const geometry=()=>({positions:[],indices:[]});
  const body=geometry(),mainMesh=geometry(),tailMesh=geometry();
  model.traverse(mesh=>{
    if(!mesh.isMesh)return;
    let parent=mesh;
    while(parent&&parent!==main&&parent!==tail)parent=parent.parent;
    addMesh(T,mesh,inverse,parent===main?mainMesh:tail&&parent===tail?tailMesh:body);
  });
  const {positions:p,indices}=body;
  let low=Infinity,high=-Infinity;
  for(const i of indices){low=Math.min(low,p[3*i+2]);high=Math.max(high,p[3*i+2]);}
  const count=12,step=(high-low)/count,bin=z=>clamp(Math.floor((z-low)/(step||1)),0,count-1);
  const bins=Array.from({length:count},()=>new Set());
  for(let k=0;k<indices.length;k+=3){
    const a=indices[k],b=indices[k+1],c=indices[k+2];
    const za=bin(p[a*3+2]),zb=bin(p[b*3+2]),zc=bin(p[c*3+2]);
    for(let i=Math.min(za,zb,zc);i<=Math.max(za,zb,zc);i++)bins[i].add(a).add(b).add(c);
  }
  const boxes=[],sections=[],probes=[],v=new T.Vector3();
  for(let i=0;i<count;i++)if(bins[i].size){
    const box=new T.Box3(),vertices=new Float32Array(bins[i].size*3);let offset=0;
    for(const index of bins[i]){
      v.fromArray(p,3*index);box.expandByPoint(v);v.toArray(vertices,offset);offset+=3;
    }
    box.min.z=low+i*step;box.max.z=low+(i+1)*step;boxes.push(box);sections.push(vertices);
    for(const x of [box.min.x,box.max.x])for(const z of [box.min.z,box.max.z])
      probes.push({p:new T.Vector3(x,Math.max(.20,box.min.y+.14),z),kind:'airframe'});
  }
  const hub=part=>part.getWorldPosition(new T.Vector3()).applyMatrix4(inverse);
  const omega=392/diameter,rotors=[sweptRotor(mainMesh,hub(main),'y',omega)];
  if(tail&&tailMesh.indices.length){
    const secondMain=tail.name==='SecondMainRotor';
    rotors.push(sweptRotor(tailMesh,hub(tail),secondMain?'y':'x',omega*(secondMain?1:tail.name==='FenestronRotor'?6.3:4.65)));
  }
  for(const disk of rotors)for(let i=0;i<20;i++){
    const angle=i*Math.PI/10,p=disk.center.clone();p.z+=Math.sin(angle)*disk.radius;
    p[disk.axis==='y'?'x':'y']+=Math.cos(angle)*disk.radius;probes.push({p,kind:'rotor'});
  }
  return {boxes,sections,rotors,probes};
}
