from math import cos,sin,pi,tau
from functools import lru_cache
import numpy as np
from heavy_mesh import v


def stations(rows):
    data=np.asarray(rows,dtype=float)
    @lru_cache(maxsize=8192)
    def sample(z):
        k=min(len(data)-2,max(0,np.searchsorted(data[:,0],z,side='right')-1))
        a,b=data[k:k+2];h=b[0]-a[0];f=np.clip((z-a[0])/h,0,1)
        slope=(b[1:]-a[1:])/h
        def tangent(i):
            if i in (0,len(data)-1):return slope
            left=(data[i,1:]-data[i-1,1:])/(data[i,0]-data[i-1,0])
            right=(data[i+1,1:]-data[i,1:])/(data[i+1,0]-data[i,0])
            return np.where(left*right>0,2*left*right/np.where(np.abs(left+right)>1e-8,left+right,1),0)
        return (2*f**3-3*f**2+1)*a[1:]+(f**3-2*f*f+f)*h*tangent(k)+(-2*f**3+3*f*f)*b[1:]+(f**3-f*f)*h*tangent(k+1)
    return sample


def superradius(t,p):
    return max(0,1-abs(2*t-1)**p)**(1/p)


def tessellate(a,range_u,stops_u,stops_t,holes,point,out,paint,nu=1.,scale=1):
    # Rectangular domains are absent from the opaque shell. The surrounding
    # curved metal web runs to the glazing seal, including on round portholes.
    u0,u1=range_u
    us=list(stops_u)+list(np.linspace(u0,u1,max(7,int(abs(u1-u0)/nu)+1)))
    ts=list(stops_t)+list(np.linspace(0,1,13))
    for lo,hi,b,t,power,glass in holes:
        us.extend(np.linspace(lo,hi,7));ts.extend(np.linspace(b,t,6))
    us=sorted(set(round(float(x),7) for x in us if u0-1e-7<=x<=u1+1e-7))
    ts=sorted(set(round(float(x),7) for x in ts if 0<=x<=1))
    # Narrow openings (e.g. two round ports on adjacent stations) retain a
    # metal web even where neighbouring bounding boxes meet.
    for i,j in zip(us,us[1:]):
        for k,l in zip(ts,ts[1:]):
            u=(i+j)/2;t=(k+l)/2
            if any(lo<u<hi and b<t<top for lo,hi,b,top,*_ in holes):continue
            a.face([point(i,k),point(j,k),point(j,l),point(i,l)],paint(u,t),out(u,t),True)
    for lo,hi,b,top,power,glass in holes:
        lo,hi,b,top=map(lambda x:round(x,7),(lo,hi,b,top))
        knots=[(u,b) for u in us if lo<=u<hi]+[(hi,t) for t in ts if b<=t<top]+[(u,top) for u in reversed(us) if lo<u<=hi]+[(lo,t) for t in reversed(ts) if b<t<=top]
        cu=(lo+hi)/2;cv=(b+top)/2
        edges=[];rims=[];rubber=[];pane=[]
        for u,t in knots:
            x=(u-cu)*2/(hi-lo);y=(t-cv)*2/(top-b)
            k=(abs(x)**power+abs(y)**power)**(-1/power)
            def p(f,d):
                uu=cu+(u-cu)*k*f;tt=cv+(t-cv)*k*f
                return point(uu,tt)+out(uu,tt)*d
            edges.append(point(u,t));rims.append(p(.965,.009*scale))
            rubber.append(p(.93,.018*scale));pane.append(p(.89,.010*scale))
        n=out(cu,cv);center=point(cu,cv)+n*.018*scale
        for i in range(len(edges)):
            j=(i+1)%len(edges)
            for outer,inner,mat in [(edges,rims,'Skin'),(rims,rubber,'Canopy frame'),(rubber,pane,'Gasket')]:
                a.face([outer[i],outer[j],inner[j],inner[i]],mat,n,True)
            a.face([pane[i],pane[j],center],glass,n,True)


def cabin(a,rows,left,right,front,depth_rows,crown_p=3.6,hull=False):
    sec=stations(rows);tip=rows[-1][0]
    def sidepoint(z,t,s):
        w,bot,top=sec(z);bend=superradius(t,crown_p)
        if hull:bend*=.48+.52*min(1,t/.44)**.85
        return v((s*w*bend,bot+(top-bot)*t,z))
    def sideout(z,t,s):
        h=sidepoint(z,min(1,t+.006),s)-sidepoint(z,max(0,t-.006),s)
        f=sidepoint(min(tip,z+.025),t,s)-sidepoint(max(rows[0][0],z-.025),t,s)
        n=np.cross(h,f)*s
        return n/max(np.linalg.norm(n),1e-9)
    bands=[0,.22,.255,.295,.37,.40,.875,.915,1]
    def paint(z,t):
        if t<(.235 if hull else .215):return 'Belly'
        if a.code=='GIRIN' and .365<t<.40:return 'Stripe'
        if a.code=='HAEMOR' and .255<t<.295:return 'Stripe'
        return 'Skin'
    for s,holes in [(-1,left),(1,right)]:
        a.part(('Starboard' if s==-1 else 'Port')+' cabin skin and apertures')
        tessellate(a,(rows[0][0],tip),[r[0] for r in rows],bands,holes,lambda u,t:sidepoint(u,t,s),lambda u,t:sideout(u,t,s),paint,.55)
    # The backplate closes the opaque tail/ramp transition.
    z=rows[0][0];steps=np.linspace(0,1,27)
    a.face([sidepoint(z,t,1) for t in steps]+[sidepoint(z,t,-1) for t in steps[::-1]],'Skin',[0,0,-1])
    shape=stations(depth_rows)
    def nosepoint(theta,t):
        w,bot,top=sec(tip);radius=abs(sidepoint(tip,t,1)[0]);depth=shape(t)[0]
        return v((radius*np.sign(sin(theta))*abs(sin(theta))**.81,bot+(top-bot)*t,
                  tip+depth*max(0,cos(theta))**.79))
    def noseout(theta,t):
        h=nosepoint(theta,min(1,t+.006))-nosepoint(theta,max(0,t-.006))
        f=nosepoint(min(pi/2,theta+.004),t)-nosepoint(max(-pi/2,theta-.004),t)
        n=np.cross(f,h);return n/max(np.linalg.norm(n),1e-9)
    a.part('Wraparound pilot windscreen and nose')
    tessellate(a,(-pi/2,pi/2),[-pi/2,0,pi/2],[r[0] for r in depth_rows]+bands,front,nosepoint,noseout,
               lambda u,t:'Belly' if t<.20 else 'Skin',.19)
    return sidepoint,sideout,nosepoint,noseout


def seam(a,point,normal,coords,r=.013,mat='Canopy frame',offset=.008):
    pts=[point(z,t)+normal(z,t)*offset for z,t in coords]
    a.pipe(pts,r,mat,n=6)


def door(a,sp,so,s,z0,z1,t0,t1):
    p=lambda z,t:sp(z,t,s);n=lambda z,t:so(z,t,s)
    a.part('Door frames hinges and latches')
    contour=[(z0+.10,t0),(z1-.1,t0),(z1,t0+.055),(z1,t1-.05),(z1-.1,t1)]
    contour += [(z0+.1,t1),(z0,t1-.05),(z0,t0+.055),(z0+.1,t0)]
    subdiv=[]
    for a0,b in zip(contour,contour[1:]):
        for f in np.linspace(0,1,6)[:-1]:subdiv.append(tuple(np.array(a0)*(1-f)+np.array(b)*f))
    subdiv.append(contour[-1]);seam(a,p,n,subdiv,r=.015)
    pt=p(z1-.23,t0+.19)+n(z1-.23,t0+.19)*.036
    a.rod(pt+[0,0,-.09],pt+[0,0,.09],.021,'Hub')


def cockpit(a,seat_z,y,spacing,npnt,nout):
    a.part('Flight deck and seats')
    for sign in (-1,1):
        x=spacing*sign
        # The flight catalogue's pilot Y is the loaded top of the cushion.
        a.box((x,y-.085,seat_z),(.29,.085,.34),'Seat')
        a.box((x,y+.32,seat_z-.25),(.28,.32,.075),'Seat')
        a.box((x,y+.63,seat_z-.27),(.16,.13,.08),'Seat')
        for dx in [-.17,.17]:a.rod((x+dx,y-.22,seat_z-.18),(x+dx,y,seat_z-.18),.035,'Hub')
        a.pipe([(x,y-.19,seat_z+.43),(x,y+.23,seat_z+.39),(x,y+.32,seat_z+.30)],.027,'Interior')
        a.box((x,y+.37,seat_z+.70),(.44,.17,.15),'Interior')
        for dx in [-.23,-.03,.17]:a.rod((x+dx,y+.39,seat_z+.541),(x+dx,y+.39,seat_z+.535),.06,'Bore',n=12)
        a.part('Windshield wipers')
        # Park the pantograph on the lower outboard windshield edge. The
        # seated pilot looks through the central glass above the wiper.
        pts=[npnt(sign*u,t)+nout(sign*u,t)*.043 for u,t in [(.22,.385),(.49,.403),(.79,.432)]]
        a.pipe(pts,.014,'Gasket',n=6)
        b=pts[-1];a.rod(b+[-.19,.08,.02],b+[.19,-.08,-.02],.012,'Gasket',n=6)
    a.part('Cockpit floor and centre console')
    a.box((0,y-.26,seat_z),(.85,.035,.71),'Interior')
    a.box((0,y+.03,seat_z+.32),(.19,.18,.54),'Interior')


def intake(a,x,y,z,r,endz=.32):
    # Deep, open metal lip backed by a dark intake and visible stator vanes.
    a.rod((x,y,z-endz),(x,y,z),r,'Hub',n=24,open_ends=True)
    d=.82*r
    for i in range(28):
        aa=tau*i/28;bb=tau*(i+1)/28
        p=lambda rad,ang,zz:(x+rad*cos(ang),y+rad*sin(ang),zz)
        a.face([p(r,aa,z),p(r,bb,z),p(d,bb,z-.025),p(d,aa,z-.025)],'Hub',[0,0,1],True)
        a.face([p(d,aa,z-.025),p(d,bb,z-.025),p(d*.86,bb,z-endz),p(d*.86,aa,z-endz)],'Heat metal',[-cos(aa),-sin(aa),0],True)
    a.rod((x,y,z-endz-.02),(x,y,z-endz),d*.87,'Bore',n=24)
    for i in range(12):
        aa=tau*i/12;bb=aa+.18
        a.face([(x,y,z-endz+.025),(x+d*.80*cos(aa),y+d*.80*sin(aa),z-endz+.06),
          (x+d*.80*cos(bb),y+d*.80*sin(bb),z-endz+.03)],'Hub',[0,0,1])
    a.rod((x,y,z-endz),(x,y,z-endz*.48),d*.25,'Hub',end=.015,n=14)


def exhaust(a,x,y,z,r):
    for i in range(24):
        aa=tau*i/24;bb=tau*(i+1)/24
        def p(a,w,zz):return (x+cos(a)*w,y+sin(a)*w,zz)
        a.face([p(aa,r,z),p(bb,r,z),p(bb,.85*r,z+.07),p(aa,.85*r,z+.07)],'Heat metal',[0,0,-1],True)
    a.rod((x,y,z),(x,y,z+.37),r,'Heat metal',end=r*.96,n=24,open_ends=True)
    a.rod((x,y,z+.33),(x,y,z+.34),r*.87,'Bore',n=20)
