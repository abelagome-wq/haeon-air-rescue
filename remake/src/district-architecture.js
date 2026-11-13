// Keep the zone finish on each original triangle. The renderer moves this
// attribute into its instanced or static sector batches together with the UVs.
export const facadeFinish={
  house:9, tiledRoof:10, apartment:11, shop:12, office:13, flatRoof:14,
  works:15, factoryRoof:16, sign:17, crown:18,stoneTower:19,formwork:20,frame:21,
};

export function districtFace(id,ny,high,peak){
  const prefix=id.slice(0,2),code=Number(id.slice(2));
  if(!Number.isFinite(code))return 0;
  if(prefix==='CA'||prefix==='AB')return ny>.28?facadeFinish.formwork:facadeFinish.frame;
  if(high<1.15)return 0;
  if(prefix==='RE'){
    if(ny>.28)return ny<.976?facadeFinish.tiledRoof:facadeFinish.flatRoof;
    if(ny>=-.15)return peak<15.4?facadeFinish.house:facadeFinish.apartment;
  }else if(prefix==='CO'){
    if(ny>.28)return ny<.976&&peak<16?facadeFinish.tiledRoof:facadeFinish.flatRoof;
    if(ny>=-.15){
      if(peak<26)return facadeFinish.shop;
      return [154,157,179,183,187].includes(code)?facadeFinish.stoneTower:facadeFinish.office;
    }
  }else if(prefix==='IN'&&code!==133){
    if(peak>25&&high>peak*.76&&ny<.28)return 7;
    if(ny>.28)return facadeFinish.factoryRoof;
    if(ny>=-.15)return facadeFinish.works;
  }
  return 0;
}

// RGB values here are linear, as are the sampled Three.js sRGB textures.
// Periodic grooves fade below a pixel to keep distant roofs stable in flight.
export const districtMaterials=String.raw`
    float mortarLine(float cycles,float halfWidth){
        float span=fwidth(cycles);
        float d=abs(fract(cycles+.5)-.5);
        return (1.-smoothstep(halfWidth,halfWidth+max(.008,span),d))*(1.-smoothstep(.20,.65,span));
    }
    vec3 paintTone(float lot){
        if(lot<.19)return vec3(.64,.54,.38);
        if(lot<.39)return vec3(.52,.61,.57);
        if(lot<.58)return vec3(.65,.42,.29);
        if(lot<.79)return vec3(.47,.56,.63);
        return vec3(.71,.66,.51);
    }
    vec3 officeTone(float lot){
        return mix(vec3(.24,.40,.49),vec3(.37,.53,.49),lot);
    }
    vec3 roofTone(float lot){
        if(lot<.41)return mix(vec3(.30,.115,.067),vec3(.46,.20,.112),lot/.41);
        if(lot<.75)return mix(vec3(.075,.13,.18),vec3(.13,.20,.24),(lot-.41)/.34);
        return mix(vec3(.23,.18,.135),vec3(.16,.25,.22),(lot-.75)/.25);
    }
    vec3 coatedSurface(float kind,vec2 p,float lot,vec3 original,float grain){
        float value=dot(original,vec3(.2126,.7152,.0722));
        float substrate=.68+.39*clamp(sqrt(max(value,0.))*1.96,0.,1.)+.14*(grain-.40);
        if(kind<9.5){
            float board=mortarLine(p.y/.33,.023);
            return paintTone(lot)*substrate*(1.-.11*board);
        }
        if(kind<10.5){
            float row=floor(p.y/.39),tile=p.x/.31+mod(row,2.)*.5;
            float seams=mortarLine(p.y/.39,.03)+mortarLine(tile,.025);
            float ribs=(.5+.5*cos(6.2831853*tile))*(1.-smoothstep(.1,.48,fwidth(tile)));
            return roofTone(lot)*(.87+.10*ribs+.15*grain)*(1.-.20*min(1.,seams));
        }
        if(kind<11.5){
            vec3 coat=lot<.45?mix(vec3(.39,.19,.10),vec3(.52,.30,.16),lot/.45):mix(vec3(.43,.49,.47),vec3(.65,.58,.44),lot);
            return coat*substrate;
        }
        if(kind<12.5){
            vec3 stucco=mix(paintTone(lot),vec3(.80,.72,.52),.28);
            return stucco*substrate;
        }
        if(kind<13.5)return officeTone(lot)*substrate;
        if(kind<14.5){
            float lap=mortarLine(p.y/1.24,.012),crossLap=mortarLine(p.x/4.15+.5*mod(floor(p.y/1.24),2.),.005);
            return mix(vec3(.31,.35,.34),vec3(.56,.55,.47),lot)*(.86+.23*grain)*(1.-.11*max(lap,crossLap));
        }
        if(kind<15.5){
            vec3 skin=lot<.49?mix(vec3(.37,.17,.095),vec3(.48,.24,.13),lot):mix(vec3(.32,.42,.40),vec3(.55,.59,.53),lot);
            float rib=lot<.49?mortarLine(p.y/.32,.018):mortarLine(p.x/.3,.045);
            return skin*substrate*(1.-rib*.15);
        }
        float seam=mortarLine(p.x/.68,.035);
        vec3 sheet=lot<.35?vec3(.24,.31,.33):lot<.69?vec3(.36,.25,.175):vec3(.38,.44,.40);
        return sheet*(.82+.34*grain)*(1.-.20*seam);
    }
`;
