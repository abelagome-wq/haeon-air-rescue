"""Metre-registered paint seams, close-spaced fasteners and removable service covers."""
from pathlib import Path
from tempfile import gettempdir
import struct,zlib
import bpy
import numpy as np


COATED={'Skin','Stripe','Belly'}
WIDTH,HEIGHT=1024,512


def uv_for(point,face):
    x,y,z=point
    if abs(face[1])>.78: t=.72+.24*np.clip((x+3.5)/7,0,1)
    else:t=.66*np.clip((6.5-y)/6.5,0,1)
    return ((z+12.1)/20.6,float(t))


def png(array):
    def chunk(t,d):return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
    rows=b''.join(b'\0'+r.tobytes() for r in array)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',WIDTH,HEIGHT,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(rows,9))+chunk(b'IEND',b'')


def panel_atlas(craft):
    yy,xx=np.mgrid[:HEIGHT,:WIDTH]
    tone=247+2*np.sin(xx*.089+np.sin(yy*.022)*1.7)+2.5*np.sin(yy*.037+xx*.018)+1.25*np.sin(xx*.46+yy*.72)
    grey=tone.astype('uint8')
    def pix(z,y):return int(round(WIDTH*(z+12.1)/20.6)),int(round(HEIGHT*.66*(6.5-y)/6.5))
    def edge(z0,y0,z1,y1):
        x0,y0=pix(z0,y0);x1,y1=pix(z1,y1)
        steps=int(np.hypot(x1-x0,y1-y0))+1
        xs=np.rint(np.linspace(x0,x1,steps)).astype(int);ys=np.rint(np.linspace(y0,y1,steps)).astype(int)
        valid=(xs>=2)&(xs<WIDTH-2)&(ys>=2)&(ys<HEIGHT-2);xs,ys=xs[valid],ys[valid]
        grey[ys,xs]=185;grey[ys+1,xs]=248
        grey[ys[::6]-2,xs[::6]+1]=179
    def hatch(z,y,w,h):
        x0,y0=pix(z-w/2,y+h/2);x1,y1=pix(z+w/2,y-h/2)
        grey[y0+1:y1,x0+1:x1]=np.minimum(grey[y0+1:y1,x0+1:x1],235)
        cs=[(z-w*.46,y-h*.5),(z+w*.46,y-h*.5),(z+w*.5,y-h*.38),(z+w*.5,y+h*.38),
            (z+w*.46,y+h*.5),(z-w*.46,y+h*.5),(z-w*.5,y+h*.38),(z-w*.5,y-h*.38)]
        for one,two in zip(cs,cs[1:]+cs[:1]):edge(*one,*two)
        grey[y0+3:y0+5,x0+4:x0+9]=125;grey[y1-3:y1-1,x1-10:x1-4]=120
    if craft=='DUSOL':
        breaks=[-6.7,-5.35,-4.82,-3.08,-1.52,.13,1.71,3.08,4.35];start,end=-6.75,5.0
        for z in [-3.3,-1.60,.08,1.67]:hatch(z,1.62,1.06,.28)
        for z in [-5.97,-5.2]:hatch(z,4.46,.55,.55)
        edge(-5.80,2.04,3.12,2.04)
    elif craft=='HAEMOR':
        breaks=[-7.33,-6.1,-4.67,-3.7,-2.25,-.77,.46,1.78,2.96];start,end=-7.45,3.0
        for z in [-3.20,-1.72,-.34,1.15]:hatch(z,1.81,.67,.30)
        edge(-4.0,1.42,2.45,1.42)
        for z in [-1.42,-.48,.39,.99]:hatch(z,3.77,.48,.27)
    else:
        breaks=[-10.23,-8.86,-7.45,-6.03,-4.32,-2.95,-1.67,-.38,.98,2.34,3.76,5.85,6.56];start,end=-9.6,6.6
        for z in np.arange(-3.28,3.83,1.16):hatch(z,3.51,.86,.24)
        hatch(4.29,1.83,.46,.28)
    for z in breaks:
        if craft=='GIRIN' and z<3.85:edge(z,2.62,z,3.76)
        else:edge(z,1.22,z,3.38)
    edge(start,2.15,end,2.15);edge(start,3.31,end,3.31)
    # Dorsal transmission tunnel panels, different projection from the side skins.
    roof0=int(HEIGHT*.72);roof1=int(HEIGHT*.96)
    for z in breaks:
        x,_=pix(z,0);grey[roof0:roof1,x]=197;grey[roof0:roof1:7,x+2]=183
    for t in [.777,.897]:
        y=int(t*HEIGHT);grey[y,80:905]=208;grey[y+2,80:905:8]=188
    rgb=np.repeat(grey[:,:,None],3,axis=2)
    data=png(rgb);p=Path(gettempdir())/('haeon-body-panel-'+craft+'.png');p.write_bytes(data)
    img=bpy.data.images.load(str(p),check_existing=False);img.name=craft+' flush fasteners and inspection hatches';img.pack()
    return img,data
