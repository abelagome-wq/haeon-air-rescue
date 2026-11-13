"""Model the street trees in 3D and bake their leaflet sprays with Blender."""
from pathlib import Path
import math
import tempfile
import random
import bpy
from mathutils import Vector
from math import cos, sin, pi

ROOT=Path(__file__).resolve().parents[3]
STREET=ROOT/'models/world/street'
ART=ROOT/'remake/art/streetscape'
TEMP=Path(tempfile.gettempdir())/'haeon-canopy-bake'
ART.mkdir(parents=True,exist_ok=True);TEMP.mkdir(exist_ok=True)
bpy.context.preferences.filepaths.save_version=0
def linear(col):
    return tuple(((int(col[i:i+2],16)/255+.055)/1.055)**2.4 for i in (0,2,4))
class Mesh:
    def __init__(self):
        self.v=[];self.faces=[];self.ink=[];self.uv=[]
    def face(self,ids,ink,uv=None):
        self.faces.append(tuple(ids));self.ink.append(linear(ink));self.uv.append(uv)
    def cone(self,a,b,r,s,ink,n=6):
        a,b=Vector(a),Vector(b);axis=(b-a).normalized();right=axis.cross(Vector((0,1,0)) if abs(axis.y)<.8 else Vector((1,0,0))).normalized();v=axis.cross(right)
        k=len(self.v)
        for c,rad in [(a,r),(b,s)]:
            for i in range(n):self.v.append(c+rad*(cos(2*pi*i/n)*right+sin(2*pi*i/n)*v))
        for i in range(n):j=(i+1)%n;self.face((k+i,k+j,k+j+n,k+i+n),ink)
    def object(self,name,uv=False):
        m=bpy.data.meshes.new(name);m.from_pydata(self.v,[],self.faces);paint=m.color_attributes.new(name='Finish',type='BYTE_COLOR',domain='CORNER')
        uvmap=m.uv_layers.new(name='Spray') if uv else None
        for f,col,tx in zip(m.polygons,self.ink,self.uv):
            for j,i in enumerate(f.loop_indices):
                paint.data[i].color=(*col,1)
                if uv:uvmap.data[i].uv=tx[j]
        o=bpy.data.objects.new(name,m);bpy.context.scene.collection.objects.link(o);return o
def paint_material(name):
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');v=m.node_tree.nodes.new('ShaderNodeVertexColor');v.layer_name='Finish'
    m.node_tree.links.new(v.outputs['Color'],p.inputs['Base Color']);p.inputs['Roughness'].default_value=.9
    return m
def render_bough(pine):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rng=random.Random(12 if pine else 55)
    stern=Mesh()
    ink=['354e43','4e7255','70855b','627d53','84925e'] if pine else ['648351','758a4e','8c9b62','547c4d','688956']
    def leaflet(a,b,width,c):
        a,b=Vector(a),Vector(b);ax=(b-a);right=Vector((-ax.y,ax.x,0)).normalized()*width
        k=len(stern.v);stern.v.extend((a,a.lerp(b,.41)+right,b,a.lerp(b,.50)-right,a.lerp(b,.50)+Vector((0,0,width*.30))))
        for ids in [(0,1,4),(1,2,4),(2,3,4),(3,0,4)]:stern.face([k+j for j in ids],c)
    # Top-down orthographic, root at left. Asymmetry and holes remain real alpha.
    stern.cone((-.43,0,0),(.46,.045,.045),.014,.004,'705c45',6)
    for i in range(1,16 if pine else 9):
        u=i/(16 if pine else 9);x=-.42+.85*u;reach=.17+.16*sin(pi*u)-.10*u
        for side in (-1,1):
            a=Vector((x,.04*u,.02*u));b=a+Vector((.13*(1-u)+.07,side*reach*rng.uniform(.79,1.04),rng.uniform(-.02,.06)))
            stern.cone(a,b,.008,.002,'745e48',4)
            for j in range(1,12 if pine else 6):
                t=j/(12 if pine else 6);p=a.lerp(b,t)
                for k in (-1,1):
                    vec=Vector((.06+k*.056 if pine else .065+k*.085,side*.055+.055*side*t,rng.uniform(-.018,.045)))
                    leaflet(p,p+vec*rng.uniform(.84,1.18),.011 if pine else rng.uniform(.028,.043),rng.choice(ink))
    o=stern.object('Needle branch' if pine else 'Elm leaflets');o.data.materials.append(paint_material('Bough surfaces'))
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=7
    scene.world=bpy.data.worlds.new('Soft sky');scene.world.use_nodes=True
    bg=scene.world.node_tree.nodes.get('Background');bg.inputs[0].default_value=(.87,.93,1,1);bg.inputs[1].default_value=1.35
    light=bpy.data.lights.new('Sun','SUN');light.energy=1.85;light.angle=.3
    sun=bpy.data.objects.new('Sun',light);scene.collection.objects.link(sun);sun.rotation_euler=Vector((.42,.32,-1)).to_track_quat('-Z','Y').to_euler()
    cam=bpy.data.objects.new('Branch camera',bpy.data.cameras.new('Branch camera'));scene.collection.objects.link(cam)
    cam.location=(.03,0,3);cam.rotation_euler=(0,0,0);cam.data.type='ORTHO';cam.data.ortho_scale=1.22;scene.camera=cam
    scene.render.resolution_x=384;scene.render.resolution_y=384;scene.render.resolution_percentage=100
    scene.render.film_transparent=True;scene.render.image_settings.color_mode='RGBA';scene.view_settings.view_transform='Standard'
    scene.render.filepath=str(TEMP/('needle-spray.png' if pine else 'elm-spray.png'));bpy.ops.render.render(write_still=True)
def tree(name,pine):
    wood=Mesh();leaves=Mesh();rng=random.Random(4431 if pine else 1093)
    def spray(a,b,wide,roll):
        a,b=Vector(a),Vector(b);axis=(b-a).normalized();side=axis.cross(Vector((0,0,1))).normalized()
        side=side*cos(roll)+axis.cross(side)*sin(roll)
        k=len(leaves.v);u0=.5 if pine else 0
        r=[.23,1,.82,.21]; shade=rng.choice(['e0e6d8','f1f0e3','ccd6c3','eff0dc'])
        for j,t in enumerate((0,.34,.68,1)):
            center=a.lerp(b,t);center.z+=sin(pi*t)*wide*.14
            leaves.v.extend([center-side*r[j]*wide,center+side*r[j]*wide])
        for j in range(3):
            s=j/3;t=(j+1)/3
            leaves.face((k+2*j,k+2*j+1,k+2*j+3,k+2*j+2),shade,[(u0+.5*s,0),(u0+.5*s,1),(u0+.5*t,1),(u0+.5*t,0)])
    def v(x,y,z):return Vector((x,y,z))
    heights=([0,.25,.52,.76,.99] if pine else [0,.20,.36,.55,.69])
    centers=[v(.013*sin(i*1.61),.011*cos(i*1.5),z) for i,z in enumerate(heights)]
    for i,(a,b) in enumerate(zip(centers,centers[1:])):
        wood.cone(a,b,.035*(1-i/len(heights)),.035*(1-(i+1)/len(heights)),'6d6256',8)
    if pine:
        for layer in range(9):
            y=.22+layer*.088;radius=.45*(1-layer/10)**.65
            for j in range(6):
                phi=(j/6+layer*.148+rng.uniform(-.035,.035))*2*pi;d=v(cos(phi),sin(phi),0);right=v(-d.y,d.x,0)
                a=v(.007*sin(layer),.006*cos(layer),y);b=a+d*radius*rng.uniform(.78,1.12)+v(0,0,rng.uniform(-.05,.05))
                m=a.lerp(b,.52)-v(0,0,.026)
                wood.cone(a,m,.012*(1-layer/12),.006,'635948',5);wood.cone(m,b,.006,.002,'75614d',4)
                for u in (.31,.62,.83):
                    p=a.lerp(b,u)
                    for sign in (-1,1):
                        tip=p+d*.12+right*(.12*(1-u)+.065)*sign+v(0,0,rng.uniform(.009,.075))
                        spray(p-d*.03,tip,.09*rng.uniform(.77,1.12),rng.uniform(-.80,.80))
                spray(m,b+d*.075,.097,rng.uniform(-.65,.65))
    else:
        for i in range(12):
            phi=2.399*i+.35;d=v(cos(phi),sin(phi),0);right=v(-d.y,d.x,0)
            a=v(.01*sin(i),.01*cos(i),.23+i*.017);h=rng.uniform(.61,.88)
            b=d*rng.uniform(.19,.36)+v(0,0,h-.14);tip=d*rng.uniform(.32,.46)+v(0,0,h+.045)
            wood.cone(a,b,.022*(1-i/25),.009,'786a56',6);wood.cone(b,tip,.009,.002,'73644e',5)
            for u in (.38,.64,.9):
                p=a.lerp(b,u)
                for sign in (-1,1):
                    t=p+d*.14+right*sign*rng.uniform(.075,.15)+v(0,0,.15)
                    wood.cone(p,t,.007,.003,'786a56',4)
                    for j in range(3):
                        vtip=t+d*(.12+rng.random()*.08)+right*(j-1)*.10+v(0,0,rng.uniform(-.06,.09))
                        spray(t-d*.065,vtip,.095+rng.random()*.038,rng.uniform(-1.10,1.10))
            spray(b,tip+v(0,0,.065),.12,rng.uniform(-.9,.9))
    solid=wood.object(name+' branches');solid.data.materials.append(bark)
    cover=leaves.object(name+' sprays',True);cover.data.materials.append(bark)
for pine in (False,True):render_bough(pine)
bpy.ops.wm.read_factory_settings(use_empty=True);bark=paint_material('Bark and needle lighting')
tree('Street elm',False);tree('Shore pine',True)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.export_scene.gltf(filepath=str(ART/'Coastal-Trees.glb'),export_format='GLB',export_texcoords=True,export_normals=True,export_vertex_color='ACTIVE')
# Stage both crowns side-by-side at street scale in the editable Blender file.
# Flight instances use the normalized mesh exported above and scale it per tree.
import numpy as np
atlas=np.empty((384,768,4),dtype=np.float32)
for i,name in enumerate(('elm-spray','needle-spray')):
    source=bpy.data.images.load(str(TEMP/(name+'.png')))
    pixels=np.empty(384*384*4,dtype=np.float32);source.pixels.foreach_get(pixels)
    atlas[:,i*384:(i+1)*384]=pixels.reshape((384,384,4))
    bpy.data.images.remove(source)
texture=bpy.data.images.new('Blender baked leaf and needle sprays',width=768,height=384,alpha=True)
texture.pixels.foreach_set(atlas.ravel());texture.pack()
leaves=bark.copy();leaves.name='Leaves | cutout sprays';nodes=leaves.node_tree.nodes;links=leaves.node_tree.links
shader=nodes.get('Principled BSDF');picture=nodes.new('ShaderNodeTexImage');picture.image=texture
links.new(picture.outputs['Color'],shader.inputs['Base Color']);links.new(picture.outputs['Alpha'],shader.inputs['Alpha'])
for o in bpy.context.scene.objects:
    o.location.x=-3 if o.name.startswith('Street elm') else 3;o.scale=(6.4,6.4,7.4)
    if o.name.endswith('sprays'):o.data.materials[0]=leaves
bpy.ops.wm.save_as_mainfile(filepath=str(STREET/'Coastal-Trees.blend'),compress=True)

