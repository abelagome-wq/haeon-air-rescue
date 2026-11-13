const cream='#e2d8bf', sandstone='#c1aa86', terracotta='#a45740', brick='#ad7154';
const timber='#98704b', deepWood='#584938', zinc='#607576', slate='#4c626b';
const limestone='#c8c3ad', chalk='#ebe7d9', trim='#46575a', glazing='#57808a';
const sage='#778979', planting='#528058';

// Local horizontal axis runs to the right as seen from outside that wall.
const elevations={
    front:[1,0,0,1], right:[0,-1,1,0], back:[-1,0,0,-1], left:[0,1,-1,0],
};
function panel(g,side,x,z,sill,width,height,color,finish,offset=.025){
    const [ax,az,nx,nz]=elevations[side];
    const point=(s,y)=>[x+s*ax+nx*offset,y,z+s*az+nz*offset];
    const half=width*.5;
    g.face([point(-half,sill),point(half,sill),point(half,sill+height),point(-half,sill+height)],color,finish);
}
function windowBay(g,side,x,z,sill,width,height,lights=2){
    const [ax,az]=elevations[side],jamb=Math.min(.14,width*.055,height*.08);
    panel(g,side,x,z,sill,width,height,trim,'solid');
    panel(g,side,x,z,sill+jamb,width-2*jamb,height-2*jamb,glazing,'glass',.064);
    for(let i=1;i<lights;i++){
        const shift=width*(i/lights-.5);
        panel(g,side,x+ax*shift,z+az*shift,sill+jamb,jamb*.66,height-2*jamb,trim,'metal',.085);
    }
}
function porchDoor(g,side,x,z,sill,w,h){
    const [ax,az]=elevations[side];
    panel(g,side,x,z,sill,w,h,deepWood,'wood');
    panel(g,side,x+ax*w*.15,z+az*w*.15,sill+h*.25,w*.36,h*.63,glazing,'glass',.055);
}
// The eaves and fascia have their own thickness and extend past the wall.
function gable(g,x,z,w,d,eave,ridge,ridgeX,wall,roof,finish){
    const xl=x-w*.5,xr=x+w*.5,zb=z-d*.5,zf=z+d*.5;
    const drip=Math.min(w,d)*.026,cap=Math.min(.16,ridge*.022);
    for(const [dz,reverse] of [[zb,true],[zf,false]]){
        const end=[[xl,eave,dz],[xr,eave,dz],[ridgeX,ridge-cap,dz]];
        g.face(reverse?end.reverse():end,wall,'plaster');
    }
    const a=xl-drip,b=xr+drip,back=zb-drip,front=zf+drip;
    g.face([[a,eave,back],[a,eave,front],[ridgeX,ridge,front],[ridgeX,ridge,back]],roof,finish);
    g.face([[ridgeX,ridge,back],[ridgeX,ridge,front],[b,eave,front],[b,eave,back]],roof,finish);
    for(const [dz,reverse] of [[back,true],[front,false]]){
        for(const [x0,y0,x1,y1] of [[a,eave,ridgeX,ridge],[ridgeX,ridge,b,eave]]){
            const edge=[[x0,y0-cap,dz],[x1,y1-cap,dz],[x1,y1,dz],[x0,y0,dz]];
            g.face(reverse?edge.reverse():edge,deepWood,'wood');
        }
    }
}
function hip(g,x,z,w,d,eave,peak,roof){
    const l=x-w/2,r=x+w/2,b=z-d/2,f=z+d/2;
    const hipRun=Math.min(w*.25,d*.4);
    const a=[l,eave,b],c=[r,eave,b],e=[r,eave,f],k=[l,eave,f];
    const j=[l+hipRun,peak,z],m=[r-hipRun,peak,z];
    g.face([a,j,m,c],roof,'tile');
    g.face([c,m,e],roof,'tile');
    g.face([k,e,m,j],roof,'tile');
    g.face([a,k,j],roof,'tile');
}
function roofLight(g,x,z,w,d,heightAt,finish='glass'){
    const corners=(width,depth,lift)=>[
        [x-width/2,z-depth/2],[x-width/2,z+depth/2],[x+width/2,z+depth/2],[x+width/2,z-depth/2],
    ].map(([u,v])=>[u,heightAt(u,v)+lift,v]);
    g.face(corners(w,d,.042),trim,'metal');
    g.face(corners(w*.89,d*.89,.075),finish==='pv'?'#354d65':glazing,finish);
}
function roofTerrace(g,x,y,z,w,d,canopyHeight){
    g.box(x,y,z,w,canopyHeight*.085,d,timber,'wood');
    for(const sx of [-.46,.46]){
        for(const sz of [-.43,.43]){
            g.box(x+w*sx,y+canopyHeight*.085,z+d*sz,Math.min(.19,w*.055),canopyHeight*.78,
                Math.min(.19,d*.08),timber,'wood');
        }
    }
    for(const sx of [-.43,-.14,.14,.43]){
        g.box(x+w*sx,y+canopyHeight*.865,z,w*.17,canopyHeight*.10,d,deepWood,'wood');
    }
}
function seaCottage(g,w,d,h){
    const x=-w*.10,z=-d*.08,bw=w*.63,bd=d*.64,e=h*.62;
    g.box(x,0,z,bw,h*.12,bd,sandstone,'stone');
    g.box(x,h*.12,z,bw,e-h*.12,bd,cream,'plaster');
    gable(g,x,z,bw,bd,e,h,x-bw*.19,cream,slate,'metal');
    const ridge=x-bw*.19,drip=Math.min(bw,bd)*.026;
    const slope=u=>h-(h-e)*(u-ridge)/(bw*.69+drip);
    for(const dz of [-.22,.15])roofLight(g,x+bw*.17,z+dz*bd,bw*.23,bd*.25,slope,'pv');
    const zf=z+bd/2,xr=x+bw/2;
    windowBay(g,'front',x-bw*.20,zf,h*.25,bw*.36,h*.27);
    porchDoor(g,'front',x+bw*.25,zf,h*.12,bw*.17,h*.41);
    for(const dz of [-.27,.22])windowBay(g,'left',x-bw/2,z+dz*bd,h*.27,bd*.28,h*.26);
    windowBay(g,'back',x+bw*.13,z-bd/2,h*.23,bw*.51,h*.26,3);
    const sx=xr+w*.10;
    g.box(sx,h*.025,z,w*.20,h*.39,d*.51,timber,'wood');
    g.box(sx,h*.415,z,w*.245,h*.045,d*.55,zinc,'metal');
    windowBay(g,'right',sx+w*.10,z,h*.13,d*.38,h*.20,3);
    g.box(x,h*.025,zf+d*.070,bw*.91,h*.086,d*.15,timber,'wood');
    g.box(x+bw*.29,e,-d*.20,w*.053,h*.29,d*.068,brick,'brick');
}
function courtHouse(g,w,d,h){
    const roof='#697477',e=h*.65;
    // Two pitched wings shelter the hardwood terrace; the street side stays open.
    g.box(-w*.23,0,0,w*.34,e,d*.82,chalk,'plaster');
    gable(g,-w*.23,0,w*.34,d*.82,e,h,-w*.21,chalk,roof,'tile');
    g.box(w*.125,0,-d*.23,w*.37,h*.49,d*.31,timber,'wood');
    hip(g,w*.125,-d*.23,w*.41,d*.35,h*.49,h*.70,roof);
    g.box(w*.105,0,d*.067,w*.32,h*.047,d*.285,sandstone,'stone');
    g.box(w*.24,0,d*.30,w*.30,h*.060,d*.18,limestone,'stone');
    g.box(w*.24,h*.060,d*.30,w*.265,h*.05,d*.135,planting,'plant');
    windowBay(g,'front',-w*.23,d*.41,h*.15,w*.24,h*.36,3);
    windowBay(g,'right',-w*.06,d*.09,h*.10,d*.40,h*.42,3);
    porchDoor(g,'front',w*.165,-d*.075,h*.045,w*.13,h*.40);
    windowBay(g,'back',w*.125,-d*.385,h*.13,w*.25,h*.29);
    for(const dz of [-.22,.18])windowBay(g,'left',-w*.40,d*dz,h*.22,d*.21,h*.26);
    g.box(-w*.05,h*.52,d*.09,w*.085,h*.04,d*.44,deepWood,'wood');
}
function gableMews(g,w,d,h){
    const bw=w*.365,bd=d*.67;
    for(const [i,s] of [-1,1].entries()){
        const x=w*.196*s,z=d*.050*s,e=h*(i?.69:.61),finish=i?cream:brick;
        g.box(x,0,z,bw,h*.085,bd,limestone,'stone');
        g.box(x,h*.085,z,bw,e-h*.085,bd,finish,i?'plaster':'brick');
        gable(g,x,z,bw,bd,e,h*(i?1:.90),x,finish,i?zinc:terracotta,i?'metal':'tile');
        const top=h*(i?1:.90),drip=Math.min(bw,bd)*.026;
        roofLight(g,x-bw*.25,z+bd*.14,bw*.24,bd*.18,u=>top+(top-e)*(u-x)/(bw*.50+drip));
        const front=z+bd/2;
        porchDoor(g,'front',x+s*bw*.26,front,h*.085,bw*.23,e*.72);
        windowBay(g,'front',x-s*bw*.16,front,h*.17,bw*.48,h*.26);
        windowBay(g,'front',x,front,e-.02,bw*.27,h*.11,1);
        windowBay(g,'back',x,z-bd/2,h*.15,bw*.69,h*.32,3);
        windowBay(g,s>0?'right':'left',x+bw*.5*s,z,h*.20,bd*.44,h*.29,3);
        g.box(x+s*bw*.26,e*.82,front+d*.038,bw*.37,h*.034,d*.082,slate,'metal');
    }
}
function verandaVilla(g,w,d,h){
    const bw=w*.69,bd=d*.52,z=-d*.055,e=h*.64;
    g.box(0,0,z,bw,h*.105,bd,limestone,'stone');
    g.box(0,h*.105,z,bw,e-h*.105,bd,'#dbad89','plaster');
    hip(g,0,z,w*.765,d*.59,e,h,terracotta);
    g.box(-w*.20,e,z-d*.15,w*.047,h*.30,d*.058,sandstone,'stone');
    const front=z+bd/2,deckZ=front+d*.094;
    g.box(0,0,deckZ,w*.78,h*.105,d*.19,sandstone,'stone');
    for(const s of [-.34,0,.34])g.box(w*s,h*.105,front+d*.157,w*.027,h*.337,d*.031,chalk,'plaster');
    g.box(0,h*.44,deckZ,w*.80,h*.043,d*.24,zinc,'metal');
    for(const s of [-.265,.265])windowBay(g,'front',w*s,front,h*.14,w*.14,h*.27);
    porchDoor(g,'front',0,front,h*.105,w*.12,h*.32);
    windowBay(g,'right',bw/2,z,h*.24,bd*.55,h*.21,3);
    windowBay(g,'left',-bw/2,z,h*.24,bd*.55,h*.21,3);
    windowBay(g,'back',0,z-bd/2,h*.21,bw*.58,h*.28,3);
}
function balcony(g,x,z,w,d,base,height){
    const slab=Math.min(.33,height*.24);
    g.box(x,base,z,w,slab,d,limestone,'stone');
    g.box(x,base+slab,z+d*.46,w,height-slab,d*.08,cream,'plaster');
    for(const s of [-1,1])g.box(x+s*w*.475,base+slab,z,w*.05,height-slab,d*.84,sandstone,'stone');
}
function terraceSteps(g,w,d,h){
    const back=-d*.35,levels=3;
    for(let tier=0;tier<levels;tier++){
        const front=d*(.32-tier*.125),width=w*(.76-tier*.055);
        const base=h*tier*.30,top=base+h*.30;
        g.box(0,base,(back+front)*.5,width,top-base,front-back,cream,'plaster');
        g.box(0,top-h*.026,(back+front)*.5,width*1.035,h*.026,(front-back)*1.035,chalk,'stone');
        const floorCount=Math.min(3,Math.max(1,Math.round(h*.30/3.0)));
        const pitch=(top-base)/floorCount;
        for(let floor=0;floor<floorCount;floor++){
            const y=base+floor*pitch+pitch*.21;
            for(const s of [-.245,.245])windowBay(g,'front',s*width,front,y,width*.40,pitch*.61,3);
            windowBay(g,'right',width/2,(back+front)*.5,y,(front-back)*.74,pitch*.51,3);
            windowBay(g,'left',-width/2,(back+front)*.5,y,(front-back)*.74,pitch*.51,3);
            windowBay(g,'back',0,back,y,width*.75,pitch*.49,3);
        }
        if(tier<2){
            g.box(0,top,front-d*.02,width*.97,h*.032,d*.035,limestone,'stone');
            for(const s of [-.29,.29])g.box(width*s,top,front-d*.055,width*.20,h*.035,d*.045,planting,'plant');
        }else{
            g.box(-w*.12,top,-d*.21,w*.22,h*.10,d*.13,zinc,'metal');
            roofTerrace(g,w*.12,top,-d*.20,w*.15,d*.15,Math.min(h*.096,2.8));
        }
    }
    porchDoor(g,'front',0,d*.32,0,w*.075,Math.min(3.2,h*.18));
}
function gardenCourt(g,w,d,h){
    const floors=Math.max(3,Math.min(9,Math.round(h*.85/3.1))),e=h*.87,pitch=e/floors;
    const wingWidth=w*.25,centre=w*.27,backZ=-d*.28,front=d*.37,wingBack=-d*.17;
    g.box(0,0,backZ,w*.79,e,d*.23,sandstone,'brick');
    g.box(0,e,backZ,w*.81,h*.035,d*.25,limestone,'stone');
    for(const s of [-1,1]){
        const x=centre*s,z=(front+wingBack)*.5;
        g.box(x,0,z,wingWidth,e,front-wingBack,chalk,'plaster');
        g.box(x,e,z,wingWidth*1.045,h*.035,(front-wingBack)*1.035,slate,'metal');
        for(let i=0;i<floors;i++){
            const bottom=i*pitch+pitch*.23;
            windowBay(g,'front',x,front,bottom,wingWidth*.71,pitch*.55,2);
            windowBay(g,s>0?'right':'left',x+wingWidth*.5*s,z,bottom,(front-wingBack)*.78,pitch*.48,2);
            windowBay(g,s>0?'left':'right',x-wingWidth*.5*s,z,bottom,(front-wingBack)*.74,pitch*.55,3);
            windowBay(g,s>0?'right':'left',w*.395*s,backZ,bottom,d*.155,pitch*.46,2);
        }
    }
    for(let i=0;i<floors;i++){
        windowBay(g,'back',0,backZ-d*.115,pitch*(i+.26),w*.60,pitch*.50,4);
        if(i>0)windowBay(g,'front',0,backZ+d*.115,pitch*(i+.24),w*.20,pitch*.57,2);
    }
    g.box(-w*.22,e,backZ,w*.17,h*.13,d*.16,slate,'metal');
    roofTerrace(g,w*.22,e+h*.035,backZ,w*.19,d*.15,Math.min(h*.09,2.7));
    g.box(0,0,d*.087,w*.22,.08,d*.37,sandstone,'stone');
    g.box(0,.08,d*.095,w*.14,Math.min(.65,h*.034),d*.22,sage,'plant');
    porchDoor(g,'front',0,backZ+d*.115,0,w*.084,pitch*.74);
}
function roundedApartment(g,w,d,h){
    const bw=w*.65,bd=d*.60,r=Math.min(bw*.26,bd*.29);
    const x=bw/2,z=bd/2;
    // Two rounded front corners give this block a continuous balcony brow.
    const outline=[[-x,-z],[x,-z],[x,z-r],[x-r*.22,z-r*.38],[x-r*.54,z-r*.12],
        [x-r,z],[-x+r,z],[-x+r*.54,z-r*.12],[-x+r*.22,z-r*.38],[-x,z-r]];
    const body=h*.89,n=Math.max(3,Math.min(10,Math.round(body/3.15))),pitch=body/n;
    g.prism(outline,0,body,cream,'plaster');
    for(let i=0;i<n;i++){
        const y=i*pitch;
        const balconyOutline=outline.map(([px,pz])=>[px*1.10,pz+.05*d*(pz+z)/bd]);
        g.prism(balconyOutline,y+pitch*.06,y+pitch*.15,chalk,'stone');
        if(i===0){
            for(const s of [-1,1])windowBay(g,'front',s*(bw-2*r)*.31,z,y+pitch*.23,(bw-2*r)*.27,pitch*.64,1);
        }else windowBay(g,'front',0,z,y+pitch*.23,(bw-2*r)*.91,pitch*.65,3);
        for(const s of [-1,1])windowBay(g,s>0?'right':'left',s*x,-r*.35,y+pitch*.25,(bd-r)*.75,pitch*.58,3);
        windowBay(g,'back',w*.04,-z,y+pitch*.25,bw*.60,pitch*.55,3);
        // A panel on the angled part of each bay turns with the corner.
        for(const s of [-1,1]){
            const [a,b]=s>0?[outline[2],outline[3]]:[outline[8],outline[9]];
            const point=(t,hh)=>[a[0]+(b[0]-a[0])*t+s*.045,hh,a[1]+(b[1]-a[1])*t+.035];
            g.face([point(.08,y+pitch*.23),point(.08,y+pitch*.76),point(.92,y+pitch*.76),point(.92,y+pitch*.23)],glazing,'glass');
        }
    }
    g.box(-w*.11,body,-d*.12,w*.22,h*.11,d*.21,zinc,'metal');
    for(const s of [-.16,.16])roofLight(g,w*s,d*.11,w*.22,d*.105,()=>body,'pv');
    porchDoor(g,'front',0,z,0,w*.085,pitch*.76);
}
function splitLoft(g,w,d,h){
    const pitchHeight=h*.83,n=Math.max(3,Math.min(8,Math.round(pitchHeight/3.05))),pitch=pitchHeight/n;
    for(const s of [-1,1]){
        const x=s*w*.186,z=s*d*.074,width=w*.32,depth=d*.55,body=s>0?pitchHeight:pitchHeight-pitch;
        g.box(x,0,z,width,body,depth,s>0?brick:limestone,s>0?'brick':'stone');
        g.box(x,body,z,width*1.035,h*.030,depth*1.035,chalk,'stone');
        for(let i=0;i<(s>0?n:n-1);i++){
            const bottom=i*pitch;
            windowBay(g,'front',x,z+depth*.5,bottom+pitch*.20,width*.74,pitch*.59,3);
            windowBay(g,s>0?'right':'left',x+width*.5*s,z,bottom+pitch*.27,depth*.74,pitch*.49,3);
            windowBay(g,'back',x,z-depth*.5,bottom+pitch*.24,width*.65,pitch*.52,2);
            if(i%2===1)balcony(g,x,z+depth*.5+d*.047,width*.88,d*.091,bottom+pitch*.05,Math.min(1.1,pitch*.33));
        }
    }
    g.box(0,0,-d*.11,w*.11,h,d*.22,zinc,'metal');
    roofTerrace(g,w*.18,pitchHeight+h*.030,d*.11,w*.20,d*.17,Math.min(h*.11,2.8));
    windowBay(g,'front',0,0,h*.20,w*.074,h*.69,1);
    porchDoor(g,'front',0,0,0,w*.085,Math.min(3,h*.17));
}

export const residentialLow=['saltbox-cottage','walled-court-house','gable-mews','veranda-villa'];
export const residentialMid=['stepped-garden-flats','garden-court-apartments','round-bay-apartments','split-loft'];
// The elevation drawings above face the viewer (+Z). Rotate the entire drawing
// onto the lot's street edge (-Z), including asymmetric gables and inset courts.
function faceStreet(build){
    return (mesh,w,d,h)=>build({
        box:(x,y,z,...rest)=>mesh.box(-x,y,-z,...rest),
        prism:(outline,...rest)=>mesh.prism(outline.map(([x,z])=>[-x,-z]),...rest),
        face:(polygon,...rest)=>mesh.face(polygon.map(([x,y,z])=>[-x,y,-z]),...rest),
    },w,d,h);
}
export const residentialPresets={
    'saltbox-cottage':faceStreet(seaCottage), 'walled-court-house':faceStreet(courtHouse),
    'gable-mews':faceStreet(gableMews), 'veranda-villa':faceStreet(verandaVilla),
    'stepped-garden-flats':faceStreet(terraceSteps), 'garden-court-apartments':faceStreet(gardenCourt),
    'round-bay-apartments':faceStreet(roundedApartment), 'split-loft':faceStreet(splitLoft),
};
