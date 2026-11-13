// The loading frontage faces local -Z. Roof profiles distinguish the
// workshops at flight altitude, even on neighbouring sites with similar paint.
const zinc='#91a8ac', blueSteel='#4f6c76', charcoal='#46565b', trim='#d7ccaf';
const glass='#64949c', daylight='#86adae', brick='#a8654d', cream='#cfbea1';

function frontPanel(g,x,z,base,w,h,tint,finish){
    g.face([[x+w/2,base,-z],[x-w/2,base,-z],[x-w/2,base+h,-z],[x+w/2,base+h,-z]],tint,finish);
}

function sidePanel(g,x,z,base,d,h,tint,finish){
    const points=[[x,base,z+d/2],[x,base,z-d/2],[x,base+h,z-d/2],[x,base+h,z+d/2]];
    g.face(x<0?points.reverse():points,tint,finish);
}

function dockDoor(g,x,z,width,height,frame=cream){
    const sill=Math.min(.48,height*.1),border=Math.min(.22,width*.06);
    frontPanel(g,x,z+.012,sill,width,height-sill,charcoal,'metal');
    for(const side of [-1,1]){
        g.box(x+side*(width/2+border/2),0,-z-.045,border,height+.1,.15,frame,'metal');
    }
    g.box(x,height,-z-.045,width+2*border,border,.15,frame,'metal');
    frontPanel(g,x,z+.022,height*.64,width*.79,height*.13,daylight,'glass');
    g.box(x,0,-z-.16,width+.18,sill,.44,'#81888a','stone');
}

// Profiles run from left to right. Fill the exposed gable above the eave,
// including vertical north lights and a curved roof approximated by sections.
function profileRoof(g,profile,eave,z0,z1,edge){
    for(let i=1;i<profile.length;i++){
        const [x0,y0,finish='metal',tint=zinc]=profile[i-1],[x1,y1]=profile[i];
        g.face([[x0,y0,z0],[x0,y0,z1],[x1,y1,z1],[x1,y1,z0]],tint,finish);
        if(x1===x0)continue;
        const end=[[x0,eave],[x1,eave]];
        if(y1>eave+.0001)end.push([x1,y1]);
        if(y0>eave+.0001)end.push([x0,y0]);
        if(end.length<3)continue;
        g.face(end.map(([x,y])=>[x,y,z1]),edge,'metal');
        g.face(end.map(([x,y])=>[x,y,z0]).reverse(),edge,'metal');
    }
}

function roofHoop(g,profile,z,width,peak,color){
    for(let i=1;i<profile.length;i++){
        const [x0,y0]=profile[i-1],[x1,y1]=profile[i];
        // Follow the shed section. Raise the flashing slightly off the skin,
        // tapering to the shared crown at the prescribed maximum height.
        const a=Math.min(peak,y0+.038),b=Math.min(peak,y1+.038);
        g.face([[x0,a,z-width/2],[x0,a,z+width/2],[x1,b,z+width/2],[x1,b,z-width/2]],color,'metal');
    }
}

function solarRack(g,x,z,y,w,d,rise){
    const gap=Math.min(.14,w*.025);
    for(let i=0;i<3;i++){
        const left=x-w/2+i*w/3+gap/2,right=left+w/3-gap;
        g.face([[left,y,z-d/2],[left,y+rise,z+d/2],[right,y+rise,z+d/2],[right,y,z-d/2]],'#33596b','pv');
    }
    for(const offset of [-.35,.35])g.box(x+offset*w,y-.10,z+d*.45,.17,rise+.07,.20,charcoal,'metal');
}

function flue(g,x,z,base,top,radius,color){
    const sides=10,rim=[];
    for(let i=0;i<sides;i++){
        const angle=2*Math.PI*i/sides;
        rim.push([x+radius*Math.cos(angle),z+radius*Math.sin(angle)]);
    }
    const capHeight=Math.min(radius*.55,(top-base)*.12);
    g.prism(rim,base,top-capHeight,color,'metal');
    const cap=rim.map(([px,pz])=>[x+(px-x)*1.13,z+(pz-z)*1.13]);
    g.prism(cap,top-capHeight,top,charcoal,'metal');
}

function northlight(g,w,d,h){
    const width=w*.89,depth=d*.83,z=depth/2,eave=h*.60;
    g.box(0,0,0,width,eave,depth,'#b48467','brick');
    const bays=width>=23?4:3,step=width/bays,points=[];
    for(let i=0;i<bays;i++){
        const x=-width/2+i*step;
        points.push([x,eave,'metal','#82979b'],[x+step*.73,h,'glass',daylight]);
    }
    points.push([width/2,eave]);
    profileRoof(g,points,eave,-z,z,'#b8b4a5');
    for(const offset of [-.28,.07,.36])roofHoop(g,points,offset*depth,.13,h,blueSteel);
    for(let i=0;i<bays;i++){
        const x=-width/2+(i+.50)*step;
        if(i===0){dockDoor(g,x,z,step*.67,eave*.76);continue;}
        frontPanel(g,x,z+.02,eave*.30,step*.72,eave*.43,glass,'glass');
        g.box(x,eave*.28,-z-.07,step*.78,.12,.24,cream,'stone');
    }
    sidePanel(g,width/2+.012,0,eave*.36,depth*.72,eave*.35,glass,'glass');
}

function slipway(g,w,d,h){
    const width=w*.88,depth=d*.82,z=depth/2,eave=h*.46;
    g.box(0,0,0,width,eave,depth,'#79918f','metal');
    const profile=[];
    // A shallow segmental vault; its crown skylight runs the full bay length.
    for(let i=0;i<=8;i++){
        const a=i*Math.PI/8;
        profile.push([-Math.cos(a)*width/2,eave+Math.sin(a)*(h-eave),
            i===3||i===4?'glass':'metal',i===3||i===4?daylight:'#9daeb0']);
    }
    profileRoof(g,profile,eave,-z,z,'#71898c');
    for(const offset of [-.46,-.22,.04,.30,.46])roofHoop(g,profile,offset*depth,.16,h,blueSteel);
    dockDoor(g,0,z,width*.59,eave*.92,trim);
    const archRise=h-eave;
    // Transom panes follow the vault instead of punching a rectangular hole
    // through its crown. A lower straight sill ties the panes to the portal.
    for(let i=1;i<7;i++){
        const [xa,ya]=profile[i],[xb,yb]=profile[i+1];
        const m=(xb-xa)*.04,base=eave+archRise*.08;
        g.face([[xb-m,base,-z-.018],[xa+m,base,-z-.018],[xa+m,ya-archRise*.12,-z-.018],
            [xb-m,yb-archRise*.12,-z-.018]],glass,'glass');
    }
    for(const side of [-1,1])sidePanel(g,side*(width/2+.018),0,eave*.48,depth*.84,eave*.29,glass,'glass');
}

function cannery(g,w,d,h){
    // The tall stair/ice tower adjoins a lower chilled packing wing.
    const z=d*.37,mainX=-w*.115,mw=w*.65,eave=h*.48;
    g.box(mainX,0,0,mw,eave,z*2,'#d7cbae','plaster');
    g.box(mainX,eave,0,mw+.14,h*.024,z*2+.16,'#758985','metal');
    const tx=w*.31,tw=w*.25,td=d*.61,front=td/2;
    g.box(tx,0,0,tw,h*.94,td,'#b27a61','brick');
    g.box(tx,h*.94,0,tw+.20,h*.06,td+.24,trim,'stone');
    for(let level=1;level<=3;level++){
        frontPanel(g,tx,front+.014,h*(.17+.21*(level-1)),tw*.55,h*.115,glass,'glass');
    }
    const vents=h*.64;
    for(const shift of [-.18,.08])flue(g,w*shift,z*.45,eave+h*.024,vents,Math.min(w,d)*.033,blueSteel);
    solarRack(g,mainX,-z*.32,eave+h*.024+.14,mw*.70,z*.46,Math.min(.64,h*.048));
    const bandY=eave*.60;
    g.box(mainX,bandY,-z-.06,mw,.20,.22,'#34847f','metal');
    for(const side of [-1,1])dockDoor(g,mainX+side*mw*.24,z,mw*.32,bandY*.87);
    g.box(mainX,bandY+.36,-z-.38,mw*.92,.14,.94,'#4e8987','metal');
}

function timberShed(g,w,d,h){
    const width=w*.88,depth=d*.80,z=depth/2,eave=h*.48;
    g.box(0,0,0,width,eave,depth,'#a87b54','wood');
    const ridgeWidth=width*.32;
    const roof=[[-width/2,eave,'metal','#5f8589'],[-ridgeWidth/2,h*.72,'glass',daylight],
        [-ridgeWidth/2,h*.90,'metal','#426d74'],[0,h,'metal','#426d74'],
        [ridgeWidth/2,h*.90,'glass',daylight],[ridgeWidth/2,h*.72,'metal','#5f8589'],[width/2,eave]];
    profileRoof(g,roof,eave,-z,z,'#aa8a66');
    for(const shift of [-.23,.23])dockDoor(g,shift*width,z,width*.32,eave*.86,'#664d40');
    // Timber verge and a short steel apron canopy over the inbound bay.
    const canopyX=-width*.23,canopyWidth=width*.41,overhang=Math.min(.95,d*.08);
    g.box(canopyX,eave*.88,-z-overhang/2,canopyWidth,.13,overhang,'#587979','metal');
    for(const side of [-1,1])g.box(canopyX+side*canopyWidth*.45,0,-z-overhang*.91,.14,eave*.88,.14,'#71583e','wood');
    for(const side of [-1,1]){
        const x=side*(width/2+.015);
        sidePanel(g,x,0,eave*.48,depth*.77,eave*.30,'#6c9596','glass');
        for(const dz of [-.30,0,.30]){
            g.box(x,0,dz*depth,.15,eave,.19,'#695e50','wood');
        }
    }
}

function silo(g,x,z,radius,base,shoulder,top,tint){
    const segments=12,outline=[];
    for(let i=0;i<segments;i++){
        const a=2*Math.PI*i/segments;
        outline.push([x+radius*Math.cos(a),z+radius*Math.sin(a)]);
    }
    g.prism(outline,base,shoulder,tint,'metal');
    for(let i=0;i<segments;i++){
        const [xa,za]=outline[i],[xb,zb]=outline[(i+1)%segments];
        g.face([[xa,shoulder,za],[x,top,z],[xb,shoulder,zb]],'#718890','metal');
    }
}

function elevator(g,w,d,h){
    const radius=Math.min(w*.123,d*.185);
    for(const sx of [-1,1])for(const sz of [-1,1]){
        silo(g,-w*.095+sx*(radius+.22),sz*(radius+.25),radius,0,h*.67,h*.75,
            sx===sz?'#c0c4b8':'#b3c1be');
    }
    const tx=w*.32,tw=w*.18,td=d*.44;
    g.box(tx,0,0,tw,h*.88,td,'#ae927a','stone');
    g.box(tx,h*.88,0,tw*1.18,h*.12,td*1.11,blueSteel,'metal');
    for(const level of [.46,.72])frontPanel(g,tx,td/2+.018,level*h,tw*.68,h*.075,glass,'glass');
    const left=-w*.095-radius,span=tx-left;
    for(const sx of [-1,1]){
        const binX=-w*.095+sx*(radius+.22);
        g.box(binX,h*.735,0,radius*.40,h*.085,2*(radius+.25),'#8c9b98','metal');
    }
    g.box((left+tx)/2,h*.77,0,span,h*.061,d*.115,trim,'metal');
    g.box((left+tx)/2,h*.83,0,span,h*.022,d*.13,blueSteel,'metal');
    dockDoor(g,tx,td/2,tw*.54,h*.17);
}

function masonryStack(g,x,z,r,h){
    const rings=[[h*.18,r],[h*.91,r*.76],[h*.925,r*.87],[h*.968,r*.87],[h*.975,r*.80],[h,r*.80]];
    const courses=['#ad7759','#c4b59b','#916e59','#c4b59b','#695f59'],n=12;
    const rim=(y,rad,i)=>[x+rad*Math.cos(i*2*Math.PI/n),y,z+rad*Math.sin(i*2*Math.PI/n)];
    for(let j=1;j<rings.length;j++){
        const [y0,r0]=rings[j-1],[y1,r1]=rings[j];
        for(let i=0;i<n;i++){
            g.face([rim(y0,r0,i),rim(y1,r1,i),rim(y1,r1,i+1),rim(y0,r0,i+1)],courses[j-1],j===1?'brick':'stone');
        }
    }
    const top=Array.from({length:n},(_,i)=>rim(h,r*.80,i));
    g.face(top.reverse(),'#474744','metal');
}

function boilerHouse(g,w,d,h){
    const hx=-w*.095,hallW=w*.70,z=d*.395,eave=h*.42;
    g.box(hx,0,0,hallW,eave,z*2,brick,'brick');
    const profile=[[hx-hallW/2,eave,'metal',charcoal],[hx-hallW*.26,h*.62,'metal',zinc],
        [hx,h*.49,'glass',glass],[hx+hallW*.24,h*.65,'metal',zinc],[hx+hallW/2,eave]];
    profileRoof(g,profile,eave,-z,z,brick);
    for(let i=0;i<4;i++){
        const x=hx+hallW*(i-1.5)*.22;
        frontPanel(g,x,z+.02,eave*.23,hallW*.165,eave*.52,glass,'glass');
        g.box(x,eave*.21,-z-.045,hallW*.18,.13,.20,cream,'stone');
    }
    const stackX=w*.355,stackZ=d*.12,r=Math.min(w,d)*.080;
    g.box(stackX,0,stackZ,2.23*r,h*.20,2.23*r,'#936d57','brick');
    masonryStack(g,stackX,stackZ,r,h);
    const linkStart=hx+hallW*.48,linkEnd=stackX;
    g.box((linkStart+linkEnd)/2,h*.24,stackZ,linkEnd-linkStart,h*.083,r*.92,'#71858a','metal');
}

function assembly(g,w,d,h){
    // Staggered sheds around an elevated glazed service spine. The front
    // awning shelters the loading apron without closing the court between bays.
    const wingW=w*.34,depth=d*.72,z=depth/2;
    for(const side of [-1,1]){
        const x=w*side*.27,shift=side*d*.04,wall=h*(side<0?.51:.64);
        g.box(x,0,shift,wingW,wall,depth,side<0?'#b1b9ad':'#99adb0','metal');
        profileRoof(g,[[x-wingW/2,wall,'metal',side<0?'#8a9d94':blueSteel],
            [x-wingW*.14,wall+h*.16,'metal',zinc],[x+wingW/2,wall]],wall,-z+shift,z+shift,zinc);
        dockDoor(g,x,z-shift,wingW*.60,wall*.73);
        sidePanel(g,x+side*(wingW/2+.012),shift,wall*.55,depth*.70,wall*.24,glass,'glass');
    }
    const coreW=w*.24,coreD=d*.53;
    g.box(0,0,d*.14,coreW,h*.76,coreD,'#97a7a5','metal');
    g.box(0,h*.76,d*.14,coreW,h*.19,coreD,'#86aaae','glass');
    g.box(0,h*.95,d*.14,coreW+.20,h*.05,coreD+.22,blueSteel,'metal');
    const front=d*.14-coreD/2,walk=d*.105;
    g.box(0,h*.48,front-walk/2,w*.23,h*.023,walk,blueSteel,'metal');
    g.box(0,h*.48+.70,front-walk,w*.23,.10,.09,trim,'metal');
    for(const i of [-1,0,1])g.box(i*w*.108,h*.48,front-walk,.09,.70,.09,trim,'metal');
}

export const industrialPresets={
    'northlight-workshop':northlight,'slipway-vault':slipway,'quay-cannery':cannery,
    'timber-transit-shed':timberShed,'grain-elevator':elevator,
    'tidal-boiler-house':boilerHouse,'assembly-court':assembly,
};
export const industrialLow=['northlight-workshop','slipway-vault','quay-cannery','timber-transit-shed'];
export const industrialLarge=['grain-elevator','tidal-boiler-house','assembly-court','northlight-workshop','slipway-vault'];
