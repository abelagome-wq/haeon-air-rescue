const TILE=16,N=128,EXTENT=1024,clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const index=(x,z)=>{const c=Math.floor((x+EXTENT)/TILE),r=Math.floor((z+EXTENT)/TILE);return c>=0&&r>=0&&c<N&&r<N?r*N+c:-1;};
const layered=code=>code>=63&&code<=66||code>=73&&code<=107;
const bridge=code=>code>=81&&code<=92||code===106||code===107;
const tunnel=code=>code>=63&&code<=66;

export {aircraftEnvelope} from './aircraft-envelope.js';

// Intersect a triangle with the rotor's thin slab, then measure the actual
// circular disk. Just sampling blade tips misses a cable through the disk.
function diskTriangle(tri,disk,radialAxis){
  const axis=disk.axis,first=axis==='y'?'x':'y',c=disk.center,plane=c[axis],half=disk.half??.11;
  let poly=[tri.a,tri.b,tri.c];
  for(const sign of [-1,1]){
    const out=[];
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length],da=(a[axis]-plane)*sign-half,db=(b[axis]-plane)*sign-half;
      if(da<=0)out.push(a);
      if((da<=0)!==(db<=0))out.push(a.clone().lerp(b,da/(da-db)));
    }
    poly=out;if(!poly.length)return false;
  }
  let positive=false,negative=false,area=0,nearest=Infinity;
  radialAxis.set(0,0,0);
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],ax=a[first]-c[first],az=a.z-c.z,bx=b[first]-c[first],bz=b.z-c.z;
    const dx=bx-ax,dz=bz-az,t=clamp(-(ax*dx+az*dz)/(dx*dx+dz*dz||1),0,1);
    const x=ax+t*dx,z=az+t*dz,distance=x*x+z*z;
    if(distance<nearest){nearest=distance;radialAxis[first]=-x;radialAxis.z=-z;}
    const cross=ax*bz-az*bx;positive||=cross>1e-8;negative||=cross< -1e-8;area+=cross;
  }
  if(Math.abs(area)>1e-8&&!(positive&&negative)){radialAxis.set(0,0,0);return true;}
  return nearest<=disk.radius**2;
}

// Test possible separating directions in the rotor/hull's local coordinates.
// A finite triangle can touch a blade tip or a box corner without touching
// the middle of the wall. Its infinite face plane alone can overstate depth.
function faceSeparation(T,tri,shape,isDisk,radialAxis,previousOffset,vertices){
  const center=isDisk?shape.center:shape.getCenter(new T.Vector3());
  const half=isDisk?null:shape.getSize(new T.Vector3()).multiplyScalar(.5);
  const normal=new T.Vector3(),axis=new T.Vector3(),edge=new T.Vector3();
  let depth=Infinity;
  function test(direction){
    if(depth<0)return;
    const length=direction.length();if(length<1e-9)return;
    direction.multiplyScalar(1/length);
    const a=direction.dot(tri.a),b=direction.dot(tri.b),c=direction.dot(tri.c);
    const low=Math.min(a,b,c),high=Math.max(a,b,c),middle=direction.dot(center);
    const axial=isDisk?direction[shape.axis]:0;
    const radius=isDisk?shape.radius*Math.sqrt(Math.max(0,1-axial*axial))+(shape.half??.11)*Math.abs(axial)
      :half.x*Math.abs(direction.x)+half.y*Math.abs(direction.y)+half.z*Math.abs(direction.z);
    let shapeLow=middle-radius,shapeHigh=middle+radius;
    if(isDisk&&shape.slices){
      shapeLow=Infinity;shapeHigh=-Infinity;
      const radial=Math.sqrt(Math.max(0,1-axial*axial)),vertical=Math.abs(axial);
      for(const slice of shape.slices){
        const mid=direction.dot(slice.center),extent=slice.radius*radial+slice.half*vertical;
        shapeLow=Math.min(shapeLow,mid-extent);shapeHigh=Math.max(shapeHigh,mid+extent);
      }
    }
    if(vertices){
      // Corners of the broad-phase box can lie well outside an oblique nose
      // or tail. Use the geometry's directional extents on each tested axis.
      let modelLow=Infinity,modelHigh=-Infinity;
      for(let i=0;i<vertices.length;i+=3){
        const value=direction.x*vertices[i]+direction.y*vertices[i+1]+direction.z*vertices[i+2];
        modelLow=Math.min(modelLow,value);modelHigh=Math.max(modelHigh,value);
      }
      shapeLow=Math.max(shapeLow,modelLow);shapeHigh=Math.min(shapeHigh,modelHigh);
    }
    const positive=high-shapeLow,negative=shapeHigh-low;
    if(positive < -1e-6 || negative < -1e-6){depth=-Infinity;return;}
    const previous=(shapeLow+shapeHigh)*.5+direction.dot(previousOffset);
    // Use the side occupied on the last clear pose when the trial point is
    // just beyond the middle of a two-sided face.
    const midpoint=(low+high)*.5;
    const outward=previous>midpoint+1e-8?1:previous<midpoint-1e-8?-1:positive<=negative?1:-1;
    const overlap=Math.max(0,outward===1?positive:negative);
    if(overlap<depth-1e-7){depth=overlap;normal.copy(direction).multiplyScalar(outward);}
  }
  test(tri.getNormal(axis));
  if(isDisk){
    axis.set(0,0,0);axis[shape.axis]=1;test(axis);
    test(axis.copy(radialAxis));
  }else{
    test(axis.set(1,0,0));test(axis.set(0,1,0));test(axis.set(0,0,1));
    for(const [a,b] of [[tri.a,tri.b],[tri.b,tri.c],[tri.c,tri.a]]){
      edge.subVectors(b,a);
      test(axis.set(0,edge.z,-edge.y));test(axis.set(-edge.z,0,edge.x));test(axis.set(edge.y,-edge.x,0));
    }
  }
  return depth<0?null:{normal,depth};
}

export function createFlightCollision(T,city,scene){
  const cells=new Map(),seenExtras=new Set(),actualRoads=new Set(),tmp=new T.Vector3(),tri=new T.Triangle();
  const lots=new Map(),seenBuildings=new Set();
  for(const p of city.flightScenery?[]:city.placements||[]){
    // Civic overlays supply a changing, detailed rooftop sampler. Ordinary
    // buildings use the same footprint and roof exposed by the city sampler.
    if(!Number.isFinite(p.x0)||[209,210,211].includes(p.code))continue;
    for(let row=p.row;row<p.row+p.h;row++)for(let col=p.col;col<p.col+p.w;col++)lots.set(row*N+col,p);
  }
  const mat=new T.Matrix4(),inv=new T.Matrix4(),quat=new T.Quaternion(),euler=new T.Euler(0,0,0,'YXZ'),unit=new T.Vector3(1,1,1);
  const pose=new T.Vector3(),worldBounds=new T.Box3(),localBounds=new T.Box3();
  const walkerBounds=new T.Box3(),rayBounds=new T.Box3(),ray=new T.Ray(),rayHit=new T.Vector3();
  const radialAxis=new T.Vector3(),previousOffset=new T.Vector3();
  let hull;
  function addTriangle(a,b,c,kind){
    if(kind==='structure'){
      const code=city.layers?.building[index((a.x+b.x+c.x)/3,(a.z+b.z+c.z)/3)];
      if(tunnel(code))kind='tunnel';
      else if([67,68,79,80].includes(code))kind='powerline';
      else if(bridge(code))kind='bridge';
    }
    const minX=Math.min(a.x,b.x,c.x),maxX=Math.max(a.x,b.x,c.x),minZ=Math.min(a.z,b.z,c.z),maxZ=Math.max(a.z,b.z,c.z);
    const item={a,b,c,kind,bounds:new T.Box3().setFromPoints([a,b,c]),
      id:'road-'+index((a.x+b.x+c.x)/3,(a.z+b.z+c.z)/3)};
    for(let r=clamp(Math.floor((minZ+EXTENT)/TILE),0,N-1);r<=clamp(Math.floor((maxZ+EXTENT)/TILE),0,N-1);r++)
      for(let col=clamp(Math.floor((minX+EXTENT)/TILE),0,N-1);col<=clamp(Math.floor((maxX+EXTENT)/TILE),0,N-1);col++){
        const id=r*N+col;if(!cells.has(id))cells.set(id,[]);cells.get(id).push(item);
      }
  }
  function readGeometry(g,m,kind,filter){
    const v=g.attributes.position,ids=g.index;
    for(let i=0;i<(ids?.count??v.count);i+=3){
      const ix=ids?ids.getX(i):i,iy=ids?ids.getX(i+1):i+1,iz=ids?ids.getX(i+2):i+2;
      if(filter&&!filter(v,ix,iy,iz))continue;
      const a=new T.Vector3().fromBufferAttribute(v,ix).applyMatrix4(m),b=new T.Vector3().fromBufferAttribute(v,iy).applyMatrix4(m),c=new T.Vector3().fromBufferAttribute(v,iz).applyMatrix4(m);
      addTriangle(a,b,c,kind);
      if(kind==='deck'){
        // road-surface.js draws a half-metre fascia along the edges. Close
        // the bottom of its physical slab even though it has no painted face.
        const x=(a.x+b.x+c.x)/3,z=(a.z+b.z+c.z)/3;
        const area=Math.abs((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x));
        if(area>.02&&(a.y+b.y+c.y)/3>city.groundAt(x,z)+1.2){
          const down=p=>new T.Vector3(p.x,p.y-.5,p.z);
          addTriangle(down(a),down(c),down(b),'soffit');
        }
      }
    }
  }
  // Match the rendered road kit, including its banked asphalt, actual pier
  // placement, trusses and tunnel portals regardless of the active visual LOD.
  scene?.traverse(o=>{
    if(!o.isMesh)return;
    o.updateWorldMatrix(true,false);
    if(o.name.startsWith('Original road structures ')){readGeometry(o.geometry,o.matrixWorld,'structure');return;}
    if(o.name==='Crossing rails and viaduct supports'&&o.isInstancedMesh){
      const transform=new T.Matrix4();
      for(let i=0;i<o.count;i++){o.getMatrixAt(i,transform);if(Math.abs(transform.elements[5])<1)continue;
        transform.premultiply(o.matrixWorld);readGeometry(o.geometry,transform,'pier');}
      return;
    }
    if(!/^Continuous roads \d+$/.test(o.name)||!city.layers)return;
    readGeometry(o.geometry,o.matrixWorld,'deck',(v,a,b,c)=>{
      const x=(v.getX(a)+v.getX(b)+v.getX(c))/3,z=(v.getZ(a)+v.getZ(b)+v.getZ(c))/3;
      const id=index(x,z),code=city.layers.building[id];if(!layered(code))return false;
      if(o.geometry.attributes.roadKind.getX(a)===3)return false;
      actualRoads.add(id);return true;
    });
  });
  function ensureExtra(id){
    if(id<0||seenExtras.has(id))return;seenExtras.add(id);
    const lot=lots.get(id);
    if(lot&&!seenBuildings.has(lot)){
      seenBuildings.add(lot);
      const low=lot.y-1,high=lot.roofY;
      const corners=[[lot.x0,lot.z0],[lot.x1,lot.z0],[lot.x1,lot.z1],[lot.x0,lot.z1]];
      for(let i=0;i<4;i++){
        const [x,z]=corners[i],[x1,z1]=corners[(i+1)%4];
        const a=new T.Vector3(x,low,z),b=new T.Vector3(x1,low,z1),c=new T.Vector3(x1,high,z1),d=new T.Vector3(x,high,z);
        addTriangle(a,b,c,'building');addTriangle(a,c,d,'building');
      }
    }
    if(city.flightScenery)return;
    const code=city.layers?.building[id];
    // These network objects are rendered by the ordinary city batches, rather
    // than the road-fixture pass: power wires, rail bridges and the open leaf.
    if(!(code>=14&&code<=28||code===89||code>=90&&code<=92))return;
    const g=city.flightMeshFor?.(code);if(!g)return;
    const col=id%128,row=id>>7,x=col*TILE-EXTENT+8,z=row*TILE-EXTENT+8;
    let y=city.groundAt(x,z)+.025,sy=1;
    if(bridge(code))y=Math.max(city.groundAt(x,z),city.layers.water[id]*4)+.015;
    else if(code>=16&&code<=19){const corners=[[-8,-8],[8,-8],[-8,8],[8,8]].map(([a,b])=>city.groundAt(x+a,z+b));y=Math.min(...corners)+.035;sy=(Math.max(...corners)-Math.min(...corners))/8||1;}
    const swap=new T.Matrix4().set(0,0,1,0,0,sy,0,0,1,0,0,0,0,0,0,1);
    if(bridge(code)&&city.layers.flags[id]&2)swap.premultiply(new T.Matrix4().makeRotationY(-Math.PI/2));
    swap.setPosition(x,y,z);readGeometry(g,swap,code<=28?'powerline':'structure');
  }
  function floorAt(x,z,y=Infinity){
    const tile=city.tileAt?.(x,z),code=tile?.building;
    const roof=city.flightScenery?city.flightScenery.floorAt(x,z,y+.10):city.roofAt?.(x,z)??-Infinity;
    if(!layered(code))return Math.max(city.surfaceAt?.(x,z)??city.groundAt(x,z),roof);
    const id=index(x,z);ensureExtra(id);
    let floor=Math.max(tunnel(code)?tile.roadY??tile.groundY:tile.groundY,tile.waterY??-Infinity,roof);
    for(const f of cells.get(id)||[]){
      if(f.kind==='powerline'||f.kind==='pier'||f.kind==='soffit'||f.bounds.min.y>y+.10||f.bounds.max.y<=floor)continue;
      const a=f.a,b=f.b,c=f.c,dx=b.x-a.x,dz=b.z-a.z,ex=c.x-a.x,ez=c.z-a.z,det=dx*ez-dz*ex;
      if(Math.abs(det)<.05)continue;
      const u=((x-a.x)*ez-(z-a.z)*ex)/det,v=(dx*(z-a.z)-dz*(x-a.x))/det;
      if(u<-.0001||v<-.0001||u+v>1.0001)continue;
      const h=a.y+u*(b.y-a.y)+v*(c.y-a.y);if(h<=y+.10)floor=Math.max(floor,h);
    }
    // Samplers without a rendered road mesh (e.g. a headless city) still
    // distinguish a deck from the water beneath it.
    if(!actualRoads.has(id)&&code!==89&&tile.roadY<=y+.10&&tile.roadY!=null){
      const ports=city.networkPorts?.(code,tile.rotate)||[];
      const offset=ports.includes('E')||ports.includes('W')?Math.abs(z-tile.z):Math.abs(x-tile.x);
      if(offset<=(bridge(code)?4.5:5.7))floor=Math.max(floor,tile.roadY);
    }
    return floor;
  }
  function setEnvelope(envelope){
    hull=envelope;localBounds.makeEmpty();
    for(const box of hull.boxes)localBounds.union(box);
    for(const probe of hull.probes)localBounds.expandByPoint(probe.p);
    for(const rotor of hull.rotors)for(const d of rotor.slices??[rotor]){
      const ext=new T.Vector3(d.radius,d.radius,d.radius);ext[d.axis]=d.half??.11;
      localBounds.expandByPoint(tmp.copy(d.center).sub(ext));
      localBounds.expandByPoint(tmp.copy(d.center).add(ext));
    }
  }
  function setPose(x,y,z,heading,pitch,bank){
    pose.set(x,y,z);quat.setFromEuler(euler.set(pitch,Math.PI-heading,bank,'YXZ'));
    mat.compose(pose,quat,unit);inv.copy(mat).invert();worldBounds.copy(localBounds).applyMatrix4(mat);
  }
  function hitTriangle(rpm,record,kind,colliderId,motion){
    function hit(shape,isDisk,vertices){
      const response=faceSeparation(T,tri,shape,isDisk,radialAxis,previousOffset,vertices);
      if(!response)return;
      response.normal.applyQuaternion(quat);
      record({...response,part:isDisk?'rotor':'airframe',kind,colliderId,...motion});
    }
    if(rpm>=.12)for(const rotor of hull.rotors){
      if((rotor.slices??[rotor]).some(d=>diskTriangle(tri,d,radialAxis)))hit(rotor,true);
    }
    for(let i=0;i<hull.boxes.length;i++){
      const box=hull.boxes[i];if(box.intersectsTriangle(tri))hit(box,false,hull.sections?.[i]);
    }
  }
  function movingContacts(actors,rpm,record){
    for(const actor of actors||[]){
      const body=actor.body;
      if(!body||!(actor.active??body.visible)||body.position.distanceToSquared(pose)>35**2)continue;
      body.updateWorldMatrix(true,true);
      const speed=actor.speed??0,yaw=body.rotation.y,pitch=body.rotation.x;
      const motion={vx:speed*Math.cos(pitch)*Math.sin(yaw),vy:-speed*Math.sin(pitch),vz:speed*Math.cos(pitch)*Math.cos(yaw)};
      (actor.collisionMesh??body).traverse(o=>{
        if(!o.isMesh)return;
        const g=o.geometry;if(!g.boundingBox)g.computeBoundingBox();const bounds=g.boundingBox.clone().applyMatrix4(o.matrixWorld);
        if(!worldBounds.intersectsBox(bounds))return;
        const m=new T.Matrix4().multiplyMatrices(inv,o.matrixWorld),v=g.attributes.position,ids=g.index;
        for(let i=0;i<(ids?.count??v.count);i+=3){
          for(const [j,p] of [[0,tri.a],[1,tri.b],[2,tri.c]])p.fromBufferAttribute(v,ids?ids.getX(i+j):i+j).applyMatrix4(m);
          hitTriangle(rpm,record,actor.kind,body.uuid,motion);
        }
      });
    }
  }
  function groundHeight(x,z){
    return tunnel(city.layers?.building[index(x,z)])?city.tileAt(x,z).roadY??city.groundAt(x,z):city.groundAt(x,z);
  }
  function samplerHeight(x,z){
    return Math.max(groundHeight(x,z),city.flightScenery?-Infinity:city.roofAt?.(x,z)??-Infinity);
  }
  function heightResponse(p,top,previousPosition){
    const s=.20;
    let x=p.x,z=p.z;
    if(previousPosition){
      const px=p.x+previousPosition.x-pose.x,pz=p.z+previousPosition.z-pose.z;
      const travel=Math.hypot(px-x,pz-z),previousHeight=samplerHeight(px,pz);
      if(travel>1e-6 && previousHeight<=p.y+.05 && top-previousHeight>travel*4){
        // The entire end probe may already be on a raised plateau. Sample the
        // normal at the boundary the swept step crossed, rather than its top.
        let outside=0,inside=1;
        for(let i=0;i<10;i++){
          const t=(outside+inside)*.5;
          if(samplerHeight(px+(x-px)*t,pz+(z-pz)*t)>p.y+.05)inside=t;else outside=t;
        }
        x=px+(x-px)*outside;z=pz+(z-pz)*outside;
      }
    }
    const dx=(samplerHeight(x+s,z)-samplerHeight(x-s,z))/(2*s);
    const dz=(samplerHeight(x,z+s)-samplerHeight(x,z-s))/(2*s);
    const normal=new T.Vector3(-dx,1,-dz).normalize();
    // A headless pillar/cliff sampler steps abruptly in height. Find its
    // horizontal boundary instead of kicking the aircraft up the roof.
    if(Math.hypot(dx,dz)>4){
      const lateral=normal.clone();lateral.y=0;lateral.normalize();
      if(x!==p.x||z!==p.z)return {normal:lateral,depth:Math.max(0,(x-p.x)*lateral.x+(z-p.z)*lateral.z)};
      let near=0,far=s*2;
      if(samplerHeight(p.x+lateral.x*far,p.z+lateral.z*far)<=p.y+.05){
        for(let i=0;i<8;i++){
          const mid=(near+far)*.5;
          if(samplerHeight(p.x+lateral.x*mid,p.z+lateral.z*mid)>p.y+.05)near=mid;else far=mid;
        }
        return {normal:lateral,depth:far};
      }
    }
    return {normal,depth:Math.max(0,(top-p.y-.05)*normal.y)};
  }
  function contact(rpm,actors,previousPosition){
    if(!hull)return null;
    previousOffset.set(0,0,0);
    if(previousPosition)previousOffset.copy(previousPosition).applyMatrix4(inv);
    const planes=[];
    function record(hit){
      const i=planes.findIndex(p=>p.normal.dot(hit.normal)>.9995);
      if(i<0)planes.push(hit);
      else if(hit.depth>planes[i].depth)planes[i]=hit;
    }
    // Actual city geometry is queried below. Headless samplers that expose only
    // a height field still participate in the same flight integrator.
    for(const probe of hull.probes){
      if(probe.kind==='rotor'&&rpm<.12)continue;tmp.copy(probe.p).applyMatrix4(mat);
      const obstacle=city.flightScenery?-Infinity:city.roofAt?.(tmp.x,tmp.z)??-Infinity;
      const ground=groundHeight(tmp.x,tmp.z);
      const top=Math.max(ground,obstacle);
      if(top>tmp.y+.05){
        const kind=obstacle>ground?'building':'terrain';
        record({...heightResponse(tmp,top,previousPosition),part:probe.kind,kind,colliderId:'height-'+index(tmp.x,tmp.z)});
      }
    }
    movingContacts(actors,rpm,record);
    visitSolids(worldBounds,(face,kind,colliderId)=>{
      if(Math.max(face.a.y,face.b.y,face.c.y)<=pose.y+.09)return null;
      tri.copy(face);tri.a.applyMatrix4(inv);tri.b.applyMatrix4(inv);tri.c.applyMatrix4(inv);
      hitTriangle(rpm,record,kind,colliderId);
    });
    if(!planes.length)return null;
    planes.sort((a,b)=>b.depth-a.depth);
    const primary=planes[0];
    if(planes.length===1)return {...primary,planes};
    if(planes.length===2){
      const [a,b]=planes,cosine=a.normal.dot(b.normal);
      if(a.depth*cosine>=b.depth)return {...primary,planes};
      if(cosine>-.99999){
        const alongB=(b.depth-a.depth*cosine)/(1-cosine*cosine);
        const v=a.normal.clone().multiplyScalar(a.depth-alongB*cosine).addScaledVector(b.normal,alongB);
        const depth=v.length();
        if(depth>1e-8)return {...primary,planes,depth,normal:v.multiplyScalar(1/depth)};
      }
    }
    // Project the release displacement onto every distinct contact plane.
    // This makes one correction clear both faces of an inside corner.
    const correction=new T.Vector3();
    for(let i=0;i<6;i++){
      let changed=false;
      for(const p of planes){
        const excess=p.depth-p.normal.dot(correction);
        if(excess>.0001){correction.addScaledVector(p.normal,excess);changed=true;}
      }
      if(!changed)break;
    }
    const depth=correction.length();
    return {...primary,planes,depth,normal:depth>1e-8?correction.multiplyScalar(1/depth):primary.normal};
  }
  const roadFace=new T.Triangle();
  function visitSolids(bounds,visit){
    const obstacle=city.flightScenery?.visit(bounds,visit);
    if(obstacle||!city.layers)return obstacle??null;
    const found=new Set();
    const col0=clamp(Math.floor((bounds.min.x+EXTENT)/16),0,127),col1=clamp(Math.floor((bounds.max.x+EXTENT)/16),0,127);
    const row0=clamp(Math.floor((bounds.min.z+EXTENT)/16),0,127),row1=clamp(Math.floor((bounds.max.z+EXTENT)/16),0,127);
    for(let row=row0;row<=row1;row++)for(let col=col0;col<=col1;col++)ensureExtra(row*128+col);
    for(let row=row0;row<=row1;row++)for(let col=col0;col<=col1;col++)for(const f of cells.get(row*128+col)||[]){
      if(found.has(f)||!f.bounds.intersectsBox(bounds))continue;found.add(f);
      roadFace.set(f.a,f.b,f.c);const result=visit(roadFace,f.kind,f.id);if(result)return result;
    }
    return null;
  }
  function blocksWalker(x,baseY,z,radius=.28,height=1.65){
    walkerBounds.min.set(x-radius,baseY+.20,z-radius);
    walkerBounds.max.set(x+radius,baseY+height,z+radius);
    if(!city.flightScenery){
      const roof=city.roofAt?.(x,z)??-Infinity;
      if(roof>baseY+.50)return true;
    }
    return !!visitSolids(walkerBounds,face=>walkerBounds.intersectsTriangle(face));
  }
  function cameraRange(start,end,clearance=.35){
    ray.origin.copy(start);ray.direction.subVectors(end,start);
    const length=ray.direction.length();if(length<.001)return 1;
    ray.direction.multiplyScalar(1/length);
    rayBounds.makeEmpty().expandByPoint(start).expandByPoint(end);
    let nearest=length;
    visitSolids(rayBounds,face=>{
      if(ray.intersectTriangle(face.a,face.b,face.c,false,rayHit)){
        const distance=rayHit.distanceTo(start);
        if(distance>.01&&distance<=length)nearest=Math.min(nearest,Math.max(0,distance-clearance));
      }
    });
    return nearest/length;
  }
  function contactAt(point,radius,rpm){
    if(!hull||!point)return null;tmp.copy(point).applyMatrix4(inv);
    if(rpm>=.12)for(const rotor of hull.rotors)for(const d of rotor.slices??[rotor]){
      const c=d.center,ax=d.axis,distance=Math.hypot(tmp[ax==='y'?'x':'y']-c[ax==='y'?'x':'y'],tmp.z-c.z);
      if(Math.abs(tmp[ax]-c[ax])<=radius+(d.half??.11)&&distance<=d.radius+radius)return {part:'rotor',speed:rpm*d.omega*Math.min(distance+radius,d.radius)};
    }
    return hull.boxes.some(b=>b.distanceToPoint(tmp)<=radius)?{part:'airframe',speed:0}:null;
  }
  return {floorAt,setEnvelope,setPose,contact,contactAt,blocksWalker,cameraRange};
}
