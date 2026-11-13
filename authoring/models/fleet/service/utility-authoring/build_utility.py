"""Blender authoring source for the four Haeon civil/utility aircraft.

blender -b --factory-startup -P build_utility.py -- [GARAM BYEOL MARU DURUM]
Input dimensions use the flight game's coordinates: Y up, Z toward the nose.
GLBs batch by material and rotor pivot. Named vertex groups remain in the
editable .blend for individual cabin, door, cowling and rotor components.
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

HERE=Path(__file__).resolve().parent
TAU=math.tau
PI=math.pi

# Cross sections are (longitudinal station, half beam, keel, top). Width and
# height interpolation is shape-preserving at the nose and tapered tail neck.
SHAPES={
    'GARAM': {
        'sections':[(-1.92,.21,1.26,1.78),(-1.57,.39,.70,1.88),(-1.10,.57,.50,1.96),(-.50,.71,.46,2.00),(.27,.76,.45,2.02),(.94,.73,.48,2.02),(1.36,.66,.54,1.94),(1.68,.56,.61,1.77),(1.96,.36,.71,1.47),(2.11,.15,.84,1.18),(2.15,.015,.96,1.04)],
        'power':.91,'edges':[(-1.92,0),(-.79,.015),(.19,-.13),(1.10,-.25),(2.08,0),(2.15,0)],
        'windows':{1:(46,100),2:(37,103),3:(2.2,108)},
        'main':(0,2.94,0),'tail':(.26,2.2188,-5.32),'radius':5.03,'blades':2,'tailblades':2,'eye':(.37,.85,1.12,.9),
        'palette':['285653','e1d4ac','254240','d19254'],
    },
    'BYEOL': {
        'sections':[(-3.55,.30,2.08,2.66),(-3.13,.62,1.43,2.88),(-2.43,.96,1.05,2.98),(-1.67,1.11,.80,3.02),(-.25,1.14,.74,3.05),(1.49,1.13,.77,3.02),(2.32,1.08,.80,3.00),(2.78,1.00,.86,2.88),(3.21,.88,.94,2.57),(3.67,.61,1.00,2.20),(3.96,.33,1.10,1.92),(4.14,.11,1.28,1.64),(4.18,.012,1.43,1.51)],
        'power':.62,'edges':[(-3.55,0),(-2.12,0),(-.92,0),(.28,0),(1.37,-.02),(2.32,-.02),(2.91,-.25),(3.94,.01),(4.18,0)],
        'windows':{1:(62,91),2:(58,91),3:(58,91),4:(54,94),5:(39,99),6:(3.2,104)},
        'main':(0,3.93,0),'tail':(.26,3.1791,-8.72),'radius':7.85,'blades':4,'tailblades':3,'eye':(.50,1.46,2.65,.94),
        'palette':['d7dcd4','b13b35','564642','ceb373'],
    },
    'MARU': {
        'sections':[(-3.29,.32,1.99,2.56),(-2.70,.64,1.51,2.68),(-1.94,.96,.94,2.76),(-1.13,1.08,.68,2.82),(.05,1.12,.65,2.84),(.98,1.09,.66,2.79),(1.75,1.02,.70,2.65),(2.36,.92,.75,2.43),(2.94,.79,.84,2.17),(3.39,.55,.99,1.89),(3.71,.23,1.12,1.60),(3.79,.015,1.28,1.39)],
        'power':.87,'edges':[(-3.29,0),(-1.54,0),(-.44,0),(.67,.01),(1.38,-.03),(2.27,-.20),(3.53,-.02),(3.79,0)],
        'windows':{1:(58,89),2:(57,89),4:(41,100),5:(3,108)},
        'main':(0,3.62,0),'tail':(.26,2.8784,-7.26),'radius':6.60,'blades':4,'tailblades':4,'eye':(.47,1.37,2.22,.94),
        'palette':['a9a049','254c43','34473b','c78335'],
    },
    'DURUM': {
        'sections':[(-4.00,.48,1.85,2.77),(-3.49,.78,1.36,2.98),(-2.65,1.08,1.02,3.13),(-1.72,1.22,.86,3.24),(-.40,1.24,.80,3.25),(1.37,1.25,.80,3.24),(2.38,1.21,.80,3.22),(3.02,1.15,.81,3.15),(3.67,1.00,.82,2.83),(4.07,.84,.83,2.46),(4.36,.63,.86,2.05),(4.59,.40,.97,1.65),(4.73,.13,1.11,1.50),(4.77,.014,1.24,1.37)],
        'power':.46,'edges':[(-4.00,0),(-2.60,0),(-1.86,0),(-.95,0),(-.20,0),(.55,0),(1.42,0),(2.12,-.03),(3.08,-.05),(4.63,-.04),(4.77,0)],
        'windows':{1:(65,91),3:(57,98),4:(57,98),6:(55,98),7:(42,100),8:(1.25,101)},
        'main':(0,4.09,0),'tail':(.26,3.6533,-9.20),'radius':7.90,'blades':4,'tailblades':4,'eye':(.54,1.53,2.95,.95),
        'palette':['487280','d17d42','c5cdc8','e1caa1'],
    },
}

def game_to_blender(v):
    return (v[0],-v[2],v[1])

def linear(s):
    n=int(s,16)/255
    return n/12.92 if n<=.04045 else ((n+.055)/1.055)**2.4

def materials(cfg):
    skin,stripe,belly,trim=cfg['palette']
    specs={'Skin':(skin,.28,.36,1),'Stripe':(stripe,.32,.37,1),'Belly':(belly,.25,.43,1),
           'Rescue trim':(trim,.25,.33,1),'Frame':('202e33',.12,.52,1),'Machined metal':('a4aaa7',.72,.3,1),
           'Cast alloy':('566466',.66,.4,1),'Rotor blade':('343f41',.34,.42,1),
           'Tire':('252a29',.00,.85,1),'Seat':('4f5855',.00,.76,1),'Cabin fabric':('474e4d',.00,.82,1),
           'Glazing':('334955',.41,.18,.69),'Roof glazing':('274345',.33,.19,.74),
           'Beacon red':('e5322c',.06,.2,1),'Beacon green':('48c595',.06,.2,1),'Light':('e2dfc8',.10,.22,1)}
    out={}
    for name,(hexcol,metal,rough,alpha) in specs.items():
        mat=bpy.data.materials.new(name); mat.use_nodes=True
        rgb=tuple(linear(hexcol[i:i+2]) for i in (0,2,4))
        shader=mat.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value=(*rgb,1);shader.inputs['Roughness'].default_value=rough
        shader.inputs['Metallic'].default_value=metal;shader.inputs['Alpha'].default_value=alpha
        if name.startswith('Beacon'):
            shader.inputs['Emission Color'].default_value=(*rgb,1);shader.inputs['Emission Strength'].default_value=.6
        mat.diffuse_color=(*rgb,alpha)
        out[name]=mat
    return out

class Batch:
    def __init__(self,name,origin=(0,0,0)):
        self.name=name;self.center=Vector(origin);self.verts=[];self.faces=[];self.mats=[];self.smooth=[]
        self.lookup={};self.part='Shell';self.groups={}
    def face(self,coordinates,material,smooth=False):
        indices=[]
        for c in coordinates:
            p=Vector(c)-self.center
            key=(self.part,*(round(x,6) for x in p))
            if key not in self.lookup:
                self.lookup[key]=len(self.verts);self.verts.append(game_to_blender(p))
                self.groups.setdefault(self.part,[]).append(self.lookup[key])
            indices.append(self.lookup[key])
        if len(set(indices))<3:return
        self.faces.append(indices);self.mats.append(material);self.smooth.append(smooth)
    def write(self,mats,parent=None):
        mesh=bpy.data.meshes.new(self.name+' geometry');mesh.from_pydata(self.verts,[],self.faces);mesh.update()
        ob=bpy.data.objects.new(self.name,mesh);bpy.context.scene.collection.objects.link(ob)
        if parent:ob.parent=parent
        ob.location=game_to_blender(self.center)
        names=list(dict.fromkeys(self.mats))
        for n in names:mesh.materials.append(mats[n])
        for f,n,s in zip(mesh.polygons,self.mats,self.smooth):f.material_index=names.index(n);f.use_smooth=s
        for n,ids in self.groups.items(): ob.vertex_groups.new(name=n).add(ids,1,'REPLACE')
        return ob

def tube(b,a,z,r,mat='Cast alloy',sides=10,r2=None):
    a=Vector(a);z=Vector(z);axis=z-a
    if axis.length<1e-5:return
    axis.normalize();t=axis.cross(Vector((0,1,0) if abs(axis.y)<.87 else (1,0,0))).normalized();v=axis.cross(t)
    circles=[]
    for pos,rad in ((a,r),(z,r if r2 is None else r2)):
        circles.append([pos+rad*(t*math.cos(TAU*i/sides)+v*math.sin(TAU*i/sides)) for i in range(sides)])
    first,last=circles
    for i in range(sides):
        j=(i+1)%sides;b.face((first[i],first[j],last[j],last[i]),mat,True)
    b.face(first[::-1],mat);b.face(last,mat)

def line(b,points,r,mat='Frame',sides=7):
    for a,c in zip(points,points[1:]):tube(b,a,c,r,mat,sides=sides)

def box(b,c,d,mat='Skin'):
    x,y,z=c;w,h,l=[i/2 for i in d]
    pts=[(x+i*w,y+j*h,z+k*l) for k in (-1,1) for j in (-1,1) for i in (-1,1)]
    for f in ((0,2,3,1),(4,5,7,6),(0,4,6,2),(1,3,7,5),(0,1,5,4),(2,6,7,3)):b.face([pts[i] for i in f],mat)

def ringloft(b,rows,mat='Skin',sides=20,power=.87,band=None):
    rings=[]
    for x,y,z,w,h in rows:
        ring=[]
        for i in range(sides):
            a=TAU*i/sides;sin,cos=math.sin(a),math.cos(a)
            ring.append((x+w*math.copysign(abs(sin)**power,sin),y+h*math.copysign(abs(cos)**power,cos),z))
        rings.append(ring)
    for k,(a,c) in enumerate(zip(rings,rings[1:])):
        for i in range(sides):
            j=(i+1)%sides;b.face([a[i],c[i],c[j],a[j]],band(k,i,sides) if band else mat,True)
    b.face(rings[0],mat);b.face(rings[-1][::-1],mat)

def sphere(b,c,d,mat):
    x,y,z=c;rx,ry,rz=d
    ringloft(b,[(x,y,z+rz*math.sin(a),max(.001,rx*math.cos(a)),max(.001,ry*math.cos(a))) for a in [-1.565+i*3.13/10 for i in range(11)]],mat,16,1)

def profile(rows,z):
    for i in range(len(rows)-1):
        a,c=rows[i:i+2]
        if z<=c[0]+1e-7:break
    t=max(0,min(1,(z-a[0])/(c[0]-a[0])));length=c[0]-a[0]
    vals=[]
    for dim in (1,2,3):
        slope=(c[dim]-a[dim])/length
        def tangent(other,p):
            if not other:return slope
            second=(p[dim]-other[dim])/(p[0]-other[0])
            return 2*second*slope/(second+slope) if second*slope>0 else 0
        m=tangent(rows[i-1] if i else None,a)
        n=tangent(rows[i+2] if i+2<len(rows) else None,c)
        vals.append(a[dim]*(2*t**3-3*t*t+1)+c[dim]*(-2*t**3+3*t*t)+length*(m*(t**3-2*t*t+t)+n*(t**3-t*t)))
    return vals

class Shell:
    def __init__(self,cfg):
        self.c=cfg;self.rows=cfg['sections']
    def at(self,z,angle,side=1,push=0):
        w,base,roof=profile(self.rows,z);a=math.radians(angle);s,c=math.sin(a),math.cos(a)
        p=self.c['power'];pos=Vector((side*w*math.copysign(abs(s)**p,s),(base+roof)/2+(roof-base)*.5*math.copysign(abs(c)**p,c),z))
        if push:pos+=Vector((side*s,c,0))*push
        return pos
    def station(self,index,a):
        z,lean=self.c['edges'][index]
        if index==len(self.c['edges'])-2:
            # Follow the descending upper bow to the windscreen toe. Retain
            # a painted chin farther back on the outside of the quarterlight.
            t=max(0,min(1,(a-38)/76))
            return self.rows[-1][0]-.034-(.095 if self.key=='GARAM' else .17)*t*t*(3-2*t)
        return z+lean*max(-1,min(1,(80-a)/65))
    def panel(self,b,i,lo,hi,side,mat,glass=False):
        def vertex(u,v,d=0):
            a=lo+(hi-lo)*v
            za,zb=self.station(i,a),self.station(i+1,a)
            return self.at(za+(zb-za)*u,a,side,d)
        def quad(pts,name):
            b.face(pts if side>0 else list(pts)[::-1],name,True)
        if not glass:
            nx=max(2,math.ceil((self.c['edges'][i+1][0]-self.c['edges'][i][0])*3))
            ny=max(2,math.ceil((hi-lo)/13))
            for a in range(nx):
                for v in range(ny):quad([vertex(a/nx,v/ny),vertex((a+1)/nx,v/ny),vertex((a+1)/nx,(v+1)/ny),vertex(a/nx,(v+1)/ny)],mat)
            return
        # Rounded gasket apertures are actual holes. Tessellate a continuous
        # curved glass patch inside a shallow frame instead of glass over paint.
        dx=max(.02,self.c['edges'][i+1][0]-self.c['edges'][i][0])
        front=i==max(self.c['windows'])
        reveal=.032 if front or self.key=='GARAM' else {'BYEOL':.068,'MARU':.085,'DURUM':.104}[self.key]
        inset=min(.16,reveal/dx)
        def mapping(u,v,level):
            if not level:return vertex(u,v)
            x,y=2*u-1,2*v-1
            # Round corners without stretching the long straight glass borders.
            ax,ay=abs(x),abs(y);f=max(0,(ax-.70)/.30)*max(0,(ay-.69)/.31)
            x*=1-.085*f;y*=1-.080*f
            iu=inset*level
            uu=.5+x*(.5-iu)
            if front and lo==0:
                # A 46–64 mm wide centre rail is measured in cabin X, not in
                # contour degrees. On a flat roof even a few degrees carve
                # a very wide opaque wedge directly in front of the crew.
                front_z=self.station(i,0)*(1-uu)+self.station(i+1,0)*uu
                halfbeam=max(.06,profile(self.rows,front_z)[0])
                halfrail=(.0115 if self.key=='GARAM' else .016)*level
                post=math.degrees(math.asin(min(.99,(halfrail/halfbeam)**(1/self.c['power']))))/(hi-lo)
                vv=post+(y*.5+.5)*(1-post-.024*level)
            else:
                iv=.033*level;vv=.5+y*(.5-iv)
            return vertex(uu,vv,(.008 if level==1 else .002))
        n=8
        outline=[(j/n,0) for j in range(n)]+[(1,j/n) for j in range(n)]+[(1-j/n,1) for j in range(n)]+[(0,1-j/n) for j in range(n)]
        for level,name in ((0,'Skin'),(1,'Frame')):
            for j,p in enumerate(outline):
                q=outline[(j+1)%len(outline)]
                quad([mapping(*p,level),mapping(*q,level),mapping(*q,level+1),mapping(*p,level+1)],name)
        for h in range(n):
            for j in range(n):
                quad([mapping(h/n,j/n,2),mapping((h+1)/n,j/n,2),mapping((h+1)/n,(j+1)/n,2),mapping(h/n,(j+1)/n,2)],mat)
    def build(self,b,key):
        self.key=key
        for side in (-1,1):
            for i in range(len(self.c['edges'])-1):
                win=self.c['windows'].get(i)
                if win and i==max(self.c['windows']):win=(0,win[1])
                extra=None
                if key=='BYEOL' and i==5:extra=(12,32,'Roof glazing')
                if key=='MARU' and i==5:extra=(113,139,'Glazing')
                if key=='DURUM' and i==7:extra=(13,34,'Roof glazing')
                stripes={'GARAM':(106,112),'BYEOL':(96,136),'MARU':(99,114),'DURUM':(105,110)}[key]
                bound=sorted(set([0,*stripes,145,180]+(list(win) if win else [])+(list(extra[:2]) if extra else [])))
                for lo,hi in zip(bound,bound[1:]):
                    # Preserve each pane as one continuous assembly even if
                    # livery stations fall inside the glass interval.
                    if win and win[0]<lo<win[1] or extra and extra[0]<lo<extra[1]:continue
                    glazing=bool(win and lo==win[0] or extra and lo==extra[0])
                    if win and lo==win[0]:hi=win[1]
                    if extra and lo==extra[0]:hi=extra[1]
                    name=(extra[2] if extra and lo==extra[0] else 'Glazing') if glazing else (
                        'Belly' if lo>=145 else 'Stripe' if stripes[0]<=lo<stripes[1] else 'Skin')
                    b.part=('Mirrored cabin glass '+str(i)) if glazing else 'Contoured cabin shell'
                    self.panel(b,i,lo,hi,side,name,glazing)
        for j in (0,-1):
            z=self.rows[j][0];pts=[self.at(z,a,1) for a in range(0,360,10)]
            b.face(pts if j==0 else pts[::-1],'Skin')

def bulk_fin(b,polygon,half,mat,tip=False):
    # Airfoil-shaped leading edge, solid thickness, aft-cut trailing edge.
    left=[(-half,y,z) for z,y in polygon];right=[(half,y,z) for z,y in polygon]
    b.face(left,mat);b.face(right[::-1],mat)
    for i in range(len(left)):
        j=(i+1)%len(left);b.face([left[i],right[i],right[j],left[j]],'Rescue trim' if tip and i==1 else mat)

def airfoil(b,origin,side,span,chord,tip,sweep,rise,mat):
    x,y,z=origin;rings=[]
    for f in (0,.18,.70,1):
        c=chord+(tip-chord)*f
        rings.append([(x+side*span*f,y+rise*f+v*c,z-sweep*f+u*c) for u,v in
                      ((-.60,.0),(-.18,-.046),(.35,-.026),(.42,.012),(.28,.052),(-.16,.066))])
    if side<0:rings.reverse()
    for a,c in zip(rings,rings[1:]):
        for i in range(len(a)):
            j=(i+1)%len(a);b.face([a[j],c[j],c[i],a[i]],mat,True)
    b.face(rings[0],mat);b.face(rings[-1][::-1],mat)

def tail(b,cfg,key):
    b.part='Tail cone and drive fairing';tx,ty,tz=cfg['tail']
    start=cfg['sections'][0][0]+.70
    root_y={'GARAM':1.74,'BYEOL':2.39,'MARU':2.30,'DURUM':2.30}[key]
    wy={'GARAM':(.19,.16),'BYEOL':(.52,.48),'MARU':(.43,.36),'DURUM':(.63,.51)}[key]
    end_y=ty-({'GARAM':.13,'BYEOL':.52,'MARU':.54,'DURUM':.88}[key])
    rows=[]
    for t in (0,.08,.3,.55,.78,.93,1):
        w=wy[0]*(.28+.72*t);h=wy[1]*(.33+.67*t)
        rows.append((0,end_y+(root_y-end_y)*t,tz+(start-tz)*t,w,h))
    ringloft(b,rows,'Skin',22,.79,
             lambda k,i,n:'Stripe' if 5<=i<=6 or 15<=i<=16 else 'Belly' if 8<=i<=13 else 'Skin')
    if key=='GARAM':
        poly=[(tz+.20,ty-.14),(tz+.03,ty+.66),(tz-.13,ty+.72),(tz-.27,ty+.71),(tz-.23,ty-.58),(tz+.06,ty-.63)]
    else:
        chord={'BYEOL':1.00,'MARU':.92,'DURUM':1.30}[key]
        poly=[(tz+chord*(1.32 if key=='DURUM' else 1),ty-(1.02 if key=='DURUM' else .72)),(tz+.18,ty+.48),(tz-.23,ty+.68),(tz-.50,ty+.48),(tz-.05,ty-.37),(tz+.30,ty-(1.02 if key=='DURUM' else .84))]
    b.part='Vertical stabiliser and tail gearbox';bulk_fin(b,poly,.078 if key=='GARAM' else .118,'Skin',True)
    sphere(b,(.04,ty,tz),(.20,.20,.25),'Cast alloy')
    b.part='Horizontal stabiliser'
    for s in ((1,) if key=='GARAM' else (-1,1)):
        span={'GARAM':.72,'BYEOL':1.20,'MARU':1.15,'DURUM':1.55}[key]
        airfoil(b,(0,end_y-.02,tz+(1.0 if key=='GARAM' else 1.78)),s,span,.65 if key=='GARAM' else .89,.28 if key=='GARAM' else .42,.23,.07,'Skin')
    for side in (-1,1):
        points=[(side*.09,ty+.075,tz-.02),(side*.13,ty-.46,tz-.48),(side*.08,ty-.51,tz-.92)] if key=='GARAM' else [(0,ty-.38,tz-.20),(0,ty-.71,tz-.63),(0,ty-.81,tz-.90)]
        if side==1 or key=='GARAM':line(b,points,.021 if key=='GARAM' else .032,'Cast alloy')
    b.part='Tail drive shaft cover'
    line(b,[(0,y+h-.01,z) for _,y,z,w,h in rows],.035 if key=='GARAM' else .060,'Skin')

def axis_y(b,levels,mat,n=18):
    # sections are (y,centerZ,halfWidth,halfLength)
    rings=[[(w*math.cos(i*TAU/n),y,z+l*math.sin(i*TAU/n)) for i in range(n)] for y,z,w,l in levels]
    for a,c in zip(rings,rings[1:]):
        for i in range(n):
            j=(i+1)%n;b.face([a[i],c[i],c[j],a[j]],mat,True)
    b.face(rings[0],mat);b.face(rings[-1][::-1],mat)

def aperture(b,x,y,z,w,h,sign,exhaust):
    # Actual recessed inlet/exhaust with a bevel, throat and louver or nozzle.
    rings=[]
    for position,scale in ((z,.97),(z+sign*.04,1.0),(z+sign*.05,.80),(z-sign*.11,.71)):
        rings.append([(x+w*scale*math.sin(a*TAU/28),y+h*scale*math.cos(a*TAU/28),position) for a in range(28)])
    for idx,(first,second) in enumerate(zip(rings,rings[1:])):
        for i in range(28):
            j=(i+1)%28;pts=[first[i],second[i],second[j],first[j]];b.face(pts if sign>0 else pts[::-1],'Machined metal' if idx!=2 else 'Cast alloy',True)
    b.face(rings[-1][::-1] if sign>0 else rings[-1],'Tire')
    if not exhaust:
        for j in range(-2,3):
            f=j*.26;half=math.sqrt(1-f*f)*w*.77
            tube(b,(x-half,y+h*f,z+sign*.015),(x+half,y+h*f,z+sign*.015),.011,'Cast alloy',6)
    else:
        sphere(b,(x,y,z-sign*.05),(w*.20,h*.20,.06),'Cast alloy')

def side_nozzle(b,center,direction,w,h):
    # Slanted, hollow throat protruding from the side of the upper fairing.
    # Do not cap the mouth with a solid plate at the skin surface.
    p=Vector(center);axis=Vector(direction).normalized();up=Vector((0,1,0))
    horizontal=axis.cross(up).normalized();vertical=horizontal.cross(axis).normalized()
    rows=[]
    for dist,scale in ((-.47,.84),(-.24,1.12),(-.03,1.05),(.0,1.0),(.0,.82),(-.28,.73)):
        rows.append([p+axis*dist+horizontal*w*math.sin(i*TAU/24)*scale+vertical*h*math.cos(i*TAU/24)*scale for i in range(24)])
    for j,(a,c) in enumerate(zip(rows,rows[1:])):
        mat='Frame' if j<2 else 'Cast alloy' if j==2 or j==4 else 'Machined metal'
        for i in range(24):
            k=(i+1)%24;b.face((a[i],c[i],c[k],a[k]),mat,True)
    b.face(rows[-1],'Tire')
    for f in [-.28,.28]:
        pol=p-axis*.14+vertical*h*f
        tube(b,pol-horizontal*w*.73,pol+horizontal*w*.73,.017,'Cast alloy',6)

def powerplant(b,cfg,key):
    my=cfg['main'][1]
    if key=='GARAM':
        # R44 mast shroud is a tall narrow wedge ahead of the tubular boom.
        b.part='Transmission pylon'
        axis_y(b,[(1.83,-.15,.27,.49),(2.02,-.13,.25,.41),(2.28,-.08,.19,.31),(2.65,-.015,.115,.15),(2.76,0,.09,.13)],'Skin')
        b.part='Piston cooling access panels'
        for s in (-1,1):
            for j in range(6):
                p=(-1.50+j*.10)
                tube(b,(s*.455,1.14,p),(s*.48,1.30,p+.046),.018,'Frame',7)
            line(b,[(s*.40,.98,-1.43),(s*.49,1.00,-.91),(s*.56,1.15,-.80)],.016,'Machined metal')
        tube(b,(.25,.68,-1.24),(.30,.52,-1.63),.075,'Cast alloy',14)
    else:
        # Low common doghouse and two prominent forward intake throats on
        # the Sokół; Dhruv's uninterrupted raked roof runs behind the mast;
        # Surion carries pronounced dark outboard ducts below its pale crown.
        deckrows={
            'BYEOL':[(-2.72,2.88,.39,.12),(-2.16,3.02,.76,.29),(-.98,3.14,.88,.40),(.02,3.21,.82,.44),(.86,3.18,.84,.39),(1.50,3.02,.74,.26),(2.16,2.96,.48,.12)],
            'MARU':[(-2.80,2.57,.40,.13),(-2.39,2.68,.68,.23),(-1.65,2.83,.83,.33),(-.72,2.98,.82,.38),(.00,3.04,.73,.36),(.59,2.98,.69,.29),(1.46,2.85,.58,.17),(2.04,2.67,.37,.078)],
            'DURUM':[(-2.92,2.99,.45,.16),(-2.35,3.12,.83,.32),(-1.41,3.29,.94,.42),(-.32,3.43,.83,.45),(.29,3.46,.73,.36),(1.03,3.30,.78,.27),(1.87,3.22,.75,.16),(2.49,3.14,.50,.07)],
        }[key]
        b.part='Contoured common transmission fairing'
        ringloft(b,[(0,y,z,w,r) for z,y,w,r in deckrows],'Skin',24,.73,
                 lambda k,i,n:'Belly' if key=='DURUM' and (i<4 or i>19) else 'Skin')
        cfgs={'BYEOL':(.57,3.17,1.51,-2.12,.38,.33),'MARU':(.62,2.92,.10,-1.94,.33,.27),'DURUM':(.78,3.28,1.05,-1.94,.38,.30)}
        offset,h,forward,aft,w,r=cfgs[key]
        for side in (-1,1):
            b.part=('Port' if side<0 else 'Starboard')+' turboshaft installation'
            x=side*offset;zs=[aft,aft+.17,aft+.70,(aft+forward)*.50,forward-.25,forward]
            contour={'BYEOL':[(.59,.61),(.79,.78),(.98,.99),(1,1),(.90,.98),(.74,.80)],
                     'MARU':[(.72,.71),(.86,.79),(.98,.99),(1,1),(.87,.90),(.63,.64)],
                     'DURUM':[(.74,.83),(.94,.98),(1,1),(1,.98),(.78,.82),(.46,.51)]}[key]
            rings=[]
            for k,(z,(rw,rh)) in enumerate(zip(zs,contour)):
                cy=h+(.095 if k<2 else -.055 if key=='DURUM' and k==5 else 0)
                bump=.07*(1-k/5) if key!='BYEOL' else 0
                rings.append([(x+side*bump+w*rw*math.sin(i*TAU/24),cy+r*rh*math.cos(i*TAU/24),z) for i in range(24)])
            for k,(a,c) in enumerate(zip(rings,rings[1:])):
                for i in range(24):
                    j=(i+1)%24
                    paint='Frame' if key=='DURUM' else 'Stripe' if key=='MARU' else 'Skin'
                    b.face([a[i],c[i],c[j],a[j]],paint if k>0 else 'Cast alloy',True)
            aperture(b,x,h-(.055 if key=='DURUM' else 0),forward,w*contour[-1][0],r*contour[-1][1],1,False)
            aperture(b,x+side*(.07 if key!='BYEOL' else 0),h+.095,aft,w*contour[0][0],r*contour[0][1],-1,True)
            if key!='BYEOL':
                side_nozzle(b,(side*(1.04 if key=='DURUM' else .91),h+.08,aft-.03),(side*.52,.11,-.84),w*.73,r*.72)
            # Hinged doors, clamps and ventilation openings set into each cowl.
            for z in [aft+.62,forward-.50]:
                a=[(x+side*.97*w*math.sin(i*.10),h+r*.99*math.cos(i*.10),z) for i in range(3,23)]
                line(b,a,.009,'Frame',5)
            for j in range(6):
                z=aft+.8+j*.095
                tube(b,(x+side*w*.94,h+.08,z),(x+side*w*.87,h+.21,z-.05),.018,'Frame',6)
            if key=='DURUM':
                # Emergency access hatch and two external grab points on
                # the upper shoulder of the broad utility roof.
                line(b,[(side*.71,3.55,.72),(side*.76,3.63,.65),(side*.77,3.63,.39),(side*.75,3.55,.33)],.016,'Machined metal')
        b.part='Transmission deck'
        axis_y(b,[(h-.20,-.04,.60,.88),(h+.17,-.09,.46,.70),(my-.34,-.02,.30,.45),(my-.28,0,.22,.31)],'Skin',24)
    b.part='Stationary mast and swashplate'
    tube(b,(0,my-.36,0),(0,my-.03,0),.065 if key=='GARAM' else .100,'Machined metal',18)
    tube(b,(0,my-.22,0),(0,my-.17,0),.16 if key=='GARAM' else .235,'Cast alloy',20)
    for a in range(3):
        v=TAU*a/3;x,z=math.sin(v),math.cos(v)
        tube(b,(x*.22,my-.39,z*.22),(x*.17,my-.17,z*.17),.023,'Machined metal',7)

def wheel(b,x,y,z,r,width):
    rings=[]
    for f,rad in [(-.55,.60),(-.51,.80),(-.39,.94),(-.17,.998),(.18,.998),(.40,.94),(.52,.80),(.55,.60)]:
        rings.append([(x+width*f,y+r*rad*math.cos(i*TAU/28),z+r*rad*math.sin(i*TAU/28)) for i in range(28)])
    for a,c in zip(rings,rings[1:]):
        for i in range(28):
            j=(i+1)%28;b.face([a[i],a[j],c[j],c[i]],'Tire',True)
    tube(b,(x-width*.57,y,z),(x+width*.57,y,z),r*.62,'Cast alloy',24)
    tube(b,(x-width*.58,y,z),(x+width*.58,y,z),r*.34,'Machined metal',20)
    for s in (-1,1):
        for i in range(6):
            a=TAU*i/6;dy=r*.46*math.cos(a);dz=r*.46*math.sin(a)
            tube(b,(x+s*width*.57,y+dy,z+dz),(x+s*width*.60,y+dy,z+dz),r*.061,'Frame',7)

def gear(b,key):
    if key in ('GARAM','MARU'):
        small=key=='GARAM';span=.84 if small else 1.25;aft=-1.21 if small else -2.06;fore=1.44 if small else 2.29
        for s in (-1,1):
            b.part='Skid tube and wear shoes'
            pts=[(s*span,.20,aft-.13),(s*span,.083,aft),(s*span,.075,fore-.28),(s*span,.11,fore),(s*span,.24,fore+.24),(s*span,.31,fore+.32)]
            line(b,pts,.066 if small else .078,'Cast alloy',12)
            for z in [aft*.72,fore*.62]:
                b.part='Skid cross tube'
                rake=.24 if small else .16
                pts=[(s*.27,.54 if small else .82,z+rake),(s*span*.67,.46 if small else .60,z+rake*.60),(s*span*.90,.29,z-.04),(s*span,.12,z-.09)]
                line(b,pts,.042 if small else .062,'Stripe',10)
                for dz in [-.05,.05]:tube(b,(s*span,.082,z-.08+dz),(s*span,.082,z-.06+dz),.079 if small else .090,'Machined metal',10)
            if not small:
                line(b,[(s*1.08,.65,.85),(s*1.27,.43,.87),(s*1.27,.43,-.40),(s*1.06,.67,-.42)],.034,'Cast alloy',9)
    else:
        width=.154 if key=='BYEOL' else .18
        b.part='Steerable nose gear';z=2.70 if key=='BYEOL' else 3.15;r=.26 if key=='BYEOL' else .29
        tube(b,(0,1.04,z-.20),(0,.48,z+.04),.079,'Machined metal',12)
        for s in (-1,1):
            tube(b,(s*.078,.52,z+.03),(s*.12,r,z),.044,'Cast alloy');wheel(b,s*.119,r,z,r,width)
        b.part='Main wheel trailing arms';x=1.31 if key=='BYEOL' else 1.43
        z=-1.78 if key=='BYEOL' else -2.12;r=.375 if key=='BYEOL' else .39
        for s in (-1,1):
            wheel(b,s*x,r,z,r,.22)
            tube(b,(s*.89,1.18,z+.48),(s*x,r,z),.078,'Cast alloy',12)
            tube(b,(s*.97,1.15,z-.29),(s*x,r+.06,z+.03),.052,'Machined metal',12)
            if key=='DURUM':sphere(b,(s*1.13,1.10,z+.14),(.22,.21,.73),'Skin')
            line(b,[(s*1.04,1.05,z+.33),(s*(x+.08),.55,z+.10)],.039,'Belly',10)

def exterior(b,shell,key):
    c=shell.c;small=key=='GARAM';win=c['windows'];last=max(win);radius=.009 if small else .014
    for side in (-1,1):
        def srf(z,a,p=.014):return shell.at(z,a,side,p)
        frame_breaks={'GARAM':[1,2,3],'BYEOL':[1,4,5,6],'MARU':[1,3,4,5],'DURUM':[2,5,6,7,8]}[key]
        for idx in frame_breaks:
            b.part='Door aperture and release hardware'
            path=[srf(shell.station(idx,a),a) for a in [52,62,73,85,96,108,120,132]]
            line(b,path,radius,'Frame',6)
            z=shell.station(idx,130)
            if idx in frame_breaks[:-1]:
                end=min(shell.station(idx+1,130)-.08,z+.94)
                line(b,[srf(z+.02,131),srf((z+end)*.5,132),srf(end,131)],radius,'Frame',6)
            if idx in (frame_breaks[1],frame_breaks[-1]):
                p=srf(z+.15,109,.029);tube(b,p+Vector((0,0,-.075)),p+Vector((0,.015,.085)),radius*2.3,'Machined metal',10)
        b.part='Windshield wiper arms'
        z0=shell.station(last,95);z1=c['edges'][last+1][0]
        if not small:
            line(b,[srf(z1-.30,101,.021),srf(z1-.48,97,.027),srf(z1-.68,91,.028)],.012,'Frame')
            line(b,[srf(z1-.87,89,.029),srf(z1-.50,96,.029)],.023,'Frame')
            b.part='Cabin steps and sliding rails'
            a,bz=c['edges'][2][0],c['edges'][5][0]
            line(b,[srf(a+(bz-a)*j/8,49,.034) for j in range(9)],.026,'Cast alloy',8)
            w=c['sections'][4][1]
            line(b,[(side*(w-.15),.82,-1.30),(side*(w+.14),.69,-1.20),(side*(w+.14),.69,.45),(side*(w-.05),.81,.54)],.031,'Cast alloy',8)
        b.part='Position and landing lights'
        pos=srf(c['edges'][1][0],96,.046)
        sphere(b,pos,(.051,.048,.09),'Beacon red' if side<0 else 'Beacon green')
        if side>0:
            pos=srf(c['sections'][-3][0],124,.012);sphere(b,pos,(.044,.07,.075),'Light')
    if not small:
        b.part='Cockpit roof aerials'
        tube(b,(.24,c['sections'][4][3]-.01,1.32),(.24,c['sections'][4][3]+.26,1.26),.022,'Cast alloy',7,.010)
    if key=='BYEOL':
        b.part='Rescue hoist and cable roller'
        for z in (-.25,.11):tube(b,(.88,2.83,z),(1.22,2.82,z),.043,'Cast alloy',9)
        sphere(b,(1.27,2.83,-.07),(.22,.17,.31),'Skin')
        tube(b,(1.42,2.75,-.04),(1.42,2.49,-.04),.017,'Cast alloy',6)
        line(b,[(1.42,2.50,-.04),(1.42,2.46,-.08),(1.42,2.49,-.12)],.023,'Machined metal')
    if key=='DURUM':
        b.part='Forward radar chin and access sill'
        sphere(b,(0,1.23,4.25),(.59,.27,.54),'Frame')
        # The prominent double door has a central join, two latches and
        # tracks set clear of its narrow inset cabin panes.
        for side in (-1,1):
            for z in (-1.63,.36):
                pts=[shell.at(z,t,side,.021) for t in (50,65,82,98,117,134)]
                line(b,pts,.018,'Frame')
                p=shell.at(z+.14,105,side,.035)
                tube(b,p-Vector((0,0,.09)),p+Vector((0,0,.09)),.026,'Cast alloy',8)
            line(b,[shell.at(-1.66+i*.32,129,side,.023) for i in range(8)],.021,'Machined metal')
    b.part='Cabin ventilation louvers'
    for side in (-1,1):
        za=c['edges'][0][0];zb=c['edges'][1][0]
        for j in range(6):
            z=za+(zb-za)*(.26+j*.10);line(b,[shell.at(z,a,side,.012) for a in (63,69,75,81)],.012 if small else .020,'Frame',6)

def interior(b,c,key):
    px,py,pz,scale=c['eye'];small=key=='GARAM'
    b.part='Cabin floor and seat plinths'
    # All full walls are cut around the glazing; the cockpit receives light
    # from the same transparent panes as the exterior chase camera.
    width=(.55 if small else .90);front=pz+.30;back=c['edges'][1][0]+.37
    box(b,(0,py-.30,(front+back)/2),(width*2,.050,front-back),'Cabin fabric')
    b.part='Pilot and observer seats'
    for side in (-1,1):
        for j,(z,y) in enumerate([(pz,py),(pz-(1.17 if small else 1.7),py+.02)]):
            x=side*(px if j==0 else width*.70)
            # The configured pilot datum is the top of the compressed cushion.
            sphere(b,(x,y-.09,z),(.25 if small else .32,.09,.32),'Seat')
            sphere(b,(x,y+.245,z-.27),(.25 if small else .32,.32,.083),'Cabin fabric')
            sphere(b,(x,y+.51,z-.29),(.16,.115,.075),'Frame')
        if not small:
            tube(b,(side*.76,.89,1.04),(side*.76,1.89,1.00),.027,'Cast alloy')
    b.part='Instrument binnacle and flight controls'
    box(b,(0,py+.16,pz+.59),(width*1.44,.24,.20),'Frame')
    dash_y=py+.17;dash_z=pz+.475
    for i in range(5):
        x=(i-2)*width*.225
        tube(b,(x,dash_y,dash_z-.006),(x,dash_y,dash_z+.015),.055 if small else .073,'Cast alloy',16)
        tube(b,(x,dash_y,dash_z-.014),(x,dash_y,dash_z-.006),.042 if small else .056,'Frame',14)
        line(b,[(x-.012,dash_y-.006,dash_z-.020),(x+.017,dash_y+.020,dash_z-.020)],.005,'Light',5)
    for side in (-1,1):
        x=side*px
        line(b,[(x,py-.16,pz+.23),(x,py+.15,pz+.22),(x,py+.22,pz+.12)],.022,'Frame')
    if small:
        line(b,[(-px,py+.18,pz+.18),(0,py+.24,pz+.20),(px,py+.18,pz+.17)],.021,'Cast alloy')

def rotor(b,c,key,horizontal):
    radius=c['radius'] if horizontal else c['radius']*(.135 if key=='GARAM' else .155)
    count=c['blades'] if horizontal else c['tailblades']
    ax=Vector((0,1,0) if horizontal else (1,0,0));center=b.center
    def point(d,v,h):return center+rad*d+tang*v+ax*h
    b.part='Rotor head';hub=radius*(.037 if horizontal else .098)
    tube(b,center-ax*hub*.4,center+ax*hub*.43,hub,'Cast alloy',22)
    tube(b,center+ax*hub*.44,center+ax*hub*.58,hub*.63,'Machined metal',16)
    for i in range(count):
        a=TAU*i/count+(0.23 if horizontal else .42)
        rad=Vector((math.sin(a),0,math.cos(a)) if horizontal else (0,math.sin(a),math.cos(a)))
        tang=ax.cross(rad)
        b.part='Blade root pitch link '+str(i+1)
        tube(b,point(hub*.65,0,0),point(radius*.16,0,.002),hub*.39,'Cast alloy',12)
        tube(b,point(radius*.12,-hub*.83,-hub*.38),point(radius*.18,-hub*.52,.01),hub*.08,'Machined metal',8)
        for k in (-1,1):
            tube(b,point(radius*.13,k*hub*.29,-hub*.22),point(radius*.13,k*hub*.29,hub*.23),hub*.13,'Machined metal',8)
        b.part='Tapered flying blade '+str(i+1)
        sections=[]
        chord=radius*(.049 if horizontal else .126)
        for f,w,sweep in ((.14,.46,0),(.21,.92,.002),(.34,1,0),(.78,.98,.008),(.925,.89,.016),(.955,.86,.021),(1,.67,.035)):
            sections.append([point(radius*f,chord*w*u-radius*sweep,chord*w*v+.018*f) for u,v in
                              ((-.52,.0),(-.30,-.044),(.28,-.030),(.49,-.005),(.33,.052),(-.12,.078),(-.43,.048))])
        for k,(row,nxt) in enumerate(zip(sections,sections[1:])):
            for j in range(7):
                l=(j+1)%7;b.face([row[j],row[l],nxt[l],nxt[j]],'Rescue trim' if k==5 else 'Cast alloy' if k==0 else 'Rotor blade',True)
        b.face(sections[-1],'Rescue trim')
        if horizontal:
            line(b,[point(radius*.22,-chord*.42,.015),point(radius*.66,-chord*.47,.022)],.011,'Cast alloy',6)

def build(key):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    c=SHAPES[key];mats=materials(c)
    body=Batch('Airframe');shell=Shell(c);shell.build(body,key)
    tail(body,c,key);powerplant(body,c,key);gear(body,key);exterior(body,shell,key);interior(body,c,key)
    root=bpy.data.objects.new('Helicopter',None);bpy.context.scene.collection.objects.link(root)
    root['haeonModelRevision']='photo-utility-1';root['aircraftID']=key
    body.write(mats,root)
    for keyname,pivot,h in [('MainRotor',c['main'],True),('TailRotor',c['tail'],False)]:
        mesh=Batch(keyname,pivot);rotor(mesh,c,key,h);mesh.write(mats,root)
    # Rotor objects have actual local origins at the published mechanics'
    # axes. The three exported domain meshes share the game axes exactly.
    bpy.context.scene.unit_settings.system='METRIC'
    for obj in bpy.context.scene.objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=bpy.data.objects['Airframe']
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                area.spaces.active.region_3d.view_distance=c['radius']*2.3
                area.spaces.active.shading.color_type='MATERIAL'
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE/(key+'.blend')),compress=True)
    bpy.ops.export_scene.gltf(filepath=str(HERE.parent/(key+'.glb')),export_format='GLB',
                              export_yup=True,export_extras=True,export_animations=False,
                              export_texcoords=False,export_cameras=False,export_lights=False,
                              export_materials='EXPORT',check_existing=False)
    print('Built',key,flush=True)

if __name__=='__main__':
    selected=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else list(SHAPES)
    for ident in selected:
        if ident not in SHAPES:raise ValueError(ident)
        build(ident)
