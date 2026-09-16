"""Renders the Craftpix low-poly tower packs into the game's 2.5D sprites.

    python3 tools/build_pack_towers.py            # every family
    python3 tools/build_pack_towers.py archer orc # or just these

Each arena gets its own tower family so the defence you build looks like it
belongs to the place you are defending. A family is five models - one per
node level - taken from a single pack so the silhouette and the texture
atlas stay consistent as the tower grows. Level 0, the bare foundation, is
shared across every family and still comes from render_assets.py.

The models arrive as FBX with a 64px palette atlas and no lighting. They are
normalised to stand on z=0 centred on the origin, scaled so their projected
height matches the tower tier they replace, and rendered through the same
orthographic game camera as every other sprite in assets/.

Writes assets/tower_<family>_L<n>.png and assets/tower_packs.js.
"""
import json, math, os, sys, zipfile
import bpy
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render_assets import TILT, UNIT_PX, SS, reset_scene, render_to

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'assets')
PACKS = os.environ.get('PACKS', os.path.join(ROOT, 'packs'))

# The packs ship as zips, which is how they are kept in the repo - unpacked
# they are a thousand files of rig and engine variants the game never reads.
# Each is expanded once into packs/<name>/ and reused from there.
PACK_ZIP = {
    'free-defence-tower':    'craftpix-net-539977-free-defence-tower-3d-low-poly-models.zip',
    'battle-tower':          'craftpix-net-916902-battle-tower-3d-low-poly-models.zip',
    'fortress-of-the-elves': 'craftpix-net-193870-fortress-of-the-elves-3d-low-poly-models.zip',
    'orc-fortress':          'craftpix-net-453642-orc-fortress-3d-low-poly-models.zip',
}


def pack_dir(pack):
    out = os.path.join(PACKS, pack)
    if os.path.isdir(out):
        return out
    src = os.path.join(PACKS, PACK_ZIP[pack])
    if not os.path.exists(src):
        raise SystemExit('missing pack: ' + src)
    print('unpacking', PACK_ZIP[pack], flush=True)
    with zipfile.ZipFile(src) as z:
        z.extractall(out)
    return out

# Where each pack keeps its single palette atlas.
PACK_TEX = {
    'free-defence-tower':    'texture/Texture_MAp_fortress_elves.png',
    'battle-tower':          'Texture/Texture_MAp_fortress.png',
    'fortress-of-the-elves': 'texture/Texture_MAp_ELfs.png',
    'orc-fortress':          'TEXTURE/Texture_MAp.png',
}

# Projected height of each tier, in Blender units, measured off the towers
# these replace so the new art drops into the same footprint.
TARGET_V = [9.30, 11.60, 14.40, 18.60, 21.45]

D = 'fbx/Full'
B = 'fbx/full_fbx'

# A family is one pack, five models, and the yaw that puts its weapon on the
# screen's near side. The tower packs only ship four tiers, so the fifth is
# that pack's heavier weapon on the same base - the tower does not just grow
# at max level, it re-arms.
FAMILIES = {
    'archer':   {'pack': 'free-defence-tower',    'dir': D, 'yaw': 35,
                 'models': ['_archer_tower_LVL_1', '_archer_tower_LVL_2', '_archer_tower_LVL_3',
                            '_archer_tower_LVL_4', '_Cannon_tower_LVL_4']},
    'ballista': {'pack': 'free-defence-tower',    'dir': D, 'yaw': 28,
                 'models': ['_Ballista_tower_LVL_1', '_Ballista_tower_LVL_2', '_Ballista_tower_LVL_3',
                            '_Ballista_tower_LVL_4', '_Poison_tower_LVL_4']},
    'cannon':   {'pack': 'battle-tower',          'dir': B, 'yaw': 32,
                 'models': ['_Cannon_tower_LVL_1', '_Cannon_tower_LVL_2', '_Cannon_Tower_LVL_3',
                            '_Cannon_tower_LVL_4', '_Fire_tower_LVL_4']},
    'flame':    {'pack': 'battle-tower',          'dir': B, 'yaw': 30,
                 'models': ['_Fire_tower_LVL_1', '_Fire_tower_LVL_2', '_Fire_tower_LVL_3',
                            '_Fire_tower_LVL_4', '_Cannon_tower_LVL_4']},
    'arcane':   {'pack': 'battle-tower',          'dir': B, 'yaw': 25,
                 'models': ['_Wizard_tower_LVL_1', '_Wizard_tower_LVL_2', '_Wizard_tower_LVL_3',
                            '_Wizard_tower_LVL_4', '_Ballista_tower_LVL_4']},
    'elven':    {'pack': 'fortress-of-the-elves', 'dir': 'fbx/full', 'yaw': 38, 'deckDrop': 0.30,
                 'models': ['_watchtoer_1', '_TOWER_1', '_TOWER_2', 'tower_4_full', 'tower_5_full']},
    'orc':      {'pack': 'orc-fortress',          'dir': 'FBX/full', 'yaw': 38, 'deckDrop': 0.30,
                 'models': ['_TOWER_01', '_TOWER_02', 'TOWER_3_FULL', 'TOWER_4_FULL', 'TOWER_5_FULL']},
}


def light_scene(sc):
    """The packs paint with a mid-tone palette meant to be shown unlit, which
    under the tower rig's sun renders to mud. The key is opened up, a cool
    fill comes in from the camera side to keep the shadow face readable, and
    the sky contributes more than it does for the procedural sandstone."""
    world = sc.world.node_tree.nodes['Background']
    world.inputs[0].default_value = (0.62, 0.68, 0.78, 1)
    world.inputs[1].default_value = 0.42

    for o in sc.collection.objects:
        if o.type == 'LIGHT':
            o.data.energy = 4.6

    fill_data = bpy.data.lights.new('Fill', 'SUN')
    fill_data.energy = 1.5
    fill_data.color = (0.78, 0.85, 1.0)
    fill_data.angle = math.radians(30)
    fill = bpy.data.objects.new('Fill', fill_data)
    sc.collection.objects.link(fill)
    fill.rotation_euler = (math.radians(62), math.radians(20), math.radians(155))
    return sc


def atlas_material(name, path):
    """Flat-lit palette atlas. The texture is 64px of solid colour bands, so
    it is sampled Closest - interpolating it bleeds one palette cell into its
    neighbour and fringes every edge of the model. A little emission of the
    same colour keeps the unlit faces from going black, which is how these
    models are meant to read."""
    img = bpy.data.images.load(path, check_existing=True)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Roughness'].default_value = 0.78
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.18
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.interpolation = 'Closest'

    # These FBX files store V the other way up, and the importer does not
    # correct it. Left alone, a tower reads its wall colour off the roof band
    # of the palette and comes out green. Measured by rendering the albedo
    # both ways: flipped, the wall is stone and only the roof is green.
    uv = nt.nodes.new('ShaderNodeUVMap')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(uv.outputs['UV'], sep.inputs['Vector'])
    flip = nt.nodes.new('ShaderNodeMath')
    flip.operation = 'SUBTRACT'
    flip.inputs[0].default_value = 1.0
    nt.links.new(sep.outputs['Y'], flip.inputs[1])
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(sep.outputs['X'], comb.inputs['X'])
    nt.links.new(flip.outputs[0], comb.inputs['Y'])
    nt.links.new(comb.outputs['Vector'], tex.inputs['Vector'])

    # Lift the palette out of the linear basement before it is shaded.
    gain = nt.nodes.new('ShaderNodeMixRGB')
    gain.blend_type = 'MULTIPLY'
    gain.inputs['Fac'].default_value = 1.0
    gain.inputs[2].default_value = (0.94, 0.93, 0.90, 1)
    nt.links.new(tex.outputs['Color'], gain.inputs[1])

    nt.links.new(gain.outputs['Color'], bsdf.inputs['Base Color'])
    if 'Emission Color' in bsdf.inputs:
        nt.links.new(gain.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = 0.04
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return m


def import_model(path, mat):
    """Imports one FBX and hands back its meshes, unparented from any rig and
    wearing the pack atlas. Unparenting restores the world matrix first: the
    rigged files hang the mesh off an armature, and dropping the parent
    without that would teleport the tower."""
    bpy.ops.import_scene.fbx(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
        o.data.materials.clear()
        o.data.materials.append(mat)
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    return meshes


def world_box(meshes):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in meshes:
        for c in o.bound_box:
            p = o.matrix_world @ Vector(c)
            for i in range(3):
                lo[i] = min(lo[i], p[i])
                hi[i] = max(hi[i], p[i])
    return lo, hi


def screen_box(meshes):
    """The model's extents along the camera's own axes, which is what decides
    the sprite's frame - a tower's height on screen is its height times the
    cosine of the tilt plus its footprint times the sine."""
    elev = math.asin(TILT)
    up = Vector((0, math.sin(elev), math.cos(elev)))
    right = Vector((1, 0, 0))
    umin = vmin = 1e9
    umax = vmax = -1e9
    for o in meshes:
        for c in o.bound_box:
            p = o.matrix_world @ Vector(c)
            u, v = p.dot(right), p.dot(up)
            umin, umax = min(umin, u), max(umax, u)
            vmin, vmax = min(vmin, v), max(vmax, v)
    return umin, umax, vmin, vmax


def foot_radius(meshes, z_cut):
    """Half the footprint of everything below z_cut - the part of the model
    that actually stands on the ground."""
    r = 0.0
    for o in meshes:
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            if p.z <= z_cut:
                r = max(r, math.hypot(p.x, p.y))
    return r or 1.0


def apply(meshes, M):
    for o in meshes:
        o.matrix_world = M @ o.matrix_world


def add_camera(sc, width, lo, hi):
    """The game camera: orthographic, pitched so a circle on the ground
    renders as the TILT ellipse the node pads already draw."""
    aspect = (hi - lo) / width
    cam_data = bpy.data.cameras.new('Cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = width * max(1.0, aspect)
    cam_data.clip_end = 500
    cam = bpy.data.objects.new('Cam', cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    elev = math.asin(TILT)
    dist = 120
    cam.location = Vector((0, -math.cos(elev) * dist, math.sin(elev) * dist))
    cam.rotation_euler = (math.pi / 2 - elev, 0, 0)
    mid = (hi + lo) / 2
    cam.location += Vector((0, math.sin(elev) * mid, math.cos(elev) * mid))
    sc.render.resolution_x = int(width * UNIT_PX * SS)
    sc.render.resolution_y = int(width * aspect * UNIT_PX * SS)
    return cam


def render_level(family, spec, level, margin=0.45):
    """One tower: import, stand it on the origin, scale it to the tier it
    replaces, frame it and shoot. Returns the manifest entry."""
    sc = light_scene(reset_scene())
    root = pack_dir(spec['pack'])
    tex = os.path.join(root, PACK_TEX[spec['pack']])
    mat = atlas_material(family + '_atlas', tex)
    path = os.path.join(root, spec['dir'], spec['models'][level] + '.fbx')
    meshes = import_model(path, mat)

    # Stand it on the ground, centred, then turn it to its display yaw.
    lo, hi = world_box(meshes)
    apply(meshes, Matrix.Translation((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)))
    apply(meshes, Matrix.Rotation(math.radians(spec.get('yaw', 32)), 4, 'Z'))

    # Scale to the tier's projected height. The projection is linear and the
    # model sits on the origin, so one uniform scale about the origin lands it
    # exactly and keeps its feet on the floor.
    umin, umax, vmin, vmax = screen_box(meshes)
    apply(meshes, Matrix.Scale(TARGET_V[level] / (vmax - vmin), 4))

    umin, umax, vmin, vmax = screen_box(meshes)
    lo, hi = world_box(meshes)
    # The shadow ellipse follows the footprint, measured across the bottom
    # fifth of the model. Taking the whole bounding box instead put a spiked
    # tier-5 crown's reach on the floor and drew a shadow twice the tower.
    foot = foot_radius(meshes, lo.z + (hi.z - lo.z) * 0.2)

    u0, u1 = umin - margin, umax + margin
    v0, v1 = vmin - margin, vmax + margin
    width = u1 - u0
    cam = add_camera(sc, width, v0, v1)
    cam.location += Vector((1, 0, 0)) * ((u0 + u1) / 2)

    name = 'tower_%s_L%d.png' % (family, level + 1)
    render_to(os.path.join(OUT, name))

    drop = spec.get('deckDrop', 0.16)
    deck_v = vmax - drop * (vmax - vmin)
    return {
        'file': name,
        'w': sc.render.resolution_x,
        'h': sc.render.resolution_y,
        # Fractions down the image: where the ground origin sits, and where
        # the weapon platform sits. The game hangs the muzzle off the deck.
        'anchorY': (v1 - 0.0) / (v1 - v0),
        'deckY': (v1 - deck_v) / (v1 - v0),
        'baseR': foot,
    }


def main():
    which = sys.argv[1:] or list(FAMILIES)
    path = os.path.join(OUT, 'tower_packs.js')
    families = {}
    if os.path.exists(path):
        raw = open(path).read()
        families = json.loads(raw[raw.index('{'):raw.rindex('}') + 1]).get('families', {})

    for family in which:
        spec = FAMILIES[family]
        # Index 0 is the bare foundation, which every family shares.
        levels = [None]
        for level in range(5):
            levels.append(render_level(family, spec, level))
            print('rendered', family, 'L%d' % (level + 1), flush=True)
        families[family] = {'levels': levels}

    manifest = {'unitPx': UNIT_PX, 'ss': SS, 'families': families}
    with open(path, 'w') as f:
        f.write('/* Generated by tools/build_pack_towers.py - do not edit. */\n')
        f.write("'use strict';\n")
        f.write('const TOWER_PACK_MANIFEST = ' + json.dumps(manifest, indent=2) + ';\n')
    print('wrote', path)


if __name__ == '__main__':
    main()
