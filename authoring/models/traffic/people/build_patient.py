"""Blender 4.5: blender -b -P build_patient.py. Dimensions are in metres.

The native scene retains the individual anatomy, garments and litter components.
The two game meshes use one vertex-colour material each; no runtime skinning.
"""
import importlib.util
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
(HERE / "lod1").mkdir(exist_ok=True)
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("people", HERE.parents[1] / "world/people/build_people.py")
people = importlib.util.module_from_spec(spec)
spec.loader.exec_module(people)
V = Vector
TAU = math.tau

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.render.fps = 24
scene.frame_end = 85
skin = people.palette("civilian")
palette = {key: mat.diffuse_color[:] for key, mat in skin.items()}
for key, color in {
    "shirt":"B56D4D","shirt seam":"DC9272","shirt shadow":"8B503F","tee":"E9D8AE",
    "denim":"485D6B","denim light":"617B86","garment fold":"354953","shoe":"594A41",
    "sole":"342F2F","lace":"E1CBA9","tread":"6E6356","bandage":"EADDC3","bandage seam":"BDAA92",
    "canvas":"D77F37","canvas edge":"EBAB61","pad":"52696D","alloy":"A8B5B3","tire":"343839",
    "webbing":"35464B","buckle":"B8B9AB","jacket":"485558","tape":"F1CF7D"
}.items():
    palette[key] = people.material(key, color).diffuse_color[:]

mat = bpy.data.materials.new("Fabric, skin and equipment colours")
mat.use_nodes = True
bs = mat.node_tree.nodes.get("Principled BSDF")
bs.inputs["Roughness"].default_value = .84
vcol = mat.node_tree.nodes.new("ShaderNodeVertexColor")
vcol.layer_name = "Colour"
mat.node_tree.links.new(vcol.outputs["Color"], bs.inputs["Base Color"])


def collection(name):
    c = bpy.data.collections.new(name)
    scene.collection.children.link(c)
    return c


patient = collection("Patient – resting, head turned to the left")
litter = collection("Collapsible wheeled rescue litter")


class Part(people.SkinMesh):
    def __init__(self, name, coll=patient):
        super().__init__(name, None, coll, 1)

    def path(self, points, color, n=16):
        self.follow([(p, w, d, "Static") for p, w, d in points], color, n)

    def line(self, coords, radius, color, n=8):
        for a, b in zip(coords, coords[1:]):
            self.tube(a, b, radius, color, "Static", n=n)

    def finish(self):
        me = bpy.data.meshes.new(self.name)
        me.from_pydata(self.v, [], self.faces)
        me.update()
        obj = bpy.data.objects.new(self.name, me)
        self.coll.objects.link(obj)
        me.materials.append(mat)
        attr = me.color_attributes.new(name="Colour", type="BYTE_COLOR", domain="POINT")
        for poly, color_index, smooth in zip(me.polygons, self.mat_indices, self.smooth):
            color = palette[self.mats[color_index]]
            for idx in poly.vertices:
                attr.data[idx].color = color
            poly.use_smooth = smooth
        return obj


def face():
    head = Part("Face, ears, lips, eyelids and hair")
    # The reusable face is built upright. Rotate about the jaw, through a
    # comfortable recline, and turn toward the patient's left.
    people.face("medic", head, head, {k:k for k in skin})
    # Side part and tapering locks break up the scalp outline from the forward
    # cockpit and overhead views. Each lock follows the skull rather than
    # making a separate, spherical hair cap.
    for k in range(9):
        x=-.064+k*.014
        brow=1.634+.013*math.cos(k*.52)
        head.path([((x+.021,-.042,1.699-.010*abs(k-4)/4),.013,.008),
                   ((x+.007,-.075,1.675-.008*abs(k-4)/4),.012,.009),
                   ((x-.008,-.088+.017*abs(k-4)/4,brow+.010),.009,.006),
                   ((x-.014,-.090+.017*abs(k-4)/4,brow),.002,.003)],
                  "hair highlights" if k in (3,7) else "hair",10)
    for s in (-1,1):
        head.path([((s*.084,-.034,1.643),.011,.010),((s*.088,-.027,1.612),.008,.008),
                   ((s*.088,-.018,1.590),.004,.005)],"hair",10)
    angle = math.radians
    tilt = Matrix.Rotation(angle(-62),3,"X") @ Matrix.Rotation(angle(18),3,"Z")
    jaw = V((0,-.006,1.470))
    head.v = [V((-.017,.565,.191)) + tilt @ (V(p)-jaw) for p in head.v]
    head.finish()


def chest():
    g = Part("Open rust overshirt, ivory T-shirt and collar")
    # Cross-sections follow the spine. The back rests on the ground and the
    # anterior surface rises from the abdomen to the sternum.
    sections = [(-.135,.115,.157,.100),(-.09,.113,.174,.102),(.005,.116,.152,.102),
                (.065,.117,.162,.102),(.16,.120,.173,.110),(.26,.125,.192,.118),
                (.33,.129,.207,.118),(.401,.129,.204,.114),(.447,.139,.183,.098),
                (.475,.152,.149,.083),(.495,.156,.098,.072),(.514,.156,.058,.058)]
    def surface(row, theta, lift=0):
        y,z,w,h=row
        return (w*math.sin(theta),y,z+(h+lift)*math.cos(theta))
    n=32
    # Top facing towards +Z, side towards +/-X.
    g.rings([[surface(row,TAU*i/n) for i in range(n)] for row in sections],
            "tee",["Static"]*len(sections))
    for s in (-1,1):
        def edge(y):
            return .12 + max(0,y-.20)*1.9 + max(0,-y)*.40
        rows = []
        for row in sections[:-1]:
            opening=edge(row[0])
            rowpoints=[surface(row,s*(opening+(math.pi-opening)*i/18),.008) for i in range(19)]
            rows.append(rowpoints)
        quads=[]
        for row in range(len(rows)-1):
            for i in range(18):
                a=row*19+i;b=a+19
                quad=[a,b,b+1,a+1]
                if s>0:quad.reverse()
                quads.append(quad)
        g.add([p for row in rows for p in row],quads,"shirt","Static")
        g.line([r[0] for r in rows],.004,"shirt seam")
        lapel=[rows[-1][0],surface(sections[8],s*.88,.014),surface(sections[6],s*.43,.017),
               surface(sections[9],s*.46,.016)]
        if s<0:lapel.reverse()
        g.add(lapel,[(0,1,2,3)],"shirt shadow","Static")
        # Stitch and button detail tracks the garment surface.
        for idx in (2,4,6):
            p=surface(sections[idx],s*(edge(sections[idx][0])+.05),.013)
            if s==1:g.ball(p,(.005,.005,.002),"lace","Static",8,4)
    g.finish()


def legs():
    g=Part("Jeans with articulated knees, hems and pocket seams")
    g.path([((0,-.153,.105),.140,.096),((0,-.11,.112),.179,.104),
            ((0,-.063,.115),.179,.107),((0,-.033,.118),.16,.100)],"denim",22)
    for s in (-1,1):
        hip=V((s*.088,-.095,.115))
        knee=V((s*(.156 if s<0 else .119),-.462,.217 if s<0 else .107))
        ankle=V((s*(.19 if s<0 else .099),-.794 if s<0 else -.855,.056))
        def at(a,b,f):return a.lerp(b,f)
        g.path([(hip,.103,.096),(at(hip,knee,.18),.102,.098),(at(hip,knee,.56),.087,.080),
                (at(hip,knee,.84),.074,.068),(knee,.069,.064),(at(knee,ankle,.12),.067,.062),
                (at(knee,ankle,.33),.073,.066),(at(knee,ankle,.61),.061,.053),
                (at(knee,ankle,.90),.052,.044),(ankle,.052,.044)],"denim",20)
        for f in (.14,.82):
            p=at(knee,ankle,f)
            g.line([p+V((-.041,-.004,.038)),p+V((-.009,0,.059)),p+V((.035,.013,.048))],
                   .0031,"denim light")
        g.line([hip+V((s*.089,0,.028)),at(hip,knee,.55)+V((s*.083,0,.023)),
                knee+V((s*.067,0,.012)),at(knee,ankle,.44)+V((s*.065,0,.012)),
                ankle+V((s*.044,0,.022))],.0026,"denim light")
        # Shoes tilt upright at the toe in a supine posture.
        he=ankle+V((0,-.07,-.026));toe=he+V((s*.018,-.105,.131))
        g.path([(ankle+V((0,.032,.010)),.049,.044),(ankle,.052,.044),
                (he.lerp(toe,.16),.055,.047),(he.lerp(toe,.35),.055,.045)],"shoe",16)
        g.path([(he,.045,.036),(he.lerp(toe,.28),.054,.047),(he.lerp(toe,.60),.057,.045),
                (he.lerp(toe,.85),.055,.037),(toe,.043,.025)],"shoe",16)
        g.path([(he+V((0,-.028,0)),.045,.015),(he.lerp(toe,.4)+V((0,-.039,0)),.055,.019),
                (toe+V((0,-.024,0)),.048,.016)],"sole",16)
        for f in (.38,.51,.64):
            p=he.lerp(toe,f)+V((0,.032,.020))
            g.line([p+V((-.034,0,0)),p+V((.034,0,.009))],.0032,"lace")
    g.finish()


def hands_and_sleeves():
    g=Part("Rolled sleeves, forearms, wrist dressing and separated fingers")
    for s in (-1,1):
        sh=V((s*.170,.39,.138))
        el=V((s*(.260 if s<0 else .241),.139,.089 if s<0 else .126))
        wrist=V((s*.119,-.027,.245)) if s>0 else V((-.305,-.099,.055))
        g.path([(sh+V((-s*.025,.015,.005)),.095,.084),(sh,.093,.085),
                (sh.lerp(el,.32),.086,.077),(sh.lerp(el,.70),.072,.063),
                (sh.lerp(el,.87),.067,.059)],"shirt",20)
        g.path([(sh.lerp(el,.76),.071,.065),(sh.lerp(el,.84),.073,.064),
                (sh.lerp(el,.91),.068,.061)],"shirt seam",18)
        g.path([(sh.lerp(el,.76),.054,.053),(el,.051,.048),(el.lerp(wrist,.21),.053,.048),
                (el.lerp(wrist,.47),.047,.041),(el.lerp(wrist,.79),.031,.030),
                (wrist,.027,.022)],"skin",16)
        if s>0:
            g.path([(el.lerp(wrist,.51),.045,.042),(el.lerp(wrist,.56),.045,.040),
                    (el.lerp(wrist,.77),.037,.032)],"bandage",18)
            for f in (.56,.65,.75):
                g.path([(el.lerp(wrist,f),.045-(f-.56)*.033,.043-(f-.56)*.039),
                        (el.lerp(wrist,f+.014),.045-(f-.56)*.033,.043-(f-.56)*.039)],"bandage seam",18)
        axis=(V((-.53,-.84,-.08)) if s>0 else V((-.22,-.96,-.03))).normalized()
        across=V((-axis.y,axis.x,0)).normalized()
        palm=wrist+axis*.078
        g.path([(wrist,.026,.021),(wrist+axis*.032,.039,.021),
                (wrist+axis*.061,.040,.019),(palm,.035,.016)],"skin",16)
        for i,(off,length) in enumerate(zip((-.028,-.009,.010,.027),(.059,.068,.065,.049))):
            a=palm+across*off
            b=a+axis*(length*.53)+across*off*.10+V((0,0,-.002))
            end=b+axis*(length*.46)+across*off*.15+V((0,0,-.012))
            g.path([(a,.009,.008),(b,.008,.007),(b.lerp(end,.58),.007,.006),
                    (end,.004,.004)],"skin",9)
        thumb=wrist+axis*.025-across*s*.023
        g.path([(thumb,.015,.013),(thumb+axis*.021-across*s*.025,.012,.010),
                (thumb+axis*.049-across*s*.037,.007,.007)],"skin",10)
    g.finish()


def support():
    p=Part("Folded coat beneath the neck")
    p.ball((-.015,.642,.064),(.135,.122,.066),"jacket","Static",24,12)
    p.ball((-.018,.630,.092),(.117,.119,.045),"jacket","Static",24,10)
    p.finish()
    g=Part("Canvas bed and head pad",litter)
    outline=[(-.18,-.995),(.18,-.995),(.278,-.91),(.278,.68),(.205,.898),
             (-.205,.898),(-.278,.68),(-.278,-.91)]
    top=[(x,y,.418) for x,y in outline]
    bot=[(x,y,.385) for x,y in outline]
    g.add(bot+top,[(7,6,5,4,3,2,1,0),(8,9,10,11,12,13,14,15)]+
          [(i,(i+1)%8,8+(i+1)%8,8+i) for i in range(8)],"canvas","Static",False)
    g.line(top+[top[0]],.014,"canvas edge")
    for s in (-1,1):
        g.line([(s*.26,-.91,.383),(s*.26,.69,.383),(s*.16,.865,.383)],.018,"alloy")
        # Tow handles rise towards a standing attendant's lowered hand.
        g.line([(s*.196,-.95,.40),(s*.196,-1.065,.51),(s*.196,-1.22,.746)],.014,"alloy")
        g.line([(s*.196,-1.175,.682),(s*.196,-1.22,.746)],.020,"webbing")
        for y in (-.59,.51):
            g.line([(s*.23,y-.12,.373),(s*.20,y+.06,.116)],.016,"alloy")
            g.line([(s*.23,y+.16,.373),(s*.20,y+.06,.116)],.013,"alloy")
            x=s*.218
            g.tube((x-.019,y+.06,.093),(x+.019,y+.06,.093),.093,"tire","Static",n=18)
            g.tube((x-.022,y+.06,.093),(x+.022,y+.06,.093),.045,"alloy","Static",n=16)
    # Two retention belts follow the patient instead of disappearing inside the bed.
    for y,height,width in [(-.63,.186,.244),(-.095,.225,.201)]:
        curve=[(-.266,y,.422),(-width,y,.462),(-width*.73,y,.418+height*.80),
               (0,y,.418+height),(width*.73,y,.418+height*.80),(width,y,.462),(.266,y,.422)]
        for a,b in zip(curve,curve[1:]):
            g.add([(a[0],y-.019,a[2]),(a[0],y+.019,a[2]),(b[0],y+.019,b[2]),(b[0],y-.019,b[2])],
                  [(3,2,1,0)],"webbing","Static")
        g.box((.010,y,.418+height+.003),(.048,.043,.009),"buckle","Static")
    g.finish()


def breathing_shape(obj):
    obj.shape_key_add(name="Rest")
    inhaled=obj.shape_key_add(name="Shallow breath")
    for v in inhaled.data:
        x,y,z=v.co
        rise=math.exp(-((y-.295)/.24)**2-(x/.22)**4)*max(0,min(1,(z-.09)/.16))
        v.co.z+=.010*rise
    for frame,val in [(1,0),(28,.93),(37,1),(69,.06),(85,0)]:
        inhaled.value=val;inhaled.keyframe_insert("value",frame=frame)
    obj.data.shape_keys.animation_data.action.name="Resting breath"
    scene.frame_set(1)


def export(coll, stem, breathing):
    bpy.ops.object.select_all(action="DESELECT")
    copies=[]
    for src in coll.objects:
        obj=src.copy();obj.data=src.data.copy();scene.collection.objects.link(obj)
        copies.append(obj);obj.select_set(True)
    bpy.context.view_layer.objects.active=copies[0]
    if len(copies)>1:bpy.ops.object.join()
    obj=bpy.context.object
    obj.name=stem
    if breathing:breathing_shape(obj)
    path=HERE/"lod1"/(stem+"-LOD1.glb")
    bpy.ops.export_scene.gltf(filepath=str(path),use_selection=True,export_format="GLB",
                              export_vertex_color="ACTIVE",export_animations=breathing,export_yup=True,
                              export_animation_mode="ACTIONS",export_morph_normal=False)
    bpy.data.objects.remove(obj,do_unlink=True)


face()
chest()
legs()
hands_and_sleeves()
support()
export(patient,"Medevac-Patient",True)
export(litter,"Patient-Litter",False)
for part in patient.objects:
    if not part.name.startswith("Folded coat"):breathing_shape(part)
litter.hide_viewport=True
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=="VIEW_3D":
            space=area.spaces.active
            space.shading.color_type="VERTEX"
            space.region_3d.view_rotation=V((-1,-1,-.85)).to_track_quat("-Z","Y")
            space.region_3d.view_distance=2.6
            space.region_3d.view_location=(0,0,.14)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/"Medevac-Patient.blend"),compress=True)

# Retain the original project clinician's articulated facial geometry, hands
# and medical bag. Replace the stationary triage clip with a walking cycle.
spec = importlib.util.spec_from_file_location("traffic_people", HERE/"build_traffic_people.py")
traffic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(traffic)
bpy.ops.wm.open_mainfile(filepath=str(HERE.parents[1]/"world/people/Medevac-Paramedic.blend"))
rig=next(obj for obj in bpy.context.scene.objects if obj.type=="ARMATURE")
rig.animation_data_clear()
for action in list(bpy.data.actions):bpy.data.actions.remove(action)
for bone in rig.pose.bones:bone.matrix_basis=Matrix.Identity(4)
traffic.action(rig,"office")
rig.animation_data.action.name="Attendant walk"
mesh_objects=[obj for obj in bpy.context.scene.objects if obj.type=="MESH"]
bpy.ops.object.select_all(action="DESELECT")
for obj in mesh_objects:
    # Keep the editable materials in the paramedic's native authoring scene.
    # The mobile export shares one colour material for face, clothes and bag.
    attr=obj.data.color_attributes.new(name="Colour",type="BYTE_COLOR",domain="CORNER")
    for poly in obj.data.polygons:
        color=obj.data.materials[poly.material_index].diffuse_color
        for idx in poly.loop_indices:attr.data[idx].color=color
    obj.select_set(True)
bpy.context.view_layer.objects.active=mesh_objects[0]
bpy.ops.object.join()
mesh=bpy.context.object
mesh.data.materials.clear()
palette_mat=bpy.data.materials.new("Paramedic colour");palette_mat.use_nodes=True
vc=palette_mat.node_tree.nodes.new("ShaderNodeVertexColor");vc.layer_name="Colour"
palette_mat.node_tree.links.new(vc.outputs["Color"],palette_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
mesh.data.materials.append(palette_mat)
rig.select_set(True)
out=HERE/"lod1/Medevac-Responder-LOD1.glb"
bpy.ops.export_scene.gltf(filepath=str(out),use_selection=True,export_format="GLB",export_vertex_color="ACTIVE",
                          export_animations=True,export_animation_mode="ACTIONS",export_skins=True,export_def_bones=False)
people.finalize_skin_roots(out)
