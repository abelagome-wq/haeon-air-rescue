const lifeSafety=new Set(['rescue','medevac']);
const handover=new Set(['patient-carry','hospital','hospital-handoff']);
const labels=['환자 인계','긴급','우선','일반'];
const colors=['#ff796a','#ff796a','#ffc378','#85d8ea'];

export function rankIncidents(calls,position){
  return calls.map(call=>{
    const distance=call.target?Math.hypot(call.target.x-position.x,call.target.z-position.z):Infinity;
    const deadline=Number.isFinite(call.secondsLeft)?call.secondsLeft:Infinity;
    const transfer=lifeSafety.has(call.type)&&handover.has(call.phase);
    const critical=lifeSafety.has(call.type)||call.type==='fire'&&call.variant==='large'||deadline<=60;
    const urgent=call.type==='fire'||call.variant==='burning'||call.type==='riot'||deadline<=150;
    const level=transfer?0:critical?1:urgent?2:3;
    return {call,level,label:labels[level],color:colors[level],deadline,distance};
  }).sort((a,b)=>a.level-b.level||a.deadline-b.deadline||a.distance-b.distance||a.call.id-b.call.id);
}
