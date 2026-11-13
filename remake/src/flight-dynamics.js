const gravity=9.80665;
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));

// The assisted controls request velocity/attitude. Forces share one rotor
// thrust budget; ground and air velocities remain distinct in the solver.
export function createFlightDynamics(spec,envelope,referenceMass){
  let width=0,height=0;
  const length=envelope.boxes.at(-1).max.z-envelope.boxes[0].min.z;
  for(const box of envelope.boxes){
    width=Math.max(width,box.max.x-box.min.x);
    height=Math.max(height,box.max.y-box.min.y);
  }
  // Approximate principal radii of gyration from the actual hull envelope:
  // the tail and landing gear occupy much less volume than the cabin.
  const pitchMoment=(length*length+height*height)/18;
  const rollMoment=(width*width+height*height)/18;
  const yawMoment=(length*length+width*width)/18;
  const diskRadius=spec.diameter*.5;
  const dragArea=Math.max(.2,width*height*.22);
  const horizontalThrust={x:0,z:0};
  let pitchRate=0,rollRate=0;
  function attitude(angle,target,rate,moment,mass,torque,dt){
    const torqueDemand=referenceMass*moment*(36*(target-angle)-12*rate);
    return rate+clamp(torqueDemand,-torque,torque)/(mass*moment)*dt;
  }
  return {
    horizontalThrust,
    pitch(angle,target,perf,dt){
      pitchRate=attitude(angle,target,pitchRate,pitchMoment,perf.massKg,perf.thrustNewtons*diskRadius*.18,dt);
      return angle+pitchRate*dt;
    },
    roll(angle,target,perf,dt){
      rollRate=attitude(angle,target,rollRate,rollMoment,perf.massKg,perf.thrustNewtons*diskRadius*.18,dt);
      return angle+rollRate*dt;
    },
    yaw(rate,target,perf,dt){
      const torque=perf.thrustNewtons*diskRadius*.30;
      const demand=referenceMass*yawMoment*(target-rate)*4;
      return rate+clamp(demand,-torque,torque)/(perf.massKg*yawMoment)*dt;
    },
    resetRates(){pitchRate=0;rollRate=0;},
    translate(v,goalX,goalZ,wind,perf,verticalLift,dt){
      const ux=v.x-wind.windX,uz=v.z-wind.windZ;
      const drag=.5*1.225*dragArea*Math.hypot(ux,uz);
      const fx=perf.massKg*(goalX-v.x)/dt+drag*ux;
      const fz=perf.massKg*(goalZ-v.z)/dt+drag*uz;
      const thrust=perf.thrustNewtons;
      const limit=Math.min(thrust*.72,Math.sqrt(Math.max(0,thrust*thrust-verticalLift*verticalLift)));
      const scale=Math.min(1,limit/Math.max(.0001,Math.hypot(fx,fz)));
      horizontalThrust.x=fx*scale;horizontalThrust.z=fz*scale;
      v.x+=(horizontalThrust.x-drag*ux)/perf.massKg*dt;
      v.z+=(horizontalThrust.z-drag*uz)/perf.massKg*dt;
    },
  };
}

// Friction impulse per unit mass. First contact transfers vertical impact
// momentum; sustained support can remove only mu*g*dt of tangential speed.
export function skidRetention(speed,normalDeltaV,rain){
  const friction=.67-.30*clamp(rain,0,1);
  return speed>0?Math.max(0,1-friction*Math.max(0,normalDeltaV)/speed):0;
}

export function verticalForceStep(vy,target,response,performance,dt){
  const mass=performance.massKg;
  const liftLimit=performance.verticalThrustToWeight*performance.weightNewtons;
  // Vertical airframe drag opposes motion even when overloaded and sinking.
  const drag=-.032*vy*Math.abs(vy);
  const desiredAcceleration=(target-vy)*(-Math.expm1(-response*dt))/dt;
  const lift=clamp(mass*(gravity+desiredAcceleration-drag),0,liftLimit);
  return {lift,velocity:vy+(lift/mass-gravity+drag)*dt};
}
