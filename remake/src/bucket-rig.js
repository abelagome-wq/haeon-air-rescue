// The crown, rim and outlet are in the original SIM3D2 BUCKET model's metre
// coordinates. 32REF gives about 50 ft from helicopter to load at full payout.
const MODEL = 'remake/art/equipment/Fire-Bucket.glb';
const VALVE_Y = -1.455, LIP_Y = -.598, FLOOR_Y = -1.430;
const MAX_LINE = 15.24 + VALVE_Y;
const HOOK_Y = {SCWZR300:.64, JETRANG:.74, HUGH500:.56, MD520:.56, BELL212:.79,
  AGUSTA:.89, DAUPHIN:.95, MDEXPLRR:.75, APACHE:.90,
  GARAM:.51,GIRIN:2.98,NOEUL:.94,HEUKSON:1.09,GYEOPNAL:.93,BYEOL:.82,
  MARU:.68,DURUM:.88,DUSOL:1.03,HAEMOR:.91,SANBI:1.04};
// Fixed tank rails sit on the fuselage skin. The crane cargo hook hangs 6 cm
// below its beam and the two legacy twin-engine winches sit inside the skin.
const TANK_RAIL_Y = {...HOOK_Y,AGUSTA:.60,DAUPHIN:.69,GIRIN:3.04};
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function sampleSurface(city, x, z, ceiling) {
  const tile = city.tileAt?.(x,z);
  const level = Number.isFinite(tile?.waterY) ? tile.waterY : null;
  const solid = city.flightScenery?.floorAt(x,z,ceiling) ?? city.roofAt?.(x,z) ?? -Infinity;
  let floor = tile?.groundY ?? city.groundAt?.(x,z) ?? city.surfaceAt?.(x,z) ?? 0;
  for (const y of [tile?.roadY, tile?.railY, solid]) {
    if (Number.isFinite(y) && y <= ceiling + .02) floor = Math.max(floor,y);
  }
  return {floor, level};
}

export function createBucketRig(ctx, city, flight) {
  const T = ctx.THREE, scene = ctx.scene, root = new T.Group(), body = new T.Group();
  root.name = 'Fire bucket and winch'; body.name = 'Suspended fire bucket';
  root.visible = false; root.add(body); scene?.add(root);
  const owned = [], own = resource => (owned.push(resource),resource);
  const cable = new T.Mesh(own(new T.CylinderGeometry(.032,.032,1,8)),
    own(new T.MeshStandardMaterial({color:0xe4ca80, metalness:0, roughness:.72})));
  cable.name = 'Winch line'; root.add(cable);
  const water = new T.Mesh(own(new T.CircleGeometry(1,6)),
    own(new T.MeshStandardMaterial({color:0x358c96,roughness:.18,metalness:.18,side:T.DoubleSide})));
  water.name = 'Bucket water surface'; water.rotation.x = -Math.PI/2; body.add(water);
  const valve = new T.Mesh(own(new T.CylinderGeometry(.184,.184,.028,12)),
    own(new T.MeshStandardMaterial({color:0x333e36,roughness:.8})));
  valve.name = 'Bottom dump valve'; body.add(valve);

  let ready = null, disposed = false;
  function load() {
    if (ready || !scene) return;
    ready = Promise.resolve().then(() => ctx.assets.load(MODEL)).then(template => {
      if (disposed) return;
      const model = template.clone(true);
      model.traverse(part => {if (part.isMesh) {part.castShadow=true;part.receiveShadow=true;}});
      body.add(model);
    }).catch(() => {
      // If the asset request fails, retain an open bucket and a visible bail.
      if (disposed) return;
      const shell = new T.Mesh(own(new T.CylinderGeometry(.658,.429,LIP_Y-FLOOR_Y,6,1,true)),
        own(new T.MeshStandardMaterial({color:0xe36831,roughness:.77,side:T.DoubleSide})));
      shell.position.y=(LIP_Y+FLOOR_Y)/2;
      const bail = new T.Mesh(own(new T.TorusGeometry(.60,.032,6,18,Math.PI)),cable.material);
      bail.position.y=LIP_Y;body.add(shell,bail);
    });
  }

  let extension=0, equipped=false, deployed=false, touching=false, initialized=false;
  let tank=null,intakePipe=null,tankMode=false;
  let dx=0, dz=0, swingVx=0, swingVz=0, lastVx=0, lastVz=0, fraction=0, flowing=false;
  const up = new T.Vector3(0,1,0), hook = new T.Vector3(), previousHook = new T.Vector3();
  const outlet = new T.Vector3(), previousOutlet = new T.Vector3(), velocity = new T.Vector3();
  const direction = new T.Vector3(), rimPoint = new T.Vector3(), inlet = new T.Vector3(), ring = body.position;
  const lipCorners = Array.from({length:6},(_,i)=>new T.Vector3(
    .65845*Math.cos(i*Math.PI/3),LIP_Y,.65845*Math.sin(i*Math.PI/3)));

  function fixedTank() {
    const group=new T.Group();
    group.name='Belly water tank';
    const shell=own(new T.MeshStandardMaterial({color:0xd07528,roughness:.6}));
    const bands=own(new T.MeshStandardMaterial({color:0x343e42,roughness:.68}));
    function piece(geometry,material,x,y,z) {
      const mesh=new T.Mesh(own(geometry),material);mesh.position.set(x,y,z);
      mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);return mesh;
    }
    // At scale 1 the 0.55 x 0.18 x 0.58 m ellipsoid holds about 240 L.
    piece(new T.SphereGeometry(1,24,12),shell,0,-.18,0).scale.set(.55,.18,.58);
    for(const z of [-.28,.28]){
      piece(new T.BoxGeometry(.77,.08,.10),bands,0,-.04,z);
    }
    intakePipe=piece(new T.CylinderGeometry(.045,.06,1,8),bands,.32,-.18,-.18);
    intakePipe.name='Tank intake hose';root.add(group);return group;
  }

  function updateTank(dt,size,railY) {
    tank??=fixedTank();
    tank.visible=flight.state.cameraId!=='drop';
    // Low-slung cabins use a shallower, longer tank with the same capacity.
    // Keep its valve above the ground even with the largest module installed.
    const heightScale=Math.min(size,(railY-.065)/.36);
    tank.scale.set(size,heightScale,size*size/heightScale);
    tank.position.copy(hook);
    if(flight.object)tank.quaternion.copy(flight.object.quaternion);
    tank.updateMatrixWorld(true);
    outlet.set(0,-.36,0);tank.localToWorld(outlet);
    inlet.set(.32,-.18,-.18);tank.localToWorld(inlet);
    direction.set(0,-1,0).applyQuaternion(tank.quaternion);
    // Each snorkel is cut to its aircraft's landing-gear height. Retract on
    // land and limit travel against the bed in shallow water. The visible tip
    // and the sampled water contact always use the same endpoint.
    const reach=railY+.90-.18*heightScale;
    rimPoint.copy(inlet).addScaledVector(direction,reach);
    const surface=sampleSurface(city,rimPoint.x,rimPoint.z,hook.y+.08);
    const openWater=surface.level!==null&&surface.floor<surface.level;
    const headroom=Math.max(0,inlet.y-surface.floor-.025)/Math.max(.1,-direction.y);
    const length=Math.min(headroom,openWater&&!flight.state.grounded?reach:.065);
    intakePipe.scale.y=length/heightScale;intakePipe.position.y=-.18-intakePipe.scale.y/2;
    inlet.addScaledVector(direction,length);
    const contact=sampleSurface(city,inlet.x,inlet.z,hook.y+.08);
    touching=contact.level!==null&&contact.floor<contact.level&&inlet.y<=contact.level+.01&&inlet.y>=contact.floor;
    if(initialized&&dt>0&&hook.distanceTo(previousHook)<Math.max(10,135*dt))
      velocity.subVectors(outlet,previousOutlet).multiplyScalar(1/dt);
    else velocity.set(0,0,0);
    previousHook.copy(hook);previousOutlet.copy(outlet);initialized=true;
  }

  function setContents(value, releasing=false) {
    fraction=clamp(Number(value)||0,0,1);
    flowing=releasing && fraction>0;
    water.visible=fraction>.0001;
    // Horizontal cross sections are similar hexagons. Use the frustum volume
    // so the changing waterline represents the same volume as the gauge.
    const low=.40, high=.615;
    const radius = Math.cbrt(low**3+(high**3-low**3)*fraction);
    water.scale.set(radius,radius,1);
    water.position.y=FLOOR_Y+.046+(LIP_Y-FLOOR_Y-.085)*(radius-low)/(high-low);
    valve.rotation.z=flowing?1.15:0;
    valve.position.set(flowing?.13:0,VALVE_Y-(flowing?.14:0),0);
  }

  function update(elapsed, options={}) {
    equipped=!!options.equipped;
    const fixed=options.kind==='tank';
    if(tankMode!==fixed){initialized=false;extension=0;dx=dz=swingVx=swingVz=lastVx=lastVz=0;}
    tankMode=fixed;
    deployed=equipped && !fixed && !!options.deployed;
    root.visible=equipped;
    body.visible=!fixed;
    if(tank)tank.visible=false;
    setContents(options.waterFraction??fraction, options.dispensing??false);
    if (!equipped) {
      touching=false;initialized=false;extension=0;dx=dz=swingVx=swingVz=lastVx=lastVz=0;
      velocity.set(0,0,0);return;
    }
    const railY=(fixed?TANK_RAIL_Y:HOOK_Y)[flight.state.id]??.64;
    hook.set(0,railY,0);
    if (flight.object) flight.object.localToWorld(hook);
    else hook.add(flight.position);
    const dt=clamp(Number(elapsed)||0,0,1);
    const size=options.sizeScale??1;
    if(fixed){cable.visible=false;updateTank(dt,size,railY);return;}
    load();
    const reset=!initialized || hook.distanceToSquared(previousHook)>Math.max(10,135*dt)**2;
    if(reset) {
      previousHook.copy(hook); dx=dz=swingVx=swingVz=lastVx=lastVz=0;
    }
    const target=deployed?MAX_LINE:0;
    extension += clamp(target-extension,-5.6*dt,4.8*dt);
    const vx=dt>0?(hook.x-previousHook.x)/dt:0, vz=dt>0?(hook.z-previousHook.z)/dt:0;
    const ax=dt>0?clamp((vx-lastVx)/dt,-20,20):0, az=dt>0?clamp((vz-lastVz)/dt,-20,20):0;
    // Damped pendulum under a moving suspension point. Split long frames so
    // mobile pauses and frame rate changes cannot destabilize the spring.
    const steps=Math.max(1,Math.ceil(dt/.025)), h=dt/steps;
    const length=Math.max(.55,extension), stiffness=9.81/length;
    const damping=1.1*Math.sqrt(stiffness), drag=.24/(1+fraction);
    const airVx=vx-(flight.state.weather?.windX??0),airVz=vz-(flight.state.weather?.windZ??0);
    for(let i=0;i<steps;i++) {
      swingVx+=(-ax-drag*airVx-stiffness*dx-damping*swingVx)*h;
      swingVz+=(-az-drag*airVz-stiffness*dz-damping*swingVz)*h;
      dx+=swingVx*h; dz+=swingVz*h;
      const span=Math.hypot(dx,dz), limit=extension*.70;
      if(span>limit) {dx*=limit/span;dz*=limit/span;}
    }
    lastVx=vx;lastVz=vz;previousHook.copy(hook);

    const x=hook.x+dx, z=hook.z+dz;
    const surface=sampleSurface(city,x,z,hook.y+.08);
    const headroom=Math.max(0,hook.y-surface.floor-.012);
    const unfolded=clamp(extension/1.25,0,1);
    const scaleY=Math.min(size*(.30+.70*unfolded), Math.max(.01,headroom/-VALVE_Y));
    body.scale.set(size*(.76+.24*unfolded),scaleY,size*(.76+.24*unfolded));
    const vertical=Math.sqrt(Math.max(0,extension**2-dx**2-dz**2));
    ring.set(x,hook.y-vertical,z);
    direction.set(-dx,Math.max(.25,vertical),-dz).normalize();
    body.quaternion.setFromUnitVectors(up,direction);
    outlet.set(0,VALVE_Y*scaleY,0).applyQuaternion(body.quaternion).add(ring);
    // Solid ground/bridge/roof supports the bag. A water tile exposes its
    // bed as the lower limit, allowing the actual valve to dip below water.
    const bottom=sampleSurface(city,outlet.x,outlet.z,hook.y+.08);
    const push=Math.max(0,bottom.floor+.012-outlet.y);
    ring.y+=push;outlet.y+=push;
    if(push>0) extension=Math.min(extension,hook.distanceTo(ring));

    direction.subVectors(hook,ring);
    const span=direction.length();
    cable.visible=span>.035;
    if(cable.visible) {
      cable.position.copy(hook).add(ring).multiplyScalar(.5);
      cable.quaternion.setFromUnitVectors(up,direction.multiplyScalar(1/span));
      cable.scale.y=span;
    }
    // A tilted open bucket starts taking water at the first submerged lip.
    // Sample that point's water and support independently at shorelines.
    touching=false;
    inlet.set(ring.x,Infinity,ring.z);
    for(const corner of lipCorners) {
      rimPoint.copy(corner).multiply(body.scale).applyQuaternion(body.quaternion).add(ring);
      if(rimPoint.y<inlet.y) inlet.copy(rimPoint);
      if(extension<=.80 || touching) continue;
      const wet=city.tileAt?.(rimPoint.x,rimPoint.z);
      if(Number.isFinite(wet?.waterY) && rimPoint.y<=wet.waterY+.003) {
        const shore=sampleSurface(city,rimPoint.x,rimPoint.z,hook.y+.08);
        touching=shore.floor<shore.level && rimPoint.y>=shore.floor-.01;
      }
    }
    if(reset || !dt) velocity.set(0,0,0);
    else velocity.subVectors(outlet,previousOutlet).multiplyScalar(1/dt);
    previousOutlet.copy(outlet); initialized=true;
  }

  return {update, setContents, outlet, inlet, velocity, hook, root,
    get ready(){return ready;}, get extension(){return extension;},
    get deployed(){return deployed;},get visible(){return equipped;},
    get inWater(){return touching;},get touchingWater(){return touching;},
    get canDischarge(){return equipped && (tankMode || extension>.80);},
    dispose(){disposed=true;root.removeFromParent();root.clear();owned.forEach(resource=>resource.dispose());}
  };
}
