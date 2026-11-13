"""Rebuild the edit library: blender --background --factory-startup --python build_library.py"""
import bpy
import json
import subprocess
from pathlib import Path
from mathutils import Vector

folder = Path(__file__).resolve().parent
output = folder / '해온-교량.blend'
payload = json.loads(subprocess.check_output(['node', str(folder / 'export-game.mjs')], cwd=folder))
scene = bpy.context.scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for col in list(bpy.data.collections):
    bpy.data.collections.remove(col)
scene.unit_settings.system = 'METRIC'
scene.unit_settings.length_unit = 'METERS'
scene.unit_settings.scale_length = 1
scene['게임 도시'] = payload['cityId']
scene['원본 좌표'] = 'Three.js X/Y/Z → Blender X/−Z/Y (m). 각 모델은 비교를 위해 평행 이동했습니다.'

materials = {}
def material(part):
    rgb = part['rgb']
    key = (part['finish'], *rgb)
    if key in materials:
        return materials[key]
    m = bpy.data.materials.new(part['finish'] + ' · ' + ''.join(f'{c:02x}' for c in rgb))
    rgba = (*[c/255 for c in rgb], 1.)
    m.diffuse_color = rgba
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba
    glazed = part['finish'] in {'glass','shop'}
    metallic = part['finish'] in {'metal','강선·보강재','난간·강재','트러스 현·복재','아치 리브·연결재','케이블 정착구'}
    bsdf.inputs['Roughness'].default_value = .23 if glazed else .44 if metallic else .72
    bsdf.inputs['Metallic'].default_value = .48 if metallic else .1 if glazed else 0.
    materials[key] = m
    return m

def collect(name, parent):
    col = bpy.data.collections.new(name)
    parent.children.link(col)
    return col

# All structures retain their original orientation in their own local frame.
offsets = {'타이드 아치교':(-28,-62,0),'사장교':(-28,46,0),
           '콘크리트 거더교':(-28,-24,0),'워런 트러스교':(-28,10,0),'연결교 사옥':(83,-2,0)}
for item in payload['models']:
    name = item['name']
    col = collect(name,scene.collection)
    for key,value in item['metadata'].items():
        col[key] = value
    col['game_triangles'] = item['triangles']
    sections = {}
    for i,part in enumerate(item['parts']):
        kind = part['category']
        if kind not in sections:
            sections[kind] = collect(name+' · '+kind,col)
        obj_name = f"{name} · {part['finish']} {i+1:02}"
        mesh = bpy.data.meshes.new(obj_name)
        mesh.from_pydata(part['points'], [], part['faces'])
        obj = bpy.data.objects.new(obj_name,mesh)
        sections[kind].objects.link(obj)
        obj.location = offsets[name]
        obj['source_part'] = i
        mesh.materials.append(material(part))
        mesh.polygons.foreach_set('use_smooth',[True]*len(mesh.polygons))
        mesh.normals_split_custom_set(part['normals'])
        palette = mesh.color_attributes.new(name='Game color',type='FLOAT_COLOR',domain='POINT')
        color = [v/255 for v in part['rgb']]+[1.]
        palette.data.foreach_set('color',color*len(mesh.vertices))
        mesh.color_attributes.active_color = palette
        mesh.update()

for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            space = area.spaces.active
            space.clip_end = 1400
            space.shading.type = 'SOLID'
            space.shading.color_type = 'MATERIAL'
            space.shading.light = 'STUDIO'
            space.shading.show_cavity = True
            space.shading.cavity_type = 'WORLD'
            space.overlay.show_floor = False
            space.overlay.show_axis_x = False
            space.overlay.show_axis_y = False
            region = space.region_3d
            region.view_perspective = 'ORTHO'
            region.view_rotation = Vector((-.24, .65,-.79)).to_track_quat('-Z','Y')
            region.view_location = (0,0,28)
            region.view_distance = 240
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(output),compress=True)

# Validate the saved file, including every triangle's three local coordinates,
# material color, and the dimensions across both structural and road meshes.
bpy.ops.wm.open_mainfile(filepath=str(output))
assert bpy.context.scene.unit_settings.system=='METRIC'
for item in payload['models']:
    col=bpy.data.collections[item['name']]
    bounds=[float('inf')]*3+[float('-inf')]*3
    total=0
    for obj in col.all_objects:
        part=item['parts'][obj['source_part']]
        mesh=obj.data
        assert tuple(obj.location)==offsets[item['name']]
        assert len(mesh.polygons)==len(part['faces'])
        for v,xyz in zip(mesh.vertices,part['points'],strict=True):
            assert all(abs(v.co[k]-xyz[k])<1e-5 for k in range(3))
            for k in range(3):
                bounds[k]=min(bounds[k],v.co[k])
                bounds[k+3]=max(bounds[k+3],v.co[k])
        for poly,indices in zip(mesh.polygons,part['faces'],strict=True):
            assert tuple(poly.vertices)==tuple(indices)
        rgb=mesh.materials[0].diffuse_color
        assert all(abs(rgb[k]-part['rgb'][k]/255)<1e-6 for k in range(3))
        assert mesh.color_attributes.get('Game color') and mesh.has_custom_normals
        total+=len(mesh.polygons)
    assert total==item['triangles']
    assert all(abs(x-y)<1e-5 for x,y in zip(bounds,item['bounds']))
    print('VERIFIED', item['name'], total, 'triangles, XYZ metres:',
          tuple(round(bounds[k+3]-bounds[k],4) for k in range(3)), 'objects:',len(col.all_objects))
