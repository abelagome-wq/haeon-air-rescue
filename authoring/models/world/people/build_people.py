"""Original SimCopter city characters. Blender 4.5; metres; Z up, facing -Y.

blender -b -t 2 --python-exit-code 1 -P build_people.py -- [--only civilian|medic|police]
Each asset has its own deforming skeleton and an authored looping gesture.
"""
import argparse
import json
import math
import random
import struct
import sys
import tempfile
import zlib
from pathlib import Path

import bpy
from mathutils import Vector

P=math.pi
TAU=math.tau
OUT=Path(__file__).resolve().parent
ROLES={
    "civilian":("Rescue-Civilian","PEOPLE_RESCUE_CIVILIAN",.975),
    "medic":("Medevac-Paramedic","PEOPLE_MEDEVAC_PARAMEDIC",1.046),
    "police":("Patrol-Officer","PEOPLE_PATROL_OFFICER",1.015)
}


def material(name,color,rough=.67,metal=0):
    m=bpy.data.materials.new(name)
    rgb=[int(color[j:j+2],16)/255 for j in (0,2,4)]
    rgb=[v/12.92 if v<.04045 else ((v+.055)/1.055)**2.4 for v in rgb]
    m.diffuse_color=(*rgb,1);m.use_nodes=True
    sh=m.node_tree.nodes["Principled BSDF"]
    sh.inputs["Base Color"].default_value=(*rgb,1)
    sh.inputs["Roughness"].default_value=rough
    sh.inputs["Metallic"].default_value=metal
    return m


def palette(role):
    skins={"civilian":("BF876F","A56C59","48352D"),"medic":("9C6853","815141","302B27"),
           "police":("C89577","AB795E","36312C")}
    a,b,c=skins[role]
    mats={k:material(k,color,r,metal) for k,(color,r,metal) in {
        "skin":(a,.62,0),"skin shadows":(b,.71,0),"hair":(c,.77,0),
        "hair highlights":({"civilian":"654636","medic":"3B3630","police":"514539"}[role],.75,0),
        "lip":({"civilian":"A36961","medic":"7F5047","police":"AD7869"}[role],.67,0),
        "lash":("493C35",.82,0),"eye white":("BEB5A7",.37,0),"iris":("4B4037",.34,0),
        "rubber":("292D2F",.85,0),"leather":("393B37",.66,0),"metal":("969E93",.38,.48),
        "zip":("464B48",.53,.38),"fabric":({"civilian":"D87846","medic":"2F6366","police":"465668"}[role],.82,0),
        "fabric dark":({"civilian":"B55C36","medic":"284A4C","police":"354352"}[role],.86,0),
        "pants":({"civilian":"4B6272","medic":"304749","police":"303A49"}[role],.86,0),
        "pants dark":({"civilian":"415768","medic":"263D40","police":"293340"}[role],.88,0),
        "seam":({"civilian":"99816B","medic":"385456","police":"404B57"}[role],.83,0),
        "boots":({"civilian":"725240","medic":"333B38","police":"2F3234"}[role],.60,0),
        "undershirt":({"civilian":"407778","medic":"344A49","police":"DBD9C6"}[role],.82,0),
        "stripe":("DBDDD4",.49,.10),"signal":("C6D959",.62,0),"bag":("B6553E",.80,0),
        "glove":("82AAA1",.61,0),"badge":("BEA46C",.38,.48),"blue":("416682",.73,0),
        "ink":("D7DCCF",.71,0),"radio":("343A3D",.73,0),"black":("1E2528",.77,0)
    }.items()}
    # Tangent-wrapping strand/curl grain on the scalp; embed the authored
    # texture into both native and runtime files. No external image dependency.
    rng=random.Random(43);sz=160;rows=[]
    base=tuple(int(c[i:i+2],16) for i in (0,2,4))
    for y in range(sz):
        row=bytearray([0])
        for x in range(sz):
            if role=="medic":
                d=(math.cos(x*.83+math.sin(y*.37))*math.cos(y*.79+x*.17))*7+rng.uniform(-4,4)
            else:
                d=(math.sin(x*.78+3.7*math.sin(y*.041+x*.036))**4)*14+rng.uniform(-2,2)-4
            row.extend(max(0,min(255,round(ch+d))) for ch in base)
        rows.append(bytes(row))
    def chunk(t,p):return struct.pack(">I",len(p))+t+p+struct.pack(">I",zlib.crc32(t+p)&0xffffffff)
    name=role+"_hair.png"
    data=b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",sz,sz,8,2,0,0,0))
    data+=chunk(b"IDAT",zlib.compress(b"".join(rows)))+chunk(b"IEND",b"")
    with tempfile.TemporaryDirectory() as d:
        texname=Path(d)/name;texname.write_bytes(data);im=bpy.data.images.load(str(texname))
        im.pack();im.filepath="//"+name
    m=mats["hair"];tex=m.node_tree.nodes.new("ShaderNodeTexImage");tex.image=im
    m.node_tree.links.new(tex.outputs["Color"],m.node_tree.nodes['Principled BSDF'].inputs["Base Color"])
    return mats


def V(p):return Vector(p)
def mixed(a,b,t):return a.lerp(b,t)
def torso_w(z):
    if z<1.02:
        f=max(0,min(1,(z-.89)/.13));return {"Pelvis":1-f,"Spine":f}
    f=max(0,min(1,(z-1.03)/.22))
    return {"Spine":1-f,"Chest":f}


class SkinMesh:
    def __init__(self,name,rig,coll,factor):
        self.name,self.rig,self.coll,self.factor=name,rig,coll,factor
        self.v,self.faces,self.weights,self.mat_indices,self.smooth,self.mats=[],[],[],[],[],[]

    def add(self,verts,faces,mat,weights,smooth=True):
        if mat not in self.mats:self.mats.append(mat)
        off=len(self.v);self.v.extend(tuple(V(p)*self.factor) for p in verts)
        if isinstance(weights,str):weights={weights:1}
        self.weights.extend([weights]*len(verts) if isinstance(weights,dict) else weights)
        self.faces.extend(tuple(off+j for j in f) for f in faces)
        self.mat_indices.extend([self.mats.index(mat)]*len(faces));self.smooth.extend([smooth]*len(faces))

    def finish(self):
        me=bpy.data.meshes.new(self.name);me.from_pydata(self.v,[],self.faces);me.update()
        obj=bpy.data.objects.new(self.name,me);self.coll.objects.link(obj);obj.parent=self.rig
        for m in self.mats:me.materials.append(m)
        for f,i,s in zip(me.polygons,self.mat_indices,self.smooth):
            f.material_index=i;f.use_smooth=s
        if any(m.name=="hair" for m in self.mats):
            uv=me.uv_layers.new(name="Hair growth")
            for f in me.polygons:
                coords=[]
                for loop in f.loop_indices:
                    x,y,z=[a/self.factor for a in self.v[me.loops[loop].vertex_index]]
                    coords.append((math.atan2(y-.006,x)/TAU+.5,(z-1.475)/.28))
                cross=(max(p[0] for p in coords)-min(p[0] for p in coords))>.5
                for loop,(u,v) in zip(f.loop_indices,coords):uv.data[loop].uv=(u+(1 if cross and u<.5 else 0),v)
        assert len(self.weights)==len(me.vertices)
        groups={}
        for i,w in enumerate(self.weights):
            assert abs(sum(w.values())-1)<1e-5
            for bn,amount in w.items():
                if amount<.00001:continue
                if bn not in groups:groups[bn]=obj.vertex_groups.new(name=bn)
                groups[bn].add([i],amount,"REPLACE")
        mod=obj.modifiers.new("Character skin","ARMATURE");mod.object=self.rig
        return obj

    def box(self,c,size,m,w,quat=None):
        vs=[]
        for x,y,z in ((-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),
                      (-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)):
            delta=V((x*size[0]/2,y*size[1]/2,z*size[2]/2))
            vs.append(V(c)+(quat@delta if quat else delta))
        self.add(vs,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],m,w,False)

    def ball(self,p,r,m,w,n=16,lat=9):
        vs=[(p[0],p[1],p[2]-r[2])]
        for j in range(1,lat):
            v=P*(j/lat-.5)
            for i in range(n):
                u=TAU*i/n
                vs.append((p[0]+r[0]*math.cos(v)*math.cos(u),p[1]+r[1]*math.cos(v)*math.sin(u),p[2]+r[2]*math.sin(v)))
        vs.append((p[0],p[1],p[2]+r[2]))
        fs=[(0,1+(i+1)%n,1+i) for i in range(n)]
        fs.extend((1+j*n+i,1+j*n+(i+1)%n,1+(j+1)*n+(i+1)%n,1+(j+1)*n+i)
                  for j in range(lat-2) for i in range(n))
        fs.extend((1+(lat-2)*n+i,1+(lat-2)*n+(i+1)%n,len(vs)-1) for i in range(n))
        self.add(vs,fs,m,w)

    def tube(self,a,b,r,m,w,r2=None,n=10):
        a,b=V(a),V(b);q=(b-a).to_track_quat("Z","Y")
        unit=[q@V((math.cos(TAU*i/n),math.sin(TAU*i/n),0)) for i in range(n)]
        vs=[a+e*r for e in unit]+[b+e*(r if r2 is None else r2) for e in unit]
        fs=[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        fs.extend([tuple(reversed(range(n))),tuple(range(n,n*2))])
        self.add(vs,fs,m,w)

    def strip(self,a,b,width,depth,m,w):
        a,b=V(a),V(b); self.box((a+b)/2,(width,depth,(b-a).length),m,w,(b-a).to_track_quat("Z","Y"))

    def rings(self,contours,m,row_w):
        n=len(contours[0]);vs=[p for row in contours for p in row]
        fs=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(len(contours)-1) for i in range(n)]
        fs.extend([tuple(reversed(range(n))),tuple(range(len(vs)-n,len(vs)))])
        weights=[]
        for w in row_w:
            if isinstance(w,str):w={w:1}
            weights.extend([w]*n)
        self.add(vs,fs,m,weights)

    def vertical(self,rows,m,weights,n=20):
        cs=[]
        for x,y,z,rx,ry in rows:
            cs.append([(x+rx*math.cos(TAU*i/n),y+ry*math.sin(TAU*i/n),z) for i in range(n)])
        self.rings(cs,m,weights if isinstance(weights,list) else [weights]*len(rows))

    def follow(self,joints,m,n=16):
        # Joint tuples contain point, transverse/depth radii and weight blend.
        pts=[V(j[0]) for j in joints]; rings=[]
        for i,(_,rx,ry,w) in enumerate(joints):
            tangent=(pts[min(i+1,len(pts)-1)]-pts[max(0,i-1)]).normalized()
            side=V((1,0,0))-tangent*tangent.x
            if side.length<.12:side=V((0,1,0))-tangent*tangent.y
            side.normalize();deep=tangent.cross(side).normalized()
            rings.append([pts[i]+side*(rx*math.cos(TAU*k/n))+deep*(ry*math.sin(TAU*k/n)) for k in range(n)])
        self.rings(rings,m,[j[3] for j in joints])

    def patch(self,points,m,w):
        self.add(points,[tuple(range(len(points)))],m,w,False)


def positions(role):
    """Articulated landmark joints in the role's relaxed/asymmetric bind pose."""
    if role=="civilian":
        arms={1:((.184,0,1.385),(.347,-.030,1.591),(.32,-.084,1.829),(.345,-.105,1.897)),
             -1:((-.184,0,1.377),(-.305,-.019,1.139),(-.477,-.097,1.015),(-.526,-.122,.982))}
        legs={1:((.088,0,.91),(.116,-.065,.514),(.159,-.092,.116)),
              -1:((-.088,0,.91),(-.115,.030,.514),(-.142,.103,.116))}
    elif role=="medic":
        arms={1:((.196,0,1.383),(.264,-.04,1.124),(.303,-.035,.875),(.31,-.04,.795)),
             -1:((-.196,0,1.382),(-.319,-.102,1.165),(-.347,-.314,1.267),(-.35,-.383,1.285))}
        legs={1:((.093,0,.91),(.129,-.065,.515),(.140,-.111,.116)),
              -1:((-.093,0,.91),(-.12,.045,.515),(-.134,.11,.116))}
    else:
        arms={1:((.193,0,1.383),(.29,.025,1.137),(.230,-.064,.917),(.211,-.071,.849)),
             -1:((-.193,0,1.384),(-.315,-.046,1.154),(-.169,-.146,1.32),(-.133,-.179,1.374))}
        legs={1:((.089,0,.91),(.113,-.005,.515),(.132,-.028,.116)),
              -1:((-.089,0,.91),(-.119,.030,.516),(-.159,.085,.116))}
    return {s:list(map(V,g)) for s,g in arms.items()},{s:list(map(V,g)) for s,g in legs.items()}


def fingers(arm,s,role):
    wr,palm=arm[2:];axis=(palm-wr).normalized()
    lateral=V((s,0,0));lateral=(lateral-axis*lateral.dot(axis)).normalized()
    normal=axis.cross(lateral).normalized()
    # A signalling palm is extended; the bag hand wraps around its handle.
    curl=(.004 if role=="civilian" and s==1 else .025)
    if role=="medic" and s==1:curl=.041
    out={}
    for ident,offset,length in (("Index",-.024,.063),("Middle",-.008,.070),
                                ("Ring",.009,.063),("Little",.026,.051)):
        start=palm+lateral*offset
        b=start+axis*(length*.55)+lateral*(offset*.13)+normal*(curl*.18)
        c=b+axis*(length*.40)+normal*(curl*.87)+lateral*(offset*.12)
        out[ident]=(start,b,c)
    start=wr+axis*.036-lateral*.030
    bend=start+axis*.019-lateral*.026+normal*.006
    out["Thumb"]=(start,bend,bend+axis*.031-lateral*.012+normal*(curl*.33))
    return out


def rig_character(role,coll,factor,arms,legs):
    arm=bpy.data.armatures.new("Responder skeleton")
    rig=bpy.data.objects.new(ROLES[role][0]+" | Rig",arm);coll.objects.link(rig)
    rig.show_in_front=True;arm.display_type="OCTAHEDRAL"
    bpy.context.view_layer.objects.active=rig;rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    def bone(n,a,b,parent=None,deform=True):
        eb=arm.edit_bones.new(n);eb.head=V(a)*factor;eb.tail=V(b)*factor;eb.use_deform=deform
        if parent:eb.parent=arm.edit_bones[parent]
    bone("Root",(0,0,0),(0,0,.12),deform=False)
    bone("Pelvis",(0,0,.86),(0,0,.99),"Root")
    bone("Spine",(0,0,.99),(0,0,1.19),"Pelvis")
    bone("Chest",(0,0,1.19),(0,0,1.39),"Spine")
    bone("Neck",(0,0,1.39),(0,-.006,1.495),"Chest")
    bone("Head",(0,-.006,1.495),(0,0,1.72),"Neck")
    for s in (-1,1):
        side=".L" if s==1 else ".R"; sh,el,wr,palm=arms[s];hip,knee,ank=legs[s]
        bone("Clavicle"+side,(0,0,1.365),sh,"Chest")
        bone("UpperArm"+side,sh,el,"Clavicle"+side)
        bone("Forearm"+side,el,wr,"UpperArm"+side)
        bone("Hand"+side,wr,palm,"Forearm"+side)
        for name,(a,b,c) in fingers(arms[s],s,role).items():
            bone(name+side,a,b,"Hand"+side);bone(name+"Tip"+side,b,c,name+side)
        bone("Thigh"+side,hip,knee,"Pelvis");bone("Shin"+side,knee,ank,"Thigh"+side)
        toe=V((ank.x,ank.y-.139,.040));bone("Foot"+side,ank,toe,"Shin"+side)
    bpy.ops.object.mode_set(mode="OBJECT")
    rig["units"]="metres";rig["forward"]="-Y";rig["role"]=role
    return rig


class Garment:
    """Build a shared-vertex garment with real openings for its limbs."""
    def __init__(self):self.v=[];self.f=[];self.w=[]
    def ring(self,points,weights):
        ids=[]
        for p,w in zip(points,weights):
            ids.append(len(self.v));self.v.append(V(p))
            self.w.append({w:1} if isinstance(w,str) else w)
        return ids
    def band(self,aa,bb,omit=()):
        ctr=sum((self.v[i] for i in aa+bb),V((0,0,0)))/len(aa+bb)
        for j in range(len(aa)):
            if j in omit:continue
            k=(j+1)%len(aa);f=[aa[j],aa[k],bb[k],bb[j]]
            p,q,r,t=[self.v[i] for i in f]
            if (q-p).cross(r-p).dot((p+q+r+t)/4-ctr)<0:f.reverse()
            self.f.append(f)
    def disk(self,idx,reverse=False):self.f.append(tuple(reversed(idx)) if reverse else tuple(idx))
    def align(self,old,points):
        n=len(points);candidates=[]
        for rev in (False,True):
            ring=list(reversed(points)) if rev else points
            for shift in range(n):
                trial=ring[shift:]+ring[:shift]
                score=sum((self.v[j]-k).length_squared for j,k in zip(old,trial))
                candidates.append((score,trial))
        return min(candidates,key=lambda c:c[0])[1]
    def extend(self,old,center,axis,rx,ry,w):
        axis=axis.normalized()
        side=V((1,0,0))-axis*axis.x
        if side.length<.13:side=V((0,1,0))-axis*axis.y
        side.normalize();deep=axis.cross(side).normalized();n=len(old)
        pts=[center+side*(rx*math.cos(TAU*j/n))+deep*(ry*math.sin(TAU*j/n)) for j in range(n)]
        new=self.ring(self.align(old,pts),[w]*n);self.band(old,new);return new
    def emit(self,g,m):g.add(self.v,self.f,m,self.w)


def shirt(role,g,m,arms):
    w=.925 if role=="civilian" else 1
    rows=[(.932,.144,.091),(.965,.152,.097),(1.022,.149,.092),(1.11,.145,.092),
          (1.205,.158,.104),(1.275,.174,.116),(1.345,.188,.111),(1.393,.177,.096),
          (1.421,.144,.079),(1.445,.079,.059)]
    top=Garment();rings=[];n=24
    for z,rx,ry in rows:
        pts=[(rx*w*math.cos(TAU*j/n),-.004+ry*math.sin(TAU*j/n),z) for j in range(n)]
        rings.append(top.ring(pts,[torso_w(z)]*n))
    slopes=set(list(range(0,3))+list(range(n-3,n))+list(range(9,15)))
    for j in range(len(rings)-1):top.band(rings[j],rings[j+1],slopes if 4<=j<8 else ())
    top.disk(rings[0],True);top.disk(rings[-1])
    for s in (-1,1):
        # The sleeve begins on the torso armhole (six circumferential faces
        # through four vertical courses), not on a separately capped cylinder.
        k0=-3 if s==1 else 9;k1=k0+6
        boundary=[rings[4][j%n] for j in range(k0,k1+1)]
        boundary += [rings[r][k1%n] for r in range(5,9)]
        boundary += [rings[8][j%n] for j in range(k1-1,k0-1,-1)]
        boundary += [rings[r][k0%n] for r in range(7,4,-1)]
        sh,el,wr,palm=arms[s];side=".L" if s==1 else ".R"
        up="UpperArm"+side;fore="Forearm"+side;hand="Hand"+side;cl="Clavicle"+side
        for i in boundary:top.w[i]={"Chest":.68,cl:.26,up:.06}
        sleeve=[(mixed(sh,el,.035)-V((s*.014,0,0)),.062*w,.064,{cl:.44,up:.53,"Chest":.03}),
                (mixed(sh,el,.16),.070*w,.068,{cl:.19,up:.81}),
                (mixed(sh,el,.31),.072*w,.067,{cl:.06,up:.94}),
                (mixed(sh,el,.54),.065*w,.066,up)]
        if role=="police":
            sleeve += [(mixed(sh,el,.64),.063*w,.062,up)]
        else:
            sleeve += [(mixed(sh,el,.79),.062*w,.061,{up:.94,fore:.06}),
                       (el,.060*w,.058,{up:.50,fore:.50}),
                       (mixed(el,wr,.20),.061*w,.061,{up:.06,fore:.94}),
                       (mixed(el,wr,.54),.051*w,.049,fore),
                       (mixed(el,wr,.82),.042*w,.040,fore),
                       (mixed(wr,palm,.17),.033,.031,{fore:.65,hand:.35})]
        for i,(center,rx,ry,weight) in enumerate(sleeve):
            direct=(sleeve[min(i+1,len(sleeve)-1)][0]-(sh if i==0 else sleeve[i-1][0])).normalized()
            boundary=top.extend(boundary,center,direct,rx,ry,weight)
        top.disk(boundary)
    top.emit(g,m["fabric"])


def trousers(role,g,m,legs):
    w=.925 if role=="civilian" else 1;model=Garment();n=24;rings=[]
    # Two semicircular panels share a curved crotch seam. Both thigh rings
    # attach to this saddle; no flat hip or thigh caps remain at the join.
    for j,(z,rx,ry) in enumerate(((.83,.159,.096),(.873,.158,.106),(.921,.150,.101),(.966,.145,.095))):
        pts=[]
        for i in range(n):
            a=TAU*i/n
            zz=z-(.044 if j==0 else 0)*(1-abs(math.cos(a)))
            pts.append((rx*w*math.cos(a),.004+ry*math.sin(a),zz))
        rings.append(model.ring(pts,["Pelvis"]*n))
    for a,b in zip(rings,rings[1:]):model.band(a,b)
    model.disk(rings[-1])
    seam=[]
    for j in range(1,6):
        f=j/6
        seam+=model.ring([(0,.004+.096*(1-2*f),.786-.035*math.sin(P*f))],["Pelvis"])
    for s in (-1,1):
        side=".L" if s==1 else ".R";th="Thigh"+side;sh="Shin"+side
        hip,knee,ank=legs[s]
        if s==1: rim=[rings[0][j%n] for j in range(-6,7)]+seam
        else: rim=[rings[0][j%n] for j in range(6,19)]+list(reversed(seam))
        for ix in rim:
            if ix not in seam and abs(model.v[ix].x)>.025:
                model.w[ix]={"Pelvis":.68,th:.32}
        levels=[(mixed(hip,knee,.40),.078*w,.086,{"Pelvis":.18,th:.82}),
                (mixed(hip,knee,.51),.082*w,.078,th),(mixed(hip,knee,.77),.071*w,.070,{th:.93,sh:.07}),
                (mixed(hip,knee,.94),.068*w,.068,{th:.67,sh:.33}),
                (knee,.069*w,.069,{th:.46,sh:.54}),
                (mixed(knee,ank,.19),.071*w,.072,{th:.06,sh:.94}),(mixed(knee,ank,.37),.070*w,.070,sh),
                (mixed(knee,ank,.70),.054*w,.054,sh),(mixed(knee,ank,.91),.048*w,.051,sh),
                (mixed(knee,ank,.97),.051*w,.052,sh)]
        for i,(center,rx,ry,weight) in enumerate(levels):
            direct=levels[min(i+1,len(levels)-1)][0]-(hip if i==0 else levels[i-1][0])
            rim=model.extend(rim,center,direct,rx,ry,weight)
        model.disk(rim)
    model.emit(g,m["pants"])


def clothing(role,g,m,arms,legs):
    woman=role=="civilian";w=.925 if woman else 1
    shirt(role,g,m,arms);trousers(role,g,m,legs)
    g.vertical([(0,-.003,1.419,.087,.066),(0,-.006,1.456,.060,.051)],
               m["undershirt"],["Chest","Neck"])
    for s in (-1,1):
        side=".L" if s==1 else ".R";hip,knee,ank=legs[s]
        th,sh,ft="Thigh"+side,"Shin"+side,"Foot"+side
        # Pressed workwear seam and knee creasing; cargo patch only on uniformed workers.
        for a,b,n in ((mixed(hip,knee,.24),mixed(hip,knee,.79),th),(mixed(knee,ank,.21),mixed(knee,ank,.84),sh)):
            a.x+=s*(.086*w if n==th else .063*w);b.x+=s*(.068*w if n==th else .048*w)
            g.tube(a,b,.0027,m["seam"],n,n=6)
        kp=knee+V((0,-.071,-.012))
        g.tube(kp+V((-.050,0,.018)),kp+V((.043,.005,-.008)),.0035,m["pants dark"],sh,n=6)
        if not woman:
            pc=mixed(hip,knee,.43);pc.x+=s*.079
            g.box(pc,(.030,.104,.119),m["pants dark"],th)
            g.box(pc+V((s*.015,0,.049)),(.013,.112,.034),m["pants"],th)
        ax,ay=ank.x,ank.y
        g.vertical([(ax,ay-.043,.000,.058,.129),(ax,ay-.048,.020,.061,.132),
                    (ax,ay-.047,.039,.060,.127)],m["rubber"],ft,20)
        g.vertical([(ax,ay-.048,.028,.059,.130),(ax,ay-.057,.058,.058,.121),
                    (ax,ay-.038,.086,.052,.096),(ax,ay-.004,.130,.052,.062),
                    (ax,ay+.004,.157,.047,.051)],m["boots"],ft,20)
        for j in range(4):
            z=.083+j*.012;y=ay-.115+j*.011
            g.tube((ax-.025,y,z),(ax+.023,y-.006,z+.007),.0029,m["seam"],ft,n=6)
    # Front opening, lapels, collar and pockets. Small elements are attached
    # to chest while the fabric itself blends from pelvis through spine.
    for s in (-1,1):
        g.patch([(s*.016,-.089,1.382),(s*.065,-.069,1.445),
                 (s*.116,-.071,1.414),(s*.083,-.108,1.359)],m["fabric dark"],"Chest")
    if role=="civilian":
        g.vertical([(0,.021,1.344,.089,.081),(0,.024,1.39,.108,.084),(0,.034,1.434,.09,.077)],
                   m["fabric dark"],"Chest")
        g.strip((0,-.101,.966),(0,-.098,1.129),.012,.006,m["zip"],"Spine")
        g.strip((0,-.104,1.129),(0,-.112,1.36),.012,.006,m["zip"],"Chest")
        g.box((0,-.119,1.319),(.017,.010,.029),m["metal"],"Chest")
        for s in (-1,1):
            g.strip((s*.092,-.079,1.036),(s*.133,-.068,1.115),.013,.007,m["fabric dark"],"Spine")
            g.patch([(s*.076,-.088,1.18),(s*.120,-.068,1.187),(s*.139,-.062,1.060),
                     (s*.134,-.066,1.021),(s*.082,-.085,1.015)],m["fabric dark"],"Spine")
            g.strip((s*.076,-.091,1.164),(s*.122,-.072,1.177),.007,.006,m["metal"],"Spine")
            g.strip((s*.09,-.083,1.410),(s*.14,-.072,1.342),.010,.007,m["undershirt"],"Chest")
    elif role=="medic":
        g.vertical([(0,-.003,1.267,.169,.113),(0,-.003,1.315,.177,.116)],
                   m["signal"],"Chest",28)
        g.vertical([(0,-.003,1.286,.174,.116),(0,-.003,1.300,.175,.117)],
                   m["stripe"],"Chest",28)
        for s in (-1,1):
            g.strip((s*.097,-.094,1.404),(s*.11,-.102,1.316),.044,.010,m["signal"],"Chest")
            g.box((s*.092,-.103,1.212),(.089,.017,.061),m["fabric dark"],"Chest")
            g.box((s*.092,-.117,1.232),(.092,.013,.020),m["fabric"],"Chest")
        g.strip((0,-.103,1.041),(0,-.121,1.34),.010,.008,m["zip"],"Chest")
    else:
        for z in (1.04,1.12,1.20,1.28,1.355):
            g.ball((0,-.096-(z-1.04)*.059,z),(.0056,.003,.0056),m["black"],"Spine" if z<1.17 else "Chest",8,4)
        for s in (-1,1):
            g.box((s*.091,-.103,1.294),(.082,.014,.074),m["fabric"],"Chest")
            g.patch([(s*.047,-.120,1.331),(s*.129,-.112,1.331),(s*.087,-.123,1.307)],m["fabric dark"],"Chest")
            g.strip((s*.102,-.021,1.414),(s*.169,.002,1.40),.035,.012,m["fabric dark"],"Chest")
        g.vertical([(0,0,.929,.153,.103),(0,0,.966,.149,.100)],m["leather"],"Pelvis",24)
        g.box((0,-.102,.948),(.064,.014,.028),m["metal"],"Pelvis")
        for s in (-1,1):
            g.box((s*.129,-.049,.929),(.048,.057,.072),m["radio"],"Pelvis")
            g.box((s*.138,-.078,.940),(.044,.009,.024),m["black"],"Pelvis")
        g.box((-.127,-.060,1.353),(.048,.025,.058),m["radio"],"Chest")
        for z in (1.346,1.356,1.366):
            g.box((-.127,-.075,z),(.028,.005,.003),m["metal"],"Chest")
        g.patch([(.053,-.121,1.35),(.068,-.123,1.365),(.087,-.121,1.35),
                 (.082,-.123,1.330),(.070,-.124,1.323),(.058,-.123,1.332)],m["badge"],"Chest")


def arms_hands(role,skin,g,m,arms):
    for s in (-1,1):
        side=".L" if s==1 else ".R";sh,el,wr,palm=arms[s];up="UpperArm"+side;fore="Forearm"+side
        hand="Hand"+side;w=.92 if role=="civilian" else 1
        rows=[(mixed(sh,el,-.12),.070*w,.071,{"Chest":.24,"Clavicle"+side:.36,up:.40}),
              (mixed(sh,el,.12),.080*w,.078,{up:.88,"Clavicle"+side:.12}),
              (mixed(sh,el,.50),.066*w,.062,up),(mixed(sh,el,.78),.053*w,.052,{up:.91,fore:.09}),
              (el,.051*w,.052,{up:.5,fore:.5}),(mixed(el,wr,.17),.055*w,.055,{up:.08,fore:.92}),
              (mixed(el,wr,.48),.048*w,.048,fore),(mixed(el,wr,.80),.035*w,.035,fore),
              (wr,.027*w,.028,{fore:.87,hand:.13})]
        if role=="police":
            skin.follow([(mixed(sh,el,.51),.056,.055,up)]+rows[3:],m["skin"])
            g.follow([(mixed(sh,el,.59),.063,.062,up),(mixed(sh,el,.65),.064,.063,up)],m["fabric dark"])
        else:
            g.follow([(mixed(el,wr,.91),.039,.038,fore),
                      (mixed(wr,palm,.17),.034,.032,{fore:.63,hand:.37})],m["fabric dark"])
            if role=="medic":
                g.follow([(mixed(sh,el,.39),.079,.075,up),(mixed(sh,el,.53),.075,.072,up)],m["signal"])
                g.follow([(mixed(sh,el,.435),.079,.076,up),(mixed(sh,el,.49),.078,.075,up)],m["stripe"])
        handmat=m["glove"] if role=="medic" else m["skin"]
        skin.follow([(mixed(el,wr,.84),.028,.027,fore),(wr,.029,.026,{fore:.60,hand:.40}),
                     (mixed(wr,palm,.34),.036,.021,hand),
                     (palm,.038,.018,hand)],handmat,14)
        for finger,(a,b,c) in fingers(arms[s],s,role).items():
            bn=finger+side;tip=finger+"Tip"+side
            r=.010 if finger in ("Thumb","Middle","Index") else .0085
            skin.follow([(a,r,r,{hand:.18,bn:.82}),(mixed(a,b,.68),r*.90,r*.91,bn),
                         (b,r*.89,r*.89,{bn:.50,tip:.50}),(mixed(b,c,.62),r*.79,r*.76,tip),
                         (c,r*.46,r*.42,tip)],handmat,9)


def face(role,skin,hair,m):
    h="Head";sidewidth=.94 if role=="civilian" else 1
    skin.vertical([(0,.001,1.40,.055,.055),(0,-.006,1.449,.050,.050),
                   (0,-.006,1.504,.046,.052),(0,-.003,1.524,.050,.056)],m["skin"],
                  [{"Chest":.48,"Neck":.52},"Neck",{"Neck":.6,h:.4},h])
    rows=[(1.468,-.033,.030,.033),(1.485,-.020,.054,.057),(1.509,-.007,.071,.074),
          (1.537,-.006,.081,.086),(1.568,-.003,.089,.094),(1.607,.002,.090,.098),
          (1.641,.006,.090,.096),(1.675,.010,.083,.087),(1.703,.009,.067,.073),
          (1.721,.008,.037,.048),(1.727,.006,.012,.015)]
    skin.vertical([(0,y,z,rx*sidewidth,ry) for z,y,rx,ry in rows],m["skin"],h,32)
    def profile(z):
        if z<=rows[0][0]:q=rows[0][1:]
        elif z>=rows[-1][0]:q=rows[-1][1:]
        else:
            for a,b in zip(rows,rows[1:]):
                if a[0]<=z<=b[0]:
                    f=(z-a[0])/(b[0]-a[0]);q=tuple(x+(y-x)*f for x,y in zip(a[1:],b[1:]));break
        return q[0],q[1]*sidewidth,q[2]
    def front_y(x,z):
        yc,rx,ry=profile(z);return yc-ry*math.sqrt(max(.01,1-(x/rx)**2))
    # Tapered low nose bridge, two alae, slight lip crease, separate eyelids
    # rather than full spheres projecting from the face.
    skin.vertical([(0,-.086,1.538,.008,.009),(0,-.099,1.548,.017,.020),(0,-.100,1.555,.015,.023),
                   (0,-.091,1.573,.012,.016),(0,-.086,1.601,.011,.010)],
                  m["skin"],h,16)
    for s in (-1,1):
        x=s*.034;zeye=1.589;radius=.0145
        # Almond-shaped lid opening follows the curvature of the cheek. The
        # iris fills most of the aperture; avoid bright spheres on the face.
        outline=[]
        for j in range(20):
            t=TAU*j/20;xx=x+radius*math.cos(t)
            zz=zeye+(.0045 if math.sin(t)>0 else .0031)*math.sin(t)+s*.0015*math.cos(t)
            outline.append((xx,front_y(xx,zz)-.0015,zz))
        skin.patch(outline,m["eye white"],h)
        for j in range(10):
            aa,bb=outline[j],outline[(j+1)%20]
            skin.tube(aa,bb,.00115,m["skin shadows"],h,n=5)
        iris=[]
        for j in range(16):
            t=TAU*j/16;xx=x+.0060*math.cos(t);zz=zeye+.0034*math.sin(t)
            iris.append((xx,front_y(xx,zz)-.0022,zz))
        skin.patch(iris,m["iris"],h)
        brow=[]
        for xx,zz in ((x-s*.016,1.602),(x,1.609),(x+s*.012,1.607),(x+s*.020,1.603)):
            brow.append((xx,front_y(xx,zz)-.0022,zz))
        for j in range(3):
            skin.tube(brow[j],brow[j+1],(.0026,.003,.0024)[j],m["hair"],h,n=8)
        skin.ball((s*.014,-.101,1.548),(.009,.011,.006),m["skin"],h,12,6)
        skin.ball((s*.014,-.109,1.545),(.003,.002,.002),m["skin shadows"],h,9,5)
        skin.ball((s*.088*sidewidth,.005,1.566),(.014,.021,.031),m["skin"],h,14,7)
        skin.ball((s*.098*sidewidth,.003,1.568),(.005,.012,.018),m["skin shadows"],h,12,6)
        skin.tube((s*.020,-.084,1.521),(s*.005,-.092,1.522),.0028,m["lip"],h,n=8)
    skin.ball((0,-.086,1.517),(.018,.005,.004),m["lip"],h,14,6)
    # Hairline follows the brow, temples and nape; the crown is continuous.
    rows_h=[]
    for j in range(10):
        f=j/10;row=[]
        for i in range(36):
            a=TAU*i/36;fw=(-math.sin(a)+1)/2
            bottom=(1.505 if role=="civilian" else 1.530)+(.131 if role=="civilian" else .109)*fw**1.50
            bottom+=.005*math.sin(3*a+.6)
            high=1.742 if role=="civilian" else 1.732
            z=bottom+(high-bottom)*f
            yc,rx,ry=profile(z-(.012 if role=="civilian" else .0035))
            extra=(.009 if role=="civilian" else .0027)*(1-f*.72)
            ripple=.0016*math.sin(15*a+2*f) if role=="civilian" else .00065*math.sin(17*a+f)
            row.append(((rx+extra+ripple)*math.cos(a),
                        yc+(ry+extra*1.2+ripple)*math.sin(a),z))
        rows_h.append(row)
    rows_h.append([(.006*math.cos(TAU*i/36),.008+.006*math.sin(TAU*i/36),high+.001) for i in range(36)])
    hair.rings(rows_h,m["hair"],[h]*len(rows_h))
    if role=="civilian":
        for k in range(5):
            x=-.059+.023*k
            hair.follow([((x+.017,-.054,1.681+.002*k),.017,.012,h),
                         ((x+.005,front_y(x,1.655)-.005,1.655),.014,.011,h),
                         ((x-.010,front_y(x,1.633)-.005,1.633+.002*k),.006,.006,h)],
                        m["hair highlights"] if k==0 else m["hair"],10)
        hair.ball((0,.093,1.588),(.067,.056,.068),m["hair"],h,18,10)
        hair.ball((.010,.13,1.553),(.041,.038,.059),m["hair highlights"],h,14,8)
        hair.tube((.008,.128,1.576),(.009,.129,1.587),.042,m["fabric dark"],h,n=14)
        for s in (-1,1):
            hair.follow([((s*.065,-.045,1.655),.026,.022,h),
                         ((s*.083,-.031,1.608),.018,.016,h),((s*.079,-.023,1.561),.008,.008,h)],m["hair"],12)
    if role=="police":
        hair.vertical([(0,.004,1.648,.097,.103),(0,.004,1.668,.099,.107),
                       (0,.005,1.695,.102,.108),(0,.005,1.713,.108,.109),
                       (0,.001,1.733,.095,.094),(0,.002,1.743,.065,.067)],m["fabric"],h,32)
        hair.vertical([(0,.004,1.650,.098,.104),(0,.004,1.669,.100,.107)],m["leather"],h,32)
        hair.ball((0,-.087,1.648),(.088,.062,.009),m["leather"],h,24,8)
        hair.patch([(-.012,-.104,1.689),(0,-.109,1.704),(.013,-.104,1.689),(.008,-.110,1.677),
                    (0,-.111,1.670),(-.008,-.110,1.677)],m["badge"],h)


def bag(gear,m,arm):
    w="Hand.L";palm=arm[3]
    cx=palm.x+.004;cy=palm.y;top=palm.z-.107
    def canvas_rings(levels):
        return [[(cx+rx*math.copysign(abs(math.cos(TAU*i/24))**.48,math.cos(TAU*i/24)),
                  cy+ry*math.copysign(abs(math.sin(TAU*i/24))**.48,math.sin(TAU*i/24)),top+z)
                 for i in range(24)] for z,rx,ry in levels]
    levels=[(-.202,.068,.133),(-.186,.084,.154),(-.138,.090,.161),
            (-.063,.086,.157),(-.021,.081,.153),(-.009,.071,.141)]
    gear.rings(canvas_rings(levels),m["bag"],[w]*len(levels))
    levels=[(-.204,.067,.131),(-.198,.075,.142),(-.184,.084,.154)]
    gear.rings(canvas_rings(levels),m["black"],[w]*len(levels))
    levels=[(-.025,.082,.154),(-.018,.082,.152)]
    gear.rings(canvas_rings(levels),m["zip"],[w,w])
    gear.box((cx+.087,cy-.009,top-.114),(.023,.261,.087),m["fabric dark"],w)
    gear.box((cx+.103,cy-.009,top-.108),(.006,.254,.018),m["stripe"],w)
    for s in (-1,1):
        gear.tube((cx,cy+s*.086,top),(cx,cy+s*.045,palm.z-.020),.008,m["leather"],w)
    gear.tube((cx,cy-.046,palm.z-.020),(cx,cy+.046,palm.z-.020),.010,m["leather"],w)
    # Six spokes identify a medical crew without copying any agency seal.
    for i in range(3):
        a=i*P/3
        gear.strip((cx+.111,cy-.035*math.cos(a),top-.102-.035*math.sin(a)),
                   (cx+.111,cy+.035*math.cos(a),top-.102+.035*math.sin(a)),.010,.008,m["blue"],w)


def label(text,pos,size,front,m,bn,mesh):
    font=bpy.data.curves.new("Lettering","FONT");font.body=text;font.size=size
    font.align_x="CENTER";font.align_y="CENTER";font.extrude=.0003
    obj=bpy.data.objects.new("temporary lettering",font);mesh.coll.objects.link(obj)
    data=bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    verts=[(pos[0]+front*v.co.x,pos[1]-front*v.co.z,pos[2]+v.co.y) for v in data.vertices]
    mesh.add(verts,[tuple(p.vertices) for p in data.polygons],m,bn,False)
    bpy.data.objects.remove(obj,do_unlink=True);bpy.data.curves.remove(font);bpy.data.meshes.remove(data)


def motion(role,rig):
    # Light secondary movement; neutral keys at both ends for a seamless loop.
    keybones={
        "civilian":{"Forearm.L":(0,.17,.12),"Hand.L":(.06,.10,.24),"Chest":(.013,0,.025),"Head":(-.03,.03,.04)},
        "medic":{"Forearm.R":(.055,.055,.08),"Hand.R":(.04,.055,.07),"Chest":(.014,0,.010),"Head":(-.025,.035,.021)},
        "police":{"Forearm.R":(.041,.034,.036),"Hand.R":(.025,.026,.041),"Chest":(.013,.005,.010),"Head":(-.039,.042,.029)}
    }[role]
    for name,ang in keybones.items():
        bone=rig.pose.bones[name];bone.rotation_mode="XYZ"
        rhythm=[(1,0),(12,1),(24,-.60),(36,.80),(48,-.45),(61,0)] if role=="civilian" else [(1,0),(18,.86),(35,-.32),(48,.41),(61,0)]
        for frame,amount in rhythm:
            bone.rotation_euler=tuple(a*amount for a in ang)
            bone.keyframe_insert(data_path="rotation_euler",frame=frame,group=name)
    action=rig.animation_data.action
    action.name={"civilian":"Signal for rescue","medic":"Medevac ready","police":"Radio check"}[role]
    bpy.context.scene.frame_start=1;bpy.context.scene.frame_end=61;bpy.context.scene.render.fps=24
    bpy.context.scene.frame_set(1)


def finalize_skin_roots(path):
    """A glTF skinned mesh derives its transform from joints; put it at scene root.

    Blender's armature parenting remains in the .blend. Here we only remove
    identity parent links from skinned meshes; the joint hierarchy, inverse
    bind matrices, vertices and animation data remain exactly as exported.
    """
    data=path.read_bytes()
    json_length=struct.unpack_from("<I",data,12)[0]
    doc=json.loads(data[20:20+json_length]);nodes=doc["nodes"];roots=doc["scenes"][0]["nodes"]
    assert len(roots)==1
    rig=nodes[roots[0]]
    assert all(k not in rig for k in ("matrix","translation","rotation","scale"))
    for index in list(rig["children"]):
        if "skin" not in nodes[index]:continue
        assert all(k not in nodes[index] for k in ("matrix","translation","rotation","scale"))
        rig["children"].remove(index);roots.append(index)
    out=json.dumps(doc,separators=(",",":"),ensure_ascii=False).encode()
    out+=b" "*((-len(out))%4);binary=data[20+json_length:]
    head=struct.pack("<4sIIII",b"glTF",2,20+len(out)+len(binary),len(out),0x4E4F534A)
    path.write_bytes(head+out+binary)


def build(role):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    stem,collname,scale=ROLES[role]
    sc=bpy.context.scene;sc.unit_settings.system="METRIC"
    coll=bpy.data.collections.new(collname);sc.collection.children.link(coll)
    arms,legs=positions(role);rig=rig_character(role,coll,scale,arms,legs);m=palette(role)
    body=SkinMesh("Skin, face and hands",rig,coll,scale);cloth=SkinMesh("Uniform and footwear" if role!="civilian" else "Rain shell, jeans and boots",rig,coll,scale)
    cap=SkinMesh("Hair and headwear",rig,coll,scale)
    face(role,body,cap,m);clothing(role,cloth,m,arms,legs);arms_hands(role,body,cloth,m,arms)
    if role=="medic":
        bag(cloth,m,arms[1])
        label("EMS",(-.092,-.120,1.332),.021,1,m["ink"],"Chest",cloth)
        label("MEDICAL",(0,.111,1.280),.029,-1,m["black"],"Chest",cloth)
    elif role=="police":
        label("POLICE",(0,.111,1.31),.038,-1,m["ink"],"Chest",cloth)
        label("CITY",(-.085,-.115,1.305),.016,1,m["ink"],"Chest",cloth)
    for g in (body,cloth,cap):g.finish()
    motion(role,rig)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in coll.objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=rig
    bpy.context.preferences.filepaths.save_version=0
    # A clear saved solid-mode view lets the asset open without a camera.
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=="VIEW_3D":
                space=area.spaces.active;space.shading.color_type="MATERIAL"
                space.region_3d.view_distance=2.8;space.region_3d.view_location=(0,0,.99)
                space.region_3d.view_rotation=V((-.16,.98,-.04)).to_track_quat("-Z","Y")
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(stem+".blend")),compress=True)
    rig["forward"]="+Z"
    bpy.ops.export_scene.gltf(filepath=str(OUT/(stem+".glb")),use_selection=True,export_format="GLB",
                              export_yup=True,export_extras=True,export_animations=True,export_skins=True,
                              export_def_bones=False,export_animation_mode="ACTIONS")
    finalize_skin_roots(OUT/(stem+".glb"))
    print("CHARACTER",stem,"bones",len(rig.data.bones),"objects",len(coll.objects),flush=True)

if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--only",choices=tuple(ROLES))
    o=p.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    for role in ([o.only] if o.only else ROLES):build(role)
