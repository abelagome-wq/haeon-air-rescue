"""Author three civilian air-taxi passengers. Blender 4.5, metres, facing -Y.
Run Blender in background with -P build_guest_passengers.py.
"""
import importlib.util
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("traffic_people", HERE / "build_traffic_people.py")
traffic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(traffic)
base = traffic.base
V = Vector

# Each guest has a different silhouette, face proportions, palette and carry prop.
GUESTS = {
    "Surveyor": ("office", .969, ["AB7459","8A5B48","342921","514138","39756E","214E4C","A88F75","8E715D","593F39","F3E1C6","B9D0C3"]),
    "Delegate": ("office", 1.058, ["AC806E","86594E","55514F","A6A199","283F5B","233047","485565","344051","392E2D","E5E9DB","748695"]),
    "Traveler": ("senior", 1.005, ["C09077","9B6E59","584637","A29481","BD7542","91583A","3E5354","304445","675146","ECDED0","D6A77D"]),
}


def set_color(material, hexcolor):
    rgb = [int(hexcolor[i:i+2], 16) / 255 for i in (0, 2, 4)]
    rgb = tuple(c/12.92 if c < .04045 else ((c+.055)/1.055)**2.4 for c in rgb)+(1,)
    material.diffuse_color = rgb
    material.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value=rgb


def detail_palette(guest, role):
    materials=base.palette("civilian" if guest=="Surveyor" else "medic")
    # Keep sculpted hair; export skin/cloth with one lightable vertex-colour material.
    for key,color in zip(("skin","skin shadows","hair","hair highlights","fabric","fabric dark","pants",
                          "pants dark","boots","undershirt","seam"), GUESTS[guest][2]):
        set_color(materials[key],color)
        shader=materials[key].node_tree.nodes.get("Principled BSDF")
        for link in list(shader.inputs["Base Color"].links):materials[key].node_tree.links.remove(link)
    for key,color in {"sole":"332D2B","handbag":"AF754F","linen":"DED6BC","strap":"694A3B","gold":"BEA580",
                      "leather trim":"835A46","clasp":"A3ADA7","thread":"BDB7A9","scarf":"BE594A",
                      "dark scarf":"94443D","badge":"D5DFDD","lens":"94AEC0","ocular":"464340"}.items():
        materials[key]=base.material(key,color)
    return materials


def tube(g,pts,r,mat,bone,n=7):
    traffic.curve(g,pts,r,mat,bone,n)


def hair_and_face(g,m,guest):
    # Comb short locks over the actual swept scalp rather than laying flat
    # strokes across the forehead in an unrelated projection.
    cap=[V(p)/g.factor for p in g.v[:360]]
    def scalp(row,slot):
        a=math.floor(slot);f=slot-a
        p=cap[row*36+a%36].lerp(cap[row*36+(a+1)%36],f)
        out=V((p.x,p.y-.006,.25*(p.z-1.56))).normalized()
        return p+out*.0016
    for k in range(30):
        a=k*36/30
        pts=[scalp(row,a+(.48 if guest=='Surveyor' else -.72)*row*(1-row/12)) for row in range(0,9)]
        tube(g,pts,.0016 if guest=='Delegate' else .0020,
             m["hair highlights"] if k%4==0 else m["hair"],"Head",5)
    for s in (-1,1):
        x=s*.034
        # Project the pupils, lash line and lip corner very slightly past the
        # cheek skin so the glTF depth buffer cannot hide them at walking distance.
        g.ball((x,-.095,1.589),(.0053,.0027,.0041),m["ocular"],"Head",12,6)
        tube(g,[(x-.014,-.091,1.589),(x-.006,-.095,1.592),(x+.004,-.095,1.593),
                (x+.014,-.091,1.589)],.00115,m["lash"],"Head",6)
    tube(g,[(-.022,-.086,1.521),(-.009,-.092,1.521),(0,-.093,1.520),
            (.010,-.091,1.521),(.022,-.086,1.523)],.0015,m["skin shadows"],"Head",6)
    # Restrained modelled locks add a different hairline and side silhouette.
    if guest=="Surveyor":
        g.ball((0,.099,1.597),(.062,.042,.053),m["hair"],"Head",16,9)
        g.ball((0,.122,1.577),(.051,.035,.054),m["hair"],"Head",16,9)
        for s in (-1,1):
            g.ball((s*.086,.006,1.55),(.004,.004,.005),m["gold"],"Head",8,5)
            for j in range(4):
                tube(g,[(s*(.039+.009*j),-.061,1.671-j*.004),(s*(.070+.004*j),-.007,1.652-j*.006),
                        (s*(.071+.003*j),.056,1.617-j*.006),(s*.045,.094,1.597)],.003,m["hair highlights"] if j==2 else m["hair"],"Head")
    elif guest=="Delegate":
        for s in (-1,1):
            for j in range(4):
                tube(g,[(s*.077,-.032,1.639-j*.006),(s*.086,-.010,1.627-j*.004),
                        (s*.088,.038,1.609-j*.004)],.0028,m["hair highlights"],"Head")
            tube(g,[(s*.018,-.099,1.54),(s*.032,-.088,1.529),(s*.036,-.080,1.518)],.00095,m["skin shadows"],"Head",5)
        for j in range(7):
            tube(g,[(-.049+j*.012,-.032,1.698),(-.044+j*.012,-.060,1.679),
                    (-.061+j*.012,-.077,1.651)],.004,m["hair"],"Head")
    else:
        # Individually rimmed lenses with an open centre, not opaque plates over the eyes.
        for s in (-1,1):
            pts=[(s*.035+.024*math.cos(i*math.tau/16),-.1025,1.587+.015*math.sin(i*math.tau/16)) for i in range(17)]
            tube(g,pts,.0018,m["ocular"],"Head",6)
            tube(g,[(s*.058,-.102,1.594),(s*.079,-.071,1.598),(s*.091,.005,1.574)],.0017,m["ocular"],"Head",6)
            for j in range(3):
                tube(g,[(s*.079,-.038,1.634-j*.004),(s*.088,-.004,1.618-j*.004),
                        (s*.082,.039,1.585+j*.003)],.0024,m["hair highlights"],"Head")
        tube(g,[(-.011,-.102,1.588),(0,-.106,1.594),(.011,-.102,1.588)],.0018,m["ocular"],"Head",6)


def garments(g,m,guest,arms):
    if guest=="Delegate":
        traffic.collared_neck(g,m,m["undershirt"])
        g.patch([(-.063,-.081,1.425),(.063,-.081,1.425),(0,-.125,1.195)],m["undershirt"],"Chest")
        for s in (-1,1):
            g.patch([(s*.069,-.071,1.432),(s*.132,-.086,1.376),(s*.086,-.110,1.352),
                     (s*.109,-.114,1.322),(s*.004,-.12,1.159)],m["fabric dark"],"Chest")
            g.strip((s*.08,-.102,1.059),(s*.135,-.080,1.067),.012,.005,m["seam"],"Spine")
        g.patch([(-.012,-.107,1.391),(.012,-.107,1.391),(.017,-.124,1.255),(0,-.12,1.224),
                 (-.016,-.124,1.255)],m["scarf"],"Chest")
        g.ball((.010,-.118,1.146),(.005,.004,.005),m["clasp"],"Spine",8,5)
        wrist=arms[1][3]
        p=wrist+V((0,.013,-.178))
        traffic.rounded_case(g,p,.075,.267,.223,m["strap"],"Hand.L")
        for h in (-.09,.09):
            tube(g,[p+V((.035,h,.102)),p+V((.042,h,0)),p+V((.035,h,-.1))],.0024,m["leather trim"],"Hand.L")
        tube(g,[p+V((.001,-.050,.110)),wrist+V((0,-.043,-.026)),
                wrist+V((0,.046,-.024)),p+V((.001,.053,.110))],.006,m["strap"],"Hand.L")
    elif guest=="Surveyor":
        traffic.collared_neck(g,m,m["fabric dark"])
        # Utility jacket with stand collar, riveted chest pocket and cross-body satchel.
        tube(g,[(.012,-.094,1.401),(.012,-.117,1.207),(.012,-.102,.985)],.0035,m["clasp"],"Chest")
        for s in (-1,1):
            g.box((s*.096,-.095,1.273),(.075,.012,.058),m["fabric dark"],"Chest")
            g.strip((s*.064,-.101,1.301),(s*.128,-.094,1.296),.012,.004,m["seam"],"Chest")
        g.strip((.117,-.071,1.420),(.032,-.128,1.255),.028,.009,m["strap"],"Chest")
        g.strip((.032,-.128,1.255),(-.113,-.112,.966),.028,.009,m["strap"],"Spine")
        g.strip((-.113,-.112,.966),(-.161,-.060,.878),.028,.009,m["strap"],"Pelvis")
        traffic.rounded_case(g,(-.171,-.039,.873),.083,.198,.178,m["handbag"],"Pelvis")
        g.box((-.214,-.039,.902),(.008,.171,.063),m["leather trim"],"Pelvis")
        g.box((-.219,-.038,.874),(.005,.019,.019),m["clasp"],"Pelvis")
    else:
        # An open scarf follows the shoulders and falls to the upper chest.
        g.vertical([(0,-.004,1.399,.076,.061),(0,-.003,1.426,.077,.065),
                    (0,.000,1.444,.056,.049)],m["scarf"],"Chest",20)
        g.patch([(-.050,-.074,1.431),(-.004,-.085,1.427),(.107,-.104,1.207),
                 (.071,-.119,1.183)],m["scarf"],"Chest")
        g.patch([(-.046,-.078,1.417),(-.017,-.096,1.394),(-.071,-.115,1.232),
                 (-.103,-.100,1.239)],m["dark scarf"],"Chest")
        for s in (-1,1):
            g.strip((s*.07,-.100,1.112),(s*.134,-.075,1.146),.016,.008,m["fabric dark"],"Spine")
        # Shoulder straps and a rounded two-compartment canvas daypack.
        traffic.rounded_case(g,(0,.142,1.188),.244,.114,.292,m["pants"],"Spine")
        traffic.rounded_case(g,(0,.204,1.135),.184,.042,.144,m["pants dark"],"Spine")
        for s in (-1,1):
            tube(g,[(s*.108,.146,1.284),(s*.128,.064,1.387),(s*.123,-.051,1.408),
                    (s*.148,-.081,1.302),(s*.164,-.040,1.183)],.013,m["strap"],"Chest",8)


def animate_wait(rig,guest):
    def key(bone,axis,degrees,frame):
        p=rig.pose.bones[bone];p.rotation_mode="QUATERNION"
        vec=p.bone.matrix_local.to_3x3().inverted()@V(axis)
        p.rotation_quaternion=Quaternion(vec.normalized(),math.radians(degrees))
        p.keyframe_insert(data_path="rotation_quaternion",frame=frame,group=bone)
    for f,b in [(1,0),(27,1),(55,0),(83,-1),(109,0)]:
        key("Chest",(1,0,0),b*.95,f);key("Head",(0,0,1),b*(7 if guest=="Surveyor" else 4),f)
        key("Spine",(0,1,0),b*.7,f)
        key("UpperArm.R",(0,1,0),b*2,f);key("Forearm.R",(1,0,0),-4+b*2.4,f)
    rig.animation_data.action.name="Await pickup"


def seated_pose(rig,compact):
    # Aim in the rig's world axes; the authored legs bend forward of the
    # cushion, then down to the cabin floor without flattening the hips.
    thigh,shin=(-117,90) if compact else (-95,95)
    for side in ('.L','.R'):
        for joint,degrees in (('Thigh',thigh),('Shin',shin),('Foot',-thigh-shin),('Forearm',-39)):
            p=rig.pose.bones[joint+side];p.rotation_mode='QUATERNION'
            axis=p.bone.matrix_local.to_3x3().inverted()@V((1,0,0))
            p.rotation_quaternion=Quaternion(axis.normalized(),math.radians(degrees))
            for frame in (1,25):p.keyframe_insert(data_path='rotation_quaternion',frame=frame,group=joint+side)
    rig.animation_data.action.name='High floor seat' if compact else 'Cabin seat'


def portrait(guest,scale):
    sc=bpy.context.scene;sc.render.engine='CYCLES';sc.cycles.samples=16;sc.cycles.use_denoising=True
    sc.render.resolution_x=180;sc.render.resolution_y=206;sc.render.resolution_percentage=100
    sc.render.film_transparent=True;sc.render.image_settings.color_mode='RGBA'
    world=bpy.data.worlds.new("Cabin portrait ambient");sc.world=world;world.use_nodes=True
    world.node_tree.nodes['Background'].inputs['Color'].default_value=(.65,.80,1.,1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value=.56
    target=V((0,-.01,1.565))*scale
    def aim(o,loc):
        o.location=target+V(loc);o.rotation_euler=(target-o.location).to_track_quat("-Z","Y").to_euler()
    for title,offset,power,col,span in [('key',(-.62,-.71,1.18),65,(1.,.88,.78),.83),('bounce',(.75,-.38,.49),34,(.7,.86,1),.83),('rim',(.29,.82,.53),44,(.67,.87,1),.59)]:
        light=bpy.data.lights.new(title,'AREA');light.energy=power;light.color=col;light.shape='DISK';light.size=span
        ob=bpy.data.objects.new(title,light);sc.collection.objects.link(ob);aim(ob,offset)
    cam=bpy.data.cameras.new('Portrait camera');ob=bpy.data.objects.new('Portrait camera',cam);sc.collection.objects.link(ob);sc.camera=ob
    aim(ob,(.33,-1.65,.12));cam.type='ORTHO';cam.ortho_scale=.49*scale
    cabin = HERE.parents[2]/'remake/art/cabin'
    cabin.mkdir(parents=True, exist_ok=True)
    sc.render.filepath=str(HERE.parents[2]/'remake/art/cabin'/('guest-'+guest.lower()+'.png'))
    bpy.ops.render.render(write_still=True)


def build(guest):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    role,scale,_=GUESTS[guest];name="Passenger-"+guest
    scene=bpy.context.scene;scene.render.fps=24;scene.unit_settings.system='METRIC'
    coll=bpy.data.collections.new(name);scene.collection.children.link(coll)
    arms,legs=traffic.landmarks(role)
    # Both waiting poses have relaxed lowered arms. Cargo follows its wearer.
    if guest=="Traveler":arms,_=traffic.landmarks("office")
    rig=base.rig_character(role,coll,scale,arms,legs);rig.name=name+' | rig'
    mats=detail_palette(guest,role)
    skin=base.SkinMesh('Skin, ears and hands',rig,coll,scale)
    body=base.SkinMesh('Jacket, articulated sleeves, trousers and shoes',rig,coll,scale)
    hair=base.SkinMesh('Face and hair',rig,coll,scale)
    base.face('civilian' if guest=="Surveyor" else 'medic',skin,hair,mats)
    hair_and_face(hair,mats,guest)
    topo=traffic.fitted_shirt(body,mats,arms)
    traffic.smart_boots(body,mats,legs,'office')
    base.arms_hands('generic',skin,body,mats,arms);base.trousers('generic',body,mats,legs)
    detail=traffic.TailoredDetails('Accessories, tailoring and luggage',rig,coll,scale,traffic.FrontSurface(topo))
    garments(detail,mats,guest,arms)
    objects=[g.finish() for g in (skin,hair,body,detail)]
    traffic.transform_shape(rig,role,scale,objects)
    # Distinct cranial profiles: a narrower jaw, broad mature jaw, or higher cheekbones.
    for ob in objects[:2]:
        for v in ob.data.vertices:
            z=v.co.z/scale
            if z<1.46:continue
            low=max(0,min(1,(1.61-z)/.15));v.co.x*=1+low*({'Surveyor':-.05,'Delegate':.055,'Traveler':-.015}[guest])
    # One mesh and one palette material in the deployable skin. Each triangle
    # keeps the material shade from the editable source including eyes and seams.
    for ob in objects:
        attr=ob.data.color_attributes.new(name="Garment colour",type="BYTE_COLOR",domain="CORNER")
        for poly in ob.data.polygons:
            col=ob.data.materials[poly.material_index].diffuse_color
            for loop in poly.loop_indices:
                attr.data[loop].color=col
    traffic.action(rig,'office');walk=rig.animation_data.action;walk.name='Walk to aircraft';walk.use_fake_user=True
    rig.animation_data.action=None
    for bone in rig.pose.bones:bone.matrix_basis=Matrix.Identity(4)
    animate_wait(rig,guest);idle=rig.animation_data.action;idle.use_fake_user=True
    stash=rig.animation_data.nla_tracks.new();stash.name='Stored footfall cycle';stash.mute=True
    stash.strips.new(walk.name,1,walk)
    for compact in (False,True):
        rig.animation_data.action=None
        for bone in rig.pose.bones:bone.matrix_basis=Matrix.Identity(4)
        seated_pose(rig,compact);seat=rig.animation_data.action;seat.use_fake_user=True
        stored=rig.animation_data.nla_tracks.new();stored.name=seat.name;stored.mute=True
        stored.strips.new(seat.name,1,seat)
    for bone in rig.pose.bones:bone.matrix_basis=Matrix.Identity(4)
    rig.animation_data.action=idle;scene.frame_end=109;scene.frame_set(1)
    bpy.context.preferences.filepaths.save_version=0
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                sp=area.spaces.active;sp.shading.color_type='MATERIAL';sp.region_3d.view_distance=2.7;sp.region_3d.view_location=(0,0,.93)
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE/(name+'.blend')),compress=True)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join()
    mesh=bpy.context.object;mesh.name=name+' | travel clothes'
    mat=bpy.data.materials.new("Skin and travel clothes");mat.use_nodes=True
    bs=mat.node_tree.nodes['Principled BSDF'];bs.inputs['Roughness'].default_value=.82;bs.inputs['Specular IOR Level'].default_value=.23
    vc=mat.node_tree.nodes.new('ShaderNodeVertexColor');vc.layer_name='Garment colour'
    mat.node_tree.links.new(vc.outputs['Color'],bs.inputs['Base Color'])
    mesh.data.materials.clear();mesh.data.materials.append(mat)
    for uv in list(mesh.data.uv_layers):mesh.data.uv_layers.remove(uv)
    rig.select_set(True)
    path=HERE/'lod1'/(name+'-LOD1.glb')
    path.parent.mkdir(exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(path),use_selection=True,export_format='GLB',export_vertex_color='ACTIVE',
        export_animations=True,export_animation_mode='ACTIONS',export_skins=True,export_texcoords=False,export_tangents=False,
        export_extras=False,export_def_bones=False)
    base.finalize_skin_roots(path)
    pack_spec=importlib.util.spec_from_file_location("pack_guests",HERE/"pack_guests.py")
    packer=importlib.util.module_from_spec(pack_spec);pack_spec.loader.exec_module(packer);packer.pack(path)
    portrait(guest,scale)
    print('Finished guest',guest,path.stat().st_size,flush=True)

for guest in GUESTS:build(guest)

