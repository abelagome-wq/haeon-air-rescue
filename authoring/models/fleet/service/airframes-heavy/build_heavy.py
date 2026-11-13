"""Build three original service helicopters in Blender 4.5.

blender -b -P models/fleet/service/airframes-heavy/build_heavy.py
The GLB flight datums come from the existing rotors and aircraft seat catalogue.
"""
from pathlib import Path
import sys,math
from math import sin,cos,pi,tau
import bpy
import numpy as np
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from heavy_mesh import Airframe,v
from heavy_surfaces import cabin,door,cockpit,seam,intake,exhaust,tessellate


def rotor(a,name,count,radius,phase,tail=False):
    c=v(a.pivots[name]);a.domain=name
    axis=v([1,0,0] if tail else [0,1,0])
    a.part('Articulated head and grip links')
    a.rod(c-axis*.11,c+axis*.12,radius*.054,'Hub',n=20)
    for b in range(count):
        angle=b*tau/count+phase
        ray=v([0,cos(angle),sin(angle)] if tail else [sin(angle),0,cos(angle)])
        cross=np.cross(axis,ray);chord=radius*(.112 if tail else .068)
        a.rod(c+ray*radius*.029,c+ray*radius*.118,radius*(.033 if tail else .019),'Hub',end=radius*.011,n=12)
        if not tail:
            a.rod(c+ray*radius*.055-axis*.28+cross*.17,c+ray*radius*.137+cross*.22,.036,'Hub',n=8)
        a.part('Lifting blades' if not tail else 'Anti-torque blades')
        steps=[(.108,.26,0),(.155,.52,.012),(.25,.94,0),(.73,1,.002),(.927,.95,.015),(1,.67,.043)]
        rings=[]
        for span,width,sweep in steps:
            mid=c+ray*radius*span-cross*sweep*radius
            if not tail:mid=mid+axis*(radius*.012*(1-span)**2)
            ring=[mid+cross*(t*chord*width)+axis*h*chord*width for t,h in [(-.5,-.01),(-.24,-.063),(.33,-.038),(.5,0),(.24,.074),(-.12,.091)]]
            rings.append(ring)
        for k,(l,r) in enumerate(zip(rings,rings[1:])):
            for i in range(6):
                j=(i+1)%6;p=[l[i],l[j],r[j],r[i]]
                a.face(p,'Hub' if k==0 else 'Tip' if k==4 else 'Rotor',np.mean(p,axis=0)-np.mean(l+r,axis=0),True)
        a.face(rings[-1],'Tip',ray);a.part('Articulated head and grip links')
    a.domain='Airframe'


def tail_fin(a,outline,w,mat='Skin'):
    a.part('Tail rotor pylon');loops=[]
    for s in (-1,1):
        loop=[(s*w,y,z) for z,y in outline];loops.append(loop)
        a.face(loop,mat,[s,0,0])
    for i in range(len(outline)):
        j=(i+1)%len(outline)
        a.face([loops[0][i],loops[1][i],loops[1][j],loops[0][j]],mat)


def inspection_band(a,point,normal,s,z,lo,hi):
    ts=np.linspace(lo,hi,10);a.pipe([point(z,t,s)+normal(z,t,s)*.011 for t in ts],.009,'Belly',n=5)


def skycrane():
    a=Airframe('GIRIN',{'MainRotor':(0,4.9,0),'TailRotor':(.26,3.8969,-11.3)})
    side=[(4.55,5.77,.39,.90,5,'Glazing'),(5.88,6.47,.39,.91,5,'Glazing')]
    front=[(-1.53,-.72,.40,.90,5,'Glazing'),(-.68,-.025,.39,.91,5,'Glazing'),
      (.025,.68,.39,.91,5,'Glazing'),(.72,1.53,.40,.90,5,'Glazing'),
      (-1.36,-.16,.13,.32,4,'Glazing'),(.16,1.36,.13,.32,4,'Glazing')]
    rows=[(3.93,.88,1.22,3.78),(4.18,1.16,1.17,3.86),(5.02,1.24,1.16,3.92),(5.83,1.26,1.15,3.90),(6.59,1.21,1.19,3.82)]
    sp,so,npnt,no=cabin(a,rows,side,side,front,[(0,.38),(.14,.93),(.35,1.40),(.51,1.48),(.76,1.10),(.92,.61),(1,.24)],4.1)
    for s in (-1,1):door(a,sp,so,s,5.68,6.52,.12,.94)
    cockpit(a,6.50,1.92,.66,npnt,no)
    # Recessed aft-looking cabin: its glazing and sill form the back wall itself.
    a.part('Rear-facing load station')
    for s in (-1,1):
        def p(z,t):
            f=(z-3.27)/.71
            return v((s*(.78+.24*f)*(1-.12*(2*t-1)**4),1.21+(1.86+.30*f)*t,z))
        tessellate(a,(3.27,3.98),[3.27,3.98],[.0,.35,1],[(3.32,3.90,.30,.88,6,'Glazing')],p,
            lambda z,t:v((s,0,0)),lambda z,t:'Stripe' if t<.18 else 'Skin',.16)
    back=[(-.70,1.44,3.27),(.70,1.44,3.27),(.70,2.95,3.27),(-.70,2.95,3.27)]
    for p,q in zip(back,back[1:]+back[:1]):a.rod(p,q,.065,'Skin')
    a.face(back,'Glazing',[0,0,-1]);a.rod((0,1.44,3.26),(0,2.95,3.26),.025,'Gasket')
    a.box((0,1.28,3.60),(.76,.075,.36),'Belly');a.box((0,3.025,3.60),(.76,.065,.36),'Skin')
    a.box((0,1.9,3.77),(.29,.09,.28),'Seat')
    a.part('Box keel and tail transmission spine')
    a.shell([(-10.7,2.17,2.49,.14),(-9.6,2.22,2.64,.19),(-7.6,2.45,2.99,.32),(-4.5,2.85,3.62,.57),
      (-3.1,3.01,3.81,.83),(-.5,3.19,3.95,.91),(2.7,3.26,3.81,.82),(4.5,3.13,3.79,.93),(5.23,3.08,3.78,.88)],'Skin',exp=.39)
    for s in (-1,1):
        a.part('Spine flange and shear-panel fasteners')
        for z in np.arange(-8.4,3.1,.91):
            f=np.clip((z+10.7)/8.,0,1);x=s*(.15+.67*f);y=2.31+1.04*f
            a.rod((x,y-.09,z),(x,y+.25,z+.21),.021,'Canopy frame',n=5)
        a.part('Exposed turboshaft installation')
        x=s*.77
        a.shell([(-2.03,3.94,4.48,.27),(-1.62,3.86,4.57,.35),(-.95,3.84,4.58,.39),(-.27,3.82,4.63,.40),(.71,3.82,4.62,.40),(1.09,3.71,4.67,.48),(1.55,3.71,4.67,.48)],
            lambda k,i:'Heat metal' if k<4 else 'Hub',center_x=x,caps=False)
        intake(a,x,4.19,1.60,.49,.37);exhaust(a,x,4.22,-2.23,.33)
        for z in [-1.44,-1.02,-.52,.06,.72,1.0]:
            a.rod((x,4.21,z-.02),(x,4.21,z+.02),.40,'Hub',n=24)
        for k in range(3):
            a.pipe([(x+s*.37,4.11+k*.09,-1.60),(x+s*.449,4.06+k*.09,-.92),
              (x+s*.44,4.14+k*.09,-.21),(x+s*.36,4.13+k*.09,.71)],.021,'Canopy frame',n=6)
        a.rod((x+s*.38,3.98,-1.46),(x+s*.38,3.99,-.67),.143,'Heat metal',end=.11,n=16)
        a.pipe([(x+s*.22,4.48,-1.64),(x+s*.36,4.53,-1.3),(x+s*.38,4.57,-.66),
                (x+s*.17,4.60,-.23),(x+s*.12,4.57,.19)],.041,'Hub',n=9)
        a.pipe([(x+s*.20,3.97,-1.52),(x+s*.55,3.93,-1.32),(x+s*.53,3.92,-.63),
                (x+s*.43,4.13,-.52)],.049,'Canopy frame',n=9)
    a.part('Transmission and hydraulic mast')
    a.shell([(-1.04,3.73,4.20,.33),(-.4,3.74,4.58,.51),(.36,3.75,4.58,.49),(.95,3.75,4.18,.25)],'Hub')
    a.rod((0,4.35,0),(0,4.89,0),.15,'Hub',n=20)
    a.part('Tail surfaces and drive shaft')
    a.pipe([(0,3.81,-3.8),(0,3.48,-5.37),(0,2.92,-8.0),(0,2.55,-10.26),(0,3.91,-11.30)],.070,'Hub')
    tail_fin(a,[(-10.25,2.22),(-10.76,2.15),(-11.66,3.95),(-11.35,4.08),(-10.83,3.34)],.135)
    for s in (-1,1):a.foil((s*.05,2.67,-9.42),(s*1.72,2.69,-9.23),.72,.43,'Skin')
    a.part('Main gear outriggers and oleos')
    for s in (-1,1):
        hub=(s*3.02,.48,-1.71)
        a.rod((s*.68,3.48,-1.25),(s*2.97,1.19,-1.71),.17,'Skin',end=.13,n=12)
        a.rod((s*.68,3.42,-3.45),(s*2.92,1.18,-1.71),.104,'Skin',n=12)
        a.rod((s*2.97,1.37,-1.71),hub,.095,'Hub',n=14)
        a.pipe([(s*2.90,1.08,-1.71),(s*2.91,.85,-1.93),(s*2.89,.62,-1.72)],.048,'Canopy frame')
        for off in [-.15,.15]:a.wheel(hub[0]+off,.46,hub[2],.245)
    a.part('Nosewheel fork and tow head')
    a.rod((0,1.48,6.37),(0,.33,6.26),.10,'Hub',n=14)
    for s in (-1,1):
        a.rod((0,1.04,6.34),(s*.17,.31,6.25),.055,'Hub')
        a.wheel(s*.145,.315,6.25,.18)
        a.pipe([(s*1.03,1.73,5.18),(s*1.28,1.12,5.14),(s*1.28,1.12,5.74),(s*1.04,1.72,5.75)],.035,'Hub')
    a.part('External load hook and swivel')
    a.rod((0,3.30,.0),(0,2.69,.0),.086,'Hub')
    a.pipe([(0,2.77,0),(0,2.48,.03),(0,2.45,.22),(0,2.61,.28)],.068,'Tip')
    rotor(a,'MainRotor',6,21.95/2,.25);rotor(a,'TailRotor',4,2.32,.17,True)
    return a


def chinook():
    a=Airframe('DUSOL',{'MainRotor':(0,5.10,4.35),'SecondMainRotor':(0,6.23,-5.18)})
    ports=[(z-.39,z+.39,.45,.71,2,'Cabin glazing') for z in [-3.91,-2.30,-.70,.90,2.49]]
    nose=[(-1.53,-.83,.40,.90,5,'Glazing'),(-.78,-.025,.43,.93,6,'Glazing'),(.025,.78,.43,.93,6,'Glazing'),(.83,1.53,.40,.90,5,'Glazing'),
      (-1.39,-.23,.15,.385,5,'Glazing'),(.23,1.39,.15,.385,5,'Glazing'),
      (-1.32,-.12,.94,.987,5,'Roof glass'),(.12,1.32,.94,.987,5,'Roof glass')]
    rows=[(-7.32,1.25,2.70,3.59),(-6.79,1.49,2.16,3.87),(-5.7,1.62,1.11,3.98),(-4.8,1.69,.89,4.03),
          (-2.0,1.72,.88,4.08),(1.28,1.72,.88,4.08),(3.18,1.66,.92,4.02),(4.38,1.56,.99,3.92)]
    sp,so,npnt,no=cabin(a,rows,ports+[(3.27,4.25,.46,.88,5,'Glazing')],ports+[(3.27,4.25,.46,.88,5,'Glazing')],nose,
        [(0,.61),(.14,2.05),(.34,2.57),(.46,2.59),(.69,2.29),(.91,1.57),(1,.81)],4.3)
    cockpit(a,5.18,1.89,.65,npnt,no)
    for s in (-1,1):
        door(a,sp,so,s,3.11,4.30,.16,.93)
        if s==-1:door(a,sp,so,s,-4.56,-3.27,.19,.86)
        a.part('Barrel lap joints')
        for z in [-5.20,-3.12,-1.53,.14,1.70]:inspection_band(a,sp,so,s,z,.28,.84)
        a.part('Self-sealing fuel sponson')
        x=s*1.52
        a.shell([(-5.37,1.29,1.57,.15),(-4.88,1.16,1.84,.41),(-3.96,1.12,1.99,.48),(-1.06,1.12,2.05,.49),
                 (1.68,1.12,2.02,.49),(2.78,1.18,1.94,.44),(3.43,1.30,1.69,.24),(3.68,1.38,1.49,.09)],'Skin',center_x=x,exp=.65)
        for z in [-3.29,-1.0,1.40]:
            a.rod((x+s*.474,1.75,z),(x+s*.49,1.75,z),.091,'Canopy frame',n=16)
        a.part('Cargo deck fold-up bench seats')
        a.box((s*1.22,1.59,-.46),(.20,.055,3.74),'Seat')
        a.box((s*1.43,1.90,-.46),(.055,.29,3.74),'Interior')
        for z in [-3.51,-2.30,-1.09,.12,1.33,2.54]:
            a.rod((s*1.40,1.64,z),(s*1.53,2.23,z+.06),.025,'Seat',n=5)
        a.part('Turbine nacelle and aft pylon mounts')
        x=s*1.49
        a.shell([(-6.77,4.27,4.89,.31),(-6.23,4.15,5.08,.45),(-5.73,4.07,5.14,.51),(-4.89,4.03,5.15,.54),(-4.31,4.06,5.12,.51),(-4.02,4.15,5.04,.44)],'Skin',center_x=x,caps=False)
        intake(a,x,4.59,-3.95,.49);exhaust(a,x,4.64,-6.87,.37)
        for z in [-5.97,-4.90]:
            a.rod((x,4.59,z-.018),(x,4.59,z+.018),.52,'Belly',n=24)
        a.part('Forward and aft retract struts')
        for z,offset in [(2.43,1.59),(-4.57,1.47)]:
            a.rod((s*1.27,1.40,z+.18),(s*offset,.37,z),.114,'Hub',end=.084,n=14)
            a.rod((s*1.39,1.09,z-.38),(s*offset,.43,z),.054,'Belly')
            if z>0:
                for off in [-.137,.137]:a.wheel(s*offset+off,.356,z,.222)
            else:a.wheel(s*offset,.36,z,.258)
    a.part('Forward rotor pylon')
    a.shell([(2.05,3.65,4.01,.44),(2.46,3.66,4.22,.66),(3.32,3.71,4.73,.72),
       (4.20,3.73,4.91,.61),(4.72,3.74,4.77,.49),(5.06,3.75,4.10,.19)],'Skin',exp=.62)
    a.part('Aft transmission pylon')
    a.shell([(-7.29,3.12,4.27,.69),(-6.98,3.19,5.41,.94),(-6.44,3.33,5.88,1.08),
       (-5.31,3.55,5.99,1.12),(-4.78,3.69,5.85,1.07),(-4.15,3.85,5.15,.90),(-3.12,3.97,4.18,.54)],'Skin',exp=.52)
    a.part('Rotor transmission tunnel')
    a.shell([(-4.18,3.93,4.23,.27),(-2.69,3.96,4.29,.23),(1.55,3.99,4.30,.23),(3.01,3.94,4.37,.33)],'Skin',exp=.62)
    for s in (-1,1):
        a.part('Transmission louvers')
        for i in range(9):
            z=-6.45+.115*i;a.rod((s*1.058,4.97,z),(s*1.044,5.47,z+.075),.029,'Canopy frame',n=5)
    a.part('Aft loading-ramp door and hinges')
    for s in (-1,1):
        a.pipe([(s*.95,2.72,-7.34),(s*1.38,2.29,-6.9),(s*1.43,1.10,-5.67)],.046,'Gasket')
    for x in [-.77,-.25,.25,.77]:a.rod((x-.12,2.86,-7.32),(x+.12,2.86,-7.32),.062,'Hub')
    a.part('Flare fairings and fore bay boarding stirrups')
    for s in [-1,1]:
        a.pipe([(s*1.55,1.49,3.16),(s*1.75,.97,3.15),(s*1.74,.97,3.68),(s*1.51,1.46,3.70)],.035,'Hub')
        a.rod((s*1.37,2.15,-5.84),(s*1.49,2.04,-6.12),.12,'Canopy frame',end=.13,n=12)
    for z,y,base in [(4.35,5.1,4.68),(-5.18,6.23,5.84)]:a.rod((0,base,z),(0,y,z),.154,'Hub',n=20)
    rotor(a,'MainRotor',3,18.29/2,.24);rotor(a,'SecondMainRotor',3,18.29/2,.24+pi/3)
    return a


def seaking():
    a=Airframe('HAEMOR',{'MainRotor':(0,4.48,0),'TailRotor':(.26,4.0706,-10.1)})
    left=[(-3.43,-2.53,.44,.75,3,'Cabin glazing'),(-1.97,-.92,.44,.76,4,'Cabin glazing'),
          (-.67,.36,.43,.76,4,'Glazing'),(.61,1.66,.43,.76,4,'Glazing'),(1.93,2.83,.42,.89,5,'Glazing')]
    right=[(-3.35,-2.42,.44,.75,3,'Cabin glazing'),(-1.82,-.92,.44,.76,4,'Cabin glazing'),(-.59,.36,.44,.76,4,'Cabin glazing'),
           (.61,1.66,.44,.76,4,'Glazing'),(1.93,2.83,.42,.89,5,'Glazing')]
    nose=[(-1.55,-.89,.41,.87,5,'Glazing'),(-.83,-.035,.47,.91,6,'Glazing'),
          (.035,.83,.47,.91,6,'Glazing'),(.89,1.55,.41,.87,5,'Glazing')]
    rows=[(-5.48,.32,2.34,3.00),(-4.90,.70,1.96,3.27),(-4.05,1.04,1.37,3.40),
          (-3.04,1.26,1.02,3.50),(-1.32,1.33,.89,3.56),(.22,1.34,.84,3.56),
          (1.55,1.32,.86,3.55),(2.92,1.28,.93,3.52)]
    sp,so,npnt,no=cabin(a,rows,left,right,nose,
        [(0,.28),(.15,1.17),(.33,1.70),(.53,1.74),(.72,1.51),(.91,1.03),(1,.53)],3.2,True)
    cockpit(a,3.17,1.86,.60,npnt,no)
    a.part('SAR cabin seats and litter rack')
    for z in [-2.65,-1.48,-.29,.79]:
        a.box((1.04,1.55,z),(.23,.055,.37),'Seat');a.box((1.22,1.80,z),(.05,.22,.37),'Interior')
    a.pipe([(-1.03,1.60,-2.91),(-1.03,1.60,-.82),(-.53,1.60,-.82),(-.53,1.60,-2.91),(-1.03,1.60,-2.91)],.032,'Hub')
    for s in (-1,1):
        door(a,sp,so,s,1.81,2.91,.16,.94)
        a.part('Spray chines')
        pts=[sp(z,.235,s)+so(z,.235,s)*.036 for z in np.linspace(-4.72,2.91,23)]
        pts+= [npnt(s*ang,.235)+no(s*ang,.235)*.036 for ang in np.linspace(pi/2,.72,8)]
        a.pipe(pts,.035,'Light trim',n=6)
        for z in [-3.72,-2.20,-.80,.48]:
            a.part('Marine fuselage stations');inspection_band(a,sp,so,s,z,.30,.84)
    door(a,sp,so,-1,-.77,1.77,.20,.835)
    a.part('Starboard sliding rescue door track and winch')
    a.pipe([(-1.20,3.20,-2.86),(-1.28,3.20,-1.39),(-1.31,3.20,1.55)],.034,'Hub')
    a.box((-1.34,3.29,.92),(.15,.14,.44),'Belly');a.rod((-1.27,3.32,1.13),(-1.84,3.43,1.13),.10,'Skin')
    a.rod((-1.83,3.42,1.13),(-1.83,3.02,1.13),.059,'Hub');a.rod((-1.83,3.06,1.13),(-1.83,2.69,1.13),.017,'Bore')
    a.pipe([(-1.83,2.75,1.13),(-1.83,2.59,1.09),(-1.83,2.58,.98),(-1.83,2.66,.94)],.024,'Hub')
    a.part('Twin Gnome engine house')
    a.shell([(-2.72,3.31,3.45,.66),(-2.22,3.30,3.83,.93),(-1.25,3.37,4.05,1.0),
             (-.45,3.38,4.21,.94),(.41,3.41,4.19,.92),(1.17,3.42,4.18,.97),(1.57,3.46,4.12,.86)],'Skin',exp=.72)
    a.rod((0,4.08,0),(0,4.48,0),.153,'Hub',n=20)
    for s in (-1,1):
        x=s*.54
        a.part('Engine intake and side exhaust')
        a.shell([(-.87,3.52,3.99,.29),(-.32,3.47,4.13,.40),(.52,3.45,4.23,.42),(1.34,3.46,4.22,.39),(1.61,3.49,4.17,.35)],'Skin',center_x=x,caps=False)
        intake(a,x,3.83,1.77,.353,.29)
        a.rod((s*.80,3.82,-.76),(s*1.07,3.89,-1.31),.235,'Heat metal',end=.228,n=22,open_ends=True)
        a.rod((s*.93,3.85,-1.04),(s*.95,3.86,-1.08),.208,'Bore',n=20)
        for i in range(8):
            z=-1.69+i*.121;a.rod((s*.89,3.71,z),(s*.78,3.93,z+.06),.026,'Canopy frame',n=5)
        a.part('Flotation sponson and wheel bay')
        x=s*1.94
        a.shell([(-2.12,1.38,1.66,.14),(-1.77,1.19,1.94,.40),(-1.09,1.07,2.04,.47),
                 (-.36,1.03,2.06,.49),(.41,1.09,2.04,.49),(1.03,1.22,1.90,.38),(1.45,1.42,1.66,.15)],'Skin',center_x=x,exp=.78)
        for z in [-1.07,.40]:
            a.rod((s*1.14,2.50,z+.13),(x,1.74,z),.062,'Hub')
        a.rod((s*1.08,1.49,-.24),(x,1.46,-.32),.16,'Skin',end=.12)
        a.rod((x,1.49,-.38),(x,.35,-.26),.099,'Hub',end=.077,n=12)
        for off in [-.12,.12]:a.wheel(x+off,.35,-.26,.206)
    a.part('Aft radio platform and radar dome')
    a.shell([(-3.65,3.22,3.44,.41),(-3.44,3.26,3.90,.59),(-3.05,3.31,4.17,.68),(-2.70,3.34,4.14,.65),(-2.39,3.35,3.96,.53),(-2.18,3.34,3.61,.26)],'Belly',exp=.86)
    a.part('Tapered port-fold tailcone')
    a.shell([(-9.85,2.55,2.85,.15),(-8.12,2.51,3.10,.26),(-6.59,2.40,3.12,.37),(-5.23,2.26,3.13,.47),(-4.41,1.95,3.25,.72)],'Skin',exp=.78)
    tail_fin(a,[(-9.23,2.56),(-10.13,2.58),(-10.62,4.13),(-10.19,4.28),(-9.73,3.78)],.122)
    a.part('Tail fold break and angled steadying plane')
    a.rod((0,2.78,-8.79),(0,2.78,-8.84),.29,'Belly',n=18)
    a.foil((-.11,2.85,-9.00),(-2.01,3.00,-9.34),.89,.50,'Skin')
    a.part('Tailwheel assembly')
    a.rod((0,2.57,-5.75),(0,.32,-5.95),.08,'Hub',end=.053,n=12)
    for s in (-1,1):
        a.rod((s*.23,1.94,-5.26),(s*.12,.39,-5.91),.047,'Hub')
        a.wheel(s*.109,.26,-5.94,.17)
    rotor(a,'MainRotor',5,18.90/2,.23);rotor(a,'TailRotor',6,1.59,.31,True)
    return a


if __name__=='__main__':
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version=0
    for i,build in enumerate([skycrane,chinook,seaking]):
        model=build();root=model.finish_blender();target=HERE.parent/(model.code+'.glb')
        model.export(target);root.location.x=(i-1)*28
        print('New flight mesh:',model.code,target.stat().st_size,'bytes')
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'Heavy-Rescue-Airframes.blend'),compress=True)
