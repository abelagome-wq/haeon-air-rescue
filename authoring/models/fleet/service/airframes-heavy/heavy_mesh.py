"""Editable metre-scale Blender surfaces, authored in the flight rig's +Z-forward axes."""
from collections import defaultdict
import json
from math import cos, sin, pi, tau
import struct
import bpy
import numpy as np
from mathutils import Vector
from panel_skin import COATED,panel_atlas,uv_for


COLORS = {
    'Skin':('8e9d87',.27,.44), 'Stripe':('d4a14e',.17,.42), 'Belly':('39464c',.18,.52),
    'Light trim':('c5c2a9',.29,.41), 'Hub':('878e87',.64,.36), 'Heat metal':('655f52',.65,.43),
    'Canopy frame':('384645',.32,.43), 'Gasket':('242c2c',.02,.69), 'Tire':('252826',.02,.81),
    'Glazing':('6c8991',.17,.13), 'Cabin glazing':('48636c',.18,.18), 'Roof glass':('496f68',.21,.17), 'Seat':('686a58',.06,.84),
    'Interior':('353c39',.05,.75), 'Bore':('181e1f',.13,.69), 'Rotor':('454a45',.25,.56),
    'Tip':('e2bc61',.17,.45), 'Red light':('de403b',.1,.26), 'Green light':('3fbb7b',.1,.25),
}
PAINT = {'GIRIN':('db882f','3e5c61','8a4c2d'), 'DUSOL':('828d79','d6ad59','454e45'),
         'HAEMOR':('db993d','e1cc9d','555f59')}
v=lambda a:np.asarray(a,dtype=float)


def rgb(hexcolor):
    data=np.array(tuple(bytes.fromhex(hexcolor)))/255
    return np.where(data<=.04045,data/12.92,((data+.055)/1.055)**2.4).tolist()


class Part:
    def __init__(self):
        self.points=[];self.faces=[];self.materials=[];self.smooth=[];self.bypos={}
    def index(self,p):
        key=tuple(round(float(c),6) for c in p)
        if key not in self.bypos:
            self.bypos[key]=len(self.points);self.points.append((key[0],-key[2],key[1]))
        return self.bypos[key]


class Airframe:
    def __init__(self,code,pivots):
        self.code=code;self.parts=defaultdict(Part);self.domain='Airframe';self.name='Outer shell'
        self.pivots={'Airframe':(0.,0.,0.),**pivots};self.palette={};self.parts3d=[]
        for name,(hexcolor,metallic,roughness) in COLORS.items():
            if name in ('Skin','Stripe','Belly'):hexcolor=PAINT[code][('Skin','Stripe','Belly').index(name)]
            alpha={'Glazing':.56,'Cabin glazing':.67,'Roof glass':.75}.get(name,1)
            self.palette[name]={'color':rgb(hexcolor),'metal':metallic,'rough':roughness,'alpha':alpha}

    def part(self,name):
        self.name=name

    def face(self,points,mat,normal=None,smooth=False):
        pts=[v(p) for p in points]
        cross=np.cross(pts[1]-pts[0],pts[2]-pts[0])
        if np.linalg.norm(cross)<1e-9:return
        if normal is not None and np.dot(cross,normal)<0:pts.reverse()
        part=self.parts[self.domain,self.name];indices=tuple(part.index(p) for p in pts)
        if len(set(indices))<3:return
        part.faces.append(indices);part.materials.append(mat);part.smooth.append(smooth)

    def rod(self,a,b,r,mat='Hub',end=None,n=8,open_ends=False):
        a,b=v(a),v(b);unit=(b-a)/np.linalg.norm(b-a)
        x=np.cross(unit,[0,1,0] if abs(unit[1])<.92 else [1,0,0]);x/=np.linalg.norm(x)
        y=np.cross(unit,x);dirs=[x*cos(i*tau/n)+y*sin(i*tau/n) for i in range(n)]
        p=[a+d*r for d in dirs];q=[b+d*(end if end is not None else r) for d in dirs]
        for i in range(n):
            j=(i+1)%n;self.face([p[i],p[j],q[j],q[i]],mat,dirs[i]+dirs[j],True)
        if not open_ends:self.face(p,mat,-unit);self.face(q,mat,unit)

    def pipe(self,line,r,mat='Hub',n=7):
        for a,b in zip(line,line[1:]):self.rod(a,b,r,mat,n=n)

    def shell(self,rings,mat='Skin',caps=True,n=28,exp=.84,center_x=0):
        # (longitudinal station, bottom, top, half beam). Ring normals point outwards.
        loops=[];centers=[]
        for z,bot,top,w in rings:
            cy=(bot+top)/2;centers.append(v((center_x,cy,z)))
            row=[]
            for i in range(n):
                a=tau*i/n;co=cos(a);si=sin(a)
                row.append(v((center_x+w*np.sign(co)*abs(co)**exp,cy+(top-bot)/2*np.sign(si)*abs(si)**exp,z)))
            loops.append(row)
        for k,(a,b) in enumerate(zip(loops,loops[1:])):
            for i in range(n):
                j=(i+1)%n;q=[a[i],a[j],b[j],b[i]];out=np.mean(q,axis=0)-(centers[k]+centers[k+1])/2;out[2]=0
                self.face(q,mat(k,i) if callable(mat) else mat,out,True)
        if caps:
            self.face(loops[0],mat(0,0) if callable(mat) else mat,[0,0,-1])
            self.face(loops[-1],mat(len(rings)-2,0) if callable(mat) else mat,[0,0,1])

    def wheel(self,x,r,z,width=.24):
        n=28;cy=r;rows=[]
        for factor,rad in [(-.5,.62),(-.49,.78),(-.36,.94),(-.19,.994),(.19,.994),(.36,.94),(.49,.78),(.5,.62)]:
            rows.append([v((x+factor*width,cy+rad*r*cos(tau*i/n),z+rad*r*sin(tau*i/n))) for i in range(n)])
        for l1,l2 in zip(rows,rows[1:]):
            for i in range(n):
                j=(i+1)%n;self.face([l1[i],l1[j],l2[j],l2[i]],'Tire',np.mean([l1[i],l1[j],l2[j],l2[i]],axis=0)-[x,cy,z],True)
        self.rod((x-width*.52,cy,z),(x+width*.52,cy,z),r*.62,'Hub',n=20)
        self.rod((x-width*.55,cy,z),(x+width*.55,cy,z),r*.35,'Belly',n=14)
        self.rod((x-width*.58,cy,z),(x+width*.58,cy,z),r*.16,'Hub',n=12)

    def box(self,c,half,mat):
        c=v(c);h=v(half)
        for dim in range(3):
            for sign in (-1,1):
                out=np.zeros(3);out[dim]=sign;corners=[]
                for a,b in [(-1,-1),(1,-1),(1,1),(-1,1)]:
                    p=out.copy();p[(dim+1)%3]=a;p[(dim+2)%3]=b;corners.append(c+p*h)
                self.face(corners,mat,out)

    def foil(self,root,tip,chord,tipchord,mat):
        a,b=v(root),v(tip);span=b-a;length=np.linalg.norm(span)
        normal=np.cross(span/length,[0,0,1]);normal/=np.linalg.norm(normal)
        outline=[(-.5,0),(-.22,.057),(.27,.065),(.5,0),(.26,-.058),(-.25,-.045)]
        rows=[[c+v((0,0,u*w))+normal*h*w for u,h in outline] for c,w in [(a,chord),(b,tipchord)]]
        for i in range(len(outline)):
            j=(i+1)%len(outline);pts=[rows[0][i],rows[0][j],rows[1][j],rows[1][i]]
            self.face(pts,mat,np.mean(pts,axis=0)-(a+b)/2,True)
        self.face(rows[1],mat,span)

    def finish_blender(self):
        coll=bpy.data.collections.new(self.code);bpy.context.scene.collection.children.link(coll)
        root=bpy.data.objects.new(self.code+' | flight datum',None);coll.objects.link(root)
        parent={}
        for group,center in self.pivots.items():
            ob=bpy.data.objects.new(self.code+' '+group,None);coll.objects.link(ob);ob.parent=root
            ob.location=(center[0],-center[2],center[1]);parent[group]=ob
        mats={};image,self.paint_atlas=panel_atlas(self.code)
        for name,s in self.palette.items():
            m=bpy.data.materials.new(self.code+' '+name);m.use_nodes=True
            bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*s['color'],1)
            bs.inputs['Metallic'].default_value=s['metal'];bs.inputs['Roughness'].default_value=s['rough']
            bs.inputs['Alpha'].default_value=s['alpha'];m.diffuse_color=(*s['color'],s['alpha']);mats[name]=m
            if name in COATED:
                tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
                mix=m.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1
                mix.inputs[1].default_value=(*s['color'],1);m.node_tree.links.new(tex.outputs['Color'],mix.inputs[2])
                m.node_tree.links.new(mix.outputs[0],bs.inputs['Base Color'])
        for (group,label),part in self.parts.items():
            mesh=bpy.data.meshes.new(label);center=parent[group].location
            mesh.from_pydata([tuple(Vector(pt)-center) for pt in part.points],[],part.faces);mesh.update()
            names=list(dict.fromkeys(part.materials))
            for name in names:mesh.materials.append(mats[name])
            for poly,name,smooth in zip(mesh.polygons,part.materials,part.smooth):
                poly.material_index=names.index(name);poly.use_smooth=smooth
            if set(names)&COATED:
                uv=mesh.uv_layers.new(name='Airframe panels')
                for poly in mesh.polygons:
                    if names[poly.material_index] not in COATED:continue
                    n=poly.normal;face=(n.x,n.z,-n.y)
                    for i in poly.loop_indices:
                        p=mesh.vertices[mesh.loops[i].vertex_index].co
                        u,t=uv_for((p.x,p.z,-p.y),face);uv.data[i].uv=(u,1-t)
            obj=bpy.data.objects.new(self.code+' '+label,mesh);coll.objects.link(obj);obj.parent=parent[group]
            self.parts3d.append((group,obj,names))
        return root

    def export(self,path):
        # Pack Blender's actual corner normals; keep one draw per material in each spinning domain.
        names=list(self.palette);buf=bytearray();doc={'asset':{'version':'2.0','generator':'Haeon Heavy Flight – Blender 4.5'},
            'extras':{'haeonPhotoAirframe':1},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'name':'Helicopter','children':[]}],
            'meshes':[],'materials':[],'accessors':[],'bufferViews':[]}
        def write(values,dtype,dim,component,target,bounds=False):
            data=np.array(values,dtype=dtype);buf.extend(b'\0'*(-len(buf)%4));off=len(buf);buf.extend(data.tobytes())
            view=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':off,'byteLength':data.nbytes,'target':target})
            attr={'bufferView':view,'componentType':component,'type':dim,'count':len(data)}
            if bounds:attr.update(min=data.min(axis=0).tolist(),max=data.max(axis=0).tolist())
            doc['accessors'].append(attr);return len(doc['accessors'])-1
        for name,props in self.palette.items():
            m={'name':name,'pbrMetallicRoughness':{'baseColorFactor':props['color']+[props['alpha']],
               'metallicFactor':props['metal'],'roughnessFactor':props['rough']},'doubleSided':True}
            if name in COATED:m['pbrMetallicRoughness']['baseColorTexture']={'index':0}
            if props['alpha']<1:m['alphaMode']='BLEND'
            if name.endswith('light'):m['emissiveFactor']=props['color']
            doc['materials'].append(m)
        data=defaultdict(list)
        for group,obj,slots in self.parts3d:
            mesh=obj.data;mesh.calc_loop_triangles();norms=mesh.corner_normals
            for tri in mesh.loop_triangles:
                mat=slots[tri.material_index];rows=data[group,mat]
                coords=[mesh.vertices[j].co for j in tri.vertices]
                geometric=(coords[1]-coords[0]).cross(coords[2]-coords[0])
                if geometric.length<1e-9:continue
                for i,li in zip(tri.vertices,tri.loops):
                    p=mesh.vertices[i].co;n=norms[li].vector
                    if not .98<n.length<1.02:n=geometric.normalized()
                    row=[p.x,p.z,-p.y,round(n.x,5),round(n.z,5),round(-n.y,5)]
                    if mat in COATED:
                        normal=tri.normal;row.extend(uv_for(row[:3],(normal.x,normal.z,-normal.y)))
                    rows.append(row)
        for group,center in self.pivots.items():
            prim=[]
            for mat in names:
                rows=data[group,mat]
                if not rows:continue
                vertices,idx=np.unique(np.array(rows,dtype='<f4'),axis=0,return_inverse=True)
                attrs={'POSITION':write(vertices[:,:3],'<f4','VEC3',5126,34962,True),'NORMAL':write(vertices[:,3:6],'<f4','VEC3',5126,34962)}
                if mat in COATED:attrs['TEXCOORD_0']=write(vertices[:,6:8],'<f4','VEC2',5126,34962)
                prim.append({'attributes':attrs,'indices':write(idx.ravel(),'<u2','SCALAR',5123,34963),'material':names.index(mat)})
            doc['nodes'][0]['children'].append(len(doc['nodes']));doc['nodes'].append({'name':group,'translation':list(center),'mesh':len(doc['meshes'])})
            doc['meshes'].append({'name':group+' surfaces','primitives':prim})
        buf.extend(b'\0'*(-len(buf)%4));offset=len(buf);buf.extend(self.paint_atlas)
        view=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(self.paint_atlas)})
        doc['images']=[{'name':self.code+' service-panel finish','bufferView':view,'mimeType':'image/png'}]
        doc['samplers']=[{'magFilter':9729,'minFilter':9987,'wrapS':33071,'wrapT':33071}]
        doc['textures']=[{'sampler':0,'source':0}]
        buf.extend(b'\0'*(-len(buf)%4));doc['buffers']=[{'byteLength':len(buf)}]
        js=json.dumps(doc,separators=(',',':'),ensure_ascii=True).encode();js+=b' '*(-len(js)%4)
        content=struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(buf),0x004e4942)+buf
        target=path.with_suffix('.tmp');target.write_bytes(struct.pack('<III',0x46546c67,2,12+len(content))+content);target.replace(path)
