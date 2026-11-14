// Street plantings occupy verges beside developed parcels. Crossings, access
// to rescue stations and the departure apron stay clear at every city size.
export function planAvenueTrees(city){
  if(!city.generated)return [];
  const trees=[],stations=city.landmarks.filter(p=>['airport','hospital','fire','police'].includes(p.kind));
  for(const r of city.roads){
    if(r.code!==29&&r.code!==30||r.neighbors.length!==2)continue;
    const ns=city.networkPorts(r.code,false,'road').includes('N');
    const street=ns?r.col:r.row,along=ns?r.row:r.col;
    const hash=((r.col*73856093)^(r.row*19349663))>>>0;
    if(Math.hypot(r.x-city.spawn.x,r.z-city.spawn.z)<37)continue;
    if(stations.some(p=>Math.abs(r.x-p.x)<p.widthM*.5+18&&Math.abs(r.z-p.z)<p.depthM*.5+18))continue;
    for(const side of [-1,1]){
      const neighbor=city.tileAt(r.x+(ns?side*16:0),r.z+(ns?0:side*16));
      if(!neighbor||neighbor.water||neighbor.rail||neighbor.building<112||neighbor.building>=198)continue;
      const cadence=neighbor.zone===3||neighbor.zone===4?2:neighbor.zone>=5?5:2+(street&1);
      if((along+street+(side>0?1:0))%cadence)continue;
      if((along+street)%4===0&&side===((((along+street)>>2)&1)?1:-1))continue;
      const x=r.x+(ns?side*7.4:0),z=r.z+(ns?0:side*7.4);
      if(![[0,0],[2.6,0],[-2.6,0],[0,2.6],[0,-2.6]].every(([dx,dz])=>{
        const t=city.tileAt(x+dx,z+dz);
        return t&&!t.water&&!t.rail&&!city.obstacleAt(x+dx,z+dz);
      }))continue;
      trees.push({x,z,y:city.surfaceAt(x,z),angle:(hash%8)*Math.PI/4,scale:.84+.1*((hash>>>5)%4),
        narrow:(street+(ns?3:1))%3===0});
    }
  }
  return trees;
}

// A single indexed mesh contains the limbs and asymmetric crown lobes.
// Each street uses a consistent tree habit, with a few repeatable sizes.
function avenueTreeGeometry(T,narrow){
  const positions=[],normals=[],colors=[],uv=[],leaf=[],indices=[];
  function append(part,matrix,tint,foliage){
    part.applyMatrix4(matrix);
    const a=part.attributes,start=positions.length/3;
    positions.push(...a.position.array);normals.push(...a.normal.array);
    for(let i=0;i<a.position.count;i++){
      const shade=foliage?.79+.21*Math.min(1,Math.max(0,(a.position.getY(i)-3)*.24)):1;
      colors.push(tint[0]*shade,tint[1]*shade,tint[2]*shade);
      uv.push(a.uv.getX(i)*4.5,a.uv.getY(i)*2.2);leaf.push(foliage?1:0);
    }
    for(const k of part.index.array)indices.push(start+k);
    part.dispose();
  }
  const up=new T.Vector3(0,1,0);
  function limb(from,to,lower,upper){
    const a=new T.Vector3(...from),b=new T.Vector3(...to),axis=b.clone().sub(a);
    const m=new T.Matrix4().compose(a.clone().lerp(b,.5),new T.Quaternion().setFromUnitVectors(up,axis.clone().normalize()),new T.Vector3(1,1,1));
    append(new T.CylinderGeometry(upper,lower,axis.length(),6,1,false),m,[.19,.13,.082],false);
  }
  function lobe(x,y,z,rx,ry,rz,seed){
    const s=new T.SphereGeometry(1,9,6),p=s.attributes.position;
    for(let i=0;i<p.count;i++){
      const a=p.getX(i),b=p.getY(i),c=p.getZ(i);
      const r=1+.075*Math.sin(a*7+c*4+seed)*Math.cos(b*6-c*3+seed);
      p.setXYZ(i,a*r,b*r,c*r);
    }
    const m=new T.Matrix4().makeScale(rx,ry,rz).setPosition(x,y,z);
    append(s,m,narrow?[.75,.93,.58]:[.84,.98,.67],true);
  }
  limb([0,0,0],[.05,3.35,-.02],.17,.095);
  const spread=narrow?1.22:1.87;
  for(let i=0;i<5;i++){
    const angle=i*2.39996+.35,x=Math.cos(angle)*spread*.64,z=Math.sin(angle)*spread*.63;
    const y=3.55+.23*i;
    limb([.04,1.7+.22*(i%2),0],[x,y+.26,z],.09,.034);
    lobe(x,y+.72,z,spread*.76,1.38+(narrow?.4:0),spread*.76,i+2.3);
  }
  lobe(.10,narrow?5.75:5.42,-.15,spread*.79,narrow?1.7:1.34,spread*.84,7.1);
  const geo=new T.BufferGeometry();
  geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  geo.setAttribute('normal',new T.Float32BufferAttribute(normals,3));
  geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  geo.setAttribute('avenueLeaf',new T.Float32BufferAttribute(leaf,1));geo.setIndex(indices);
  geo.computeBoundingSphere();return geo;
}

export async function addAvenueTrees(T,city,group,owned){
  const rows=planAvenueTrees(city);
  if(!rows.length)return;
  const map=await new T.TextureLoader().loadAsync(new URL('../art/streetscape/Zelkova-Foliage.webp',import.meta.url).href);
  map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.MirroredRepeatWrapping;map.anisotropy=4;
  const mat=new T.MeshLambertMaterial({map,vertexColors:true});
  mat.onBeforeCompile=s=>{
    s.vertexShader='attribute float avenueLeaf; varying float vLeaf;\n'+s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvLeaf=avenueLeaf;');
    s.fragmentShader='varying float vLeaf;\n'+s.fragmentShader.replace('#include <map_fragment>',
      'vec3 grain=texture2D(map,vMapUv).rgb; diffuseColor.rgb*=mix(vec3(1.),vec3(.042,.068,.029)+grain*1.18,vLeaf);');
  };
  mat.customProgramCacheKey=()=>'avenue-crown-v1';
  const shapes=[avenueTreeGeometry(T,false),avenueTreeGeometry(T,true)];
  owned.push(map,mat,...shapes);
  const sectors=new Map(),pose=new T.Object3D();
  for(const row of rows){
    const shape=shapes[Number(row.narrow)],key=Math.floor((row.x+1024)/512)+4*Math.floor((row.z+1024)/512)+16*Number(row.narrow);
    if(!sectors.has(key))sectors.set(key,{shape,instances:[]});
    pose.position.set(row.x,row.y-.025,row.z);pose.rotation.y=row.angle;pose.scale.setScalar(row.scale);pose.updateMatrix();
    const matrix=pose.matrix.clone();sectors.get(key).instances.push(matrix);
    city.flightScenery.add(shape,matrix,'tree');
  }
  for(const {shape,instances} of sectors.values()){
    const mesh=new T.InstancedMesh(shape,mat,instances.length);
    instances.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.computeBoundingSphere();
    mesh.name='Planted avenue crowns';mesh.castShadow=mesh.receiveShadow=true;
    group.add(mesh);owned.push(mesh);
  }
}
