// Collision impulses use the obstacle's frame, so a train and a stationary
// wall produce different results even at the same helicopter airspeed.
export function createRebound(T) {
  const normal=new T.Vector3(),surface=new T.Vector3();
  let remaining=0,minimumSpeed=0,surfaceSpeed=0;

  function respond(velocity,hit,rotorRunning,firstContact) {
    surface.set(hit.vx??0,hit.vy??0,hit.vz??0);
    velocity.sub(surface);
    for(const plane of hit.planes?.length?hit.planes:[hit]){
      const n=plane.normal,component=velocity.dot(n);
      if(component>0)continue;
      const closing=-component;
      const rotorKick=firstContact&&rotorRunning&&hit.part==='rotor';
      const separatingSpeed=closing>.3||rotorKick?
        Math.min(15,Math.max(rotorKick?3.6:2.5,closing*.44)):0;
      // Only the normal component changes. A glancing hit preserves movement
      // along the facade and an aircraft already retreating keeps its speed.
      velocity.addScaledVector(n,separatingSpeed-component);
    }
    const outward=velocity.dot(hit.normal);
    remaining=0;
    if(outward>.3){
      normal.copy(hit.normal);minimumSpeed=outward;surfaceSpeed=surface.dot(normal);remaining=.42;
    }
    velocity.add(surface);
  }
  function afterControls(velocity,dt) {
    if(remaining<=0)return;
    // Do not let the hover controller cancel a mechanical impulse on the
    // following tick. Only oppose steering back into this contact for 420 ms.
    const component=velocity.dot(normal)-surfaceSpeed;
    const minimum=minimumSpeed*Math.min(1,remaining/.16);
    if(component<minimum)velocity.addScaledVector(normal,minimum-component);
    remaining=Math.max(0,remaining-dt);
  }
  return {respond,afterControls,reset(){remaining=0;}};
}
