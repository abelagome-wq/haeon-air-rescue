// One camera-facing draw covers flame tongues, advecting smoke, a water stream
// and gas clouds. Shape, opacity and light vary inside each billboard.
export function createParticles(T,group,capacity=320,name='Incident flame, smoke and spray'){
    const geometry=new T.InstancedBufferGeometry();
    geometry.setIndex([0,1,2,0,2,3]);
    geometry.setAttribute('position',new T.Float32BufferAttribute([-.5,-.5,0,.5,-.5,0,.5,.5,0,-.5,.5,0],3));
    const poses=new T.InstancedBufferAttribute(new Float32Array(capacity*4),4).setUsage(T.DynamicDrawUsage);
    const styles=new T.InstancedBufferAttribute(new Float32Array(capacity*4),4).setUsage(T.DynamicDrawUsage);
    geometry.setAttribute('pose',poses);geometry.setAttribute('styleData',styles);
    const material=new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.DoubleSide,
        uniforms:{clock:{value:0}},
        vertexShader:`attribute vec4 pose,styleData; varying vec2 coords; varying vec4 style; varying float overhead;
            void main(){vec4 p=modelViewMatrix*vec4(pose.xyz,1.);
                overhead=smoothstep(.35,.92,abs(viewMatrix[1].z));
                vec2 size=vec2(styleData.y,1.);
                if(styleData.x<.5)size=mix(size,vec2(max(.5,styleData.y)),overhead);
                p.xy+=position.xy*pose.w*size;coords=position.xy+.5;style=styleData;
                gl_Position=projectionMatrix*p;}`,
        fragmentShader:`varying vec2 coords;varying vec4 style;varying float overhead;uniform float clock;
            float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.54);}
            float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),f.x),f.y);}
            void main(){vec2 p=coords-.5;float v=style.z,seed=style.w,k=style.x;
                float n=noise(coords*4.+vec2(seed,-clock*.62)),n2=noise(coords*9.+vec2(-clock*.13,seed));
                vec3 col;float a;
                if(k<.5){float u=coords.y;
                    float eddy=noise(vec2(coords.x*5.+n*2.+seed,coords.y*3.-clock*2.1));
                    vec2 q=p+vec2((n-.5)*.22+(eddy-.5)*.15,(n2-.5)*.10);
                    float side=length(vec2(q.x/(.37-.23*u),q.y/.49));
                    float top=length(q)/(.40+.08*eddy);
                    float core=1.-mix(side,top,overhead);
                    a=smoothstep(-.04,.34,core)*(.67+.27*eddy);
                    float hot=smoothstep(.1,.78,core+.26*eddy-.16*u);
                    col=mix(vec3(.63,.055,.008),vec3(1.,.44,.055),hot);
                    col=mix(col,vec3(1.,.86,.49),hot*hot*.84);
                }else{float r=length(p*vec2(1.03,1.));float irregular=r+(n-.5)*.15+(n2-.5)*.055;
                    a=(1.-smoothstep(.23,.51,irregular))*(1.-v);
                    if(k<1.5){col=mix(vec3(.075,.089,.098),vec3(.41,.43,.44),n*.60+v*.30);a*=.56;}
                    else if(k<2.5){col=mix(vec3(.50,.75,.86),vec3(.94,.99,1.),n);a*=.8;}
                    else{col=mix(vec3(.64,.68,.57),vec3(.84,.86,.76),n);a*=.54;}}
                if(a<.016)discard;gl_FragColor=vec4(col,a);
                #include <colorspace_fragment>
            }`});
    const mesh=new T.Mesh(geometry,material);mesh.name=name;mesh.frustumCulled=false;group.add(mesh);mesh.visible=false;
    let count=0;
    return {begin(t){count=0;material.uniforms.clock.value=t;},
        add(x,y,z,h,kind,aspect,age,seed){
            if(count>=capacity)return;
            poses.setXYZW(count,x,y,z,h);styles.setXYZW(count,kind,aspect,age,seed);count++;
        },
        end(){geometry.instanceCount=count;mesh.visible=count>0;
            for(const a of [poses,styles]){a.clearUpdateRanges();if(count){a.addUpdateRange(0,count*4);a.needsUpdate=true;}}},
        dispose(){mesh.removeFromParent();geometry.dispose();material.dispose();}
    };
}
