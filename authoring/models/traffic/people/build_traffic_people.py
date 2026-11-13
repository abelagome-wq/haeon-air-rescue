"""Build the playable pilot, technician and three original city pedestrians.

Blender 4.5 LTS, ground origin, metres, forward -Y in Blender (+Z in glTF).
Run: blender -b -t 2 -P build_traffic_people.py -- [--only pilot|mechanic|office|passenger|senior]
"""
import argparse
import importlib.util
import math
import struct
import sys
import tempfile
import zlib
from pathlib import Path

import bpy
from mathutils import Vector, Quaternion
from mathutils.bvhtree import BVHTree
import numpy as np

OUT=Path(__file__).resolve().parent
sys.dont_write_bytecode=True
shared=OUT.parents[1]/"world"/"people"/"build_people.py"
spec=importlib.util.spec_from_file_location("city_character_rig",shared)
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
V=Vector;P=math.pi;TAU=math.tau

ROLES={
    "pilot":("City-Pilot","TRAFFIC_CITY_PILOT",1.020),
    "mechanic":("Hangar-Mechanic","TRAFFIC_HANGAR_MECHANIC",1.006),
    "office":("Office-Commuter","TRAFFIC_OFFICE_COMMUTER",1.065),
    "passenger":("City-Passenger","TRAFFIC_CITY_PASSENGER",.973),
    "senior":("Senior-Pedestrian","TRAFFIC_SENIOR_PEDESTRIAN",.962),
    "child":("Schoolchild","TRAFFIC_SCHOOLCHILD",.825),
    "swimmer":("Harbor-Swimmer","TRAFFIC_HARBOR_SWIMMER",1.012),
}
base.ROLES.update(ROLES)
wardrobe={
    # Skin, skin shadow, hair, hair highlight, jacket, dark jacket,
    # trousers/skirt, trouser trim, footwear, undershirt, stitching.
    "pilot":["AE795D","8F604B","3B3329","5F503C","676D4B","515A3F","555E44","475039","413C35","C2B699","868465"],
    "mechanic":["BA896A","966F54","665349","8B7767","485D61","354B50","40585B","34494F","725542","BAA27C","728180"],
    "office":["B9866F","9B6B5B","35312F","50453C","3C6365","344F53","4B5055","373E43","503F37","C7A6B0","6A7776"],
    "passenger":["94634E","794F41","322A29","514238","B18CA9","92718E","55546A","454557","6F5847","E7D3C4","BBA7B6"],
    "senior":["BF937D","A17766","9C9991","C5C4B9","AD9A58","8B804B","565F61","434B50","614F43","D6C6AF","B5AB83"]
    ,"child":["B98769","9F7058","614631","806148","4F80A5","3D6283","B29C69","8F8058","956C52","F0D9B0","7894A5"],
    "swimmer":["B58265","976950","423A31","5A5142","DC8250","BB5F39","426C75","365965","725C4D","D2BA80","829A95"]
}


def palette(role):
    seed="civilian" if role=="passenger" else "medic"
    m=base.palette(seed)
    keys=("skin","skin shadows","hair","hair highlights","fabric","fabric dark","pants",
          "pants dark","boots","undershirt","seam")
    for k,color in zip(keys,wardrobe[role]):
        mat=m[k];bs=mat.node_tree.nodes["Principled BSDF"];rgb=[int(color[i:i+2],16)/255 for i in (0,2,4)]
        rgb=[c/12.92 if c<.04045 else ((c+.055)/1.055)**2.4 for c in rgb]
        mat.diffuse_color=(*rgb,1);bs.inputs["Base Color"].default_value=(*rgb,1)
        # The original procedural scalp texture is embedded and has its own
        # color. Recolor its encoded PNG, keeping the strands at their UVs.
        if k=="hair":
            for link in list(bs.inputs['Base Color'].links):mat.node_tree.links.remove(link)
    colors={"helmet":"AAA583","shell edge":"4D5948","visor":"2A3838","linen":"C4C4AB",
            "strap":"655E47","tie":"765766","briefcase":"725344","wood":"755640",
            "cane ferrule":"AAA496","spanner":"A8AFAC","steel":"697373","amber":"C0894F",
            "denim dye":"53676A","oil":"3B4A47","cap":"905746","gold":"C5AD75",
            "handbag":"9C734E","knit":"C1B47F","pearl":"DDCDA9","map":"DFD4B5",
            "ink dark":"394D4F","lens":"87999C","sole":"393735","paper fold":"A09884"}
    for k,col in colors.items():
        metal=.55 if k in ("spanner","steel","cane ferrule","gold") else 0
        m[k]=base.material(k,col,.45 if metal else .73,metal)
    for index,key in enumerate(("fabric","fabric dark","pants","pants dark")):
        dye_cloth(m[key],wardrobe[role][4+index],role,index)
    return m


def dye_cloth(mat,color,role,index):
    """An embedded, tileable 0.32-m swatch; visible yarn, dye and subtle wear."""
    size=256;u=np.arange(size)[None,:]/size;v=np.arange(size)[:,None]/size
    rng=np.random.default_rng(140+index)
    twill=np.cos(TAU*(43*u+20*v));weft=np.sin(TAU*60*v);warp=np.cos(TAU*54*u)
    cloud=2.9*np.sin(TAU*(u+v)) + 1.9*np.cos(TAU*(3*u-v)) + 1.1*np.sin(TAU*(2*v+4*u))
    grain=rng.normal(0,1.38,(size,size))
    if role=="senior" and index<2:
        texture=3.2*twill+2.3*warp*weft+1.8*weft+.8*grain+cloud
    elif role=="office" and index<2:
        texture=1.7*twill+1.7*weft*warp+1.7*(np.cos(TAU*9*u)**12)+cloud*.7+grain
    elif role=="mechanic":
        texture=2.6*twill+1.8*weft*warp+cloud*1.25+grain
    else:texture=2.05*twill+1.5*weft*warp+cloud+grain
    base_rgb=np.array([int(color[j:j+2],16) for j in (0,2,4)])
    pixels=np.clip(base_rgb+texture[:,:,None],0,255).astype(np.uint8)
    def chunk(t,p):return struct.pack(">I",len(p))+t+p+struct.pack(">I",zlib.crc32(t+p)&0xffffffff)
    raw=b"".join(b"\0"+row.tobytes() for row in pixels[::-1])
    png=b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",size,size,8,2,0,0,0))+chunk(b"IDAT",zlib.compress(raw,7))+chunk(b"IEND",b"")
    label=role+"_"+mat.name.replace(' ','-')+"_twill.png"
    with tempfile.TemporaryDirectory() as d:
        fn=Path(d)/label;fn.write_bytes(png);im=bpy.data.images.load(str(fn));im.pack();im.filepath="//"+label
    node=mat.node_tree.nodes.new("ShaderNodeTexImage");node.image=im
    mat.node_tree.links.new(node.outputs["Color"],mat.node_tree.nodes['Principled BSDF'].inputs["Base Color"])
    mat["cloth"]=True


def map_cloth(obj,scale):
    me=obj.data
    if not any(m.get("cloth") for m in me.materials):return
    layer=me.uv_layers.active if me.uv_layers.active else me.uv_layers.new(name="Surface metre mapping")
    for poly in me.polygons:
        if not me.materials[poly.material_index].get("cloth"):continue
        axis=max(range(3),key=lambda n:abs(poly.normal[n]))
        for li in poly.loop_indices:
            v=me.vertices[me.loops[li].vertex_index].co/scale
            layer.data[li].uv=((v.x if axis!=0 else v.y)/.32,(v.z if axis!=2 else v.y)/.32)


def landmarks(role):
    if role=="pilot":
        arms={1:((.193,0,1.385),(.333,-.010,1.164),(.143,-.005,1.552),(.110,-.008,1.602)),
              -1:((-.192,0,1.38),(-.253,.041,1.115),(-.249,-.048,.870),(-.26,-.079,.804))}
        # The upper and forearm stay anatomical lengths; a small forward
        # elbow lets the headset hand meet the ear without stretching.
        arms[1]=((.193,0,1.385),(.371,-.055,1.304),(.148,-.036,1.518),(.110,-.020,1.581))
    elif role=="mechanic":
        arms={1:((.19,0,1.383),(.303,-.080,1.163),(.294,-.286,1.301),(.283,-.344,1.335)),
              -1:((-.191,0,1.383),(-.293,-.080,1.146),(-.267,-.305,1.248),(-.250,-.365,1.276))}
    elif role=="office":
        arms={1:((.182,0,1.38),(.256,.049,1.130),(.264,.054,.883),(.267,.052,.812)),
              -1:((-.182,0,1.38),(-.224,-.046,1.119),(-.224,-.12,.876),(-.226,-.143,.806))}
    elif role=="passenger":
        arms={1:((.178,0,1.377),(.259,-.072,1.129),(.112,-.185,1.293),(.084,-.176,1.347)),
              -1:((-.178,0,1.377),(-.241,.030,1.123),(-.221,-.004,.874),(-.224,-.019,.805))}
    elif role=="child":
        arms={1:((.178,0,1.377),(.234,.027,1.137),(.241,-.033,.906),(.244,-.046,.848)),
              -1:((-.178,0,1.377),(-.238,-.051,1.139),(-.224,-.149,.926),(-.218,-.179,.868))}
    elif role=="swimmer":
        arms={1:((.192,0,1.383),(.400,-.084,1.243),(.486,-.295,1.264),(.509,-.363,1.269)),
              -1:((-.192,0,1.383),(-.395,-.112,1.235),(-.495,-.309,1.217),(-.526,-.374,1.218))}
    else:
        arms={1:((.178,0,1.374),(.272,-.049,1.135),(.289,-.194,.934),(.293,-.228,.873)),
              -1:((-.178,0,1.374),(-.247,.018,1.126),(-.219,-.025,.879),(-.211,-.04,.808))}
    legs={1:((.092,0,.909),(.112,-.025,.514),(.13,-.033,.116)),
          -1:((-.092,0,.909),(-.112,.015,.514),(-.136,.060,.116))}
    if role=="mechanic":
        legs={1:((.095,0,.909),(.156,-.076,.507),(.18,-.055,.116)),
              -1:((-.095,0,.909),(-.138,-.016,.510),(-.172,.068,.116))}
    if role=="senior":
        legs={1:((.089,0,.909),(.121,-.081,.507),(.145,-.053,.116)),
              -1:((-.089,0,.909),(-.115,-.045,.512),(-.135,.074,.116))}
    if role=="swimmer":
        legs={1:((.091,0,.909),(.195,-.150,.544),(.177,.113,.241)),
              -1:((-.091,0,.909),(-.211,.089,.545),(-.204,.336,.226))}
    return {s:list(map(V,a)) for s,a in arms.items()},{s:list(map(V,a)) for s,a in legs.items()}


def curve(g,points,r,mat,bone,n=8):
    for a,b in zip(points,points[1:]):
        if (V(a)-V(b)).length>.00003:g.tube(a,b,r,mat,bone,n=n)


def orient_shell(g):
    # Consistent winding around the armhole, not a face-by-face radial guess.
    edges={}
    for i,f in enumerate(g.f):
        for j,a in enumerate(f):
            b=f[(j+1)%len(f)];k=tuple(sorted((a,b)))
            edges.setdefault(k,[]).append((i,a==k[0]))
    assert all(len(v)==2 for v in edges.values()),"Garment must have no open garment-body edges"
    links=[[] for f in g.f]
    for ((i,a),(j,b)) in edges.values():links[i].append((j,a==b));links[j].append((i,a==b))
    flips={0:False};pending=[0]
    while pending:
        a=pending.pop()
        for b,different in links[a]:
            flip=flips[a]^different
            if b not in flips:flips[b]=flip;pending.append(b)
            else:assert flips[b]==flip
    assert len(flips)==len(g.f)
    g.f=[tuple(reversed(f)) if flips[i] else tuple(f) for i,f in enumerate(g.f)]
    volume=sum(g.v[f[0]].dot(g.v[f[k]].cross(g.v[f[k+1]])) for f in g.f for k in range(1,len(f)-1))
    if volume<0:g.f=[tuple(reversed(f)) for f in g.f]


def fitted_shirt(g,m,arms,short=False,bare=False):
    # The civilian/service shirts use a real, shorter underarm cut on a
    # shared continuous trunk. Raised arm poses get a higher elastic gusset.
    topo=base.Garment();n=28;rings=[]
    rows=[(.930,.146,.092),(.964,.151,.097),(1.023,.149,.093),(1.115,.148,.095),
          (1.208,.156,.106),(1.268,.169,.113),(1.312,.180,.112),(1.357,.186,.107),
          (1.395,.174,.096),(1.419,.146,.080),(1.445,.077,.058)]
    for z,rx,ry in rows:
        rings.append(topo.ring([(rx*math.cos(TAU*j/n),-.004+ry*math.sin(TAU*j/n),z) for j in range(n)],
                               [base.torso_w(z)]*n))
    sectors=set(range(3))|set(range(n-3,n))|set(range(n//2-3,n//2+3))
    for j in range(len(rows)-1):topo.band(rings[j],rings[j+1],sectors if 5<=j<9 else ())
    topo.disk(rings[0],True);topo.disk(rings[-1])
    for s in (-1,1):
        k=(n//2 if s<0 else 0)-3;r=k+6
        rim=[rings[5][i%n] for i in range(k,r+1)]
        rim += [rings[t][r%n] for t in range(6,10)]
        rim += [rings[9][i%n] for i in range(r-1,k-1,-1)]
        rim += [rings[t][k%n] for t in range(8,5,-1)]
        sh,el,wr,palm=arms[s];side=".L" if s==1 else ".R"
        cl,up,fore,hand=[k+side for k in ("Clavicle","UpperArm","Forearm","Hand")]
        for t in rim:topo.w[t]={"Chest":.64,cl:.30,up:.06}
        sleeve=[(base.mixed(sh,el,.058)+V((s*.005,0,-.003)),.061,.064,{cl:.37,up:.60,"Chest":.03}),
                (base.mixed(sh,el,.22),.071,.067,{cl:.11,up:.89}),
                (base.mixed(sh,el,.48),.067,.065,up)]
        if bare:
            sleeve += [(base.mixed(sh,el,.77),.054,.051,{up:.93,fore:.07}),
                       (el,.050,.050,{up:.50,fore:.50}),
                       (base.mixed(el,wr,.21),.055,.050,{up:.06,fore:.94}),
                       (base.mixed(el,wr,.52),.045,.044,fore),
                       (base.mixed(el,wr,.80),.032,.032,fore),
                       (base.mixed(wr,palm,.12),.027,.026,{fore:.60,hand:.40})]
        elif short:sleeve += [(base.mixed(sh,el,.64),.064,.063,up)]
        else:sleeve += [(base.mixed(sh,el,.77),.062,.061,{up:.93,fore:.07}),(el,.060,.058,{up:.50,fore:.50}),
                        (base.mixed(el,wr,.20),.061,.061,{up:.06,fore:.94}),
                        (base.mixed(el,wr,.55),.050,.050,fore),(base.mixed(el,wr,.83),.041,.041,fore),
                        (base.mixed(wr,palm,.17),.033,.032,{fore:.63,hand:.37})]
        for i,(center,rx,ry,weight) in enumerate(sleeve):
            direct=sleeve[min(i+1,len(sleeve)-1)][0]-(sh if i==0 else sleeve[i-1][0])
            rim=topo.extend(rim,center,direct,rx,ry,weight)
        topo.disk(rim)
    orient_shell(topo);topo.emit(g,m["fabric"]);return topo


class FrontSurface:
    """Project appliqués onto the actual shirt and interpolate the same skin."""
    def __init__(self,shirt):
        self.verts=shirt.v;self.weights=shirt.w
        self.tris=[(f[0],f[i],f[i+1]) for f in shirt.f for i in range(1,len(f)-1)]
        self.bvh=BVHTree.FromPolygons(self.verts,self.tris,all_triangles=True)
    def at(self,x,z):
        hit,_,index,_=self.bvh.ray_cast(V((x,-.65,z)),V((0,1,0)),.9)
        if hit is None:return None
        ids=self.tris[index];a,b,c=[self.verts[i] for i in ids]
        u=b-a;v=c-a;p=hit-a;uu=u.dot(u);vv=v.dot(v);uv=u.dot(v)
        det=uu*vv-uv*uv
        if abs(det)<1e-13:return None
        wb=(vv*p.dot(u)-uv*p.dot(v))/det;wc=(uu*p.dot(v)-uv*p.dot(u))/det
        w={}
        for i,k in zip(ids,(1-wb-wc,wb,wc)):
            for name,f in self.weights[i].items():w[name]=w.get(name,0)+max(0,k)*f
        total=sum(w.values());return hit.y,{name:f/total for name,f in w.items()}


class TailoredDetails(base.SkinMesh):
    def __init__(self,name,rig,coll,scale,surf):
        super().__init__(name,rig,coll,scale);self.surface=surf
    def add(self,vertices,faces,mat,weights,smooth=True):
        pts=[V(p) for p in vertices]
        # Only the torso's forward decals, zipper, straps and pockets conform.
        # Full belt loops, hand props/backpacks and all head accessories keep
        # their own constructed thickness, orientation and pivot weights.
        if not (isinstance(weights,str) and weights in ("Chest","Spine","Pelvis") and
                min(p.z for p in pts)>.930 and max(p.z for p in pts)<1.456 and
                max(p.y for p in pts)<-.017 and max(abs(p.x) for p in pts)<.162):
            return super().add(vertices,faces,mat,weights,smooth)
        name=mat.name; layer=.0034
        if name in ("undershirt","denim dye"):layer=.0016
        elif name in ("strap","fabric dark","knit"):layer=.0044
        elif name in ("metal","gold","linen","zip","seam","amber"):layer=.0072
        elif name in ("ink","ink dark","paper fold"):layer=.010
        yback=max(p.y for p in pts);depth=min(.014,max(.001,yback-min(p.y for p in pts)))
        span=max(.00001,yback-min(p.y for p in pts))
        out=[];w=[];ff=[]
        def triangle(a,b,c,iteration):
            if iteration<4 and max((a-b).length,(b-c).length,(a-c).length)>.033:
                ab=(a+b)/2;bc=(b+c)/2;ca=(c+a)/2
                for aa,bb,cc in ((a,ab,ca),(ab,b,bc),(ca,bc,c),(ab,bc,ca)):triangle(aa,bb,cc,iteration+1)
                return
            idx=len(out)
            for p in (a,b,c):
                s=self.surface.at(p.x,p.z)
                out.append(V((p.x,s[0]-layer-depth*(yback-p.y)/span,p.z)) if s else p)
                w.append(s[1] if s else {weights:1})
            ff.append((idx,idx+1,idx+2))
        for f in faces:
            for i in range(1,len(f)-1):triangle(pts[f[0]],pts[f[i]],pts[f[i+1]],0)
        return super().add(out,ff,mat,w,smooth)


def smart_boots(g,m,legs,role):
    for s in (-1,1):
        h,k,a=legs[s];side=".L" if s==1 else ".R";foot="Foot"+side
        x,y=a.x,a.y
        formal=role in ("office","passenger","senior")
        wide=.054 if role=="passenger" else .058
        g.vertical([(x,y-.045,0,wide,.129),(x,y-.049,.019,wide+.004,.133),
                    (x,y-.051,.032,wide+.002,.131)],m["sole"],foot,24)
        g.vertical([(x,y-.05,.028,wide+.002,.13),(x,y-.057,.061,wide,.119),
                    (x,y-.03,.087,wide-.003,.096),(x,y-.005,.117 if formal else .143,.051,.062),
                    (x,y,.125 if formal else .165,.046,.054)],m["boots"],foot,24)
        if role in ("pilot","mechanic","senior","office"):
            for j in range(4 if not formal else 3):
                zz=.079+j*.013;yy=y-.122+j*.013
                g.tube((x-.022,yy,zz),(x+.022,yy-.003,zz+.006),.0024,m["seam"],foot,n=6)
        else:
            g.strip((x-.041,y-.070,.090),(x+.041,y-.074,.090),.014,.006,m["handbag"],foot)
            g.box((x+.033,y-.075,.095),(.017,.010,.009),m["gold"],foot)


def outer_pockets(g,m):
    for s in (-1,1):
        side=".L" if s==1 else ".R";th="Thigh"+side
        x=s*.169
        g.box((x,-.020,.717),(.023,.104,.106),m["pants dark"],th)
        g.box((x+s*.012,-.020,.758),(.012,.110,.028),m["pants"],th)
        g.tube((x+s*.018,-.065,.756),(x+s*.018,.025,.756),.0022,m["seam"],th,n=6)


def collared_neck(g,m,color):
    for s in (-1,1):
        g.patch([(s*.013,-.091,1.382),(s*.064,-.061,1.445),
                 (s*.108,-.071,1.421),(s*.074,-.105,1.355)],color,"Chest")


def rounded_case(g,center,width,depth,height,mat,bone,corner=.45):
    x,y,z=center;rings=[]
    for f,scale in ((-.5,.88),(-.44,.98),(-.25,1),(.28,1),(.45,.97),(.5,.88)):
        ring=[]
        for i in range(24):
            a=TAU*i/24;c=math.cos(a);d=math.sin(a)
            ring.append((x+width*.5*scale*math.copysign(abs(c)**corner,c),
                         y+depth*.5*scale*math.copysign(abs(d)**corner,d),z+height*f))
        rings.append(ring)
    g.rings(rings,mat,[bone]*len(rings))


def shade_glasses(g,m,sunglasses=True):
    for s in (-1,1):
        pts=[]
        for i in range(28):
            a=TAU*i/28
            xx=s*.037+.030*math.cos(a);zz=1.588+(.025 if sunglasses else .017)*math.sin(a)
            yy=-.107+.38*abs(xx)
            pts.append((xx,yy,zz))
        if sunglasses:g.patch(list(reversed(pts)),m["visor"],"Head")
        curve(g,pts+[pts[0]],.0027 if sunglasses else .0019,m["steel"] if sunglasses else m["gold"],"Head",7)
        curve(g,[(s*.064,-.082,1.596),(s*.085,-.049,1.593),(s*.088,.014,1.583)],.0022,m["steel"],"Head",7)
    curve(g,[(-.009,-.104,1.595),(0,-.111,1.601),(.009,-.104,1.595)],.0023,m["steel"],"Head",7)


def pilot(g,m):
    collared_neck(g,m,m["fabric dark"])
    # Civil air-service flight helmet: ear defenders, headband, microphone
    # and smoke lenses, echoing the olive headset portrait in PEOPLE1.BMP.
    helmet=[]
    for j in range(13):
        f=j/13;row=[]
        for i in range(40):
            a=TAU*i/40;fw=(-math.sin(a)+1)/2
            zlow=1.554+.076*fw
            lat=math.asin((zlow-1.605)/.151);lat+=(P/2-lat)*f
            row.append((.107*math.cos(lat)*math.cos(a),
                        .005+.116*math.cos(lat)*math.sin(a),1.605+.151*math.sin(lat)))
        helmet.append(row)
    helmet.append([(.004*math.cos(TAU*i/40),.005+.004*math.sin(TAU*i/40),1.757) for i in range(40)])
    g.rings(helmet,m["helmet"],["Head"]*len(helmet))
    curve(g,helmet[0]+[helmet[0][0]],.0053,m["shell edge"],"Head")
    for s in (-1,1):
        g.ball((s*.094,.001,1.581),(.027,.043,.052),m["rubber"],"Head",20,10)
        g.ball((s*.107,.001,1.583),(.018,.037,.044),m["helmet"],"Head",20,10)
        g.ball((s*.121,.003,1.584),(.004,.016,.021),m["shell edge"],"Head",14,7)
        curve(g,[(s*.094,-.020,1.552),(s*.060,-.051,1.501),(s*.024,-.065,1.486)],
              .0062,m["strap"],"Head")
    curve(g,[(.112,-.022,1.565),(.105,-.063,1.546),(.076,-.110,1.536),(.040,-.118,1.530)],
          .0039,m["rubber"],"Head")
    g.ball((.035,-.117,1.531),(.014,.008,.007),m["black"],"Head",12,6)
    shade_glasses(g,m)
    base.label("AIR",(0,-.107,1.650),.021,1,m["ink dark"],"Head",g)
    for s in (-1,1):
        g.strip((s*.114,-.075,1.419),(s*.099,-.117,1.300),.032,.013,m["strap"],"Chest")
        g.strip((s*.099,-.118,1.30),(s*.052,-.107,1.180),.032,.013,m["strap"],"Chest")
        g.strip((s*.053,-.105,1.180),(s*.022,-.114,1.000),.032,.012,m["strap"],"Spine")
        # Shoulder webbing continues over the seam to the rear belt anchor.
        curve(g,[(s*.114,-.070,1.417),(s*.115,-.018,1.429),(s*.110,.047,1.414),
                 (s*.104,.089,1.343)],.014,m["strap"],"Chest",10)
        g.strip((s*.104,.089,1.343),(s*.075,.106,1.163),.029,.010,m["strap"],"Chest")
        g.strip((s*.075,.106,1.163),(s*.031,.106,.994),.029,.010,m["strap"],"Spine")
        g.box((s*.096,-.128,1.296),(.044,.011,.025),m["metal"],"Chest")
        g.box((s*.097,-.134,1.295),(.026,.007,.011),m["strap"],"Chest")
        g.box((s*.121,-.083,1.230),(.064,.014,.072),m["fabric dark"],"Chest")
        g.strip((s*.103,-.100,1.263),(s*.140,-.079,1.270),.005,.004,m["metal"],"Chest")
    g.vertical([(0,-.004,.978,.157,.106),(0,-.004,1.010,.157,.107)],m["strap"],"Spine",28)
    g.box((0,-.118,.993),(.057,.012,.028),m["metal"],"Spine")
    g.strip((0,-.104,1.015),(0,-.103,1.165),.009,.006,m["zip"],"Spine")
    g.strip((0,-.103,1.165),(0,-.119,1.365),.009,.006,m["zip"],"Chest")
    outer_pockets(g,m)
    # Distinctive folding kneeboard secured to the outside of the right thigh.
    g.box((-.104,-.095,.706),(.108,.021,.147),m["briefcase"],"Thigh.R")
    g.box((-.104,-.108,.707),(.084,.010,.122),m["map"],"Thigh.R")
    for j in range(4):
        g.strip((-.136,-.117,.674+j*.022),(-.081,-.117,.682+j*.018),.002,.003,m["denim dye"],"Thigh.R")


def spanner(g,m,p):
    # Closed, extruded open-jaw silhouette. The wrench is carried in the right
    # hand. The tool, all jaw surfaces and the hanging hole pivot with that hand.
    p=V(p);axis=V((-.19,-.70,.68)).normalized()
    lat=V((1,0,0))-axis*axis.x;lat.normalize();depth=axis.cross(lat)
    shape=[(-.112,-.009),(.061,-.009),(.083,-.022),(.110,-.021),(.133,-.013),
           (.106,-.005),(.110,.009),(.133,.003),(.123,.021),(.100,.026),
           (.076,.020),(.061,.009),(-.112,.009),(-.118,.006),(-.118,-.006)]
    verts=[p+axis*a+lat*b+depth*(z*.004) for z in (-1,1) for a,b in shape]
    n=len(shape);faces=[tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    g.add(verts,faces,m["spanner"],"Hand.R",False)
    g.tube(p-axis*.102+depth*.004,p-axis*.102+depth*.006,.0039,m["ink dark"],"Hand.R",n=10)


def mechanic(g,m,arms):
    collared_neck(g,m,m["denim dye"])
    # Work cap with soft rounded crown and a forward curved bill.
    g.vertical([(0,0,1.637,.099,.105),(0,.003,1.655,.101,.106),(0,.003,1.688,.095,.103),
                (0,.008,1.713,.084,.091),(0,.008,1.731,.061,.070),
                (0,.009,1.739,.021,.031)],m["cap"],"Head",28)
    g.ball((0,-.088,1.641),(.087,.074,.009),m["cap"],"Head",22,8)
    g.ball((0,.009,1.740),(.012,.012,.005),m["fabric dark"],"Head",10,6)
    for s in (-1,1):
        curve(g,[(s*.079,-.064,1.659),(s*.063,-.053,1.707),(s*.020,-.006,1.734)],
              .0016,m["seam"],"Head",6)
        g.patch([(s*.012,-.096,1.378),(s*.10,-.101,1.348),(s*.10,-.111,1.247),
                 (s*.048,-.116,1.229)],m["denim dye"],"Chest")
        g.strip((s*.048,-.119,1.322),(s*.105,-.106,1.330),.009,.005,m["seam"],"Chest")
    g.tube((-.081,-.115,1.321),(-.075,-.110,1.382),.0033,m["amber"],"Chest",n=8)
    g.box((.091,-.122,1.310),(.059,.007,.022),m["linen"],"Chest")
    base.label("SERVICE",(.091,-.127,1.309),.012,1,m["ink dark"],"Chest",g)
    g.patch([(-.049,-.097,1.401),(.048,-.097,1.401),(.003,-.125,1.246)],m["undershirt"],"Chest")
    g.strip((0,-.104,1.009),(0,-.106,1.140),.009,.007,m["zip"],"Spine")
    g.strip((0,-.106,1.14),(0,-.125,1.246),.009,.006,m["zip"],"Chest")
    g.vertical([(0,-.004,.953,.161,.109),(0,-.004,.984,.161,.109)],m["briefcase"],"Pelvis",28)
    g.box((0,-.120,.968),(.057,.014,.025),m["metal"],"Pelvis")
    rounded_case(g,(.148,.008,.889),.064,.132,.131,m["briefcase"],"Pelvis")
    for i,y in enumerate((-.029,.014,.049)):
        g.tube((.157,y,.926),(.164,y,.986+i*.009),.006,m["steel"],"Pelvis",n=8)
        g.tube((.164,y,.974),(.165,y,1.004+i*.008),.011,m["cap"] if i==1 else m["amber"],"Pelvis",n=8)
    outer_pockets(g,m)
    for s in (-1,1):
        side=".L" if s==1 else ".R"
        g.box((s*.121,-.064,.517),(.090,.010,.091),m["oil"],"Shin"+side)
        g.strip((s*.077,-.071,.550),(s*.153,-.066,.546),.004,.004,m["seam"],"Shin"+side)
    spanner(g,m,arms[-1][3])
    # A folded, stained service rag in the other hand.
    p=arms[1][3]
    g.patch([p+V((-.023,0,.002)),p+V((.020,0,.004)),p+V((.042,.007,-.095)),
             p+V((.004,-.005,-.118)),p+V((-.029,.005,-.067))],m["linen"],"Hand.L")


def office(g,m,arms):
    collared_neck(g,m,m["undershirt"])
    # Period box-cut jacket, separate lapels, a triangular tie and a briefcase.
    g.vertical([(0,.002,.812,.158,.111),(0,.004,.851,.162,.112),
                (0,.002,.915,.151,.103),(0,0,.954,.145,.096)],m["fabric"],"Pelvis",28)
    g.patch([(-.070,-.088,1.420),(.07,-.088,1.42),(0,-.125,1.196)],m["undershirt"],"Chest")
    g.patch([(-.014,-.101,1.392),(.013,-.101,1.392),(.010,-.122,1.325),
             (.017,-.131,1.253),(0,-.133,1.224),(-.015,-.131,1.252),(-.007,-.124,1.326)],
            m["tie"],"Chest")
    for s in (-1,1):
        g.patch([(s*.074,-.074,1.423),(s*.126,-.077,1.387),(s*.096,-.102,1.350),
                 (s*.126,-.107,1.338),(s*.024,-.122,1.214),(s*.046,-.115,1.309)],m["fabric dark"],"Chest")
        g.strip((s*.073,-.093,.951),(s*.129,-.077,.959),.013,.009,m["fabric dark"],"Pelvis")
        g.box((s*.093,-.105,1.294),(.040,.008,.008),m["seam"],"Chest")
    g.ball((.014,-.110,1.147),(.005,.003,.005),m["briefcase"],"Spine",8,4)
    g.ball((.017,-.105,1.047),(.005,.003,.005),m["briefcase"],"Spine",8,4)
    p=arms[1][3];center=p+V((.010,.020,-.197))
    rounded_case(g,center,.116,.328,.219,m["briefcase"],"Hand.L",.32)
    for s in (-1,1):
        g.strip(center+V((.056,s*.144,-.066)),center+V((.057,s*.144,.083)),.009,.004,m["seam"],"Hand.L")
        curve(g,[center+V((.004,s*.066,.104)),p+V((0,s*.041,-.018)),p+V((0,s*.017,-.010))],
              .007,m["leather"],"Hand.L")
        g.box(center+V((.060,s*.106,.072)),(.005,.021,.022),m["gold"],"Hand.L")
    g.tube(p+V((0,-.041,-.015)),p+V((0,.041,-.015)),.009,m["leather"],"Hand.L",n=10)
    # Brushed swept dark hair rather than the rescuer's tied hair.
    for k in range(6):
        x=-.052+k*.018
        g.follow([((x+.016,-.043,1.690),.015,.011,"Head"),
                  ((x+.009,-.076,1.658),.014,.009,"Head"),((x-.014,-.089,1.637+.002*k),.005,.006,"Head")],
                 m["hair highlights"] if k==1 else m["hair"],10)


def passenger(g,m,legs):
    # Soft A-line skirt: weighted to pelvis at the waist and progressively
    # to both independently moving thighs down toward the hem.
    n=32;vs=[];weights=[];levels=[(.553,.204,.138),(.570,.201,.136),(.660,.188,.125),(.780,.176,.117),
                                  (.882,.164,.110),(.958,.145,.097)]
    for z,rx,ry in levels:
        for i in range(n):
            a=TAU*i/n;pleat=.005*math.cos(10*a)*(1-(z-.55)/.45)
            vs.append(((rx+pleat)*math.cos(a),.004+(ry+pleat)*math.sin(a),z))
            t=min(.66,max(0,(.91-z)*1.8));left=(1+math.cos(a))/2
            weights.append({"Pelvis":1-t,"Thigh.L":t*left,"Thigh.R":t*(1-left)})
    faces=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(len(levels)-1) for i in range(n)]
    g.add(vs,faces,m["pants"],weights)
    for s in (-1,1):
        side=".L" if s==1 else ".R";a,k,b=legs[s];th="Thigh"+side;sh="Shin"+side
        g.follow([(a,.070,.068,th),(base.mixed(a,k,.62),.066,.064,th),
                  (k,.057,.056,{th:.45,sh:.55}),(base.mixed(k,b,.32),.056,.056,sh),
                  (base.mixed(k,b,.78),.035,.037,sh),(b,.031,.033,sh)],m["skin"],16)
    g.vertical([(0,0,.932,.149,.101),(0,0,.956,.147,.099)],m["handbag"],"Pelvis",28)
    # Asymmetric shoulder purse strap and softly gusseted bag.
    g.strip((.117,-.075,1.418),(.036,-.122,1.260),.025,.009,m["handbag"],"Chest")
    g.strip((.037,-.116,1.260),(-.061,-.102,1.062),.024,.009,m["handbag"],"Spine")
    g.strip((-.061,-.102,1.062),(-.145,-.053,.900),.025,.009,m["handbag"],"Pelvis")
    rounded_case(g,(-.177,-.033,.855),.098,.179,.150,m["handbag"],"Pelvis")
    g.box((-.225,-.040,.864),(.009,.123,.012),m["gold"],"Pelvis")
    # Looped beads are a cue from the purple-shirt portrait on the sheet.
    for i in range(18):
        t=i/17;xx=(t-.5)*.15;zz=1.377+.056*(2*t-1)**2
        yy=-.108+.038*abs(2*t-1)
        g.ball((xx,yy,zz),(.0056,.0055,.0063),m["pearl"],"Chest",8,5)
    # Individually sculpted sides and nape form a full, wavy bob.
    for s in (-1,1):
        g.ball((s*.079,.011,1.588),(.032,.061,.086),m["hair"],"Head",20,11)
        for k in range(6):
            y=-.035+k*.020
            g.follow([((s*.074,y,1.661),.024,.016,"Head"),((s*(.094+.004*(k%2)),y-.008,1.609),.018,.014,"Head"),
                      ((s*.096,y+.004,1.555),.014,.013,"Head"),((s*.081,y+.010,1.522+.008*(k%3)),.008,.007,"Head")],
                     m["hair highlights"] if k==3 else m["hair"],10)
        g.ball((s*.092,-.002,1.548),(.005,.005,.008),m["gold"],"Head",8,5)
    g.ball((0,.075,1.584),(.077,.050,.075),m["hair"],"Head",18,10)


def senior(g,m,arms):
    shade_glasses(g,m,False)
    # Receding gray hair and a low bun, with a few swept silver locks.
    g.ball((0,.094,1.562),(.060,.048,.056),m["hair"],"Head",20,10)
    for s in (-1,1):
        for j in range(3):
            xx=s*(.065+.009*j)
            curve(g,[(xx,-.046,1.643),(xx+s*.006,-.010,1.623),(xx,.046,1.593)],
                  .0028,m["hair highlights"],"Head",7)
        curve(g,[(s*.021,-.097,1.543),(s*.030,-.088,1.534),(s*.032,-.079,1.522)],
              .0013,m["skin shadows"],"Head",6)
        curve(g,[(s*.048,-.076,1.586),(s*.055,-.073,1.581)],.0014,m["skin shadows"],"Head",6)
    g.patch([(-.068,-.082,1.416),(.068,-.082,1.416),(0,-.120,1.209)],m["undershirt"],"Chest")
    for s in (-1,1):
        g.strip((s*.067,-.079,1.416),(0,-.122,1.208),.020,.010,m["knit"],"Chest")
        g.box((s*.108,-.082,1.072),(.068,.015,.077),m["fabric dark"],"Spine")
        g.strip((s*.08,-.092,1.104),(s*.14,-.076,1.108),.014,.008,m["knit"],"Spine")
    for j in range(4):
        z=1.025+.050*j;g.ball((.004,-.108,z),(.006,.004,.006),m["wood"],"Spine",9,6)
    # The rubber tip is at ground level in the authored stance.
    grip=arms[1][3];shaft=grip+V((.027,-.037,-.009));tip=V((shaft.x+.058,shaft.y-.087,.013))
    curve(g,[grip+V((-.037,.012,.003)),grip+V((-.026,-.009,.010)),shaft],.010,m["wood"],"Hand.L",10)
    g.tube(shaft,tip,.010,m["wood"],"Hand.L",r2=.008,n=12)
    g.tube(base.mixed(tip,shaft,.035),base.mixed(tip,shaft,.059),.0106,m["cane ferrule"],"Hand.L",n=12)
    g.tube(tip-V((0,0,.012)),base.mixed(tip,shaft,.039),.013,m["rubber"],"Hand.L",r2=.010,n=12)


def shorts_and_legs(g,m,legs,role):
    topo=base.Garment();n=24;rings=[];trim=set()
    # Construct the shorts to the actual thigh axes. Each hem is a complete
    # closed circumferential ring, including when the knees are held unevenly.
    for j,(z,rx,ry) in enumerate(((.83,.159,.096),(.873,.158,.106),(.921,.150,.101),(.966,.145,.095))):
        pts=[]
        for i in range(n):
            a=TAU*i/n
            pts.append((rx*math.cos(a),.004+ry*math.sin(a),
                        z-(.044 if j==0 else 0)*(1-abs(math.cos(a)))))
        rings.append(topo.ring(pts,["Pelvis"]*n))
    for aa,bb in zip(rings,rings[1:]):topo.band(aa,bb)
    topo.disk(rings[-1]);seam=[]
    for j in range(1,6):
        f=j/6
        seam+=topo.ring([(0,.004+.096*(1-2*f),.786-.035*math.sin(P*f))],["Pelvis"])
    for s in (-1,1):
        th="Thigh"+(".L" if s>0 else ".R");a,k,_=legs[s]
        if s==1:rim=[rings[0][j%n] for j in range(-6,7)]+seam
        else:rim=[rings[0][j%n] for j in range(6,19)]+list(reversed(seam))
        for idx in rim:
            if idx not in seam and abs(topo.v[idx].x)>.025:topo.w[idx]={"Pelvis":.68,th:.32}
        for t,rx,ry,blend in ((.40,.081,.087,.18),(.54,.083,.080,0),(.70,.079,.074,0),
                              (.735,.080,.075,0),(.74,.076,.071,0)):
            start=len(topo.f)
            rim=topo.extend(rim,base.mixed(a,k,t),k-a,rx,ry,{"Pelvis":blend,th:1-blend})
            if t>=.735:trim.update(range(start,len(topo.f)))
        topo.disk(rim)
    orient_shell(topo)
    for subset,material in ((False,m["pants"]),(True,m["pants dark"])):
        faces=[f for i,f in enumerate(topo.f) if (i in trim)==subset]
        used=sorted({v for f in faces for v in f});idx={v:i for i,v in enumerate(used)}
        g.add([topo.v[i] for i in used],[[idx[v] for v in f] for f in faces],material,[topo.w[i] for i in used])
    for s in (-1,1):
        side=".L" if s==1 else ".R";a,k,b=legs[s];th="Thigh"+side;sh="Shin"+side
        g.follow([(base.mixed(a,k,.60),.063,.063,th),(base.mixed(a,k,.84),.057,.071,th),
                  (k,.057,.056,{th:.46,sh:.54}),(base.mixed(k,b,.30),.059,.057,sh),
                  (base.mixed(k,b,.65),.045,.043,sh),(b,.030,.031,sh)],m["skin"],16)
        if role=="child":
            g.follow([(base.mixed(k,b,.67),.046,.046,sh),(base.mixed(k,b,.74),.044,.045,sh),
                      (base.mixed(k,b,.96),.033,.036,sh)],m["linen"],14)
            g.follow([(base.mixed(k,b,.674),.0468,.047,sh),(base.mixed(k,b,.705),.046,.046,sh)],m["fabric"],14)
        else:
            # Foot tapers from ankle to a downward-pointing forefoot as used
            # in an eggbeater kick. No shoe or boot geometry enters the model.
            toe=V((b.x,b.y-.14,.042));ft="Foot"+side
            g.follow([(base.mixed(k,b,.93),.029,.028,{sh:.70,ft:.30}),(b,.032,.031,{sh:.35,ft:.65}),
                      (base.mixed(b,toe,.42),.041,.039,ft),(base.mixed(b,toe,.83),.046,.026,ft),
                      (toe,.039,.019,ft)],m["skin"],18)
            for j in range(5):
                t=b+V(((j-2)*.014,-.145-(.014 if j==0 else 0),-b.z+.030+j*.003))
                g.ball(t,(.009,.016,.011),m["skin"],ft,9,5)


def exposed_hands(skin,m,arms):
    for s in (-1,1):
        side=".L" if s==1 else ".R";sh,el,wr,palm=arms[s];fore="Forearm"+side;hand="Hand"+side
        skin.follow([(base.mixed(el,wr,.87),.025,.024,fore),(wr,.029,.026,{fore:.6,hand:.4}),
                     (base.mixed(wr,palm,.34),.036,.021,hand),(palm,.038,.018,hand)],m["skin"],14)
        for name,(a,b,c) in base.fingers(arms[s],s,"swimmer").items():
            bn=name+side;tip=name+"Tip"+side;r=.010 if name in ("Thumb","Middle","Index") else .0085
            skin.follow([(a,r,r,{hand:.18,bn:.82}),(base.mixed(a,b,.68),r*.90,r*.91,bn),
                         (b,r*.89,r*.89,{bn:.50,tip:.50}),(base.mixed(b,c,.62),r*.79,r*.76,tip),
                         (c,r*.46,r*.42,tip)],m["skin"],9)


def child(g,m):
    # Hood down behind the neck and a two-tone anorak with a kangaroo pocket.
    g.vertical([(0,.037,1.340,.093,.080),(0,.054,1.397,.113,.088),
                (0,.045,1.433,.103,.087)],m["fabric dark"],"Chest")
    g.patch([(-.137,-.083,1.148),(-.097,-.098,1.214),(.097,-.098,1.214),(.137,-.083,1.148),
             (.145,-.078,1.131),(-.145,-.078,1.131)],m["undershirt"],"Chest")
    g.patch([(-.112,-.085,1.030),(-.074,-.103,1.096),(.074,-.103,1.096),(.109,-.084,1.030),
             (.090,-.090,.985),(-.090,-.090,.985)],m["fabric dark"],"Spine")
    base.label("AIR CLUB",(0,-.118,1.275),.023,1,m["ink"],"Chest",g)
    rounded_case(g,(0,.148,1.190),.237,.137,.264,m["cap"],"Chest")
    rounded_case(g,(0,.218,1.133),.170,.061,.106,m["briefcase"],"Chest")
    g.box((0,.245,1.151),(.128,.009,.011),m["signal"],"Chest")
    for s in (-1,1):
        curve(g,[(s*.092,.139,1.304),(s*.129,.064,1.404),(s*.135,-.051,1.396),
                 (s*.111,-.106,1.311),(s*.127,-.083,1.186),(s*.135,.090,1.066)],
              .012,m["strap"],"Chest",10)
        g.box((s*.118,-.108,1.262),(.032,.012,.025),m["gold"],"Chest")
    # Several soft, forward locks and broader cheeks distinguish this child
    # from the short-cropped adult face before the proportional conversion.
    for j in range(6):
        x=-.058+j*.023
        g.follow([((x+.012,-.051,1.676),.018,.012,"Head"),((x+.006,-.077,1.648),.016,.010,"Head"),
                  ((x-.008,-.089,1.622+.004*(j%3)),.006,.006,"Head")],
                 m["hair highlights"] if j==1 else m["hair"],10)


def swimmer(g,m):
    # Twin flotation panels leave the neck and sculling arms free. The
    # vest is a new safety outfit, not an extracted original texture.
    for s in (-1,1):
        g.vertical([(s*.093,-.080,1.080,.060,.034),(s*.093,-.092,1.117,.076,.044),
                    (s*.092,-.093,1.278,.075,.046),(s*.096,-.076,1.348,.068,.036),
                    (s*.102,-.058,1.410,.040,.028)],m["fabric"],"Chest",18)
        g.strip((s*.103,-.063,1.415),(s*.100,.053,1.407),.060,.026,m["fabric"],"Chest")
        g.box((s*.092,-.143,1.273),(.075,.006,.022),m["stripe"],"Chest")
    rounded_case(g,(0,.090,1.245),.269,.077,.238,m["fabric dark"],"Chest")
    for z in (1.119,1.194):
        g.vertical([(0,-.005,z-.012,.163,.128),(0,-.005,z+.012,.164,.129)],
                   m["strap"],"Chest",26)
        g.box((0,-.139,z),(.047,.015,.025),m["black"],"Chest")
    g.strip((.014,-.137,1.252),(.017,-.140,1.330),.007,.006,m["amber"],"Chest")
    g.box((.017,-.144,1.250),(.014,.010,.028),m["amber"],"Chest")
    # Swim cap and dark goggles with an elastic head strap.
    g.vertical([(0,.008,1.630,.094,.099),(0,.006,1.663,.092,.095),
                (0,.010,1.697,.079,.084),(0,.009,1.720,.052,.066),
                (0,.008,1.737,.014,.020)],m["pants"],"Head",30)
    for s in (-1,1):
        g.ball((s*.038,-.090,1.589),(.029,.012,.018),m["rubber"],"Head",16,8)
        g.ball((s*.038,-.100,1.589),(.023,.007,.013),m["lens"],"Head",16,8)
        curve(g,[(s*.060,-.085,1.592),(s*.088,-.037,1.592),(s*.093,.007,1.598),
                 (s*.076,.069,1.607)],.0051,m["rubber"],"Head")
    g.tube((-.013,-.101,1.59),(.013,-.101,1.59),.0036,m["rubber"],"Head",n=8)


def proportion(p,role,scale):
    x,y,z=[a/scale for a in p]
    influence=lambda a,b: max(0,min(1,(z-a)/(b-a)))
    head=influence(1.43,1.56);torso=influence(.91,1.30)
    if role=="mechanic":
        x*=1.07+.065*torso-.072*head;y*=1.075-.04*head
        y-=.052*influence(1.12,1.67);z-=.018*head
    elif role=="office":
        x*=.935-.025*torso+.067*head;y*=.93+.053*head
    elif role=="passenger":
        x*=1.015-.055*torso+.035*head;y*=1.01-.04*torso
    elif role=="senior":
        x*=.955-.025*torso+.078*head;y*=1.01
        y-=.089*influence(.91,1.63);z-=.044*influence(1.05,1.72)
    elif role=="child":
        # Shorter legs and arms, rounder chest and larger head relative to
        # shoulders. This is a child-specific rest skeleton and mesh shape.
        armblend=influence(.83,1.09)*max(0,min(1,(abs(x)-.155)/.063))
        z += (1.365-z)*.13*armblend
        x*=.872+.246*head; y*=.910+.209*head
        z=min(z,.91)*.825+max(0,min(z,1.44)-.91)*.915+max(0,z-1.44)*1.13
    elif role=="swimmer":
        x*=.996+.075*torso-.067*head;y*=1.015
        y-=.030*influence(.94,1.60)
        z-=.019
    else:
        x*=1.016+.015*torso-.03*head
    return V((x,y,z))*scale


def transform_shape(rig,role,scale,objects):
    for obj in objects:
        for v in obj.data.vertices:v.co=proportion(v.co,role,scale)
        obj.data.update()
    bpy.ops.object.select_all(action="DESELECT");rig.select_set(True);bpy.context.view_layer.objects.active=rig
    bpy.ops.object.mode_set(mode="EDIT")
    for bone in rig.data.edit_bones:
        a,b=bone.head.copy(),bone.tail.copy()
        bone.head=proportion(a,role,scale);bone.tail=proportion(b,role,scale)
    bpy.ops.object.mode_set(mode="OBJECT")


def action(rig,role):
    # Rotate around model-space hinge directions, not guessed local X/Y axes.
    def key(name,axis,angle,frame):
        pb=rig.pose.bones[name];pb.rotation_mode="QUATERNION"
        local=pb.bone.matrix_local.to_3x3().inverted()@V(axis);local.normalize()
        pb.rotation_quaternion=Quaternion(local,math.radians(angle))
        pb.keyframe_insert(data_path="rotation_quaternion",frame=frame,group=name)
    x=(1,0,0);z=(0,0,1)
    if role in ("office","passenger","child","pilotwalk"):
        end={"office":33,"passenger":37,"child":29,"pilotwalk":33}[role]
        for j in range(9):
            frame=1+round(j*(end-1)/8);phi=TAU*j/8
            for s,side in [(1,'.L'),(-1,'.R')]:
                phase=phi+(0 if s==1 else P)
                key("Thigh"+side,x,-(21 if role=="child" else 18)*math.cos(phase),frame)
                # Knee bends mainly as the foot swings forward.
                key("Shin"+side,x,5+20*max(0,-math.sin(phase)),frame)
                key("Foot"+side,x,11*math.cos(phase)-5,frame)
                carry=(role=="passenger" and s==1) or (role=="office" and s==1)
                if role=="pilotwalk":
                    # The dispatch pose is the bind stance. Lower the headset
                    # arm while walking, then swing both arms in model space.
                    parent_delta=Quaternion((1,0,0),0)
                    for joint,vec,swing in (("UpperArm",(s*.070,.012,-.258),13),("Forearm",(s*.008,-.063,-.237),9),
                                             ("Hand",(s*.004,-.026,-.070),6)):
                        pose=rig.pose.bones[joint+side];rest=pose.bone;basis=rest.matrix_local.to_quaternion()
                        wanted=Quaternion(V(x),math.radians(swing*math.cos(phase)))@V(vec)
                        delta=(rest.tail_local-rest.head_local).normalized().rotation_difference(wanted.normalized())
                        pose.rotation_mode='QUATERNION'
                        pose.rotation_quaternion=basis.inverted()@parent_delta.inverted()@delta@basis
                        pose.keyframe_insert(data_path="rotation_quaternion",frame=frame,group=joint+side)
                        parent_delta=delta
                else:
                    key("UpperArm"+side,x,(4 if carry else 13)*math.cos(phase),frame)
                    key("Forearm"+side,x,(-2 if carry else -4)*(1-math.sin(phase)),frame)
            key("Chest",z,-3.8*math.cos(phi),frame);key("Head",z,2.0*math.cos(phi),frame)
            pelvis=rig.pose.bones["Root"];pelvis.location.y=.010*(1-math.cos(phi*2))
            pelvis.keyframe_insert(data_path="location",frame=frame,group="Root")
        name={"office":"Walk with briefcase","passenger":"Walk with shoulder bag","child":"Schoolday walk","pilotwalk":"Walk on foot"}[role]
    elif role=="swimmer":
        end=49
        for j in range(9):
            f=1+j*6;phase=TAU*j/8
            for s,side in [(1,'.L'),(-1,'.R')]:
                key("UpperArm"+side,z,s*(15*math.sin(phase)),f)
                key("Forearm"+side,z,s*(12*math.cos(phase)),f)
                key("Hand"+side,x,8*math.sin(phase+s*.5),f)
                key("Thigh"+side,x,s*13*math.sin(phase),f)
                key("Shin"+side,x,6+s*15*math.cos(phase),f)
            key("Chest",z,3.4*math.sin(phase),f);key("Head",z,-2.8*math.sin(phase),f)
            root=rig.pose.bones["Root"]
            # Blender's Root bone is upright. Its local Y is model-space Z.
            root.location.y=.012*(1-math.cos(2*phase))
            root.keyframe_insert(data_path="location",frame=f,group="Root")
        name="Tread water"
    else:
        end=61;rhythm=[(1,0),(16,.9),(30,.25),(45,-.50),(61,0)]
        anim={
            "pilot":[("Head",z,6),("Forearm.L",x,4),("Hand.L",z,6),("Chest",z,-2)],
            "mechanic":[("Forearm.R",z,13),("Hand.R",x,22),("Forearm.L",x,4),("Head",x,6),("Chest",x,2)],
            "senior":[("Head",z,9),("Chest",z,2),("Forearm.R",x,3.5),("Hand.R",x,3)]
        }[role]
        for frame,q in rhythm:
            for n,axis,a in anim:key(n,axis,a*q,frame)
        name={"pilot":"Listen to dispatch","mechanic":"Check and turn spanner","senior":"Wait at crossing"}[role]
    ac=rig.animation_data.action;ac.name=name
    sc=bpy.context.scene;sc.frame_start=1;sc.frame_end=end;sc.render.fps=24;sc.frame_set(1)
    return name


def build(role):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    stem,cn,scale=ROLES[role];sc=bpy.context.scene;sc.unit_settings.system='METRIC'
    coll=bpy.data.collections.new(cn);sc.collection.children.link(coll)
    arms,legs=landmarks(role);rig=base.rig_character(role,coll,scale,arms,legs)
    m=palette(role)
    skin=base.SkinMesh("Skin and hands",rig,coll,scale);wear=base.SkinMesh("Clothing and shoes",rig,coll,scale)
    head=base.SkinMesh("Hair and facial features",rig,coll,scale)
    base.face("medic",skin,head,m)
    if role=="swimmer":
        bare=dict(m);bare["fabric"]=bare["skin"];bare["fabric dark"]=bare["skin"]
        topo=fitted_shirt(skin,bare,arms,bare=True);exposed_hands(skin,m,arms)
    else:
        topo=fitted_shirt(wear,m,arms,short=role=="passenger")
        smart_boots(wear,m,legs,role)
        base.arms_hands("police" if role=="passenger" else "generic",skin,wear,m,arms)
    if role in ("child","swimmer"):shorts_and_legs(wear,m,legs,role)
    elif role!="passenger":base.trousers("generic",wear,m,legs)
    props=TailoredDetails("Role gear and insignia",rig,coll,scale,FrontSurface(topo))
    if role=="pilot":pilot(props,m)
    elif role=="mechanic":mechanic(props,m,arms)
    elif role=="office":office(props,m,arms)
    elif role=="passenger":passenger(props,m,legs)
    elif role=="senior":senior(props,m,arms)
    elif role=="child":child(props,m)
    else:swimmer(props,m)
    objs=[g.finish() for g in (skin,wear,head,props)]
    for o in objs:map_cloth(o,scale)
    transform_shape(rig,role,scale,objs)
    if role=="swimmer":
        rig["waterline_z_m"]=round(proportion((0,0,1.355*scale),role,scale).z,4)
        rig["placement"]="Position this waterline at water-surface height."
    rig["player_character"]=role=="pilot";rig["source_rendering"]="Original authored geometry"
    clip=action(rig,role)
    if role=="pilot":
        dispatch=rig.animation_data.action;dispatch.use_fake_user=True
        rig.animation_data.action=None
        for p in rig.pose.bones:
            p.rotation_mode='QUATERNION';p.rotation_quaternion=Quaternion((1,0,0),0);p.location=(0,0,0)
        action(rig,"pilotwalk")
        walk=rig.animation_data.action;walk.use_fake_user=True
        stash=rig.animation_data.nla_tracks.new();stash.name="Walk on foot (stored)";stash.mute=True
        stash.strips.new(walk.name,1,walk)
        rig.animation_data.action=dispatch
        # Bones not keyed by the dispatch clip resume their neutral placement.
        for p in rig.pose.bones:
            p.rotation_quaternion=Quaternion((1,0,0),0);p.location=(0,0,0)
        sc.frame_end=61;sc.frame_set(1)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in coll.objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=rig;bpy.context.preferences.filepaths.save_version=0
    for scr in bpy.data.screens:
        for area in scr.areas:
            if area.type=="VIEW_3D":
                sp=area.spaces.active;sp.shading.color_type="MATERIAL";sp.region_3d.view_distance=2.72
                sp.region_3d.view_location=(0,0,.96);sp.region_3d.view_rotation=V((-.14,.98,-.055)).to_track_quat("-Z","Y")
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(stem+".blend")),compress=True)
    rig["forward"]="+Z"
    path=OUT/(stem+".glb")
    bpy.ops.export_scene.gltf(filepath=str(path),use_selection=True,export_format="GLB",export_yup=True,
                              export_extras=True,export_animations=True,export_skins=True,
                              export_def_bones=False,export_animation_mode="ACTIONS")
    base.finalize_skin_roots(path)
    print("TRAFFIC_CHARACTER",stem,cn,"bones",len(rig.data.bones),"action",clip,flush=True)


if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--only",choices=tuple(ROLES))
    opt=p.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    for role in ([opt.only] if opt.only else ROLES):build(role)
