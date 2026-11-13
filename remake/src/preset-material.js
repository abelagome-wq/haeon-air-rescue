import {glassShader} from './city-glass.js';

// The physical shell, shutters, roofs and glazing share one draw material.
// Its surface distances are metres, so masonry courses and window bays keep
// a consistent scale between a corner shop and a large office tower.
export function createPresetMaterial(T,texture,glass,night){
    const material=new T.MeshLambertMaterial({vertexColors:true,side:T.DoubleSide});
    material.name='Coastal architecture';
    material.customProgramCacheKey=()=>'coastal-presets-'+Number(night);
    material.onBeforeCompile=shader=>{
        Object.assign(shader.uniforms,glass.uniforms,{finishAtlas:{value:texture}});
        shader.vertexShader='attribute float urbanKind;varying vec3 lotPoint,lotNormal;varying float coating;\n'+shader.vertexShader
            .replace('#include <project_vertex>',`lotPoint=(modelMatrix*vec4(transformed,1.)).xyz;
                lotNormal=normalize(mat3(modelMatrix)*objectNormal);coating=urbanKind;
                #include <project_vertex>`);
        shader.fragmentShader='varying vec3 lotPoint,lotNormal;varying float coating;uniform sampler2D finishAtlas;\n'+glassShader+`
            float joint(float v,float halfWidth){
                float pixel=max(.0001,fwidth(v)),d=abs(fract(v+.5)-.5);
                return (1.-smoothstep(halfWidth,halfWidth+pixel,d))*(1.-smoothstep(.18,.60,pixel));
            }
            float roomValue(vec2 id){
                vec3 v=fract(vec3(id.xyx)*.1031);v+=dot(v,v.yzx+33.33);return fract((v.x+v.y)*v.z);
            }
        `+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
            float coat=floor(coating+.0001),lot=fract(coating);
            vec3 n=normalize(lotNormal);
            vec2 across=length(n.xz)>.05?normalize(vec2(n.z,-n.x)):vec2(1.,0.);
            vec2 plane=abs(n.y)>.56?vec2(dot(lotPoint.xz,across),dot(lotPoint.xz,vec2(-across.y,across.x))):
                vec2(dot(lotPoint.xz,across),lotPoint.y);
            vec3 windowLight=vec3(0.);
            diffuseColor.rgb*=mix(vec3(.93,.95,.96),vec3(1.06,1.02,.98),lot);
            if(coat==6.||coat==7.){
                vec2 bay=plane/vec2(coat==7.?2.10:1.65,coat==7.?3.6:3.12);
                vec2 pane=fract(bay);
                float frame=max(joint(bay.x,.016),joint(bay.y,.021));
                vec2 address=floor(bay)+vec2(floor(lot*41.),floor(lotPoint.z*.016));
                float occupancy=roomValue(address),suite=roomValue(vec2(floor(address.x/3.),address.y));
                vec3 eye=normalize(cameraPosition-lotPoint);float fresnel;
                vec3 reflected=exteriorReflection(lotPoint,n,eye,${night?'1.':'0.'},fresnel);
                float nearPane=1.-smoothstep(.07,.40,max(fwidth(bay.x),fwidth(bay.y)));
                float sill=(1.-smoothstep(.05,.17,pane.y))*nearPane;
                float blind=smoothstep(mix(.57,.96,suite)-.035,mix(.57,.96,suite)+.035,pane.y)*nearPane;
                float slats=.92+.08*cos(pane.y*85.)*nearPane;
                vec3 tint=diffuseColor.rgb*(.72+.21*occupancy)+vec3(.056,.072,.075)*blind*slats;
                diffuseColor.rgb=mix(tint,vec3(.11,.14,.15),max(frame,sill*.72));
                float glazed=(1.-frame)*(1.-sill*.83);
                // A warm rear wall and uneven shade reveal individual rooms.
                // Neighbouring panes share a suite; a whole tower never lights in lockstep.
                float shade=(.62+.32*pane.y)*(1.-blind*.68)*(.89+.11*cos(6.28*(pane.x+.22*suite))*nearPane);
                float lit=coat==7.?mix(.3,.8,suite):smoothstep(.52,.82,suite*.61+occupancy*.39);
                vec3 lamp=mix(vec3(.55,.27,.105),vec3(.32,.39,.37),smoothstep(.31,.88,roomValue(address+vec2(17.,9.))));
                windowLight=glazed*(reflected*(.26+.72*fresnel)
                    +${night?'1.':'0.'}*lamp*(coat==7.?.44:.38)*lit*shade);
            }else if(coat>1.){
                vec2 metres=plane/(coat==3.?vec2(2.6,2.):vec2(3.8));
                vec2 quadrant=(coat==3.||coat==9.)?vec2(0.):(coat==5.||coat==10.)?vec2(1.,0.):vec2(0.,1.);
                vec3 grain=textureGrad(finishAtlas,quadrant*.5+vec2(.003)+fract(metres)*.494,dFdx(metres)*.494,dFdy(metres)*.494).rgb;
                float lum=dot(grain,vec3(.2126,.7152,.0722));
                float seam=0.;
                if(coat==3.){float course=plane.y/.24;seam=max(joint(course,.027),joint(plane.x/.57+.5*mod(floor(course),2.),.025));}
                if(coat==4.)seam=joint(plane.x/.55,.027);
                if(coat==5.)seam=max(joint(plane.y/.38,.038),joint(plane.x/.31+.5*mod(floor(plane.y/.38),2.),.022));
                if(coat==9.)seam=max(joint(plane.y/1.20,.012),joint(plane.x/2.64+.5*mod(floor(plane.y/1.20),2.),.013));
                if(coat==10.)seam=joint(plane.x/.23,.018);
                if(coat==11.)seam=max(joint(plane.x/.31,.018),joint(plane.y/.31,.018));
                diffuseColor.rgb*=clamp(.91+lum*.26,.91,1.12)*(1.-.23*seam);
            }
        `).replace('#include <opaque_fragment>','outgoingLight+=windowLight;\n#include <opaque_fragment>');
    };
    return material;
}
