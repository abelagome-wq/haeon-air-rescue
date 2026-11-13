"""Author the Hip, Hind, Helix and Z-10 service models in Blender.

Run Blender in background with --python eastern_airframes.py [-- <fleet ids>].
Dimensions below are in the game's +Y up, +Z forward system. Rotor meshes
are local to their named animated hubs. Each editable part in the .blend is
baked into one indexed mesh per moving domain for the web/Windows game.
"""
import json
import math
import struct
import sys
import tempfile
import zlib
from pathlib import Path

import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
PI, TAU = math.pi, math.tau
RIG = {
    'NOEUL': (21.29, (0,4.67,0), (.26,3.8969,-11.55), 'TailRotor', (.62,1.75,3.75), '63969a', 'e4cc81'),
    'HEUKSON': (17.30, (0,4.19,0), (.26,3.7603,-9.38), 'TailRotor', (0,1.85,2.95), '74816b', 'c2b68d'),
    'GYEOPNAL': (15.90, (0,4.33,-.12), (0,5.32,-.12), 'SecondMainRotor', (.54,1.60,2.65), 'e4e5dc', 'b74a38'),
    'SANBI': (13.00, (0,3.81,0), (.26,3.3537,-7.93), 'TailRotor', (0,1.67,2.26), '596f75', 'c3b484'),
}
SOURCES = {
    'NOEUL':'https://www.lennundusmuuseum.ee/en/gallery/helicopters/mil-mi-8/',
    'HEUKSON':'https://www.helimuseum.com/heli.php?ident=hind',
    'GYEOPNAL':'https://www.kaanair.com/mainpage/ka-32a11bc/',
    'SANBI':'https://eng.mod.gov.cn/xb/Home/Focus/16415541_2.html',
}

def vec(p):
    return np.array(p,dtype=float)

def norm(p):
    return p/max(1e-9,float(np.linalg.norm(p)))

class Part:
    def __init__(self,name,domain='Airframe'):
        self.name,self.domain=name,domain
        self.v,self.f,self.m,self.s=[],[],[],[]
    def points(self,seq):
        first=len(self.v)
        self.v.extend([tuple(p) for p in seq])
        return list(range(first,len(self.v)))
    def face(self,indices,material,smooth=False):
        self.f.append(list(indices));self.m.append(material);self.s.append(smooth)
    def quad(self,a,b,c,d,material,smooth=False):
        self.face(self.points([a,b,c,d]),material,smooth)
    def rings(self,rows,material,smooth=True,cap=True):
        rings=[self.points(r) for r in rows]
        for k,(a,b) in enumerate(zip(rings,rings[1:])):
            for j in range(len(a)):
                f=(j+1)%len(a)
                self.face([a[j],b[j],b[f],a[f]],material(k,j) if callable(material) else material,smooth)
        if cap:
            self.face(rings[0],material(0,0) if callable(material) else material)
            self.face(rings[-1][::-1],material(len(rows)-2,0) if callable(material) else material)
    def strut(self,a,b,r,material,r2=None,n=9):
        a,b=vec(a),vec(b);u=norm(b-a)
        v=norm(np.cross(u,[0,1,0] if abs(u[1])<.9 else [0,0,1]))
        w=np.cross(v,u)
        circle=[v*math.cos(TAU*i/n)+w*math.sin(TAU*i/n) for i in range(n)]
        self.rings([[a+r*d for d in circle],[b+(r if r2 is None else r2)*d for d in circle]],material)
    def line(self,path,r,material,n=6):
        for a,b in zip(path,path[1:]):
            self.strut(a,b,r,material,n=n)
    def pod(self,x,y,z,rx,ry,rz,material,n=18,rows=12):
        rings=[]
        for phi in np.linspace(-1.565,1.565,rows):
            rings.append([(x+rx*math.cos(phi)*math.sin(t),y+ry*math.cos(phi)*math.cos(t),
                           z+rz*math.sin(phi)) for t in np.arange(n)*TAU/n])
        self.rings(rings,material)
    def block(self,a,b,material):
        x,y,z=a;xx,yy,zz=b
        self.rings([[(x,yy,k),(xx,yy,k),(xx,y,k),(x,y,k)] for k in (z,zz)],material,False)

class Build:
    def __init__(self,key):
        self.key=key;self.parts=[]
        self.diameter,self.top,self.tail,self.tailname,self.seat,skin,stripe=RIG[key]
        self.hubs={'Airframe':(0,0,0),'MainRotor':self.top,self.tailname:self.tail}
        self.colors={'Skin':skin,'Stripe':stripe,'Belly':'394952','Panel':'829291','Glazing':'526c7c',
                     'Canopy frame':'33424a','Hub':'9aabad','Rotor':'393f42','Tip':'e5bd58',
                     'Tire':'22282b','Seat':'3e5051','Exhaust':'746c5d','Intake':'1b282a',
                     'Red light':'cd493f','Green light':'61a988'}
        panel={'NOEUL':'75a2a1','HEUKSON':'8d937b','GYEOPNAL':'c7d2ce','SANBI':'687b7e'}
        self.colors['Panel']=panel[key]
    def part(self,name,domain='Airframe'):
        part=Part(name,domain);self.parts.append(part);return part

# Stations are (longitudinal z, beam half-width, belly y, shoulder roof y).
# The long Hip cabin has a clamshell upsweep, the Helix more nearly vertical
# sidewalls and a very short tail; Hind/Z-10 reserve the upper forward shell
# for genuinely open tandem canopy apertures.
STATIONS={
'NOEUL':[(-5.28,.56,2.46,3.13),(-4.68,1.12,1.85,3.59),(-3.82,1.41,1.12,3.76),
        (-2.62,1.49,.93,3.85),(-1.42,1.53,.92,3.89),(-.22,1.53,.92,3.90),(.98,1.52,.94,3.88),
        (2.18,1.49,.99,3.85),(2.92,1.45,1.03,3.83),(3.61,1.38,1.12,3.76),
        (4.18,1.29,1.23,3.54),(4.78,1.11,1.36,3.17),(5.19,.80,1.53,2.75),(5.46,.42,1.73,2.40),(5.55,.09,1.92,2.22)],
'GYEOPNAL':[(-3.83,.63,2.10,2.98),(-3.16,1.12,1.36,3.15),(-2.54,1.38,.93,3.25),
        (-1.23,1.43,.86,3.30),(.03,1.46,.86,3.33),(1.34,1.43,.89,3.34),(2.0,1.38,.91,3.35),
        (2.57,1.33,.96,3.34),(3.06,1.25,1.00,3.18),(3.55,1.08,1.10,2.90),
        (3.88,.76,1.27,2.54),(4.02,.48,1.45,2.30),(4.11,.25,1.63,2.11),(4.15,.065,1.81,1.95)],
'HEUKSON':[(-4.46,.33,2.36,2.85),(-3.85,.68,1.88,3.18),(-3.12,.95,1.35,3.30),
        (-2.42,1.14,1.05,3.40),(-1.36,1.19,.99,3.42),(-.30,1.21,1.0,3.41),(.76,1.13,1.0,3.32),
        (1.68,.91,1.05,2.73),(2.47,.79,1.1,2.59),(3.30,.73,1.13,2.55),(3.70,.66,1.17,2.19),
        (4.26,.60,1.22,2.09),(4.83,.55,1.27,2.06),(5.23,.48,1.32,1.99),(5.60,.32,1.43,1.88),(5.77,.12,1.52,1.72)],
'SANBI':[(-3.63,.34,2.14,2.69),(-3.08,.56,1.81,2.89),(-2.38,.70,1.48,2.94),
        (-1.34,.84,1.21,2.98),(-.45,.88,1.13,3.01),(.55,.79,1.06,2.82),
        (1.10,.68,1.05,2.39),(1.9,.63,1.05,2.25),(2.64,.58,1.08,2.22),
        (3.12,.54,1.13,1.90),(3.67,.47,1.21,1.84),(4.07,.40,1.28,1.78),(4.39,.29,1.35,1.70),(4.53,.10,1.46,1.63)]}
ANGLES=[-180,-159,-139,-119,-106,-89,-70,-52,-33,-16,0,16,33,52,70,89,106,119,139,159,180]

def section(row,deg,exponent):
    z,w,bot,top=row;t=math.radians(deg);sn=math.sin(t);cs=math.cos(t)
    # Lower lobes tuck in under the sills; the roof narrows at the crown.
    x=w*math.copysign(abs(sn)**exponent,sn)*(1-.10*max(0,-cs)**1.4)
    return vec((x,(bot+top)/2+(top-bot)*.5*math.copysign(abs(cs)**exponent,cs),z))

def shell(a):
    key=a.key;rows=STATIONS[key];attack=key in ('HEUKSON','SANBI')
    hx={'NOEUL':.87,'GYEOPNAL':.70,'HEUKSON':.87,'SANBI':.70}[key]
    p=a.part('Formed fuselage skin'); rings=[p.points([section(r,t,hx) for t in ANGLES[:-1]]) for r in rows]
    n=len(ANGLES)-1
    windowRanges={'NOEUL':range(2,7),'GYEOPNAL':range(2,5),'HEUKSON':range(3,6),'SANBI':[]}
    def patch(k,t):
        z=rows[k][0];end=rows[k+1][0];at=abs(t)
        if k in windowRanges[key] and 70<at<106:return 'opening'
        # The crew's side view is bounded by a true jamb just forward of the cabin.
        if not attack:
            sideStart=2.18 if key=='NOEUL' else 1.34
            limit=5.55 if key=='NOEUL' else 4.12
            roofStart=3.61 if key=='NOEUL' else 2.57
            if key=='GYEOPNAL':
                if z>=3.55 and at>89:return 'Skin'
                if z>=3.88 and at>89:return 'Skin'
            if z>=sideStart and end<=limit and ((52<at<106) or z>=roofStart and at<52):return 'Glazing'
            if key=='GYEOPNAL' and 2.57<=z and end<=3.55 and 106<at<119:return 'Glazing'
        if attack and z>=(1.68 if key=='HEUKSON' else 1.10) and end<=(5.23 if key=='HEUKSON' else 4.07) and at<52:
            return 'cut'  # Open cockpit well under the tandem canopy.
        if at>141:return 'Belly'
        if key in ('NOEUL','GYEOPNAL') and 106<at<119:return 'Stripe'
        return 'Skin'
    seams=a.part('Pressure shell frames and seals')
    for k,(aa,bb) in enumerate(zip(rings,rings[1:])):
        for j in range(n):
            t=(ANGLES[j]+ANGLES[j+1])/2
            mat=patch(k,t)
            if mat in ('opening','cut'):continue
            p.face([aa[j],bb[j],bb[(j+1)%n],aa[(j+1)%n]],mat,key!='SANBI')
            if mat=='Glazing':
                neighbor=patch(k,(ANGLES[j-1]+ANGLES[j])/2) if j else 'Skin'
                post=ANGLES[j] in (-52,0,52) or zframe(key,rows[k][0],ANGLES[j])
                # The Helix looking over the pilot's glareshield has a clear
                # forward pane between the centre post and cheek frame.
                if key=='GYEOPNAL' and rows[k][0]>=3.55 and ANGLES[j]!=0:post=False
                if neighbor!='Glazing' or post:
                    seams.strut(section(rows[k],ANGLES[j],hx),section(rows[k+1],ANGLES[j],hx),.026,'Canopy frame')
                # Keep station splits only on actual cockpit posts, not on every loft station.
                if k==0 or patch(k-1,t)!='Glazing' or rows[k][0] in (3.61,2.57):
                    seams.strut(section(rows[k],ANGLES[j],hx),section(rows[k],ANGLES[j+1],hx),.030,'Canopy frame')
                if k==len(rows)-2 or patch(k+1,t)!='Glazing':
                    seams.strut(section(rows[k+1],ANGLES[j],hx),section(rows[k+1],ANGLES[j+1],hx),.032,'Canopy frame')
    p.face(rings[0],'Skin');p.face(rings[-1][::-1],'Skin')
    for k in windowRanges[key]:
        for s in (-1,1):
            cabin_window(a,rows[k],rows[k+1],s,hx,key=='NOEUL')
    a.rows=rows;a.exponent=hx

def zframe(key,z,angle):
    return (key=='NOEUL' and z>=4.18 or key=='GYEOPNAL' and z>=3.06) and angle in (-33,33)

def cabin_window(a,r1,r2,side,exponent,round_window):
    # A radial annulus stitches the gasket, glazing and surrounding metal into
    # a single aperture. Its outer contour follows the curved shell itself.
    p=a.part('Circular cabin light' if round_window else 'Inset rectangular cabin light')
    def pt(u,v):
        r=vec(r1)*(1-u)+vec(r2)*u
        return section(r,side*(106-v*36),exponent)
    rings=[]
    for mode in (0,1,2):
        ring=[]
        for ang in np.arange(40)*TAU/40:
            x,y=math.cos(ang),math.sin(ang)
            if mode==0: x,y=x/max(abs(x),abs(y)),y/max(abs(x),abs(y))
            elif round_window:
                radius=min(.33,(r2[0]-r1[0])*.34)
                if mode==2:radius-=.028
                x*=2*radius/(r2[0]-r1[0]);y*=2*radius/max(.1,np.linalg.norm(pt(.5,1)-pt(.5,0)))
            else:
                x=math.copysign(abs(x)**.32,x)*(.79 if mode==1 else .74)
                y=math.copysign(abs(y)**.32,y)*(.80 if mode==1 else .74)
            ring.append(pt(.5+x*.5,.5+y*.5))
        rings.append(p.points(ring))
    for k,mat in enumerate(('Skin','Canopy frame')):
        for j in range(40):
            idx=[rings[k][j],rings[k][(j+1)%40],rings[k+1][(j+1)%40],rings[k+1][j]]
            p.face(idx if side<0 else idx[::-1],mat,mat=='Skin')
    p.face(rings[-1] if side<0 else rings[-1][::-1],'Glazing')

def surface(a,z,ang):
    rows=a.rows
    for left,right in zip(rows,rows[1:]):
        if left[0]<=z<=right[0]:
            t=(z-left[0])/(right[0]-left[0]);return section(vec(left)*(1-t)+vec(right)*t,ang,a.exponent)
    raise ValueError(z)

def smooth_pod(a,name,stations,material):
    """Section loft with measured crown/keel and actual elliptical flanks."""
    p=a.part(name)
    rings=[]
    for x,y,z,rx,ry in stations:
        rings.append([(x+rx*math.sin(f),y+ry*math.cos(f),z) for f in np.arange(24)*TAU/24])
    p.rings(rings,material)
    return p

def duct(p,center,axis,rx,ry,depth,rim='Skin'):
    origin=vec(center);u=norm(vec(axis));v=norm(np.cross([0,1,0],u));w=norm(np.cross(u,v))
    circle=[rx*math.sin(t)*v+ry*math.cos(t)*w for t in np.arange(24)*TAU/24]
    rings=[p.points([origin+offset*u+scale*c for c in circle]) for offset,scale in
           [(0,1.04),(.025,1),(-.045,.91),(-depth,.76)]]
    for k,mat in enumerate([rim,'Hub','Intake']):
        for i in range(24):
            j=(i+1)%24;p.face([rings[k][i],rings[k][j],rings[k+1][j],rings[k+1][i]],mat,True)
    p.face(rings[-1],'Intake')
    for i in range(6):
        t=TAU*i/6;end=origin-depth*.88*u+.65*(rx*math.sin(t)*v+ry*math.cos(t)*w)
        p.strut(origin-depth*u,end,.011,'Hub',n=5)
    p.strut(origin-depth*u,origin-(depth-.04)*u,min(rx,ry)*.22,'Hub',n=12)

def turbopack(a):
    k=a.key
    # Only the transport engines are forward-facing circular scoops. Z10
    # shoulders have lateral exhausts, raised intake brows and a separate lip.
    settings={'NOEUL':(.74,3.83,2.38,-2.23,.49,.44),'GYEOPNAL':(.78,3.44,1.74,-2.15,.45,.42),
              'HEUKSON':(.69,3.28,1.42,-2.16,.45,.43),'SANBI':(.79,2.72,.58,-2.00,.37,.37)}
    spacing,cy,nose,aft,rx,ry=settings[k]
    smooth_pod(a,'Main transmission fairing',[(0,cy-.16,aft-.86,.18,.16),(0,cy-.03,aft,.59,.37),
           (0,cy+.085,-.15,.59,.49),(0,cy+.03,.72,.54,.37),(0,cy-.20,nose-.22,.31,.21)],'Skin')
    for side in [-1,1]:
        x=spacing*side;p=a.part('Port engine intake and exhaust' if side>0 else 'Starboard engine intake and exhaust')
        shifts=[(aft-.27,.39,.53,-.09),(aft,.74,.84,-.04),(aft+.54,.98,.98,0),
                (.10,1,1,.07),(nose-.31,.96,.96,0),(nose,.83,.88,-.015)]
        rings=[]
        for z,sx,sy,dy in shifts:
            rings.append([(x+rx*sx*math.sin(t),cy+dy+ry*sy*math.cos(t),z) for t in np.arange(24)*TAU/24])
        p.rings(rings,'Skin',True,False)
        duct(p,(x,cy-.015,nose),(0,0,1),rx*.83,ry*.88,.25)
        ez=aft+.23 if k!='GYEOPNAL' else aft+.11
        exhaust=vec((x+side*rx*.74,cy+.035,ez))
        axis=norm(vec((side*.56,.05,-.83)))
        xx=norm(np.cross([0,1,0],axis));yy=norm(np.cross(axis,xx))
        circle=[xx*math.sin(t)*rx+yy*math.cos(t)*ry for t in np.arange(24)*TAU/24]
        p.rings([[exhaust-.32*axis+v*.77 for v in circle],[exhaust+.18*axis+v*.69 for v in circle]],'Exhaust',True,False)
        duct(p,exhaust+.18*axis,axis,rx*.68,ry*.69,.20,'Exhaust')
        if k=='HEUKSON':
            # Hind particle separator with a radially supported centre body.
            p.pod(x,cy-.015,nose+.025,rx*.44,ry*.44,.21,'Panel',16,10)
            for ang in [PI/6,5*PI/6,3*PI/2]:
                p.strut((x+rx*.37*math.cos(ang),cy+ry*.37*math.sin(ang),nose+.04),
                        (x+rx*.78*math.cos(ang),cy+ry*.78*math.sin(ang),nose-.015),.026,'Hub')
        if k=='SANBI':
            # Broad faceted engine shoulders over the narrow tandem cockpit.
            # Cover only the flanks behind the intake; leave its mouth open.
            fac=[(-.7,.7),(.1,.99),(.77,.77),(1.,.17),(.72,-.69),(-.58,-.73)]
            wrap=[]
            for cz,scale in [(aft,.62),(aft+.57,1.22),(nose-.57,1.27),(nose-.09,.99)]:
                wrap.append([(x+side*rx*xx*scale,cy+ry*yy*scale,cz) for xx,yy in fac])
            p.rings(wrap,'Skin',False,False)
        # Two removable cowl panels and vent gills behind the intake.
        for z in [aft+.58,nose-.44]:
            points=[(x+rx*.99*math.sin(t),cy+.045+ry*.99*math.cos(t),z) for t in np.arange(-1.50,1.52,.20)]
            p.line(points,.012,'Canopy frame',5)
        for j in range(6):
            z=aft+.60+j*.128
            p.strut((x+side*rx*.96,cy+.16,z),(x+side*rx*.98,cy-.015,z+.055),.023,'Intake',n=6)
    p=a.part('Hub pylon and swashplate')
    y=a.top[1];z=a.top[2]
    for lo,hi,r1,r2,mat in [(cy+.13,y-.34,.34,.23,'Skin'),(y-.37,y-.23,.25,.29,'Hub'),
                             (y-.23,y-.15,.34,.32,'Canopy frame'),(y-.15,y-.03,.15,.14,'Hub')]:
        p.strut((0,lo,z),(0,hi,z),r1,mat,r2,n=18)
    if k=='GYEOPNAL':
        p.strut((0,y-.02,z),(0,a.tail[1],z),.11,'Hub',n=16)
        for tier,phase in [(y,0),(a.tail[1],PI/3)]:
            for cy,r,mat in [(tier-.29,.24,'Hub'),(tier-.21,.32,'Canopy frame'),(tier-.14,.27,'Hub')]:
                p.strut((0,cy-.028,z),(0,cy+.028,z),r,mat,n=20)
            for j in range(3):
                f=phase+TAU*j/3
                p.strut((.235*math.cos(f),tier-.26,z+.235*math.sin(f)),
                        (.48*math.cos(f+.22),tier-.06,z+.48*math.sin(f+.22)),.028,'Hub')
                p.strut((.16*math.cos(f),tier-.20,z+.16*math.sin(f)),
                        (.21*math.cos(f+.5),tier+.045,z+.21*math.sin(f+.5)),.025,'Belly')
    for n in range(5 if k!='GYEOPNAL' else 3):
        f=TAU*n/(5 if k!='GYEOPNAL' else 3)
        p.strut((.27*math.cos(f),y-.31,z+.27*math.sin(f)),(.47*math.cos(f+.2),y+.01,z+.47*math.sin(f+.2)),.032,'Hub')

def surface_wing(p,sections,mat):
    # x,y,z of the quarter-chord, local chord and airfoil thickness.
    points=[(0,0),(.10,.75),(.32,1),(.68,.55),(1,.07),(.68,-.32),(.22,-.45),(.06,-.28)]
    rings=[]
    for x,y,z,chord,thick in sections:
        rings.append([(x,y+thick*v,z+chord*(.25-u)) for u,v in points])
    p.rings(rings,mat,False)

def bevel_vertical(p,x,profile,depth,mat):
    rings=[[(x+off,y,z) for y,z in profile] for off in (-depth,depth)]
    p.rings(rings,mat,False)

def tailassembly(a):
    k=a.key;rot=a.tail
    if k=='GYEOPNAL':
        smooth_pod(a,'Short centre tailcone',[(0,2.58,-5.66,.24,.24),(0,2.60,-4.75,.40,.35),
              (0,2.47,-3.76,.65,.46),(0,2.53,-2.74,.96,.60)],'Skin')
        p=a.part('Twin endplate stabilizer')
        for side in [-1,1]:
            surface_wing(p,[(side*.14,2.55,-4.83,1.30,.11),(side*1.68,2.58,-5.12,.89,.07)],'Skin')
            x=side*1.56
            bevel_vertical(p,x,[(1.97,-4.77),(2.54,-4.55),(3.48,-4.84),(3.88,-5.18),(3.88,-5.66),
                                 (3.40,-5.84),(2.38,-5.80),(1.95,-5.45)],.060,'Skin')
            p.line([(x+side*.064,2.05,-5.42),(x+side*.064,3.55,-5.50),(x+side*.064,3.82,-5.48)],.012,'Canopy frame')
        return
    rear=a.rows[0];hubx,huby,hubz=rot
    if k=='NOEUL':
        rows=[(0,3.32,-11.27,.19,.22),(0,3.19,-9.22,.29,.31),
              (0,2.99,-7.35,.38,.41),(0,2.81,-5.36,.56,.51),(0,2.72,-4.27,.76,.62)]
    elif k=='HEUKSON':
        rows=[(0,3.08,-9.33,.17,.21),(0,2.87,-7.42,.24,.27),(0,2.68,-5.62,.36,.37),
              (0,2.52,-4.17,.51,.47),(0,2.57,-3.34,.72,.57)]
    else:
        rows=[(0,2.44,-7.85,.15,.19),(0,2.38,-6.36,.22,.24),(0,2.34,-4.75,.31,.33),
              (0,2.40,-3.37,.44,.39),(0,2.46,-2.56,.54,.48)]
    smooth_pod(a,'Tapered tail drive casing',rows,'Skin')
    p=a.part('Tail pylon, hub casing and stabilizers')
    y,z=huby,hubz
    bevel_vertical(p,0,[(rows[0][1]-.18,z+.83),(y+.14,z+.32),(y+.52,z+.04),(y+.50,z-.31),
                         (y-.03,z-.34),(rows[0][1]-.27,z+.04)],.105,'Skin')
    p.strut((-.13,y,z),(.22,y,z),.155,'Hub',n=16)
    for sign in [-1,1]:
        zc=z+2.20 if k=='NOEUL' else z+1.34
        surface_wing(p,[(sign*.13,rows[1][1],zc,1.02,.092),(sign*(1.62 if k=='NOEUL' else 1.23),rows[1][1]+.04,zc-.33,.48,.043)],'Skin')
    for idx,(_,cy,cz,rx,ry) in enumerate(rows[1:-1]):
        p.line([(rx*math.sin(t),cy+ry*math.cos(t),cz) for t in np.linspace(0,TAU,17)],.013,'Panel')

def wheel(p,x,y,z,r,width):
    rings=[]
    for s,rr in [(-.5,.68),(-.46,.87),(-.32,.97),(0,1),(.32,.97),(.46,.87),(.5,.68)]:
        rings.append([(x+s*width,y+r*rr*math.cos(t),z+r*rr*math.sin(t)) for t in np.arange(20)*TAU/20])
    p.rings(rings,'Tire')
    p.strut((x-width*.52,y,z),(x+width*.52,y,z),r*.59,'Hub',n=16)
    p.strut((x-width*.56,y,z),(x+width*.56,y,z),r*.38,'Belly',n=16)
    p.strut((x-width*.60,y,z),(x+width*.60,y,z),r*.14,'Hub',n=12)
    for side in (-1,1):
        for j in range(5):
            t=j*TAU/5;y1=y+math.cos(t)*r*.43;z1=z+math.sin(t)*r*.43
            p.strut((x+side*width*.513,y1,z1),(x+side*width*.543,y1,z1),.027,'Canopy frame',n=6)

def undercarriage(a):
    k=a.key;p=a.part('Landing gear, tires and exposed oleos')
    if k in ('NOEUL','HEUKSON'):
        nosez=3.15 if k=='NOEUL' else 3.87;nr=.33 if k=='NOEUL' else .28
        p.strut((0,1.43,nosez-.22),(0,nr+.08,nosez),.105,'Hub',.062)
        p.strut((0,.84,nosez-.42),(0,nr+.04,nosez),.049,'Hub')
        for s in (-1,1):wheel(p,s*.185,nr,nosez,nr,.19)
        z=-1.28 if k=='NOEUL' else -1.06;track=1.94 if k=='NOEUL' else 1.34;r=.49 if k=='NOEUL' else .445
        for s in (-1,1):
            x=s*track
            p.strut((s*(1.29 if k=='NOEUL' else 1.01),2.15,z-.30),(x,r,z),.104,'Skin',.061)
            p.strut((s*.90,1.24,z+.78),(x,r,z),.076,'Hub',.054)
            p.strut((s*.94,1.30,z-.63),(x,r,z),.064,'Hub')
            wheel(p,x,r,z,r,.28)
    elif k=='GYEOPNAL':
        for s in (-1,1):
            for z,x,r in [(2.12,1.12,.275),(-1.9,1.42,.37)]:
                p.strut((s*1.17,1.50,z-.16),(s*x,r,z),.085,'Hub',.047)
                p.strut((s*.87,1.27,z+.37),(s*x,r,z),.064,'Skin')
                wheel(p,s*x,r,z,r,.21)
    else:
        for s in (-1,1):
            p.strut((s*.70,1.64,.32),(s*1.13,.37,.1),.096,'Belly',.049)
            p.strut((s*.67,1.35,-.62),(s*1.13,.37,.1),.059,'Hub')
            wheel(p,s*1.16,.35,.10,.35,.21)
        p.strut((0,2.30,-6.02),(0,.23,-6.51),.085,'Skin',.043)
        p.strut((0,1.24,-6.14),(0,.28,-6.54),.052,'Hub')
        wheel(p,0,.23,-6.52,.23,.14)

def transport_details(a):
    k=a.key;p=a.part('Cargo door surround, rails, handles and steps')
    if k=='NOEUL':
        # Hip external saddle tanks have a flat attachment face and elliptical ends.
        for s in (-1,1):
            smooth_pod(a,'External self-sealing tank',[(s*1.35,1.38,-3.50,.08,.11),(s*1.45,1.39,-3.19,.31,.32),
                (s*1.45,1.39,-2.82,.39,.42),(s*1.45,1.39,.69,.39,.42),(s*1.38,1.40,1.20,.31,.34),
                (s*1.35,1.41,1.47,.07,.09)],'Skin')
            for z in [-2.65,-1.18,.43]:
                p.line([(s*(1.45+.39*math.cos(t)),1.39+.42*math.sin(t),z) for t in np.linspace(-1.3,1.34,12)],.022,'Panel')
        for t in [-55,0,55]:
            p.line([surface(a,z,t) for z in [-5.23,-4.68,-4.04]],.018,'Canopy frame')
    else:
        smooth_pod(a,'Helix lower observation nose moulding',[(0,1.57,3.11,.98,.36),(0,1.59,3.50,.94,.35),
                     (0,1.64,3.86,.72,.30),(0,1.70,4.07,.48,.23),(0,1.76,4.20,.23,.15),(0,1.79,4.24,.06,.06)],'Skin')
        for s in [-1,1]:
            smooth_pod(a,'Helix lower flotation fairing',[(s*1.20,1.28,-2.49,.05,.07),(s*1.29,1.28,-2.05,.25,.27),
                 (s*1.31,1.25,.91,.27,.29),(s*1.21,1.27,1.58,.05,.09)],'Stripe')
    for s in [-1,1]:
        z0,z1=(-.22,2.13) if k=='NOEUL' else (-1.20,1.30)
        def sidept(z,t):
            v=surface(a,z,t*s);v[0]+=s*.013;return v
        outline=[sidept(z0,117),sidept(z0,88),sidept(z0,59),sidept((z0+z1)/2,58),sidept(z1,59),
                 sidept(z1,89),sidept(z1,117),sidept((z0+z1)/2,118),sidept(z0,117)]
        p.line(outline,.017,'Canopy frame')
        p.line([sidept(q,56) for q in np.linspace(z0-.3,z1+.12,9)],.030,'Panel')
        a0=sidept(z1-.37,102);b=sidept(z1-.14,102);a0[0]+=.03*s;b[0]+=.03*s
        p.strut(a0,b,.038,'Hub')
        stepX=s*(1.6 if k=='NOEUL' else 1.55)
        p.line([(s*1.24,1.25,z0+.35),(stepX,.70,z0+.35),(stepX,.70,z1-.27),(s*1.29,1.2,z1-.27)],.046,'Hub')
    cockpit_trim(a)

def cockpit_trim(a):
    p=a.part('Crew furniture, instrument brow and controls')
    x,y,z=a.seat
    seats=[(x,y,z)]+([(-x,y,z)] if x!=0 else [(0,y-.34,z+1.29)])
    for x,y,z in seats:
        # The two rings bracketing z=0 put the cushion's actual seat-pad
        # surface .1121 m above the pod centre (8 longitudinal samples).
        p.pod(x,y-.1121,z,.265,.115,.34,'Seat',12,8)
        p.pod(x,y+.27,z-.31,.28,.38,.11,'Seat',12,8)
        p.pod(x,y+.58,z-.32,.16,.13,.12,'Tire',10,7)
        p.block((x-.30,y+.26,z+.63),(x+.29,y+.405,z+.83),'Canopy frame')
        p.strut((x,y-.01,z+.38),(x,y+.29,z+.32),.027,'Hub')
        p.strut((x,y+.29,z+.32),(x+.035,y+.33,z+.27),.040,'Tire')
        p.strut((x-.25,y,z+.10),(x-.25,y+.18,z-.16),.026,'Canopy frame')
    k=a.key
    p=a.part('Flight deck glareshield, instrument groups and glazing sill')
    utility=k in ('NOEUL','GYEOPNAL')
    for sx,sy,sz in ([(0,a.seat[1],a.seat[2])] if utility else seats):
        w=1.05 if utility else .40; dz=sz+.63; top=sy+.42
        p.block((sx-w,sy+.04,dz),(sx+w,top,dz+.17),'Canopy frame')
        p.block((sx-w-.015,top,dz-.045),(sx+w+.015,top+.035,dz+.27),'Tire')
        p.block((sx-w,sy-.25,sz-1.04),(sx+w,sy-.21,dz+.20),'Seat')
        if k!='SANBI':
            n=9 if utility else 4
            for j in range(n):
                xx=sx-w+(j+.61)*2*w/n
                for yy in [sy+.145,sy+.29]:
                    r=min(.057,w/n*.56)
                    p.strut((xx,yy,dz+.007),(xx,yy,dz-.013),r*1.14,'Hub',n=14)
                    p.strut((xx,yy,dz-.013),(xx,yy,dz-.019),r,'Intake',n=14)
                    angle=(j*.83+yy*3.2)
                    p.strut((xx,yy,dz-.021),(xx+r*.80*math.sin(angle),yy+r*.80*math.cos(angle),dz-.021),.006,'Panel',n=5)
        else:
            for s in [-1,1]:
                xx=sx+s*.17
                p.block((xx-.126,sy+.070,dz-.022),(xx+.126,top-.035,dz-.005),'Tire')
                p.block((xx-.105,sy+.095,dz-.03),(xx+.105,top-.055,dz-.023),'Seat')
                for yy in [sy+.15,sy+.23,sy+.30]:
                    p.block((xx-.085,yy,dz-.031),(xx+.048,yy+.004,dz-.030),'Green light')
    for s,mat in [(-1,'Red light'),(1,'Green light')]:
        v=surface(a,.12,s*98);p.pod(*v,.052,.045,.10,mat,10,6)

def attack_canopy(a,rows,faceted):
    p=a.part('Armoured tandem windshield' if faceted else 'Armoured tandem bubble hood')
    ribs=a.part('Hood hoops, armoured rails and opening handles')
    ang=[-90,-57,-32,0,32,57,90] if faceted else list(range(-90,91,10))
    def pane(r,t):
        z,w,bottom,top=r;f=math.radians(t)
        if faceted:
            # Narrow crown with clipped shoulders; long flat side panes.
            stations=[(0,0,1),(32,.67,.98),(57,.92,.79),(90,1,0)]
            _,cx,cy=next(v for v in stations if v[0]==abs(t))
            return (math.copysign(cx*w,t),bottom+cy*(top-bottom),z)
        return (w*math.sin(f),bottom+(top-bottom)*math.cos(f),z)
    v=[p.points([pane(r,t) for t in ang]) for r in rows]
    p.face(v[0],'Belly')
    for k,(aa,bb) in enumerate(zip(v,v[1:])):
        for j in range(len(ang)-1):
            t=(ang[j]+ang[j+1])/2; mat='Glazing'
            if faceted and abs(t)<33 and k<len(v)-3:mat='Belly'
            if k==0:mat='Skin'
            p.face([aa[j],bb[j],bb[j+1],aa[j+1]],mat,not faceted)
    for idx in [1,len(rows)-3,len(rows)-1]:
        ribs.line([pane(rows[idx],t) for t in ang],.032 if faceted else .027,'Canopy frame')
    for t in ([-90,-57,57,90] if faceted else [-90,90]):
        ribs.line([pane(r,t) for r in rows],.035,'Skin')
    if not faceted:
        for side in [-1,1]:
            ribs.line([pane(r,side*50) for r in rows[-3:]],.023,'Canopy frame')
    # Flat armoured front panel, then the sill between the glazing and nose.
    p.face(v[-1][::-1],'Glazing')
    ribs.strut(pane(rows[-1],-90),pane(rows[-1],90),.037,'Skin')
    for s in (-1,1):
        back=rows[2];v1=vec(pane(back,90*s));v1[0]+=.028*s;v1[1]+=.075
        ribs.strut(v1,v1+np.array([0,.015,.16]),.027,'Hub')

def gunship(a):
    hind=a.key=='HEUKSON'
    rows=([(1.20,.81,2.52,2.84),(1.68,.81,2.50,3.21),(2.18,.75,2.42,3.56),(2.75,.73,2.39,3.56),
           (3.13,.68,2.31,3.42),(3.48,.62,2.26,3.16),(3.72,.56,2.22,2.90)] if hind else
          [(.77,.68,2.33,2.67),(1.1,.71,2.30,2.99),(1.52,.67,2.22,3.21),(2.17,.65,2.17,3.24),
           (2.52,.63,2.10,3.10),(2.83,.58,2.08,2.86),(3.01,.54,2.05,2.67)])
    attack_canopy(a,rows,not hind)
    rows=([(3.26,.64,2.09,2.33),(3.54,.65,2.07,2.65),(3.92,.62,2.04,2.90),(4.35,.58,2.02,2.89),
           (4.71,.55,2.0,2.78),(5.02,.5,2.0,2.56),(5.25,.42,1.98,2.23)] if hind else
          [(2.72,.58,1.87,2.09),(2.94,.59,1.85,2.31),(3.16,.57,1.81,2.51),(3.47,.55,1.8,2.60),
           (3.69,.52,1.80,2.54),(3.91,.45,1.79,2.31),(4.15,.37,1.77,1.98)])
    # The sealed gunner hood sits below the aft pilot's first-person horizon.
    rows=[(z,w,b-.14,max(b-.06,top-(.56 if hind else .49))) for z,w,b,top in rows]
    attack_canopy(a,rows,not hind)
    cockpit_trim(a)
    p=a.part('Stub wings, gear fairings and hardpoints')
    for sign in (-1,1):
        if hind:
            surface_wing(p,[(sign*.94,2.73,-.32,1.96,.20),(sign*1.68,2.61,-.65,1.50,.16),
                    (sign*2.61,2.40,-.92,1.02,.11),(sign*3.21,2.20,-1.12,.66,.08)],'Skin')
            bevel_vertical(p,sign*3.17,[(2.25,-1.59),(2.23,-.76),(1.78,-.72),(1.76,-1.62)],.05,'Belly')
            p.pod(sign*1.04,1.57,-1.39,.27,.43,.82,'Skin',14,8)
        else:
            surface_wing(p,[(sign*.68,2.14,-.27,1.37,.12),(sign*1.28,2.13,-.40,1.01,.103),
                          (sign*2.23,2.07,-.65,.64,.069)],'Skin')
        for x in ([1.91,2.66] if hind else [1.27,1.87]):
            y=(2.49-(x-1.91)*.27) if hind else 2.1
            z=-.92 if hind else -.64
            bevel_vertical(p,sign*x,[(y,z+.21),(y,z-.45),(y-.29,z-.36),(y-.29,z+.20)],.047,'Belly')
            p.block((sign*x-.07,y-.32,z-.52),(sign*x+.07,y-.25,z+.29),'Hub')
        if not hind:
            for z in [-1.74,-1.53,-1.32,-1.11]:
                p.strut((sign*.95,2.38,z),(sign*.97,2.49,z-.08),.024,'Intake')
        if hind:
            for z in [-2.51,-1.36,-.30,.76]:
                p.line([surface(a,z,t*sign) for t in [62,76,91,106,120]],.013,'Panel')
    # Unarmed rescue livery; these external housings retain the identity of
    # the actual nose. They are geometry rather than functional weapon logic.
    p=a.part('Stabilised chin and nose sight')
    if hind:
        p.pod(0,1.31,5.12,.31,.28,.39,'Belly')
        for x in [-.042,.042]:
            for y in [1.26,1.34]:p.strut((x,y,5.38),(x,y-.018,6.05),.030,'Exhaust',.023,n=8)
        p.strut((0,1.30,5.84),(0,1.30,5.90),.094,'Hub',n=12)
        p.pod(.39,1.53,4.92,.17,.19,.28,'Panel')
        p.pod(.39,1.56,5.16,.11,.10,.045,'Glazing',12,7)
    else:
        p.pod(0,1.84,4.43,.31,.33,.27,'Belly');p.pod(0,1.29,4.05,.30,.26,.32,'Canopy frame')
        p.pod(.09,1.88,4.66,.10,.095,.025,'Glazing',12,7)
        p.strut((0,1.27,4.17),(0,1.23,4.99),.060,'Exhaust',.05)

def service_finish(a):
    k=a.key;p=a.part('Riveted inspection covers, static ports and antennas')
    for side in [-1,1]:
        def at(z,t,offset=.012):
            r=surface(a,z,t*side);r[0]+=side*offset;return r
        panels={'NOEUL':[(-3.56,-2.88,114,140),(-1.92,-1.13,114,134),(1.59,2.11,113,138)],
                'GYEOPNAL':[(-2.37,-1.67,113,139),(-.88,-.28,114,136)],
                'HEUKSON':[(-3.22,-2.67,79,114),(-.58,.43,110,133),(1.18,1.60,90,126)],
                'SANBI':[(-2.19,-1.52,79,117),(-1.16,-.40,105,133),(.12,.69,107,136),(1.40,1.89,97,122)]}[k]
        for z0,z1,t0,t1 in panels:
            outside=[at(z0+.07,t0),at(z1-.07,t0),at(z1,t0+3),at(z1,t1-3),at(z1-.07,t1),
                at(z0+.07,t1),at(z0,t1-3),at(z0,t0+3)]
            p.face(p.points(outside),'Panel',False);p.line(outside+outside[:1],.011,'Canopy frame',5)
            for z in [z0+.09,z1-.09]:
                for theta in [t0+3,t1-3]:
                    d=at(z,theta,.021);p.strut(d,d+vec((.012*side,0,0)),.021,'Hub',n=6)
        # Rows of flush fasteners follow the actual curved skin and catch the
        # light only at close range. They remain below the glazed cabin panels.
        z0,z1={'NOEUL':(-3.7,3.0),'GYEOPNAL':(-2.57,2.15),'HEUKSON':(-3.14,2.30),'SANBI':(-2.36,2.54)}[k]
        for z in np.arange(z0,z1,.21):
            d=at(z,121,.010);p.strut(d,d+vec((.011*side,0,0)),.013,'Panel',n=5)
        if k in ('NOEUL','GYEOPNAL'):
            window_z=4.0 if k=='NOEUL' else 2.98
            p.line([at(window_z+.54,49,.02),at(window_z+.27,47,.032),at(window_z+.09,49,.043)],.017,'Canopy frame',6)
            p.strut(at(window_z+.09,49,.044),at(window_z+.54,46,.045),.024,'Tire',n=6)
        zpit=4.65 if k=='NOEUL' else 3.55 if k=='GYEOPNAL' else 4.39 if k=='HEUKSON' else 3.42
        pit=at(zpit,111,.07)
        p.strut(pit,pit+vec((side*.045,-.033,.42)),.024,'Hub',.012,n=8)
    if k in ('HEUKSON','SANBI'):
        p.strut((-.06,2.90,-3.20),(-.07,3.40,-3.40),.028,'Canopy frame',.013,n=6)
        for side in [-1,1]:
            ztail=-6.04 if k=='HEUKSON' else -5.24
            p.block((side*.24-.04,2.41,ztail-.22),(side*.24+.04,2.60,ztail+.24),'Panel')
    if k=='NOEUL':
        p.line([(0,2.26,-5.00),(0,2.37,-6.36),(0,2.53,-6.62)],.059,'Hub')
    if k=='GYEOPNAL':
        for s in [-1,1]:
            p.pod(s*1.56,3.88,-5.43,.062,.07,.12,'Red light' if s<0 else 'Green light',10,6)

def rotors(a):
    primary=3 if a.key=='GYEOPNAL' else 5
    labels=[('MainRotor',True,primary,a.diameter*.5,0)]
    if a.tailname=='SecondMainRotor':labels.append((a.tailname,True,3,a.diameter*.5,PI/3))
    else:labels.append(('TailRotor',False,4 if a.key=='SANBI' else 3,a.diameter*.5*.147,.19))
    for name,horizontal,count,radius,phase in labels:
        p=a.part(name+' links, cuffs and blades',name)
        axis=vec((0,1,0) if horizontal else (1,0,0));p.strut(-.11*axis,.12*axis,radius*(.034 if horizontal else .07),'Hub',n=16)
        for j in range(count):
            ang=phase+j*TAU/count
            rr=vec((math.cos(ang),0,math.sin(ang)) if horizontal else (0,math.cos(ang),math.sin(ang)))
            cc=norm(np.cross(axis,rr));chord=radius*(.057 if horizontal else .115)
            p.strut(rr*radius*.018,rr*radius*.11,radius*.013,'Hub',radius*.010,n=8)
            p.strut(rr*radius*.07-axis*.035+cc*.06,rr*radius*.12-axis*.035-cc*.07,.023 if horizontal else .012,'Belly',n=6)
            if horizontal:
                for side in (-1,1):
                    p.strut(rr*.16+cc*side*.089,rr*radius*.102+cc*side*.053,.037,'Hub',.026,n=8)
                hub=rr*radius*.075
                p.strut(hub-axis*.095,hub+axis*.10,.066,'Canopy frame',n=12)
                end=rr*radius*.074-cc*.19
                p.strut(hub,end,.032,'Hub',n=8)
                p.strut(end,end-rr*.14-axis*.30,.025,'Hub',n=8)
            shape=[(.40,0),(.19,.07),(-.19,.105),(-.55,.045),(-.60,0),(-.13,-.052),(.27,-.05)]
            stations=[(.085,.35,.00),(.15,.77,.0),(.24,1,.0),(.67,1,.003),(.91,.97,.009),(.964,.92,.012),(1,.68,.022)]
            rings=[]
            for span,length,sweep in stations:
                mid=rr*radius*span-cc*radius*sweep+axis*(radius*.007*span**2)
                rings.append([mid+cc*dc*chord*length+axis*dy*chord for dc,dy in shape])
            p.rings(rings,lambda k,i:'Hub' if k==0 else 'Tip' if k==len(stations)-2 else 'Rotor',False)

def srgb(hexcolor):
    vals=np.array(list(bytes.fromhex(hexcolor)))/255.
    return tuple(np.where(vals<=.04045,vals/12.92,((vals+.055)/1.055)**2.4))

def finish_image(a):
    # An authored finish sheet in fuselage station/elevation coordinates.
    # All paint shapes, inspection seams and scuff variation are original.
    w,h=768,256
    z,y=np.meshgrid((np.arange(w)+.5)/w*20-13,(1-(np.arange(h)+.5)/h)*6)
    def col(s):return np.array(list(bytes.fromhex(s)))/255.
    def blend(rgb,c,t):return rgb*(1-t[:,:,None])+col(c)*t[:,:,None]
    def step(v,edge=0,width=.03):return np.clip((v-edge)/width+.5,0,1)
    rgb=np.broadcast_to(col(a.colors['Skin']),(h,w,3)).copy()
    k=a.key
    if k=='HEUKSON':
        field=np.sin(z*1.09+y*1.13)+.7*np.cos(z*1.71-y*.89)+.32*np.sin(y*3-z*.63)
        rgb=blend(rgb,'9a9c78',step(field,.22,.15)*.76)
        rgb=blend(rgb,'506653',step(field,1.13,.20)*.84)
        rgb=blend(rgb,'829083',step(1.37-y+.11*np.sin(z*1.2),0,.17)*.75)
    elif k=='SANBI':
        mask=np.maximum(np.minimum(2.37-y,z*.46+y-.78),np.minimum(2.08-y,-z*.34+y-.85))
        rgb=blend(rgb,'465c62',step(mask,-.07,.04)*.72)
        rgb=blend(rgb,'80908e',step(y+z*.10,2.84,.055)*.60)
    elif k=='NOEUL':
        rgb=blend(rgb,'a9c1ba',step(y+.10*np.cos(z*.61),3.15,.05)*.76)
        line=2.16+.13*np.sin((z-1.5)*.62)-.043*z
        rgb=blend(rgb,'e0d39f',step(.047-np.abs(y-line),0,.025))
        rgb=blend(rgb,'d38755',step(.053-np.abs(y-line+.102),0,.025)*.83)
    else:
        line=1.34-.14*np.sin(z*.78)+np.maximum(0,-z-2.55)*.36
        rgb=blend(rgb,'b84637',step(line-y,0,.055))
        rgb=blend(rgb,'45636b',step(.038-np.abs(y-line-.065),0,.025))
        rgb=blend(rgb,'526a72',step(y+np.maximum(0,-z-4.8)*.15,3.63,.05)*.77)
    # Faint variation between metal sheets, not a uniformly dirty coating.
    panels=.012*np.sin((z+y*.08)*2.60)+.008*np.cos(y*5.87+z*.82)+.005*np.sin(z*10.-y*4.)
    rgb=np.clip(rgb+panels[:,:,None],0,1)
    def chunk(tag,data):
        return struct.pack('>I',len(data))+tag+data+struct.pack('>I',zlib.crc32(tag+data)&0xffffffff)
    raw=(rgb*255+.5).astype('uint8')
    encoded=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))
    encoded+=chunk(b'IDAT',zlib.compress(b''.join(b'\0'+row.tobytes() for row in raw),9))+chunk(b'IEND',b'')
    with tempfile.TemporaryDirectory(prefix='haeon-enamel-') as temp:
        path=Path(temp)/(k+'-enamel.png');path.write_bytes(encoded)
        im=bpy.data.images.load(str(path));im.pack()
    return im

def materials(a):
    mats={}
    im=finish_image(a)
    for name,value in a.colors.items():
        m=bpy.data.materials.new(name);m.use_nodes=True
        s=m.node_tree.nodes.get('Principled BSDF')
        rgba=(*srgb(value),.79 if name=='Glazing' else 1)
        s.inputs['Base Color'].default_value=rgba;s.inputs['Alpha'].default_value=rgba[3]
        s.inputs['Metallic'].default_value=.52 if name in ('Hub','Exhaust') else .11
        s.inputs['Roughness'].default_value=.18 if name=='Glazing' else .76 if name in ('Seat','Tire','Intake') else .46
        m.diffuse_color=rgba
        if name=='Skin':
            tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=im;tex.extension='EXTEND'
            m.node_tree.links.new(tex.outputs['Color'],s.inputs['Base Color'])
        mats[name]=m
    return mats

def blender_coords(p):
    return (float(p[0]),float(-p[2]),float(p[1]))

def create_objects(a):
    mats=materials(a);roots={}
    root=bpy.data.objects.new('Helicopter',None);bpy.context.scene.collection.objects.link(root)
    for dom,local in a.hubs.items():
        o=bpy.data.objects.new(dom,None);bpy.context.scene.collection.objects.link(o);o.parent=root;o.location=blender_coords(local);roots[dom]=o
    for part in a.parts:
        if not part.f:continue
        me=bpy.data.meshes.new(part.name);me.from_pydata([blender_coords(v) for v in part.v],[],part.f);me.update()
        uv=me.uv_layers.new(name='Airframe stations')
        for loop in me.loops:
            _,y,z=part.v[loop.vertex_index];uv.data[loop.index].uv=((z+13)/20,y/6)
        o=bpy.data.objects.new(part.name,me);bpy.context.scene.collection.objects.link(o);o.parent=roots[part.domain]
        used=list(dict.fromkeys(part.m))
        for mat in used:me.materials.append(mats[mat])
        for face,mat,smooth in zip(me.polygons,part.m,part.s):
            face.material_index=used.index(mat);face.use_smooth=smooth
    root['aircraft_id']=a.key;root['photo_reference']=SOURCES[a.key]
    return root,roots,mats

def export(a,roots,mats,root):
    # Keep labels/assemblies editable in the Blender scene. The exported GLB
    # batches the same meshes by flight transform and material, cutting draw
    # calls for the row of porthole frames, wheel hubs and linkages.
    for dom,parent in roots.items():
        objs=list(parent.children)
        bpy.ops.object.select_all(action='DESELECT')
        for child in objs:child.select_set(True)
        bpy.context.view_layer.objects.active=objs[0];bpy.ops.object.join()
        obj=bpy.context.view_layer.objects.active;obj.parent=root
        parent.name=dom+' source transform';obj.name=dom;obj.location=blender_coords(a.hubs[dom]);obj.data.name=dom+' surfaces'
        bpy.data.objects.remove(parent,do_unlink=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(HERE/(a.key+'.glb')),export_format='GLB',use_selection=True,
        export_yup=True,export_normals=True,export_texcoords=True,export_materials='EXPORT',export_animations=False,
        export_cameras=False,export_lights=False,export_extras=True,export_apply=False,export_attributes=False)

def run(key):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    a=Build(key);shell(a);tailassembly(a);turbopack(a);undercarriage(a)
    if key in ('NOEUL','GYEOPNAL'):transport_details(a)
    else:gunship(a)
    service_finish(a);rotors(a);root,roots,mats=create_objects(a)
    src=HERE/'blender';src.mkdir(exist_ok=True); bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(src/(key+'.blend')),compress=True)
    export(a,roots,mats,root)

if __name__=='__main__':
    keys=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else list(RIG)
    for key in keys:run(key)
