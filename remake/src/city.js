import modelTable from './city-models-data.js';
import {loadFarKit} from './far-kit.js';
import {createDetails} from './city-details.js';
import {createCityGlass,rooflineShader} from './city-glass.js';
import {cityPresets,createPresetPlanner} from './city-presets.js';
import {buildPresetMesh} from './preset-mesh.js';
import {createPresetMaterial} from './preset-material.js';
import {addAvenueTrees} from './avenue-trees.js';
import {addCargoQuay} from './cargo-quay.js';
import {addParcelProps} from './parcel-props.js';
import {createFlightScenery} from './flight-scenery.js';
import {addBridgeSpans,bridgeLevel} from './bridge-spans.js';
import {buildBridgeGeometry} from './bridge-architecture.js';
import {addRoadSurfaces,isRoadCode,drawRoadMap} from './road-surface.js';
import {addRoadFixtures} from './road-fixtures.js';
import {isStreetProp,addStreetObjects} from './street-assets.js';
import {buildRoadGraph,networkPorts} from './road-topology.js';
import {createRoadGrade} from './road-grade.js';
import {prepareRoadPaths} from './road-path.js';
import {parseGeneratedCityId,generateCity} from './generated-city.js';
export {networkPorts};

const N=128, TILE=16, EXTENT=1024, STEP=4, CORNERS=129;
const slopeBits=['0000','1100','0101','0011','1010','1101','0111','1011','1110','0100','0001','0010','1000','1111'];
const inMap=(x,z)=>x>=0&&z>=0&&x<N&&z<N;
const clamp=(x,lo,hi)=>Math.min(hi,Math.max(lo,x));
const cellX=i=>i*TILE-EXTENT+8;
const lookup=i=>modelTable[i];
const special=(code)=>code>=81&&code<=96||code===106||code===107||code===221||code===223;

export async function fetchCityData(id){
    const world=parseGeneratedCityId(id);
    if(!world)throw Error('생성할 도시를 확인하세요.');
    return generateCity(world.size,world.seed);
}

function decode(source){
    const layers={};
    for(const [k,str] of Object.entries(source.layers)){
        const bytes=str instanceof Uint8Array?str:Uint8Array.from(atob(str),c=>c.charCodeAt(0));
        if(bytes.length!==N*N)throw Error('도시 타일 수 불일치: '+k);
        layers[k]=bytes;
    }
    return layers;
}

function terrainGrid(l){
    const heights=new Float32Array(CORNERS*CORNERS),counts=new Uint8Array(heights.length);
    const split=new Uint8Array(N*N);
    for(let i=0;i<N*N;i++){
        const col=i%N,row=i>>7,ter=l.terrain[i],level=l.height[i]*STEP;
        const bits=ter<62?(slopeBits[ter&15]||'0000'):'0000';
        // Isolate a single high/low corner on its own triangle.
        split[i]=bits==='1000'||bits==='0001'||bits==='0111'||bits==='1110'?1:0;
        for(let n=0;n<4;n++){
            const corner=(row+(n>>1))*CORNERS+col+(n&1);
            heights[corner]+=level+Number(bits[n])*STEP;counts[corner]++;
        }
    }
    for(let i=0;i<heights.length;i++)heights[i]/=counts[i];
    return {heights,split};
}

export function createCitySampler(data){
    if(data.width!==N||data.height!==N||data.tileSize!==TILE)throw Error('지원 범위를 벗어난 도시 크기');
    const l=decode(data),{heights,split}=terrainGrid(l);
    const tileToWorld=(col,row)=>({x:cellX(col),z:cellX(row)});
    const worldToTile=(x,z)=>({col:Math.floor((x+EXTENT)/TILE),row:Math.floor((z+EXTENT)/TILE)});
    function groundAt(x,z){
        const gx=clamp((x+EXTENT)/TILE,0,N),gz=clamp((z+EXTENT)/TILE,0,N);
        const col=Math.min(N-1,Math.floor(gx)),row=Math.min(N-1,Math.floor(gz)),u=gx-col,v=gz-row;
        const p=row*CORNERS+col,a=heights[p],b=heights[p+1],c=heights[p+CORNERS],d=heights[p+CORNERS+1];
        if(split[row*N+col])return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
        return u>=v?a+(b-a)*u+(d-b)*v:a+(d-c)*u+(c-a)*v;
    }
    function wetLevel(i,x,z,ground){
        const t=l.terrain[i];
        if(t<16)return null;
        if(t<48){
            const y=(l.water[i]-.5)*STEP;
            return y>ground+.015?y:null;
        }
        if(t<63)return ground+.11;
        const dx=x-cellX(i%N),dz=z-cellX(i>>7);
        const r=2.15;
        if(t===64&&Math.abs(dz)<=r||t===65&&Math.abs(dx)<=r)return ground+.09;
        if(t>=66&&t<=69){
            const edge=[8-dz,dx+8,dz+8,8-dx][t-66];
            const across=t%2===0?dx:dz;
            if(edge>=0&&edge*edge+across*across<7.1*7.1)return ground+.09;
        }
        return null;
    }
    // Build the topology first; grade calculation uses precisely its real
    // reciprocal ports, including ramps and both channels of a crossover.
    const roads=buildRoadGraph(l,data.compass,(i,x,z)=>groundAt(x,z));
    prepareRoadPaths(roads);
    const roadGrade=createRoadGrade(l,roads,groundAt,data.compass);
    for(const node of roads)node.y=roadGrade.heightInTile(node.tileId,node.x,node.z,node.level);
    const rotate=i=>!!(l.flags[i]&2);
    function tileAt(x,z){
        const {col,row}=worldToTile(x,z);
        if(!inMap(col,row))return null;
        const i=row*N+col,code=l.building[i],g=groundAt(x,z),w=wetLevel(i,x,z,g);
        const roadY=roadGrade.heightInTile(i,x,z),railY=roadGrade.heightInTile(i,x,z,'rail');
        return {col,row,x:cellX(col),z:cellX(row),building:code,terrain:l.terrain[i],zone:l.zone[i]&15,
            groundY:g,water:w!==null,waterY:w,road:roadY!==null,roadY,rail:railY!==null,railY,rotate:rotate(i)};
    }
    function surfaceAt(x,z){
        const t=tileAt(x,z);
        return t?Math.max(t.groundY,t.waterY??-Infinity,t.roadY??-Infinity,t.railY??-Infinity):groundAt(x,z);
    }
    const landmarks=[],placements=[],obstacles=new Array(N*N);
    const planPreset=data.generated&&createPresetPlanner(data.generated.seed,new Set(roads.filter(r=>r.level==='street').map(r=>r.tileId)));
    for(const [code,col,row,w,h] of data.placements){
        const m=lookup(code),x=cellX(col)+(w-1)*8,z=cellX(row)+(h-1)*8,i=row*N+col;
        const y=groundAt(x,z),rot=rotate(i);
        const model=m.id, widthM=w*TILE,depthM=h*TILE;
        const p={code,col,row,w,h,x,y,z,model,rotate:rot,roofY:y+m.max[1],widthM,depthM};
        if(planPreset){
            const preset=planPreset(p,l.zone[i]&15,m.max[1]);
            if(preset){p.preset=preset;p.roofY=y+.015+preset.h;}
        }
        placements.push(p);
        // Rooftop collisions follow the archived object's actual bounds rather than its entire zoning lot.
        if(m.max[1]>2.2&&code!==213&&code!==223&&code!==238&&code!==239){
            if(p.preset){
                const {turn,w,d}=p.preset,halfX=(turn%2?d:w)/2,halfZ=(turn%2?w:d)/2;
                p.x0=x-halfX;p.x1=x+halfX;p.z0=z-halfZ;p.z1=z+halfZ;
            }else{p.x0=x+m.min[0];p.x1=x+m.max[0];p.z0=z+m.min[2];p.z1=z+m.max[2];}
            for(let iz=0;iz<h;iz++)for(let ix=0;ix<w;ix++)obstacles[(row+iz)*N+col+ix]=p;
        }
        const kind=({209:'hospital',210:'police',211:'fire',223:'port',224:'port',225:'airport',226:'airport',232:'airport',246:'airport',248:'port'})[code];
        if(kind)landmarks.push({...p,kind});
    }
    function obstacleAt(x,z){
        const {col,row}=worldToTile(x,z);
        if(!inMap(col,row))return null;
        const p=obstacles[row*N+col];
        return p&&x>=p.x0&&x<=p.x1&&z>=p.z0&&z<=p.z1?p:null;
    }
    const airport=landmarks.filter(v=>v.kind==='airport').sort((a,b)=>Number(b.code===246)-Number(a.code===246)||Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z))[0];
    const target=airport??roads[Math.floor(roads.length/2)]??{x:0,z:0};
    let best=Infinity,spawn=null;
    for(let i=0;i<N*N;i++){
        const code=l.building[i],col=i%N,row=i>>7;
        if((code!==0&&code!==221&&code!==222)||col<2||row<2||col>N-3||row>N-3)continue;
        const x=cellX(col),z=cellX(row),d=Math.hypot(x-target.x,z-target.z);
        if(d>best+24)continue;
        const y=groundAt(x,z),corners=[[0,0],[-7,-7],[-7,7],[7,-7],[7,7]];
        if(corners.some(([a,b])=>wetLevel(i,x+a,z+b,groundAt(x+a,z+b))!==null||Math.abs(groundAt(x+a,z+b)-y)>.55||obstacleAt(x+a,z+b)))continue;
        const score=d+(code===0?0:24);
        if(score<best){best=score;spawn={x,y:y+.075,z,col,row,heading:0};}
    }
    if(!spawn)throw Error('평평한 이륙 구역을 찾지 못했습니다: '+data.name);
    const ships=(data.ships??[]).map(ship=>{
        const p=tileToWorld(ship.col,ship.row),t=tileAt(p.x,p.z);
        if(t?.waterY==null)throw Error('원작 화물선 수면 좌표 오류: '+data.name);
        return {...ship,...p,y:t.waterY,code:3};
    });
    // Face a populated approach, keeping the 20 m chase camera clear of the neighboring tower.
    let view=-Infinity;
    for(let deg=0;deg<360;deg+=15){
        const rad=deg*Math.PI/180,dx=Math.sin(rad),dz=-Math.cos(rad);
        let score=0;
        for(const p of placements){
            const vx=p.x-spawn.x,vz=p.z-spawn.z,dist=Math.hypot(vx,vz);
            if(dist<35||dist>560)continue;
            const facing=(vx*dx+vz*dz)/dist;
            score+=Math.max(0,facing-.65)*(p.roofY-p.y+3)*65/(dist+30);
        }
        for(let d=4;d<=24;d+=4){
            const roof=obstacleAt(spawn.x-d*dx,spawn.z-d*dz);
            if(roof&&roof.roofY>spawn.y+2)score-=1000;
        }
        for(let d=4;d<=100;d+=4){
            const x=spawn.x+d*dx,z=spawn.z+d*dz,obstacle=obstacleAt(x,z);
            const clearance=Math.max(groundAt(x,z),obstacle?.roofY??-Infinity)-spawn.y;
            if(clearance>5+d*.045){score-=3000;break;}
        }
        if(score>view){view=score;spawn.heading=deg;}
    }
    return {cityId:data.id,name:data.name,generated:data.generated,citySize:data.citySize,tileSize:TILE,spawn,roads,landmarks,placements,ships,
        bounds:data.playBounds??{minX:-EXTENT,maxX:EXTENT,minZ:-EXTENT,maxZ:EXTENT},groundAt,surfaceAt,tileAt,tileToWorld,worldToTile,networkPorts,
        roadHeightAt:roadGrade.heightAt,railHeightAt:(x,z)=>roadGrade.heightAt(x,z,'rail'),roadProfileAt:roadGrade.profileAt,
        roofAt:(x,z)=>obstacleAt(x,z)?.roofY??-Infinity,
        buildingAt:obstacleAt,obstacleAt,layers:l,heights,split};
}

function meshGeometry(T,positions,indices,colors){
    const geometry=new T.BufferGeometry();
    geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    if(colors)geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
    if(indices)geometry.setIndex(indices);
    geometry.computeVertexNormals();geometry.computeBoundingSphere();
    return geometry;
}

function addTerrain(T,city,group,owned){
    const points=[],colors=[],indices=[];
    const palettes={field:[.11,.167,.09],tree:[.070,.123,.086],beach:[.42,.36,.24],earth:[.185,.169,.113],
        homes:[.123,.159,.106],paving:[.165,.176,.181],airport:[.139,.159,.168],water:[.088,.141,.148]};
    const {layers:l,heights,split}=city;
    const cornerColors=new Float32Array(CORNERS*CORNERS*3),weights=new Uint8Array(CORNERS*CORNERS);
    const vegetation=new Float32Array(CORNERS*CORNERS);
    for(let row=0;row<N;row++)for(let col=0;col<N;col++){
        const i=row*N+col,code=l.building[i],t=l.terrain[i],zone=l.zone[i]&15;
        let key=t>=16&&t<32?'water':t>=32&&t<48?'beach':code>=6&&code<=12?'tree':
            code>=221&&code<=232&&code!==223?'airport':
            (code>=112&&code<=197?(zone===1||zone===2?'homes':'paving'):code>=198?'paving':'field');
        if(key==='field'&&t>0&&t<13)key='earth';
        const base=palettes[key],corner=row*CORNERS+col;
        for(let j=0;j<4;j++){
            const index=corner+(j&1)+(j>>1)*CORNERS;weights[index]++;
            if(['field','tree','homes','earth'].includes(key))vegetation[index]++;
            for(let k=0;k<3;k++)cornerColors[3*index+k]+=base[k];
        }
        const order=split[i]?[0,2,1,1,2,3]:[0,2,3,0,3,1];
        for(const ix of order)indices.push(corner+(ix&1)+(ix>>1)*CORNERS);
    }
    for(let row=0;row<=N;row++)for(let col=0;col<=N;col++){
        const i=row*CORNERS+col;
        points.push(col*TILE-EXTENT,heights[i],row*TILE-EXTENT);vegetation[i]/=weights[i];
        const variation=1+.075*Math.sin(col*.141+Math.cos(row*.13)*2.1)+.042*Math.cos(row*.267+col*.117);
        for(let k=0;k<3;k++)colors.push(variation*cornerColors[3*i+k]/weights[i]);
    }
    const geo=meshGeometry(T,points,indices,colors),mat=new T.MeshLambertMaterial({vertexColors:true});
    geo.setAttribute('cover',new T.BufferAttribute(vegetation,1));
    const turf=new T.TextureLoader().load(new URL('../art/haeon-coastal-turf.webp',import.meta.url).href);
    turf.wrapS=turf.wrapT=T.MirroredRepeatWrapping;turf.anisotropy=4;owned.push(turf);
    mat.onBeforeCompile=s=>{
        s.uniforms.turf={value:turf};
        s.vertexShader='attribute float cover; varying vec3 vTerrain;\n'+s.vertexShader.replace(
            '#include <begin_vertex>','#include <begin_vertex>\n vTerrain=vec3(position.xz,cover);');
        s.fragmentShader='uniform sampler2D turf; varying vec3 vTerrain;\n'+s.fragmentShader.replace(
            '#include <color_fragment>',`#include <color_fragment>
            vec3 grass=texture2D(turf,vTerrain.xy/12.).rgb;
            float detail=dot(grass,vec3(.27,.60,.13))-.37;
            float nearGround=1.-smoothstep(70.,260.,distance(vTerrain.xy,cameraPosition.xz));
            diffuseColor.rgb*=1.+detail*1.8*nearGround*vTerrain.z;`);
    };
    const land=new T.Mesh(geo,mat);land.name='city-terrain';land.receiveShadow=true;group.add(land);owned.push(geo,mat);
    // The map has finite limits; terrain skirts close the visible edges against the sky.
    const outer=[],idx=[];
    for(let k=0;k<4;k++)for(let n=0;n<N;n++){
        const side=(j)=>k===0?[-EXTENT,cellX(j)-8]:k===1?[EXTENT,cellX(j)-8]:k===2?[cellX(j)-8,-EXTENT]:[cellX(j)-8,EXTENT];
        const a=side(n),b=side(n+1),v=outer.length/3;
        for(const p of [a,b])outer.push(p[0],city.groundAt(...p)-.02,p[1]);
        for(const p of [b,a])outer.push(p[0]+(k===0?-150:k===1?150:0),-26,p[1]+(k===2?-150:k===3?150:0));
        idx.push(v,v+1,v+2,v,v+2,v+3);
    }
    const g=meshGeometry(T,outer,idx),m=new T.MeshLambertMaterial({color:0x737858,side:T.DoubleSide});
    const skirt=new T.Mesh(g,m);skirt.name='SC2 map boundary';group.add(skirt);owned.push(g,m);
}

function addWater(T,city,group,owned,glass,night){
    const positions=[],indices=[],depths=[],colors=[],clock={value:0};
    const l=city.layers;
    function polygon(i,xy,level,flow){
        const start=positions.length/3;
        for(const [x,z] of xy){
            const g=city.groundAt(x,z),y=flow?g+.115:level,d=Math.max(0,y-g);
            positions.push(x,y,z);depths.push(flow?1:d);
            const mix=Math.min(1,d/12);
            colors.push(.060-.041*mix,.249-.125*mix,.251-.074*mix);
        }
        for(let j=1;j<xy.length-1;j++)indices.push(start,start+j+1,start+j);
    }
    for(let i=0;i<N*N;i++){
        const t=l.terrain[i];if(t<16)continue;
        const x=cellX(i%N),z=cellX(i>>7);
        if(t>=16&&t<63){
            const box=[[x-8,z-8],[x+8,z-8],[x+8,z+8],[x-8,z+8]];
            if(t<48)polygon(i,box,(l.water[i]-.5)*STEP,false);
            else {
                const order=city.split[i]?[0,1,3,1,2,3]:[0,1,2,0,2,3];
                for(let j=0;j<6;j+=3)polygon(i,order.slice(j,j+3).map(k=>box[k]),0,true);
            }
        }else if(t===64||t===65){
            const w=t===64?8:2.15,d=t===65?8:2.15;
            polygon(i,[[x-w,z-d],[x+w,z-d],[x+w,z+d],[x-w,z+d]],0,true);
        }else if(t>=66&&t<=69){
            const poly=[],angle=(t-66)*Math.PI/2;
            for(let j=0;j<=12;j++){
                const a=Math.PI*j/12,across=7.1*Math.cos(a),along=8-7.1*Math.sin(a);
                poly.push([x+across*Math.cos(angle)-along*Math.sin(angle),z+across*Math.sin(angle)+along*Math.cos(angle)]);
            }
            polygon(i,poly,0,true);
        }
    }
    if(!positions.length)return clock;
    const footprint={value:new T.Vector4(0,0,0,0)},washLevel={value:0};
    let lastFlight,lastTime=0;
    city.updateWaterWash=(source,flight)=>{
        const time=flight.state.weather?.elapsed??0,ring=footprint.value;
        const dt=Math.min(.15,Math.max(0,time-lastTime));
        if(flight!==lastFlight||time<lastTime)ring.w=0;
        lastFlight=flight;lastTime=time;
        if(source?.openWater){
            ring.x=source.x+source.windX*.12;ring.y=source.z+source.windZ*.12;
            ring.z=source.radius;washLevel.value=source.y;
            ring.w+=(source.strength-ring.w)*(1-Math.exp(-4*dt));
        }else{
            ring.w*=Math.exp(-2.4*dt);
            if(ring.w<.002)ring.w=0;
        }
    };
    const g=meshGeometry(T,positions,indices,colors);g.setAttribute('waterDepth',new T.Float32BufferAttribute(depths,1));
    const m=new T.MeshPhongMaterial({vertexColors:true,shininess:46,specular:0x263641,side:T.DoubleSide});
    const surfaceWind={value:new T.Vector2()};
    city.updateWaterWind=sample=>{
        surfaceWind.value.set(sample?.windX??0,sample?.windZ??0);
    };
    m.onBeforeCompile=s=>{
        Object.assign(s.uniforms,glass.uniforms);s.uniforms.waterTime=clock;s.uniforms.surfaceWind=surfaceWind;
        s.uniforms.rotorFootprint=footprint;s.uniforms.rotorLevel=washLevel;
        s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nattribute float waterDepth;varying float shoreDepth;varying vec3 waterPoint;')
            .replace('#include <begin_vertex>','#include <begin_vertex>\nwaterPoint=position;shoreDepth=waterDepth;');
        s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\n'+rooflineShader+'\nvarying vec3 waterPoint;varying float shoreDepth;uniform vec2 surfaceWind;uniform float waterTime;uniform vec4 rotorFootprint;uniform float rotorLevel;')
            .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
                vec2 p=waterPoint.xz;float t=waterTime;
                float eddy=sin(p.x*.067+p.y*.043+t*.19)+.58*sin(p.y*.094-p.x*.028-t*.13);
                float wind=clamp(length(surfaceWind)/12.,0.,1.);
                vec2 windDir=normalize(vec2(.6,.24)+surfaceWind*.22+vec2(.0001));
                vec2 windAcross=vec2(-windDir.y,windDir.x);
                float w1=sin(dot(p,windDir)*.51+eddy*1.6+t*(1.05+wind*.9));
                float w2=sin(dot(p,windAcross)*.59+eddy*1.15-t*(.82+wind*.65));
                float w3=sin(dot(p,vec2(1.42,.68))+eddy*1.9+t*1.82);
                float w4=cos(dot(p,vec2(-.75,1.57))+eddy*1.4-t*1.61);
                float dist=length(vViewPosition);float farFade=1.-smoothstep(75.,380.,dist);
                vec2 slope=(windDir*w1+windAcross*w2)*(.033+wind*.052)+vec2(w3,w4)*.021*farFade;
                vec3 wn=normalize(vec3(slope.x,1.,slope.y));
                float crest=0.;
                if(rotorFootprint.w>0. && abs(waterPoint.y-rotorLevel)<.8){
                    vec2 delta=p-rotorFootprint.xy;
                    float d=length(delta),r=max(1.,rotorFootprint.z);
                    float wash=rotorFootprint.w*(1.-smoothstep(r*.35,r*2.,d));
                    float waves=sin(d*2.8-t*6.1+eddy*1.3);
                    wn.xz+=delta/max(d,.4)*waves*.16*wash;
                    crest=smoothstep(.35,.94,waves)*wash*(.55+.15*eddy);
                }
                normal=normalize(mat3(viewMatrix)*wn);
                diffuseColor.rgb*=1.+.021*eddy+.015*farFade*(w3+w4);
                diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.45,.63,.65),crest*.39);
                float nearshore=1.-smoothstep(.08,.42,shoreDepth);
                float shoreRipple=.5+.5*sin(p.x*.89+p.y*.67+t*1.4+2.*eddy);
                diffuseColor.rgb+=.13*nearshore*smoothstep(.51,.95,shoreRipple)*vec3(.78,.93,.94);`)
            .replace('#include <opaque_fragment>',`
                vec3 eye=normalize(cameraPosition-waterPoint),bounce=reflect(-eye,wn);
                float az=atan(bounce.z,bounce.x)*.159154943;
                vec4 coast=citySkyline(waterPoint,az);
                float altitude=coast.r*2.-1.,sky=smoothstep(altitude-.017,altitude+.017,bounce.y);
                float fresnel=.028+.84*pow(1.-clamp(dot(wn,eye),0.,1.),4.);
                vec3 skyColour=mix(glassHaze,${night?'vec3(.014,.028,.070)':'vec3(.14,.34,.57)'},smoothstep(.015,.65,bounce.y)*(1.-.74*glassCloud));
                vec3 reflected=mix(${night?'vec3(.008,.014,.020)':'vec3(.062,.089,.10)'},skyColour,sky);
                float spec=pow(max(0.,dot(bounce,glassLightDir)),mix(155.,75.,wind));
                reflected+=spec*(1.-glassCloud)*sky*${night?'vec3(1.3,1.55,2.1)':'vec3(4.0,3.3,2.2)'};
                ${night?`float strip=pow(.5+.5*cos(az*735.+sin(az*133.)),6.);
                float lampBand=smoothstep(-.04,.01,bounce.y)*(1.-sky)*coast.a;
                reflected+=lampBand*(.15+.85*strip)*vec3(1.06,.56,.21);`:''}
                outgoingLight=mix(outgoingLight,reflected,fresnel);
                #include <opaque_fragment>`);
    };
    m.customProgramCacheKey=()=>night?'coastal-reflection-night-v2':'coastal-reflection-day-v2';
    const water=new T.Mesh(g,m);water.name='SC2 water';group.add(water);owned.push(g,m);return clock;
}

function addPad(T,city,group,owned){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
    const c=canvas.getContext('2d');c.fillStyle='#77888c';c.fillRect(0,0,512,512);
    c.fillStyle='#4a5960';c.fillRect(8,8,496,496);
    c.strokeStyle='#69777a';c.lineWidth=2;
    for(const n of [128,256,384]){c.beginPath();c.moveTo(n,8);c.lineTo(n,504);c.stroke();c.beginPath();c.moveTo(8,n);c.lineTo(504,n);c.stroke();}
    c.strokeStyle='#e4e9e3';c.lineWidth=8;c.beginPath();c.arc(256,256,182,0,2*Math.PI);c.stroke();
    c.fillStyle='#f2f1e7';c.fillRect(181,172,26,168);c.fillRect(305,172,26,168);c.fillRect(200,244,115,25);
    c.fillStyle='#ed8263';for(let n=32;n<480;n+=36){c.fillRect(n,20,18,5);c.fillRect(n,487,18,5);}
    c.fillStyle='#dbe7e5';c.textAlign='center';c.font='bold 19px sans-serif';c.fillText('HAEON  01',256,468);
    const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;tex.anisotropy=4;
    const m=new T.MeshLambertMaterial({map:tex,polygonOffset:true,polygonOffsetFactor:-1});
    const g=new T.PlaneGeometry(15.3,15.3,4,4);g.rotateX(-Math.PI/2);
    const p=g.attributes.position;
    for(let i=0;i<p.count;i++)p.setY(i,city.groundAt(city.spawn.x+p.getX(i),city.spawn.z+p.getZ(i))+.085);
    g.computeVertexNormals();const pad=new T.Mesh(g,m);
    pad.name='Departure helipad';pad.position.set(city.spawn.x,0,city.spawn.z);pad.receiveShadow=true;group.add(pad);owned.push(tex,m,g);
}

function runwayAngle(city,p){
    const i=p.row*N+p.col,l=city.layers.building;
    const same=j=>j>=0&&j<N*N&&(l[j]===221||l[j]===222);
    const ns=Number(same(i-N))+Number(same(i+N));
    const ew=Number(p.col>0&&same(i-1))+Number(p.col<N-1&&same(i+1));
    return ns>ew||ns===ew&&p.rotate?-Math.PI/2:0;
}

function addRunwayMarkings(T,city,group,owned){
    const positions=[],indices=[],l=city.layers.building;
    for(const p of city.placements){
        if(p.code!==221)continue;
        const ns=runwayAngle(city,p)!==0,i=p.row*N+p.col;
        const mark=(a,b,c,d)=>{
            const j=positions.length/3;
            for(const [u,v] of [[a,b],[c,b],[c,d],[a,d]]){
                const x=p.x+(ns?u:v),z=p.z+(ns?v:u);
                positions.push(x,city.groundAt(x,z)+.085,z);
            }
            indices.push(j,j+1,j+2,j,j+2,j+3);
        };
        for(const side of [-1,1])mark(side*6.32-.075,-8,side*6.32+.075,8);
        mark(-.14,-2,.14,2);
        for(const sign of [-1,1]){
            const col=p.col+(ns?0:sign),row=p.row+(ns?sign:0);
            const adjacent=l[i+sign*(ns?N:1)];
            if(inMap(col,row)&&(adjacent===221||adjacent===222))continue;
            const a=sign*4.7,b=sign*6.75;
            for(const u of [-4.6,-3.15,-1.7,1.7,3.15,4.6])mark(u-.25,Math.min(a,b),u+.25,Math.max(a,b));
        }
    }
    if(!positions.length)return;
    const g=meshGeometry(T,positions,indices),m=new T.MeshBasicMaterial({color:0xb9b69d,side:T.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1});
    const markings=new T.Mesh(g,m);markings.name='Airfield runway markings';group.add(markings);owned.push(g,m);
}

async function addFreighters(ctx,city,group){
    if(!city.ships.length)return [];
    const template=await ctx.assets.load('models/complete/city/XTHG03-Ship.glb');
    const ships=[];
    for(const p of city.ships){
        const ship=template.clone(true);
        ship.name='XTHG03 · SC2 slot '+p.slot;
        // The XTHG record's north (-source Y) maps to world east (+X),
        // and its east (+source X) maps to world south (+Z).
        ship.rotation.y=Math.PI-(p.rotation+2)*Math.PI/4;
        ship.position.set(p.x,p.y,p.z);group.add(ship);ships.push(ship);
        city.flightScenery.addObject(ship,'ship');
    }
    return ships;
}

export function makeMinimap(city){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
    const c=canvas.getContext('2d'),l=city.layers;
    const water=new Uint8Array(N*N);
    for(let i=0;i<N*N;i++){
        const col=i%N,row=i>>7,code=l.building[i],x=cellX(col),z=cellX(row),t=city.tileAt(x,z);
        water[i]=t.water?1:0;
        c.fillStyle=t.water?'#34667d':t.rail?'#8b999e':code>=112?'#748791':code>=6&&code<=13?'#617e78':
            'hsl(193 14% '+(48+Math.min(17,l.height[i]*.48))+'%)';
        c.fillRect(col*4,row*4,4,4);
    }
    c.strokeStyle='#a8ced3';c.lineWidth=.85;c.beginPath();
    for(let i=0;i<N*N;i++){
        if(!water[i])continue;
        const x=(i%N)*4,y=(i>>7)*4;
        if(x>0&&!water[i-1]){c.moveTo(x,y);c.lineTo(x,y+4);}
        if(x<508&&!water[i+1]){c.moveTo(x+4,y);c.lineTo(x+4,y+4);}
        if(y>0&&!water[i-N]){c.moveTo(x,y);c.lineTo(x+4,y);}
        if(y<508&&!water[i+N]){c.moveTo(x,y+4);c.lineTo(x+4,y+4);}
    }
    c.stroke();
    drawRoadMap(c,city);
    for(const p of city.landmarks){
        const x=(p.col+p.w/2)*4,y=(p.row+p.h/2)*4;
        const marks={airport:['H','#163f53'],hospital:['+','#9e453c'],police:['P','#355b82'],fire:['F','#ab5343'],port:['≋','#386773']};
        const mark=marks[p.kind];if(!mark)continue;
        c.fillStyle=mark[1];c.fillRect(x-4.5,y-4.5,9,9);
        c.fillStyle='#f0f6f7';c.font='bold 8px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(mark[0],x,y+.3);
    }
    return canvas;
}

function bakeStaticBlock(T,parts,owned,group,material,name='SC2 block of original structures'){
    const count=parts.reduce((n,p)=>n+p.geometry.attributes.position.count,0);
    const indexCount=parts.reduce((n,p)=>n+(p.geometry.index?.count??p.geometry.attributes.position.count),0);
    const position=new Float32Array(3*count),normal=new Int8Array(3*count),uv=new Float32Array(2*count);
    const colors=new Uint8Array(3*count),rect=parts[0].geometry.attributes.farRect?new Float32Array(4*count):null;
    const kinds=parts.some(p=>p.geometry.attributes.urbanKind)?new Float32Array(count):null;
    const indices=count<65536?new Uint16Array(indexCount):new Uint32Array(indexCount);
    let v=0,ix=0,reach=0;
    for(const {geometry,item,range} of parts){
        const a=geometry.attributes,m=item.matrix.elements,n=a.position.count;
        if(kinds&&a.urbanKind){
            const seed=m[12]*.01357+m[14]*.03173,variation=(seed-Math.floor(seed))*.997;
            for(let j=0;j<n;j++){const kind=a.urbanKind.getX(j);kinds[v+j]=kind>0?kind+variation:0;}
        }
        reach=Math.max(reach,range);
        for(let j=0;j<n;j++){
            const x=a.position.array[3*j],y=a.position.array[3*j+1],z=a.position.array[3*j+2],k=3*(j+v);
            position[k]=x*m[0]+z*m[8]+m[12];position[k+1]=y*m[5]+m[13];position[k+2]=x*m[2]+z*m[10]+m[14];
            const nx=a.normal.array[j*3],ny=a.normal.array[j*3+1]/Math.max(.001,m[5]),nz=a.normal.array[j*3+2];
            const s=127/(Math.hypot(nx,ny,nz)||127);
            normal[k]=Math.round((nx*m[0]+nz*m[8])*s);normal[k+1]=Math.round(ny*s);normal[k+2]=Math.round((nx*m[2]+nz*m[10])*s);
        }
        uv.set(a.uv.array,v*2);colors.set(a.color.array,v*3);if(rect)rect.set(a.farRect.array,v*4);
        const index=geometry.index;
        for(let j=0;j<(index?.count??n);j++)indices[ix++]=v+(index?index.array[j]:j);
        v+=n;
    }
    const g=new T.BufferGeometry();
    for(const [name,array,size,norm] of [['position',position,3,false],['normal',normal,3,true],
        ['uv',uv,2,false],['color',colors,3,true]]){
        g.setAttribute(name,new T.BufferAttribute(array,size,norm));
    }
    if(rect)g.setAttribute('farRect',new T.BufferAttribute(rect,4));
    if(kinds)g.setAttribute('urbanKind',new T.BufferAttribute(kinds,1));
    g.setIndex(new T.BufferAttribute(indices.slice(),1).setUsage(T.DynamicDrawUsage));g.computeBoundingSphere();
    const mesh=new T.Mesh(g,material);mesh.name=name;group.add(mesh);owned.push(g);
    let filtered=false;
    return {mesh,reach,center:g.boundingSphere.center,radius:g.boundingSphere.radius,
        override(placements){
            const needs=parts.some(p=>placements.has(p.item.placement));
            if(!needs&&!filtered)return;
            if(!needs){g.index.array.set(indices);g.index.needsUpdate=true;g.setDrawRange(0,indices.length);filtered=false;return;}
            const all=g.index.array;let read=0,write=0;
            for(const {geometry,item} of parts){
                const length=geometry.index?.count??geometry.attributes.position.count;
                if(!placements.has(item.placement)){all.set(indices.subarray(read,read+length),write);write+=length;}
                read+=length;
            }
            g.index.needsUpdate=true;
            filtered=true;g.setDrawRange(0,write);
        }
    };
}

function addStructures(T,city,kit,group,owned,detail,presetMaterial){
    const batches=new Map(),l=city.layers,temp=new T.Object3D();
    const presetMeshes=new Map(),presetBlocks=new Map();
    function entry(model,code,x,y,z,rot=0,scaleY=1,placement=null){
        const source=kit.get(model);
        if(!source)return;
        if(!batches.has(model))batches.set(model,{source,code,items:[],swap:code>=14&&code<=111&&!(code>=59&&code<=62||code>=108&&code<=111)});
        temp.position.set(x,y,z);temp.rotation.set(0,rot,0);temp.scale.set(1,scaleY,1);temp.updateMatrix();
        batches.get(model).items.push({x,z,matrix:temp.matrix.clone(),placement});
    }
    for(const p of city.placements){
        if(p.preset){
            const {key,name,w,d,h,turn}=p.preset;
            let geometry=presetMeshes.get(key);
            if(!geometry){
                geometry=buildPresetMesh(T,cityPresets[name],w,d,h);
                geometry.name=name;presetMeshes.set(key,geometry);owned.push(geometry);
            }
            temp.position.set(p.x,p.y+.015,p.z);temp.rotation.set(0,-turn*Math.PI/2,0);temp.scale.set(1,1,1);temp.updateMatrix();
            const item={x:p.x,z:p.z,matrix:temp.matrix.clone(),placement:p};
            city.flightScenery.add(geometry,item.matrix,'building',p);
            const sector=Math.floor((p.x+EXTENT)/224)+10*Math.floor((p.z+EXTENT)/224);
            if(!presetBlocks.has(sector))presetBlocks.set(sector,[]);
            presetBlocks.get(sector).push({geometry,item,range:clamp(680+h*13,780,2500)});
            continue;
        }
        // The archived straight runway runs along local X. Airport orientation is
        // stored separately from the street piece names; tile flags are MSB first.
        let rot=0;
        if(p.code===221)rot=runwayAngle(city,p);
        else if(p.code===223&&p.rotate)rot=-Math.PI/2;
        entry(p.model,p.code,p.x,p.y+.015,p.z,rot,1,p);
    }
    for(let i=0;i<N*N;i++){
        const code=l.building[i];if(!code||code>=112||bridgeLevel(code)||isStreetProp(code)||(isRoadCode(code)&&code!==89))continue;
        const x=cellX(i%N),z=cellX(i>>7),g=city.groundAt(x,z),m=lookup(code),rot=!!(l.flags[i]&2);
        let y=g+.025,sy=1,r=0;
        if(code===89||code===92)y=Math.max(g,l.water[i]*STEP)+.015;
        if((code>=16&&code<=19)||(code>=31&&code<=34)||(code>=46&&code<=49)||(code>=59&&code<=62)||(code>=97&&code<=100)){
            const corners=[[x-8,z-8],[x+8,z-8],[x-8,z+8],[x+8,z+8]].map(p=>city.groundAt(...p));
            y=Math.min(...corners)+.035;
            if(code<59||code>=97)sy=(Math.max(...corners)-Math.min(...corners))/8||1;
        }
        if(special(code)&&rot)r=-Math.PI/2;
        entry(m.id,code,x,y,z,r,sy);
    }
    const dynamic=[],partsByBlock=new Map(),featuresByBlock=new Map(),blocks=[];
    for(const [id,{source,code,items,swap}] of batches){
        let geometry=source.geometry;
        if(swap){
            // OBJX longitudinal axes are transposed relative to the SC2 compass.
            // Mirror only network geometry; reverse triangle winding at the same time.
            geometry=geometry.clone();
            for(const attr of ['position','normal']){
                const a=geometry.attributes[attr];
                for(let i=0;i<a.count;i++){const x=a.getX(i),z=a.getZ(i);a.setX(i,z);a.setZ(i,x);}
            }
            const indices=[];
            for(let i=0;i<geometry.attributes.position.count;i+=3)indices.push(i,i+2,i+1);
            geometry.setIndex(indices);geometry.computeBoundingSphere();owned.push(geometry);
        }
        if(source.max[1]-source.min[1]>.30){
            const tree=code>=6&&code<=12;
            const shape=tree?detail.geometryFor(code)??geometry:geometry;
            const kind=tree?'tree':code<=4?'rubble':code>=14&&code<=28?'powerline':code===89?'bridge':'building';
            for(const item of items)city.flightScenery.add(shape,item.matrix,kind,item.placement);
        }
        // Large facilities remain skyline anchors across the entire map. Small
        // houses/trees and street pieces are culled by distance to the current sector.
        const reach=code>=112?clamp(680+source.max[1]*13,780,2500):code<=13?725:940;
        // Facades, projecting balconies and rooftop equipment form part of
        // the building at every viewing distance. The render batch and the
        // flight index consume the same indexed mesh and placement matrix.
        if(detail.isBuilding(code)){
            const features=detail.buildingGeometry(code,geometry);
            if(features)for(const item of items){
                city.flightScenery.add(features,item.matrix,'building',item.placement);
                const key=Math.floor((item.x+EXTENT)/192)+11*Math.floor((item.z+EXTENT)/192);
                if(!featuresByBlock.has(key))featuresByBlock.set(key,[]);
                featuresByBlock.get(key).push({geometry:features,item,range:reach});
            }
        }
        if(code>13&&items.length<=12){
            for(const item of items){
                const key=Math.floor((item.x+EXTENT)/352)+8*Math.floor((item.z+EXTENT)/352);
                if(!partsByBlock.has(key))partsByBlock.set(key,[]);
                partsByBlock.get(key).push({geometry,item,range:reach});
            }
            continue;
        }
        const mesh=new T.InstancedMesh(geometry,source.material,items.length);
        mesh.name='Original '+id;mesh.receiveShadow=true;
        mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);group.add(mesh);
        dynamic.push({mesh,items,reach});
    }
    for(const parts of partsByBlock.values())blocks.push(bakeStaticBlock(T,parts,owned,group,kit.material));
    for(const parts of featuresByBlock.values()){
        blocks.push(bakeStaticBlock(T,parts,owned,group,detail.material,'SC2 building facades and roof fittings'));
    }
    for(const parts of presetBlocks.values()){
        blocks.push(bakeStaticBlock(T,parts,owned,group,presetMaterial,'Coastal building presets'));
    }
    let lastX=Infinity,lastZ=Infinity,lastAltitude=-Infinity,lastFocus=city.spawn,overrides=new Set();
    function refresh(focus,force=false){
            const altitude=Math.max(0,focus.y-city.groundAt(focus.x,focus.z));
            if(!force&&Math.hypot(lastX-focus.x,lastZ-focus.z)<19&&Math.abs(lastAltitude-altitude)<22)return;
            lastX=focus.x;lastZ=focus.z;lastAltitude=altitude;
            lastFocus={x:focus.x,y:focus.y,z:focus.z};
            detail.update(focus,batches,overrides);
            const extra=Math.min(450,altitude*1.1);
            for(const b of blocks)b.mesh.visible=Math.hypot(b.center.x-focus.x,b.center.z-focus.z)<b.reach+b.radius+extra;
            for(const {mesh,items,reach} of dynamic){
                const r2=(reach+extra)**2;
                let n=0;
                for(const item of items)if(!overrides.has(item.placement)&&!detail.replaced.has(item)&&(item.x-focus.x)**2+(item.z-focus.z)**2<r2)mesh.setMatrixAt(n++,item.matrix);
                mesh.count=n;mesh.visible=n>0;
                if(n){mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();}
            }
    }
    return {
        refresh,
        setOverrides(placements){
            const next=new Set((placements??[]).filter(Boolean));
            if(next.size===overrides.size&&Array.from(next).every(p=>overrides.has(p)))return;
            overrides=next;for(const block of blocks)block.override(overrides);
            refresh(lastFocus,true);
        },
        dispose(){for(const {mesh} of dynamic)mesh.dispose();}
    };
}

export async function loadCity(ctx,cityId,departureCity){
    const T=ctx.THREE;
    const group=new T.Group(),owned=[];
    const glass=createCityGlass(T,ctx.night),finishOptions={night:ctx.night,glass};
    const [city,kit,detail]=await Promise.all([departureCity??fetchCityData(cityId).then(createCitySampler),loadFarKit(T,finishOptions),createDetails(T,group,finishOptions)]);
    city.flightScenery=createFlightScenery(T);
    city.flightMeshFor=code=>kit.get(lookup(code).id)?.geometry;
    group.name=city.name;
    let structures;
    try{
        glass.bake(city);
        city.updateFacadeLighting=glass.update;
        addTerrain(T,city,group,owned);
        const clock=addWater(T,city,group,owned,glass,ctx.night);
        const roadSurfaces=addRoadSurfaces(T,city,group,owned);
        addRoadFixtures(T,city,kit,lookup,group,owned);
        addBridgeSpans(T,city,group,owned,buildBridgeGeometry);
        const [updateStreet]=await Promise.all([addStreetObjects(ctx,city,group,owned),addAvenueTrees(T,city,group,owned),addParcelProps(ctx,city,group,owned)]);
        addCargoQuay(T,city,group,owned);
        const presetMaterial=createPresetMaterial(T,detail.finishTexture,glass,ctx.night);owned.push(presetMaterial);
        structures=addStructures(T,city,kit,group,owned,detail,presetMaterial);
        addPad(T,city,group,owned);
        addRunwayMarkings(T,city,group,owned);
        const ships=await addFreighters(ctx,city,group);
        const updateShips=focus=>{
            for(const ship of ships)ship.visible=(ship.position.x-focus.x)**2+(ship.position.z-focus.z)**2<1100**2;
        };
        updateShips(city.spawn);
        city.minimap??=makeMinimap(city);
        structures.refresh(city.spawn);ctx.scene.add(group);
        city.update=(focus,elapsed)=>{if(focus){structures.refresh(focus);updateStreet(focus);roadSurfaces.update(focus);updateShips(focus);}if(Number.isFinite(elapsed))clock.value=elapsed;};
        const overriddenTiles=new Map();
        let roofSamplers=new Map();
        city.roofAt=(x,z)=>{
            const {col,row}=city.worldToTile(x,z);
            const p=overriddenTiles.get(row*N+col);
            if(p&&inMap(col,row)&&roofSamplers.has(p))return roofSamplers.get(p)(x,z);
            // Mission and camera queries need the surface directly beneath
            // this point, including courtyards and stepped roofs.
            return city.flightScenery.floorAt(x,z,Infinity);
        };
        city.setModelOverrides=(placements=[],samplers=new Map())=>{
            overriddenTiles.clear();roofSamplers=samplers??new Map();
            for(const p of placements)if(roofSamplers.has(p)){
                for(let j=0;j<p.h;j++)for(let i=0;i<p.w;i++)overriddenTiles.set((p.row+j)*N+p.col+i,p);
            }
            structures.setOverrides(placements);
            city.flightScenery.setOverrides(placements);
        };
        city.setPadOverride=active=>{group.getObjectByName('Departure helipad').visible=!active;};
        city.dispose=()=>{group.removeFromParent();structures.dispose();for(const item of owned)item.dispose();detail.dispose();kit.dispose();glass.dispose();};
        return city;
    }catch(error){
        group.removeFromParent();structures?.dispose();for(const item of owned)item.dispose();detail.dispose();kit.dispose();glass.dispose();throw error;
    }
}
