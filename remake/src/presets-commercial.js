// Architect's sketches below put the storefront on the near (+Z) side. The
// exported prefabs turn these elevations to the city's street convention (-Z).
const limestone='#d7c9b1', ivory='#dfdccd', bronze='#a2774d', ink='#34464a';
const seaGlass='#537e83', blueGlass='#537785', shopGlass='#44686b';
const zinc='#6d7b7a', membrane='#777e77', planting='#778860', brick='#a3634d';

function cornerPlan(width,depth,radius){
    const x=width/2,z=depth/2,r=Math.min(radius,x,z);
    const outline=[[-x,-z],[x,-z],[x,z-r]];
    for(let i=1;i<=5;i++){
        const a=i*Math.PI/10;
        outline.push([x-r+r*Math.cos(a),z-r+r*Math.sin(a)]);
    }
    outline.push([-x,z]);
    return outline;
}

function chamferPlan(w,d,cut){
    const x=w/2,z=d/2,c=Math.min(cut,x*.7,z*.7);
    return [[-x+c,-z],[x-c,-z],[x,-z+c],[x,z-c],[x-c,z],[-x+c,z],[-x,z-c],[-x,-z+c]];
}

function move(plan,x,z){return plan.map(([px,pz])=>[px+x,pz+z]);}

function planter(g,x,y,z,w,d,scale=1){
    g.box(x,y,z,w,scale*.32,d,limestone,'stone');
    g.box(x,y+scale*.32,z,w*.88,scale*.27,d*.78,planting,'plant');
}

// A curb, screened fan bank and raised sheet-metal lid read distinctly from above.
function mechanical(g,x,y,z,w,d,h){
    g.box(x,y,z,w*.92,h*.17,d*.92,ink,'metal');
    g.box(x,y+h*.17,z,w,h*.72,d,zinc,'metal');
    g.box(x,y+h*.89,z,w*1.035,h*.11,d*1.035,ivory,'metal');
    for(const side of [-1,1]){
        g.box(x,y+h*.34,z+side*d*.501,w*.73,h*.26,d*.025,ink,'metal');
    }
}

function door(g,x,y,z,width,height){
    g.box(x,y,z,width,height,.11,ink,'metal');
    g.box(x,y+.08,z+.07,width*.81,height*.86,.055,shopGlass,'shop');
    g.box(x,y+.08,z+.11,.075,height*.86,.045,bronze,'metal');
}

// Rounded corner shop with continuous bronze reveal, a rooftop studio and a planted deck.
function cornerBookshop(g,w,d,h){
    const plinth=cornerPlan(w*.90,d*.82,w*.245);
    const facade=cornerPlan(w*.86,d*.78,w*.23);
    const awning=cornerPlan(w*.96,d*.92,w*.255);
    const sill=h*.095,band=h*.40,cap=h*.72;
    g.prism(plinth,0,sill,limestone,'stone');
    g.prism(facade,sill,band,shopGlass,'shop');
    g.prism(awning,band,band+h*.043,bronze,'metal');
    g.prism(facade,band+h*.043,cap,ivory,'plaster');
    const paneZ=d*.391;
    const bays=Math.min(7,Math.max(2,Math.floor(w*.53/2.7)));
    for(let i=0;i<bays;i++){
        const spacing=w*.56/bays,x=-w*.392+(i+.5)*spacing;
        g.box(x,band+h*.093,paneZ,spacing*.72,h*.159,.08,seaGlass,'glass');
    }
    for(let side of [-1,1]){
        for(let i=0;i<3;i++){
            const z=-d*.32+i*d*.19;
            g.box(side*w*.431,band+h*.09,z,.08,h*.16,d*.115,seaGlass,'glass');
        }
    }
    g.prism(plinth,cap,cap+h*.026,limestone,'stone');
    // The tucked-back saw-cut corner reveals an outdoor reading terrace.
    const terrace=cap+h*.026;
    g.box(-w*.116,terrace,-d*.077,w*.50,h*.196,d*.47,brick,'brick');
    g.box(-w*.116,terrace+h*.196,-d*.077,w*.54,h*.058,d*.51,zinc,'metal');
    g.box(-w*.116,terrace+h*.045,d*.160,w*.40,h*.105,.09,seaGlass,'glass');
    planter(g,w*.322,terrace,-d*.17,w*.080,d*.36,Math.min(h*.16,1));
    door(g,-w*.27,sill,d*.391,w*.12,band-sill);
}

// Raised barrel over a market nave. A segmented vault shares its ends and ridge ribs
// with the actual glass clerestory rather than floating on a rectangular roof.
function coveredMarket(g,w,d,h){
    const radius=w*.285,spring=h*.64,crest=h*.97,front=d*.392,back=-d*.39;
    g.box(0,0,-d*.012,w*.91,h*.055,d*.84,limestone,'stone');
    for(const side of [-1,1]){
        const x=side*w*.37,z=-d*.012;
        g.box(x,h*.055,z,w*.164,h*.443,d*.78,brick,'brick');
        g.box(x,h*.498,z,w*.18,h*.045,d*.81,zinc,'metal');
        g.box(x,h*.096,front,w*.115,h*.32,.10,shopGlass,'shop');
        // A high band of windows lights the produce aisles without losing shelf space below.
        for(const slot of [-.245,-.045,.155,.315]){
            g.box(side*w*.453,h*.292,d*slot,.085,h*.144,d*.109,seaGlass,'glass');
        }
        g.box(side*w*.454,h*.275,z,.14,h*.018,d*.73,limestone,'stone');
    }
    g.box(0,h*.055,(back+front)/2,radius*2,spring-h*.055,front-back,ivory,'plaster');
    const arc=[];
    for(let i=0;i<=10;i++){
        const a=i*Math.PI/10;
        arc.push([-radius*Math.cos(a),spring+(crest-spring)*Math.sin(a)]);
    }
    const endFront=arc.map(([x,y])=>[x,y,front]);
    g.face(endFront.slice().reverse(),seaGlass,'glass');
    g.face(arc.map(([x,y])=>[x,y,back]),seaGlass,'glass');
    for(let i=0;i<arc.length-1;i++){
        const [ax,ay]=arc[i],[bx,by]=arc[i+1];
        const strip=(start,end,lift,color,finish)=>g.face([
            [ax,ay+lift,end],[bx,by+lift,end],[bx,by+lift,start],[ax,ay+lift,start],
        ],color,finish);
        strip(back,front,0,i===4||i===5?blueGlass:'#69877d',i===4||i===5?'glass':'metal');
        for(let j=0;j<=4;j++){
            const z=back+(front-back)*j/4;
            strip(z-.04,z+.04,h*.008,limestone,'metal');
        }
    }
    // Three shopfront openings sit below the glazed end of the nave.
    for(let i=-1;i<=1;i++){
        g.box(i*radius*.61,h*.085,front+.045,radius*.52,h*.34,.12,shopGlass,'shop');
    }
    g.box(0,h*.465,front+d*.035,w*.69,h*.041,d*.11,bronze,'metal');
    for(const side of [-1,1])g.box(side*w*.31,h*.055,front+d*.068,.18,h*.41,.18,ink,'metal');
}

// A U around a pedestrian court, with a glazed rear gallery and a pergola. The court
// floor stays open to the sky, even in the collision mesh.
function courtyardParade(g,w,d,h){
    const floor=h*.052,leftH=h*.82,rightH=h*.64,cap=h*.031;
    g.box(0,0,0,w*.92,floor,d*.90,'#ac9f8a','stone');
    for(const side of [-1,1]){
        const top=side<0?leftH:rightH,x=side*w*.332;
        g.box(x,floor,0,w*.252,top-floor,d*.85,side<0?brick:ivory,side<0?'brick':'plaster');
        g.box(x,top,0,w*.276,cap,d*.88,limestone,'stone');
        g.box(x,floor+.10,d*.427,w*.183,(top-floor)*.51,.10,shopGlass,'shop');
        const walkX=side*w*.204;
        for(let i=0;i<3;i++){
            g.box(walkX,floor+.10,-d*.13+i*d*.211,.10,(top-floor)*.47,d*.158,shopGlass,'shop');
        }
        g.box(side*w*.163,floor+(top-floor)*.55,d*.071,w*.098,h*.034,d*.69,bronze,'metal');
        for(const slot of [-.28,-.056,.168,.34]){
            g.box(side*w*.46,floor+(top-floor)*.34,d*slot,.10,(top-floor)*.38,d*.13,seaGlass,'glass');
        }
        for(const z of [-d*.22,d*.10,d*.39]){
            g.box(side*w*.127,floor,z,.16,(top-floor)*.55,.16,ink,'metal');
        }
    }
    g.box(0,floor,-d*.309,w*.42,h*.61-floor,d*.216,seaGlass,'glass');
    g.box(0,h*.61,-d*.309,w*.43,cap,d*.24,zinc,'metal');
    mechanical(g,-w*.334,leftH+cap,-d*.115,w*.16,d*.215,h-leftH-cap);
    for(let i=0;i<4;i++){
        g.box(0,h*.50,-d*.16+i*d*.051,w*.43,h*.026,d*.024,'#916e50','wood');
    }
    planter(g,0,floor,d*.247,w*.14,d*.18,Math.min(1,h*.17));
}

// Three northlights over workshops. Each leeward slope is a full glass panel; the
// darker roofs, solid gable cheeks and front gallery make the bays readable in flight.
function northlightStudios(g,w,d,h){
    const width=w*.88,half=width/2,front=d*.274,back=-d*.413;
    const floor=h*.065,eave=h*.57,bay=width/3;
    g.box(0,0,-d*.043,w*.92,floor,d*.78,limestone,'stone');
    g.box(0,floor,(front+back)/2,width,eave-floor,front-back,brick,'brick');
    for(let i=0;i<3;i++){
        const left=-half+i*bay,peak=left+bay*.72,right=left+bay,hi=h*(i===1?1:.94);
        g.face([[left,eave,front],[right,eave,front],[peak,hi,front]],ivory,'plaster');
        g.face([[left,eave,back],[peak,hi,back],[right,eave,back]],ivory,'plaster');
        g.face([[left,eave,front],[peak,hi,front],[peak,hi,back],[left,eave,back]],'#7d9890','metal');
        g.face([[peak,hi,front],[right,eave,front],[right,eave,back],[peak,hi,back]],'#648586','glass');
        const mid=(left+right)/2;
        g.box(mid,floor+h*.10,back-.05,bay*.73,h*.245,.12,seaGlass,'glass');
        g.box(mid,floor+h*.10,front+.05,bay*.69,h*.30,.12,shopGlass,'shop');
    }
    g.box(0,floor+h*.403,d*.34,w*.94,h*.039,d*.21,'#ac794f','metal');
    for(const side of [-1,1]){
        g.box(side*w*.437,floor,d*.423,.18,h*.403,.18,bronze,'metal');
        g.box(side*w*.441,floor+h*.14,-d*.082,.10,h*.24,d*.44,seaGlass,'glass');
    }
}

// Rounded glass tower with a continuous corner ribbon and a separate roof pavilion.
function coastExchange(g,w,d,h){
    const podium=cornerPlan(w*.91,d*.86,Math.min(w,d)*.24);
    const lower=cornerPlan(w*.75,d*.68,Math.min(w,d)*.21);
    const upper=move(cornerPlan(w*.60,d*.52,Math.min(w,d)*.17),-w*.045,-d*.035);
    const lobby=cornerPlan(w*.87,d*.82,Math.min(w,d)*.23);
    g.prism(podium,0,h*.044,limestone,'stone');g.prism(lobby,h*.044,h*.133,shopGlass,'shop');
    g.prism(podium,h*.133,h*.17,'#d1bd9b','stone');
    g.prism(lower,h*.17,h*.69,seaGlass,'glass');
    for(const level of [.30,.45,.60])g.prism(cornerPlan(w*.758,d*.688,Math.min(w,d)*.21),h*level,h*(level+.009),zinc,'metal');
    g.prism(lower,h*.69,h*.712,ivory,'stone');g.prism(upper,h*.712,h*.925,blueGlass,'glass');
    g.prism(upper,h*.925,h*.944,zinc,'metal');
    g.box(-w*.055,h*.944,-d*.036,w*.33,h*.056,d*.22,'#677576','metal');
    for(let i=0;i<4;i++){
        const x=-w*.301+i*w*.117;
        g.box(x,h*.17,d*.342,w*.010,h*.52,.17,ivory,'metal');
    }
    planter(g,0,h*.17,d*.389,w*.39,d*.046,Math.min(1.35,h*.04));
    planter(g,w*.311,h*.712,-d*.093,w*.042,d*.25,Math.min(1.25,h*.035));
    door(g,-w*.22,h*.044,d*.413,w*.12,h*.089);
}

// Narrow masonry piers divide the deep glass bays. The central stair shaft and
// paired ventilation cheeks continue above the stepped roofline as a real crown.
function setbackPress(g,w,d,h){
    const podium=chamferPlan(w*.91,d*.86,Math.min(w,d)*.075);
    g.prism(podium,0,h*.065,limestone,'stone');
    g.prism(chamferPlan(w*.874,d*.822,w*.063),h*.065,h*.18,shopGlass,'shop');
    g.prism(podium,h*.18,h*.207,'#caa987','stone');
    const tiers=[
        {w:w*.78,d:d*.74,from:.207,to:.56,piers:5},
        {w:w*.61,d:d*.56,from:.56,to:.78,piers:4},
        {w:w*.42,d:d*.40,from:.78,to:.91,piers:3},
    ];
    for(const t of tiers){
        g.prism(chamferPlan(t.w,t.d,Math.min(t.w,t.d)*.115),h*t.from,h*t.to,blueGlass,'glass');
        for(const side of [-1,1]){
            for(let i=0;i<t.piers;i++){
                const f=(i/(t.piers-1)-.5)*.71;
                g.box(t.w*f,h*t.from,side*t.d*.498,Math.max(.42,t.w*.045),h*(t.to-t.from),.42,brick,'brick');
            }
            const flanks=t.piers===5?[-.27,0,.27]:t.piers===4?[-.24,.24]:[0];
            for(const f of flanks){
                g.box(side*t.w*.498,h*t.from,t.d*f,.42,h*(t.to-t.from),Math.max(.38,t.d*.044),brick,'brick');
            }
        }
        g.prism(chamferPlan(t.w*1.018,t.d*1.018,t.w*.095),h*(t.to-.014),h*t.to,limestone,'stone');
    }
    g.box(0,h*.91,0,w*.224,h*.09,d*.21,limestone,'stone');
    for(const side of [-1,1]){
        g.box(side*w*.155,h*.91,-d*.014,w*.084,h*.055,d*.23,bronze,'metal');
        g.box(side*w*.155,h*.922,d*.103,w*.06,h*.027,.10,ink,'metal');
    }
}

// Oblique pentagonal tower with a clipped, inclined roof. Make every side from
// its actual corner endpoints; the roof and cladding agree at all five heights.
function sailOffices(g,w,d,h){
    const podium=chamferPlan(w*.91,d*.84,Math.min(w,d)*.115);
    g.prism(podium,0,h*.046,limestone,'stone');
    g.prism(chamferPlan(w*.858,d*.788,Math.min(w,d)*.105),h*.046,h*.16,shopGlass,'shop');
    g.prism(podium,h*.16,h*.19,'#b4ad96','stone');
    const plan=[[-.35,-.25],[.13,-.31],[.35,-.11],[.29,.23],[-.23,.32],[-.36,.13]].map(([x,z])=>[w*x,d*z]);
    const upper=plan.map(([x,z])=>[x*.77-w*.027,z*.78-d*.008]);
    const roofY=x=>h*(.86+.22*x/w);
    const bottom=plan.map(([x,z])=>[x,h*.19,z]),top=upper.map(([x,z])=>[x,roofY(x),z]);
    for(let i=0;i<plan.length;i++){
        const j=(i+1)%plan.length;
        const finish=i===5?'stone':'glass',color=i===5?limestone:i===2?'#538080':blueGlass;
        // The corners form a slightly twisted ruled surface; keep the diagonal explicit.
        g.face([bottom[i],top[i],top[j]],color,finish);
        g.face([bottom[i],top[j],bottom[j]],color,finish);
    }
    g.face(top.slice().reverse(),membrane,'metal');
    const spine=move(chamferPlan(w*.15,d*.37,w*.032),w*.17,-d*.08);
    g.prism(spine,h*.79,h*.985,'#cebfa1','stone');
    g.prism(spine,h*.985,h,'#7c8a88','metal');
    g.box(w*.175,h*.91,-d*.269,w*.084,h*.053,.12,ink,'metal');
    for(let level=0;level<3;level++){
        const t=.22+level*.21,edge=(i,offset)=>bottom[i].map((b,k)=>b+(top[i][k]-b)*(t+offset));
        for(let i=0;i<plan.length-1;i++){
            const j=i+1,nx=plan[j][1]-plan[i][1],nz=plan[i][0]-plan[j][0],span=Math.hypot(nx,nz);
            const proud=p=>[p[0]+.09*nx/span,p[1],p[2]+.09*nz/span];
            g.face([proud(edge(i,0)),proud(edge(i,.012)),proud(edge(j,.012)),proud(edge(j,0))],zinc,'metal');
        }
    }
    planter(g,-w*.036,h*.19,d*.366,w*.36,d*.056,Math.min(1.2,h*.033));
}

// Cut a real doorway out of the face of each tower at the gallery. A recessed
// lobby continues behind that opening between the two deep entrance jambs.
function galleryTower(g,rim,side,bottom,top,gallery){
    const {floor,ceiling,z,depth}=gallery;
    const opening=depth*.41;
    for(let i=0;i<rim.length;i++){
        const a=rim[i],b=rim[(i+1)%rim.length];
        const panel=(p,q,lo,hi)=>g.face([[p[0],lo,p[1]],[p[0],hi,p[1]],[q[0],hi,q[1]],[q[0],lo,q[1]]],
            side<0?'#518085':blueGlass,'glass');
        // The positive-X face of the west shaft and negative-X face of the
        // east shaft look into the notch. The chamfers remain unbroken.
        if(i!==(side<0?2:6)){panel(a,b,bottom,top);continue;}
        const sign=Math.sign(b[1]-a[1]);
        const entry=[a[0],z-sign*opening],exit=[a[0],z+sign*opening];
        panel(a,entry,bottom,top);panel(exit,b,bottom,top);
        panel(entry,exit,bottom,floor);panel(entry,exit,ceiling,top);
    }
}

// A rectangular steel tube in the vertical X/Y plane. End plates meet the
// edge beams; the four exposed faces give the diagonal its actual thickness.
function galleryBrace(g,x0,y0,x1,y1,z,r){
    const dx=x1-x0,dy=y1-y0,k=r/Math.hypot(dx,dy),ox=-dy*k,oy=dx*k;
    const section=(x,y)=>[[x-ox,y-oy,z-r],[x+ox,y+oy,z-r],[x+ox,y+oy,z+r],[x-ox,y-oy,z+r]];
    const a=section(x0,y0),b=section(x1,y1);
    for(let i=0;i<4;i++){
        const j=(i+1)%4;g.face([a[i],a[j],b[j],b[i]],'#b18255','metal');
    }
}

function skyGallery(g,w,gallery){
    const {edge,depth,z,floor,ceiling,slab,lobby}=gallery;
    const length=2*(edge+lobby);
    g.box(0,floor-slab,z,length,slab,depth,'#495454','metal');
    g.box(0,ceiling,z,length,.25,depth,'#bac4b8','metal');
    // The longitudinal skylight sits on a curb; covers at both ends are
    // contained in the two towers rather than protruding through their roofs.
    g.box(0,ceiling+.25,z,edge*1.64,.12,depth*.45,ink,'metal');
    g.box(0,ceiling+.37,z,edge*1.56,.075,depth*.40,'#668c87','glass');
    const bays=edge*2>11?4:3;
    for(const side of [-1,1]){
        const outer=z+side*(depth/2-.10),pane=z+side*(depth/2-.32);
        g.box(0,floor-.18,outer,edge*2+.12,.25,.24,'#997550','metal');
        g.box(0,ceiling-.10,outer,edge*2+.12,.28,.24,'#997550','metal');
        // Recessed glass balustrade and clerestory leave a continuous open
        // viewing band at eye height. Each end meets the receiving lobby.
        for(const [y0,y1] of [[floor+.10,floor+.96],[ceiling-.43,ceiling-.08]]){
            const quad=[[-edge,y0,pane],[edge,y0,pane],[edge,y1,pane],[-edge,y1,pane]];
            g.face(side>0?quad:quad.reverse(),seaGlass,'glass');
        }
        g.box(0,floor+.96,pane,edge*2,.075,.085,ink,'metal');
        for(let i=0;i<bays;i++){
            const x0=-edge+2*edge*i/bays,x1=-edge+2*edge*(i+1)/bays;
            galleryBrace(g,x0,i%2?ceiling:floor,x1,i%2?floor:ceiling,outer,Math.min(.135,w*.0047));
        }
        for(const x of [-edge,edge]){
            g.box(x,floor,outer,.19,ceiling-floor,.24,bronze,'metal');
        }
    }
    for(const x of [-edge,edge])g.box(x,ceiling-.34,z,.45,.34,depth*.94,ink,'metal');
}

// Slender offset towers frame an inhabited, trussed overlook above an open
// podium garden. Nothing fills the space below the gallery deck.
function bridgeHouse(g,w,d,h){
    const podium=chamferPlan(w*.93,d*.81,w*.058);
    g.prism(podium,0,h*.048,limestone,'stone');
    g.prism(chamferPlan(w*.88,d*.76,w*.057),h*.048,h*.16,shopGlass,'shop');
    g.prism(podium,h*.16,h*.187,'#d6d1c0','stone');
    const floor=h*.56,ceiling=floor+Math.max(2.5,Math.min(3.8,h*.087));
    const gallery={floor,ceiling,edge:w*.15,z:-d*.035,depth:Math.min(5.3,d*.19),slab:Math.min(.54,w*.015),lobby:w*.052};
    for(const side of [-1,1]){
        const bodyW=w*.29,x=side*(gallery.edge+bodyW/2),z=side*d*.055,bodyD=d*(side<0?.54:.61);
        const tip=side<0?.80:.935;
        const shaft=move(chamferPlan(bodyW,bodyD,w*.049),x,z);
        galleryTower(g,shaft,side,h*.187,h*tip,gallery);
        g.prism(shaft,h*tip,h*(tip+.019),zinc,'metal');
        const wing=x+side*bodyW*.408;
        g.box(wing,h*.187,z,bodyW*.18,h*(tip-.187),bodyD*.74,ivory,'stone');
        for(let i=0;i<3;i++){
            const f=(i-1)*.27;
            g.box(x+bodyW*f,h*.187,z+bodyD*.501,bodyW*.032,h*(tip-.187),.16,bronze,'metal');
        }
        const fy=h*(tip+.019),cap=h*(side<0?.878:1);
        mechanical(g,x,fy,z,bodyW*.63,bodyD*.49,cap-fy);
        const receiving=side*(gallery.edge+gallery.lobby/2);
        for(const end of [-1,1]){
            g.box(receiving,floor,gallery.z+end*gallery.depth*.432,gallery.lobby,ceiling-floor,.15,limestone,'stone');
        }
        g.box(side*(gallery.edge+gallery.lobby),floor,gallery.z,.12,ceiling-floor,gallery.depth*.84,shopGlass,'shop');
        g.box(side*(gallery.edge-.13),floor-gallery.slab-.24,gallery.z,.53,.24,gallery.depth*.80,limestone,'stone');
    }
    skyGallery(g,w,gallery);
    door(g,0,h*.048,d*.383,w*.14,h*.108);
    g.box(0,h*.151,d*.419,w*.26,.22,d*.118,bronze,'metal');
    for(const side of [-1,1])planter(g,side*w*.108,h*.187,d*.27,w*.068,d*.14,Math.min(1.2,h*.034));
}

export const commercialLow=['corner-bookshop','covered-market','courtyard-parade','northlight-studios'];
export const commercialTall=['coast-exchange','setback-press','sail-offices','bridge-house'];
function streetFacing(design){
    return (g,w,d,h)=>design({
        box:(x,y,z,...spec)=>g.box(-x,y,-z,...spec),
        prism:(plan,...spec)=>g.prism(plan.map(([x,z])=>[-x,-z]),...spec),
        face:(points,...spec)=>g.face(points.map(([x,y,z])=>[-x,y,-z]),...spec),
    },w,d,h);
}
export const commercialPresets={
    'corner-bookshop':streetFacing(cornerBookshop),'covered-market':streetFacing(coveredMarket),
    'courtyard-parade':streetFacing(courtyardParade),'northlight-studios':streetFacing(northlightStudios),
    'coast-exchange':streetFacing(coastExchange),'setback-press':streetFacing(setbackPress),
    'sail-offices':streetFacing(sailOffices),'bridge-house':streetFacing(bridgeHouse),
};
