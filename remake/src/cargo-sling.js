import {HOOK_Y} from './bucket-rig.js';
import {cargoContainerGeometry, CARGO_EYE_HEIGHT, CARGO_WIDTH, CARGO_LENGTH} from './cargo-container.js';

const MAX_LINE = 13.8, CARRY_LINE = 2.8, STOWED_LINE = .28;
const LOWER_RATE = 4.8, RAISE_RATE = 5.6;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function createCargoSling({T, parent, city, flight, equipped, notice = () => {}}) {
  const loads = new Set(), mount = new T.Vector3(), hook = new T.Vector3();
  const previous = new T.Vector3(), speed = new T.Vector3(), previousSpeed = new T.Vector3();
  const acceleration = new T.Vector3(), swing = new T.Vector2(), swingSpeed = new T.Vector2();
  const up = new T.Vector3(0, 1, 0), direction = new T.Vector3(), aim = new T.Vector3();
  const rig = new T.Group(), hardware = new T.Group();
  rig.name = 'Cargo winch';
  hardware.name = 'Swivel hook with safety latch';
  parent.add(rig);
  rig.add(hardware);
  const owned = [];
  const own = resource => { owned.push(resource); return resource; };
  const steel = own(new T.MeshStandardMaterial({color:0x8f9ba1, roughness:.62, metalness:.48}));
  const safety = own(new T.MeshStandardMaterial({color:0xf9b42d, roughness:.51, metalness:.32}));
  const cable = new T.Mesh(own(new T.CylinderGeometry(.026, .026, 1, 8)), steel);
  cable.name = 'Cargo lift cable';
  rig.add(cable);
  // The cable ends at the swivel. The hook bowl meets the container lifting eye.
  const curved = new T.Mesh(own(new T.TorusGeometry(.13, .041, 8, 18, Math.PI*1.58)), safety);
  curved.rotation.z = Math.PI*.54;
  curved.position.y = .13;
  const swivel = new T.Mesh(own(new T.CylinderGeometry(.052, .065, .16, 8)), steel);
  swivel.position.set(-.031,.292,0);
  const latch = new T.Mesh(own(new T.BoxGeometry(.031, .174, .048)), steel);
  latch.position.set(.058,.175,0);
  latch.rotation.z = .67;
  hardware.add(curved, swivel, latch);
  rig.visible = false;

  const containerMaterial = own(new T.MeshStandardMaterial({vertexColors:true, roughness:.73, metalness:.22}));
  let containerGeometry, attached = null, held = false, initialized = false, aircraft;
  let length = STOWED_LINE;
  const state = {name:'화물 고리', kind:'hook', deployed:false, extension:0, attached:false, massKg:0, externalLoadKg:0,
    grounded:false, hookPosition:hook, outlet:hook};

  function register({position, massKg = 160, onAttach, onRelease}) {
    if (![position?.x, position?.y, position?.z, massKg].every(Number.isFinite) || massKg <= 0) {
      throw new TypeError('Cargo needs a finite ground position and a positive mass');
    }
    containerGeometry ??= own(cargoContainerGeometry(T));
    const box = new T.Mesh(containerGeometry, containerMaterial);
    box.name = 'Corrugated cargo container';
    box.position.copy(position);
    box.castShadow = box.receiveShadow = true;
    parent.add(box);
    const load = {
      position:box.position, massKg, attached:false, grounded:true, retired:false,
      lastSetDown:box.position.clone(), onAttach, onRelease,
      retire() { load.retired = true; },
      dispose() {
        if (attached === load) detach();
        loads.delete(load);
        box.removeFromParent();
      }
    };
    loads.add(load);
    return load;
  }

  // A structural deck supports the load even if the terrain below it is water.
  function floorAt(x, z, ceiling) {
    const tile = city.tileAt?.(x, z);
    let ground = tile?.groundY ?? city.groundAt?.(x,z) ?? city.surfaceAt?.(x,z) ?? 0;
    const solid = city.flightScenery?.floorAt(x,z,ceiling) ?? city.roofAt?.(x,z);
    for (const y of [tile?.roadY, tile?.railY, solid]) {
      if (Number.isFinite(y) && y <= ceiling) ground = Math.max(ground, y);
    }
    return ground;
  }

  function footprintFloor(x, z, ceiling) {
    let ground = floorAt(x,z,ceiling);
    for (const side of [-1,1]) for (const end of [-1,1]) {
      ground = Math.max(ground, floorAt(x+side*CARGO_WIDTH*.43, z+end*CARGO_LENGTH*.45, ceiling));
    }
    return ground;
  }

  function dryAt(position) {
    const water = city.tileAt?.(position.x, position.z)?.waterY;
    return !Number.isFinite(water) || position.y >= water+.04;
  }

  function nearestEye(x, z, radius) {
    let best = null, bestDistance = radius*radius;
    for (const load of loads) {
      if (load.retired) continue;
      const d = (x-load.position.x)**2 + (z-load.position.z)**2;
      if (d <= bestDistance) { best = load; bestDistance = d; }
    }
    return best;
  }

  function detach() {
    const load = attached;
    if (!load) return null;
    attached = null;
    load.attached = false;
    load.grounded = true;
    state.grounded = false;
    state.attached = false;
    state.massKg = 0;
    state.externalLoadKg = 0;
    return load;
  }

  function toggle() {
    if (!equipped()) { notice('격납고에서 화물 고리를 장착하세요.'); return false; }
    if (flight.state.onFoot || flight.state.grounded || flight.state.destroyed) {
      notice('이륙한 뒤 화물 줄을 조작하세요.');
      return false;
    }
    state.deployed = !state.deployed;
    notice(state.deployed ? '화물 줄을 내립니다.' : '화물 줄을 감아 올립니다.');
    return true;
  }

  function begin() {
    if (held) return false;
    held = true;
    if (!equipped()) { notice('격납고에서 화물 고리를 장착하세요.'); return false; }
    if (flight.state.onFoot || flight.state.destroyed) return false;
    if ((flight.state.speed ?? 0) > 2 || Math.abs(flight.state.verticalSpeed ?? 0) > 1.7) {
      notice('컨테이너 위에서 속도를 줄이고 기체를 안정시키세요.');
      return false;
    }
    if (attached) {
      if (!attached.grounded || !dryAt(attached.position)) {
        notice('컨테이너를 마른 바닥에 내려놓은 뒤 고리를 푸세요.');
        return false;
      }
      const load = detach();
      load.lastSetDown.copy(load.position);
      notice('화물 고리를 분리했습니다.');
      load.onRelease?.(load, 'ground');
      return true;
    }
    if (!state.deployed || state.extension < .75 || flight.state.grounded) {
      notice('컨테이너 위에서 화물 줄을 내리세요.');
      return false;
    }
    const load = nearestEye(hook.x, hook.z, 1.05);
    const eyeY = load ? load.position.y+CARGO_EYE_HEIGHT : Infinity;
    if (!load || Math.abs(eyeY-hook.y) > .65 || mount.y < eyeY+.65) {
      notice('기체를 낮춰 고리와 컨테이너의 노란 인양 고리를 맞추세요.');
      return false;
    }
    attached = load;
    load.attached = true;
    state.attached = true;
    state.massKg = load.massKg;
    state.grounded = true;
    hook.set(load.position.x, eyeY, load.position.z);
    swing.set(hook.x-mount.x, hook.z-mount.z);
    swingSpeed.set(0,0);
    notice('컨테이너 연결 완료. 천천히 상승하세요.');
    load.onAttach?.(load);
    return true;
  }

  function reset() {
    if (attached) {
      const load = detach();
      load.position.copy(load.lastSetDown);
      load.onRelease?.(load, 'reset');
    }
    state.deployed = false;
    state.extension = 0;
    length = STOWED_LINE;
    held = false;
    initialized = false;
    swing.set(0,0);
    swingSpeed.set(0,0);
    previousSpeed.set(0,0,0);
  }

  function swingLine(dt) {
    const stiffness = 9.81 / Math.max(.5, length);
    const damping = 1.05*Math.sqrt(stiffness);
    const drag = attached ? .15 : .24;
    const weather = flight.state.weather;
    const forceX = -acceleration.x + drag*((weather?.windX ?? 0)-speed.x);
    const forceZ = -acceleration.z + drag*((weather?.windZ ?? 0)-speed.z);
    const steps = Math.max(1, Math.ceil(dt/.025)), h = dt/steps;
    for (let i=0; i<steps; i++) {
      swingSpeed.x += (forceX - stiffness*swing.x - damping*swingSpeed.x)*h;
      swingSpeed.y += (forceZ - stiffness*swing.y - damping*swingSpeed.y)*h;
      swing.addScaledVector(swingSpeed,h);
      swing.clampLength(0, length*.72);
    }
    const vertical = Math.sqrt(Math.max(0, length*length-swing.lengthSq()));
    hook.set(mount.x+swing.x, mount.y-vertical, mount.z+swing.y);
  }

  function seatContainer() {
    const pos = attached.position;
    // A grounded load stays put while the hoist pays out slack. Keeping it at
    // the hook's XZ during that interval would drag the box with the helicopter.
    if (attached.grounded &&
        Math.hypot(mount.x-pos.x, mount.y-(pos.y+CARGO_EYE_HEIGHT), mount.z-pos.z) <= length+.035) {
      hook.set(pos.x,pos.y+CARGO_EYE_HEIGHT,pos.z);
    } else {
      const ground = footprintFloor(hook.x,hook.z,mount.y+.1);
      const bottom = hook.y-CARGO_EYE_HEIGHT;
      attached.grounded = bottom <= ground+.06;
      pos.set(hook.x,Math.max(bottom,ground),hook.z);
      hook.y = pos.y+CARGO_EYE_HEIGHT;
    }
    if (attached.grounded) {
      swing.set(hook.x-mount.x,hook.z-mount.z);
      swingSpeed.set(0,0);
    }
    state.grounded = attached.grounded;
    state.externalLoadKg = attached.grounded ? 0 : attached.massKg;
  }

  function update(elapsed) {
    const available = equipped(), changed = aircraft !== flight.state.id;
    if (!available || changed || flight.state.destroyed || flight.state.onFoot) {
      if (initialized || attached || changed) reset();
      aircraft = flight.state.id;
    }
    rig.visible = available && !flight.state.destroyed;
    if (!rig.visible) return;
    const dt = clamp(Number(elapsed)||0,0,.5);
    mount.set(0,HOOK_Y[aircraft]??.64,0);
    if (flight.object) flight.object.localToWorld(mount);
    else mount.add(flight.position);
    if (!initialized || mount.distanceToSquared(previous)>Math.max(10,135*dt)**2) {
      previous.copy(mount);
      previousSpeed.set(0,0,0);
      swing.set(0,0);
      swingSpeed.set(0,0);
    }
    if (flight.state.grounded && !attached) state.deployed = false;
    speed.subVectors(mount,previous).multiplyScalar(dt>0 ? 1/dt : 0);
    acceleration.subVectors(speed,previousSpeed).multiplyScalar(dt>0 ? 1/dt : 0);
    acceleration.clampScalar(-20,20);
    previous.copy(mount);
    previousSpeed.copy(speed);
    initialized = true;
    const target = state.deployed ? MAX_LINE : (attached ? CARRY_LINE : STOWED_LINE);
    length += clamp(target-length,-RAISE_RATE*dt,LOWER_RATE*dt);
    swingLine(dt);
    if (attached) seatContainer();
    else {
      const ground = floorAt(hook.x,hook.z,mount.y+.1);
      hook.y = Math.max(hook.y,ground+.03);
      const load = nearestEye(hook.x,hook.z,.89);
      if (load && mount.y>load.position.y+CARGO_EYE_HEIGHT+.15) {
        hook.y = Math.max(hook.y,load.position.y+CARGO_EYE_HEIGHT);
      }
    }
    hardware.position.copy(hook);
    // Connect the winch to the swivel shank above the hook bowl.
    direction.subVectors(mount, hook);
    const lengthToMount = direction.length();
    if (lengthToMount>.001) direction.multiplyScalar(1/lengthToMount);
    else direction.copy(up);
    hardware.quaternion.setFromUnitVectors(up,direction);
    const span = Math.max(0,lengthToMount-.34);
    cable.visible = span>.025;
    cable.quaternion.copy(hardware.quaternion);
    cable.scale.y = span;
    cable.position.copy(mount).addScaledVector(direction,-span/2);
    state.extension = Math.max(0,lengthToMount-STOWED_LINE);
  }

  function getAim() {
    if (!rig.visible) return null;
    return aim.set(hook.x,floorAt(hook.x,hook.z,mount.y+.1)+.03,hook.z);
  }

  function dispose() {
    for (const load of loads) load.dispose();
    rig.removeFromParent();
    for (const resource of owned) resource.dispose();
  }
  return {state, register, toggle, begin, end:()=>{held=false;}, update, getAim, dispose};
}
