"""Build the coastal distribution pole and lamp library in metres, with editable Blender parts."""
from math import cos, sin, pi
from pathlib import Path
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[3]
AUTHOR=ROOT/'models/world/street'
OUT=ROOT/'remake/art/streetscape'
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version=0
material=bpy.data.materials.new('Utility finishes | vertex paint')
material.use_nodes=True
principled=material.node_tree.nodes.get('Principled BSDF')
colors=material.node_tree.nodes.new('ShaderNodeVertexColor');colors.layer_name='Finish'
material.node_tree.links.new(colors.outputs['Color'],principled.inputs['Base Color'])
principled.inputs['Roughness'].default_value=.74
def linear(h):
    raw=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in raw)
class Shape:
    def __init__(self,name):
        self.name=name;self.v=[];self.faces=[];self.colors=[]
    def face(self,vs,col):
        self.faces.append(tuple(vs));self.colors.append(linear(col))
    def turned(self,a,b,rings,col,sides=12):
        a=Vector(a);b=Vector(b);axis=(b-a).normalized()
        if axis.length<.01:return
        u=axis.cross(Vector((0,1,0)) if abs(axis.y)<.8 else Vector((1,0,0))).normalized()
        v=axis.cross(u)
        ring=[]
        for t,r in rings:
            center=a+(b-a)*t;base=len(self.v)
            for i in range(sides):
                angle=2*pi*i/sides;self.v.append(center+(u*cos(angle)+v*sin(angle))*r)
            if ring:
                for i in range(sides):
                    j=(i+1)%sides;self.face((ring[i],ring[j],base+j,base+i),col)
            else:self.face(tuple(reversed(range(base,base+sides))),col)
            ring=list(range(base,base+sides))
        self.face(ring,col)
    def pipe(self,a,b,r,col,sides=9,r2=None):
        self.turned(a,b,[(0,r),(1,r if r2 is None else r2)],col,sides)
    def bar(self,a,b,w,d,col):
        a=Vector(a);b=Vector(b);z=(b-a).normalized()
        u=z.cross(Vector((0,1,0)) if abs(z.y)<.8 else Vector((1,0,0))).normalized();v=z.cross(u)
        base=len(self.v)
        for center in (a,b):
            for i,j in [(-1,-1),(1,-1),(1,1),(-1,1)]:self.v.append(center+i*u*w/2+j*v*d/2)
        self.face([base+i for i in (3,2,1,0)],col);self.face([base+i for i in (4,5,6,7)],col)
        for i in range(4):
            j=(i+1)%4;self.face((base+i,base+j,base+j+4,base+i+4),col)
    def make(self):
        m=bpy.data.meshes.new(self.name);m.from_pydata(self.v,[],self.faces);m.materials.append(material)
        paint=m.color_attributes.new(name='Finish',type='BYTE_COLOR',domain='CORNER')
        for poly,color in zip(m.polygons,self.colors):
            for i in poly.loop_indices:paint.data[i].color=(*color,1)
        o=bpy.data.objects.new(self.name,m);bpy.context.scene.collection.objects.link(o)
        return o
pole=Shape('Distribution mast')
pole.turned((0,0,-.25),(0,0,8.55),[(0,.22),(.04,.217),(.62,.159),(.96,.103),(1,.091)],'989890',14)
pole.pipe((0,0,-.04),(0,0,.19),.233,'646965',14,.228)
for z in (1.15,1.31,5.83,6.87,7.78):
    r=.215-z*.0139;pole.pipe((0,0,z),(0,0,z+.052),r+.012,'566369',12)
for y in (-.087,.087):
    pole.bar((-1.42,y,7.61),(1.42,y,7.61),.12,.10,'68787c')
for side in (-1,1):
    pole.bar((0,-.03,6.97),(side*.98,-.03,7.57),.05,.042,'708288')
    pole.pipe((side*.99,-.131,7.58),(side*.99,.132,7.58),.04,'58646a',7)
def standoff(o,x,y,z,h,r,body='bdc9bf'):
    o.pipe((x,y,z-.04),(x,y,z+h+.012),r*.45,'58656a',8)
    rings=[(0,r*.52),(.12,r*.55)]
    for t in (.24,.44,.64,.84):rings.extend([(t-.065,r*.52),(t,r),(t+.045,r*.82),(t+.084,r*.50)])
    rings.extend([(.96,r*.50),(1,r*.61)])
    o.turned((x,y,z),(x,y,z+h),rings,body,10)
for x in (-1.19,0,1.19):
    z=8.53 if x==0 else 7.68
    standoff(pole,x,0,z,.31,.108)
pole.make()
tx=Shape('Pole transformer')
tx.turned((0,.55,4.74),(0,.55,6.02),[(0,.31),(.04,.398),(.085,.403),(.12,.366),(.90,.366),(.93,.402),(.96,.405),(1,.32)],'829493',16)
for z in (4.96,5.73):
    tx.bar((0,-.07,z),(0,.35,z),.15,.09,'4e5e65')
    tx.pipe((0,0,z-.07),(0,0,z+.07),.16,'62767b',12)
for j in range(13):
    a=j*2*pi/13;c=cos(a);s=sin(a)
    tx.bar((.37*c,.55+.37*s,4.96),(.37*c,.55+.37*s,5.79),.064,.075,'788b89')
for x in (-.14,.14):standoff(tx,x,.55,6.00,.23,.088,'9cae9b')
tx.bar((.08,.09,6.60),(.58,.09,6.60),.084,.056,'6e7d82')
standoff(tx,.56,.09,6.59,.34,.074,'b2beb3')
for pts in [[(.56,.09,6.91),(.62,.29,7.24),(.91,.16,7.64),(1.19,0,7.98)],
            [(.56,.09,6.58),(.47,.34,6.36),(.20,.52,6.23),(.14,.55,6.21)]]:
    for a,b in zip(pts,pts[1:]):tx.pipe(a,b,.014,'303738',5)
tx.make()
lamp=Shape('Galvanized outreach lamp')
lamp.turned((0,0,-.04),(0,0,5.64),[(0,.14),(.04,.135),(.18,.094),(.99,.062),(1,.056)],'819295',12)
lamp.turned((0,0,0),(0,0,.24),[(0,.22),(.13,.22),(.25,.18),(1,.138)],'667477',10)
points=[(0,0,5.59),(.16,0,5.86),(.60,0,6.04),(1.20,0,6.12)]
for a,b in zip(points,points[1:]):lamp.pipe(a,b,.05,'879494',8,.042)
lamp.turned((.99,0,6.07),(1.75,0,6.07),[(0,.08),(.27,.163),(.69,.174),(1,.08)],'455963',10)
lamp.make()
AUTHOR.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(AUTHOR/'Coastal-Distribution.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'Coastal-Distribution.glb'),export_format='GLB',
    export_texcoords=False,export_normals=True,export_materials='EXPORT',export_vertex_color='ACTIVE')

