import {glassShader} from './city-glass.js';
import {districtMaterials} from './district-architecture.js';
// Shared by the city's static building sectors and repeated instances.
const atlases=new WeakMap();
export async function acquireUrbanFinish(T){
    let entry=atlases.get(T);
    if(!entry){
        const url=new URL('../art/urban-finishes.webp',import.meta.url).href;
        entry={users:0,ready:new T.TextureLoader().loadAsync(url).then(texture=>{
            texture.colorSpace=T.SRGBColorSpace;texture.flipY=false;texture.anisotropy=4;
            return texture;
        })};
        atlases.set(T,entry);
    }
    entry.users++;
    let texture;
    try{texture=await entry.ready;}catch(error){
        if(!--entry.users)atlases.delete(T);
        throw error;
    }
    return {texture,release(){if(!--entry.users){texture.dispose();atlases.delete(T);}}};
}

const uniforms=`
    varying vec3 urbanPosition;
    varying vec3 urbanNormal;
    varying vec2 urbanMaterial;
    uniform sampler2D urbanFinish;
`;
const vertex=`
    vec4 cityPoint=vec4(transformed,1.);
    vec3 cityNormal=objectNormal;
    float variation=fract(urbanKind);
    #ifdef USE_INSTANCING
        cityPoint=instanceMatrix*cityPoint;
        cityNormal=mat3(instanceMatrix)*cityNormal;
        variation=fract(dot(instanceMatrix[3].xz,vec2(.01357,.03173)));
    #endif
    urbanPosition=(modelMatrix*cityPoint).xyz;
    urbanNormal=normalize(mat3(modelMatrix)*cityNormal);
    urbanMaterial=vec2(floor(urbanKind+.00001),variation);
`;

// All dimensions are metres. Align zinc ribs up the roof pitch, rather than
// painting the same horizontal grid on walls, gables and sloping roofs.
const helpers=`
    float roomHash(vec2 id){
        vec3 p=fract(vec3(id.xyx)*.1031);
        p+=dot(p,p.yzx+33.33);
        return fract((p.x+p.y)*p.z);
    }
    vec2 surfacePlane(vec3 p, vec3 n, bool top){
        vec2 along=length(n.xz)>.05?normalize(vec2(n.z,-n.x)):vec2(1.,0.);
        return top?vec2(dot(p.xz,along),dot(p.xz,vec2(-along.y,along.x))):vec2(dot(p.xz,along),p.y);
    }
    vec3 readFinish(vec2 uv, vec2 quadrant){
        // The independent photographs touch only outside this sampling area.
        vec2 extent=vec2(.496);
        return textureGrad(urbanFinish,quadrant*.5+.002+fract(uv)*extent,dFdx(uv)*extent,dFdy(uv)*extent).rgb;
    }
    float softBar(float x,float center,float halfWidth){
        float aa=clamp(fwidth(x),.001,.15);
        return 1.-smoothstep(halfWidth-aa,halfWidth+aa,abs(x-center));
    }
    void shadeRoom(vec2 p,float roomSeed,float distanceToEye,vec3 n,bool shop,
                   out vec3 glass,out vec3 interior,out float exposed){
        float detail=1.-smoothstep(45.,175.,distanceToEye);
        float crossbar=shop?0.:softBar(p.y,.34,.019)*detail;
        float mullion=shop?0.:softBar(p.x,.50,.017)*detail;
        float frame=max(crossbar,mullion);
        float shadeHeight=mix(.14,.85,roomSeed);
        float blind=shop?0.:(1.-smoothstep(shadeHeight-.018,shadeHeight+.018,p.y))*detail;
        float slats=.5+.5*cos(64.*p.y);
        vec3 eye=normalize(cameraPosition-urbanPosition);
        vec3 tangent=normalize(vec3(n.z+.00001,0.,-n.x));
        vec2 through=vec2(-dot(eye,tangent),eye.y)/max(.08,abs(dot(eye,n)));
        through*=shop?vec2(.98,1.45):vec2(1.40,1.16);
        vec2 reach=mix(p,1.-p,step(vec2(0.),through))/max(abs(through),vec2(.0001));
        float depth=clamp(min(reach.x,reach.y),0.,1.);
        vec2 wall=clamp(p+through*depth,0.,1.);
        float back=smoothstep(.94,1.,depth);
        float floorHit=step(reach.y,reach.x)*step(.0,through.y)*(1.-back);
        float ceilingHit=step(reach.y,reach.x)*step(through.y,.0)*(1.-back);
        float shelf=softBar(wall.y,shop?.61:.72,.021)*back;
        float goods=step(.19,fract(wall.x*5.+roomSeed))*(1.-step(.85,fract(wall.x*5.+roomSeed)));
        goods*=smoothstep(.59-mix(.10,.21,roomSeed),.56,wall.y)*(1.-smoothstep(.59,.61,wall.y))*back;
        float trim=mix(1.,(.47+.43*back+.18*floorHit-.14*ceilingHit)*(1.-.34*shelf-.31*goods),detail);
        vec3 room=mix(vec3(.074,.067,.050),vec3(.10,.113,.117),roomSeed);
        glass=mix(room*trim,vec3(.17,.19,.17)*(.82+.18*slats),blind);
        glass=mix(glass,vec3(.040,.046,.046),frame);
        float occupied=shop?.94:smoothstep(.39,.68,roomSeed);
        vec3 light=mix(vec3(.58,.29,.12),vec3(.39,.45,.42),smoothstep(.69,.96,roomSeed));
        interior=light*(occupied*trim)*(1.-frame*.98)*(1.-blind*(.53+.14*slats));
        if(shop){
            // Stock sits on two shelves behind the front mullions. Projecting
            // onto the virtual back wall gives the display parallax at street level.
            float tier=wall.y<.63?.61:.85;
            float item=floor(wall.x*6.),slot=fract(wall.x*6.);
            float h=mix(.075,.22,roomHash(vec2(item+.51,tier+roomSeed)));
            float products=smoothstep(.11,.17,slot)*(1.-smoothstep(.82,.9,slot))*
                smoothstep(tier-h-.018,tier-h+.01,wall.y)*(1.-smoothstep(tier-.008,tier+.01,wall.y));
            float ledge=max(softBar(wall.y,.61,.012),softBar(wall.y,.85,.012));
            float visible=detail*(.30+.70*back);
            float stocked=products*visible;
            glass=mix(glass,vec3(.19,.115,.063),stocked);
            glass+=vec3(.045,.035,.022)*(1.-products)*visible;
            interior*=1.-.63*stocked-.45*ledge*visible;
        }
        exposed=1.-frame;
    }
`;

function installFinish(material,{texture,panes=null,night=false,glass=null,signs=null}){
    const original=material.onBeforeCompile.bind(material);
    const previousKey=material.customProgramCacheKey();
    material.defaultAttributeValues={...material.defaultAttributeValues,urbanKind:[0]};
    material.onBeforeCompile=shader=>{
        original(shader);
        shader.uniforms.urbanFinish={value:texture};
        if(panes)shader.uniforms.urbanPanes={value:panes};
        if(signs)shader.uniforms.districtSigns={value:signs};
        shader.vertexShader='attribute float urbanKind;varying vec3 urbanPosition;varying vec3 urbanNormal;varying vec2 urbanMaterial;\n'+
            shader.vertexShader.replace('#include <project_vertex>',vertex+'\n#include <project_vertex>');
        const originalPanes=panes?`
          if(!top&&(kind<5.5||kind==9.||kind==11.||kind==12.||kind==15.||kind==19.)){
            vec4 pane=textureGrad(urbanPanes,cell.xy+tileUV*cell.zw,dFdx(vMapUv)*cell.zw,dFdy(vMapUv)*cell.zw);
            aperture=pane.r*(1.-smoothstep(.15,.47,abs(n.y)));
            paneCoord=pane.gb;
            float repeatSeed=roomHash(floor(vMapUv)+vec2(urbanMaterial.y*47.0,urbanMaterial.y*23.0));
            roomSeed=fract(max(0.,pane.a*2.-1.)*.75+repeatSeed*.65);
          }
        `:'';
        const isBase=!!panes;
        if(glass)Object.assign(shader.uniforms,glass.uniforms);
        shader.fragmentShader=uniforms+(isBase?'uniform sampler2D urbanPanes;\n':'')+(signs?'uniform sampler2D districtSigns;\n':'')+(glass?glassShader:'')+helpers+districtMaterials+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
            float reliefHeight=0.,urbanBounce=0.;
            vec3 roomLight=vec3(0.),glazingLight=vec3(0.);
            if(urbanMaterial.x>.5){
                vec3 n=normalize(urbanNormal);
                float kind=urbanMaterial.x;
                bool top=abs(n.y)>.28;
                vec2 plane=surfacePlane(urbanPosition,n,top);
                float aperture=0.,roomSeed=0.;
                vec2 paneCoord=vec2(.5);
                ${originalPanes}
                if(kind>8.5){
                    if(kind<16.5){
                        vec3 stock=readFinish(plane/vec2(3.15,3.44),kind>14.5?vec2(0.,1.):vec2(1.,0.));
                        float grain=dot(stock,vec3(.2126,.7152,.0722));
                        diffuseColor.rgb=coatedSurface(kind,plane,urbanMaterial.y,diffuseColor.rgb,grain);
                        reliefHeight=grain*(top?.032:.015);
                        if(kind>12.5&&kind<13.5){
                            // Curtain-wall floors combine a continuous glass ribbon, a solid spandrel
                            // and slender aluminum mullions. Local pane IDs remain stable in flight.
                            vec2 officeBay=plane/vec2(2.55,3.35);
                            vec2 coord=fract(officeBay);
                            float joint=mortarLine(officeBay.x,.033);
                            float spandrel=smoothstep(.05,.09,coord.y)*(1.-smoothstep(.79,.84,coord.y));
                            aperture=spandrel*(1.-joint);
                            paneCoord=vec2(coord.x,clamp((coord.y-.07)/.74,0.,1.));
                            roomSeed=roomHash(floor(officeBay)+urbanMaterial.y*64.);
                            diffuseColor.rgb=mix(officeTone(urbanMaterial.y)*.76,vec3(.44,.49,.48),joint);
                        }
                    }else if(kind<17.5){
                        aperture=0.;
                        ${signs?`float facadeId=mod(floor(urbanMaterial.y*73.)+floor(-vMapUv.x-2.),8.);
                        vec2 signUV=vec2(fract(-vMapUv.x-2.),(facadeId+.02+.96*vMapUv.y)/8.);
                        float ink=texture2D(districtSigns,signUV).r;
                        vec3 paint=facadeId<1.5?vec3(.025,.21,.17):facadeId<3.5?vec3(.40,.10,.05):facadeId<5.5?vec3(.095,.19,.28):vec3(.31,.19,.07);
                        diffuseColor.rgb=mix(paint,vec3(.86,.82,.65),ink);
                        ${night?'roomLight=ink*vec3(.75,.54,.30)+paint*.18;':''}`:''}
                    }else if(kind<18.5){
                        aperture=0.;
                        diffuseColor.rgb=mix(vec3(.22,.34,.37),vec3(.48,.53,.49),urbanMaterial.y);
                    }else if(kind<19.5){
                        float source=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
                        vec3 stone=mix(vec3(.44,.38,.29),vec3(.66,.63,.53),urbanMaterial.y);
                        float course=mortarLine(plane.y/.76,.014);
                        diffuseColor.rgb=stone*(.56+.52*clamp(sqrt(max(source,0.))*1.97,0.,1.))*(1.-.13*course);
                    }else{
                        aperture=0.;
                        float source=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
                        float board=mortarLine(plane.x/1.22,.01);
                        vec3 primer=mix(vec3(.22,.125,.069),vec3(.34,.39,.38),urbanMaterial.y);
                        vec3 concrete=mix(vec3(.31,.33,.30),vec3(.47,.45,.38),urbanMaterial.y);
                        diffuseColor.rgb=(kind<20.5?concrete:primer)*(.76+.26*clamp(sqrt(max(source,0.))*2.8,0.,1.))*(1.-.12*board);
                    }
                }else if(kind<4.5){
                    vec2 extent=kind<1.5?vec2(1.76,1.57):kind<2.5?vec2(4.8,5.4):kind<3.5?vec2(3.6,5.0):vec2(3.2);
                    vec2 quadrant=kind<1.5?vec2(0.,0.):kind<2.5?vec2(1.,0.):kind<3.5?vec2(0.,1.):vec2(1.);
                    vec2 uv=plane/extent+vec2(urbanMaterial.y,.0);
                    vec3 sampleColor=readFinish(uv,quadrant);
                    float grain=dot(sampleColor,vec3(.2126,.7152,.0722));
                    float scale=kind<1.5?.90:kind<2.5?1.02:kind<3.5?1.12:.85;
                    float patina=.94+.10*urbanMaterial.y;
                    vec3 body=sampleColor*scale*patina;
                    ${isBase?`float painted=clamp(dot(diffuseColor.rgb,vec3(.2126,.7152,.0722))*2.8,.43,1.18);
                        float bare=(cell.z<.003&&cell.w<.003)?1.:0.;
                        float amount=top?mix(.76,.94,bare):mix(.63,.88,bare);
                        diffuseColor.rgb=mix(diffuseColor.rgb,body*mix(painted,1.,bare*.8),amount);`:`diffuseColor.rgb=body*mix(vec3(.68),vec3(1.17),clamp(diffuseColor.rgb,0.,1.));`}
                    reliefHeight=grain*(kind>2.5?.065:.028)*(1.-aperture);
                }else if(kind>5.5&&kind<7.5){
                    aperture=0.;
                    if(kind<6.5){
                        // Rounded tanks have welded courses and a lightly
                        // oxidized coat, including their shallow domed lids.
                        float course=fract(urbanPosition.y/1.62);
                        float band=softBar(course,.5,.015);
                        vec3 zinc=readFinish(plane/4.2,vec2(0.,1.));
                        float patina=dot(zinc,vec3(.2126,.7152,.0722));
                        vec3 coat=mix(vec3(.23,.255,.24),vec3(.35,.38,.36),urbanMaterial.y);
                        diffuseColor.rgb=coat*clamp(.79+.68*patina,.79,1.14)*(1.-.19*band);
                        reliefHeight=.012*band+.009*patina;
                    }else{
                        vec3 brick=readFinish(plane/vec2(1.72,1.45),vec2(0.));
                        float ring=softBar(fract(urbanPosition.y/3.3),.5,.016);
                        vec3 baked=brick*vec3(.93,.78,.65)+vec3(.045,.028,.015);
                        // Broad alternating courses remain legible on the approach to the works.
                        float stripe=fract(urbanPosition.y/8.4+urbanMaterial.y*.22);
                        float whitewash=smoothstep(.02,.075,stripe)*(1.-smoothstep(.47,.53,stripe));
                        baked=mix(baked,vec3(.56,.52,.43),whitewash*.77);
                        diffuseColor.rgb=mix(baked,vec3(.073,.078,.075),ring*.69);
                        reliefHeight=.035*dot(brick,vec3(.2126,.7152,.0722))+.013*ring;
                    }
                }else{
                    vec2 bay=surfacePlane(urbanPosition,n,false)/vec2(1.45,1.85);
                    aperture=1.;
                    if(vMapUv.x< -1.5){
                        float id=-vMapUv.x-2.;
                        paneCoord=vec2(fract(id),vMapUv.y);
                        roomSeed=roomHash(vec2(floor(id),urbanMaterial.y*39.));
                    }else{
                        paneCoord=fract(bay);roomSeed=roomHash(floor(bay)+urbanMaterial.y*39.);
                    }
                }
                if(aperture>.01){
                    vec3 pane;float exposed;
                    float afterHours=1.;
                    vec3 fixtureColor=vec3(1.);
                    ${night?`
                    if(kind==12.||kind==13.||kind==19.){
                        float floorId=floor(plane.y/3.35);
                        float suiteId=floor(plane.x/11.7+urbanMaterial.y*1.8);
                        float owner=urbanMaterial.y*87.;
                        float floorUse=roomHash(vec2(floorId+.75,owner));
                        float suiteUse=roomHash(vec2(suiteId+owner*.4,floorId+owner));
                        float activeFloor=smoothstep(.37,.71,floorUse);
                        float activeSuite=smoothstep(.24,.60,suiteUse);
                        afterHours=.027+.65*activeFloor*activeSuite;
                        // Neighbouring desks behind one blind share a light circuit.
                        roomSeed=.46+.35*suiteUse+.10*roomSeed;
                        fixtureColor=mix(vec3(.90,.74,.58),vec3(.69,.87,.99),suiteUse*.65+urbanMaterial.y*.24);
                    }else if(kind!=8.)afterHours=.72;
                    `:''}
                    shadeRoom(paneCoord,roomSeed,length(cameraPosition-urbanPosition),n,kind>7.5&&kind<8.5,pane,roomLight,exposed);
                    roomLight*=afterHours*fixtureColor;
                    if(kind>12.5&&kind<13.5)pane=mix(pane,officeTone(urbanMaterial.y)*.53,.66);
                    ${glass?`float reflectance;
                        vec3 viewDir=normalize(cameraPosition-urbanPosition);
                        vec3 reflected=exteriorReflection(urbanPosition,n,viewDir,${night?'1.':'0.'},reflectance);
                        if(kind>12.5&&kind<13.5)reflectance=mix(reflectance,1.,${night?'.11':'.27'});
                        reflectance*=exposed;
                        glazingLight=reflected*reflectance*aperture;
                        pane*=1.-reflectance;roomLight*=1.-reflectance;`:''}
                    diffuseColor.rgb=mix(diffuseColor.rgb,pane,aperture*.95);
                    roomLight*=aperture;
                }
                urbanBounce=1.-aperture;
                ${night?`if(top&&kind>=9.&&kind!=17.){
                    diffuseColor.rgb*=kind==14.?vec3(.48,.54,.59):vec3(.69,.73,.79);
                    urbanBounce*=.58;
                }`:''}
            }
        `).replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
            vec3 sx=dFdx(-vViewPosition),sy=dFdy(-vViewPosition);
            vec3 r1=cross(sy,normal),r2=cross(normal,sx);
            float det=dot(sx,r1);
            float dx=dFdx(reliefHeight),dy=dFdy(reliefHeight);
            if(abs(det)>.000001)normal=normalize(normal-sign(det)*(r1*dx+r2*dy)/max(abs(det),.000001));
        `).replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
             totalEmissiveRadiance+=glazingLight;
             ${night?'totalEmissiveRadiance+=roomLight+urbanBounce*diffuseColor.rgb*vec3(.032,.039,.049);':'if(urbanMaterial.x==8.)totalEmissiveRadiance+=roomLight*.13;'}`);
    };
    material.customProgramCacheKey=()=>previousKey+(panes?'/district-atlas-v2':'/district-relief-v2')+(night?'/night':'/day');
}

export function applyDetailFinish(material,options){installFinish(material,options);}
export function applyFacadeFinish(material,options){installFinish(material,options);}

