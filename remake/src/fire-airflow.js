// 15TUT describes rising hot air, stronger fire under low rotor wash and
// aircraft damage close to flame. These SI accelerations are remake tuning.
const clip=(n,min,max)=>Math.max(min,Math.min(max,n));
export function createFireAirflow(){
  let sources=[],time=0;
  const field={up:0,x:0,z:0,bank:0,pitch:0,heat:0,strength:0};
  function setSources(list=[]){
    sources=list.filter(p=>p&&[p.x,p.y,p.z,p.intensity,p.radius].every(Number.isFinite)&&p.intensity>0&&p.radius>0)
      .map(p=>({...p,intensity:clip(p.intensity,0,2),radius:clip(p.radius,1,35)}));
    if(!sources.length)for(const key in field)field[key]=0;
  }
  function sample(p,dt){
    time+=dt;
    for(const key in field)field[key]=0;
    for(const fire of sources){
      const h=p.y-fire.y;if(h<-.8)continue;
      const top=16+fire.radius*3.25;if(h>top)continue;
      const width=fire.radius+Math.max(0,h)*.17,dx=p.x-fire.x,dz=p.z-fire.z;
      const radial=1-(dx*dx+dz*dz)/(width*width);if(radial<=0)continue;
      const strength=fire.intensity*radial*radial*(1-Math.max(0,h)/top)**1.35;
      const phase=fire.x*.113+fire.z*.083+h*.10;
      const gx=Math.sin(time*2.3+phase)+.4*Math.sin(time*4.7-phase*.6);
      const gz=Math.cos(time*1.9-phase)+.4*Math.cos(time*5.1+phase);
      field.up+=strength*(3.7+.85*Math.sin(time*2.6+phase));
      field.x+=strength*2.8*gx;field.z+=strength*2.8*gz;
      field.bank+=strength*.14*gx;field.pitch+=strength*.11*gz;
      field.heat+=strength*Math.max(0,1-Math.max(0,h)/(4.2+fire.radius*.42));
      field.strength+=strength;
    }
    field.up=clip(field.up,0,6.5);field.x=clip(field.x,-4.2,4.2);field.z=clip(field.z,-4.2,4.2);
    field.bank=clip(field.bank,-.23,.23);field.pitch=clip(field.pitch,-.18,.18);field.heat=clip(field.heat,0,1);
    field.strength=clip(field.strength,0,1.5);
    return field;
  }
  return {setSources,sample};
}
