import {mergeGeometries} from '../vendor/three/addons/utils/BufferGeometryUtils.js';

// +Z points forward in the fleet GLBs. Offsets are metres from the pilot's
// seat. The inboard end of each bracket sits on the actual cabin surface.
const stations = {
  megaphone:{side:-1, height:-.18, forward:.13},
  harness:{side:1, height:.40, forward:-.68},
  cannon:{side:1, height:-.24, forward:.25},
  gas:{side:-1, height:-.20, forward:-.68},
};

const steel=0x647078, rubber=0x293136, zinc=0xc7c9c0, safetyYellow=0xd59d35;
const straight=Math.PI/2;

function makeAccessory(T,id) {
  const pieces=[];
  function piece(geometry,color,x,y,z,tilt=0) {
    geometry.rotateX(tilt);
    geometry.translate(x,y,z);
    const paint=new T.Color(color);
    const rgb=new Float32Array(geometry.attributes.position.count*3);
    for(let i=0;i<rgb.length;i+=3)paint.toArray(rgb,i);
    geometry.setAttribute('color',new T.BufferAttribute(rgb,3));
    pieces.push(geometry);
  }
  const box=(color,x,y,z,w,h,d)=>piece(new T.BoxGeometry(w,h,d),color,x,y,z);
  const tube=(color,x,y,z,front,rear,length,tilt=straight)=>
    piece(new T.CylinderGeometry(front,rear,length,12),color,x,y,z,tilt);

  box(steel,.095,0,0,.25,.085,.15);
  if(id==='megaphone'){
    tube(rubber,.24,-.06,-.16,.075,.062,.13);
    // Turn the outer and inner horn profiles in one piece; the dark driver is
    // recessed inside the flared mouth.
    const horn=[[.062,-.15],[.080,-.09],[.123,.018],[.17,.115],[.173,.135],
      [.155,.135],[.113,.038],[.054,-.067]].map(([radius,axial])=>new T.Vector2(radius,axial));
    piece(new T.LatheGeometry(horn,16),zinc,.24,-.06,.025,straight+.15);
    tube(rubber,.24,-.06,-.040,.055,.052,.016);
  }else if(id==='harness'){
    box(steel,.22,.01,0,.33,.095,.19);
    tube(safetyYellow,.38,-.03,0,.148,.148,.34);
    for(const z of [-.155,.155])tube(rubber,.38,-.03,z,.153,.153,.047);
    box(steel,.38,-.22,0,.09,.15,.087);
    piece(new T.TorusGeometry(.061,.016,6,14,Math.PI*1.65),safetyYellow,.38,-.33,0);
  }else if(id==='cannon'){
    box(steel,.235,-.065,-.10,.19,.16,.14);
    tube(steel,.27,-.14,.03,.077,.09,.48);
    tube(zinc,.27,-.14,.29,.052,.085,.13);
    tube(rubber,.27,-.14,.362,.060,.060,.035);
    tube(0x101b20,.27,-.14,.382,.038,.038,.01);
  }else if(id==='gas'){
    box(steel,.24,-.08,-.075,.25,.135,.31);
    for(const [x,y] of [[.17,-.12],[.31,-.12],[.24,-.015]]){
      tube(0x5d6862,x,y,.05,.067,.067,.40);
      tube(zinc,x,y,.252,.069,.069,.026);
      tube(0x182222,x,y,.268,.050,.050,.008);
    }
  }
  // One draw per mounted accessory, even on the three-tube launcher.
  const merged=mergeGeometries(pieces);
  pieces.forEach(g=>g.dispose());
  return merged;
}

export function createExteriorAddons(T,model,spec) {
  const root=new T.Group();
  root.name='Mounted mission equipment';
  const parts=new Map();
  const material=new T.MeshStandardMaterial({vertexColors:true,roughness:.65,metalness:.28,side:T.DoubleSide});
  model.updateWorldMatrix(true,true);
  const airframe=[];
  function collect(node){
    if(node.name==='MainRotor'||node.name===spec.tail)return;
    if(node.isMesh)airframe.push(node);
    for(const child of node.children)collect(child);
  }
  collect(model);
  model.add(root);

  const [,seatY,seatZ]=spec.pilot;
  function mount(id){
    const {side,height,forward}=stations[id];
    const y=seatY+height, z=seatZ+forward;
    // Test against the rendered surface at this station. The wide helicopter
    // door, tandem cockpit and crane cab each put the bracket at a different X.
    model.updateWorldMatrix(true,true);
    const origin=model.localToWorld(new T.Vector3(side*spec.diameter,y,z));
    const direction=model.localToWorld(new T.Vector3(0,y,z)).sub(origin).normalize();
    const hits=new T.Raycaster(origin,direction).intersectObjects(airframe,false);
    const hit=hits.length?model.worldToLocal(hits[0].point):null;
    const x=hit && hit.x*side>0 ? hit.x : side*Math.max(.65,Math.abs(spec.pilot[0])*2);
    const mesh=new T.Mesh(makeAccessory(T,id),material);
    mesh.name=id;mesh.position.set(x,y,z);mesh.scale.x=side;
    mesh.castShadow=mesh.receiveShadow=true;
    root.add(mesh);parts.set(id,mesh);
    return mesh;
  }
  return {
    setFit(fit){
      for(const id of Object.keys(stations)){
        const equipped=fit?.mounted[id]===id;
        const part=parts.get(id)??(equipped?mount(id):null);
        if(part)part.visible=equipped;
      }
    },
    dispose(){
      root.removeFromParent();
      for(const part of parts.values())part.geometry.dispose();
      root.clear();parts.clear();material.dispose();
    },
  };
}
