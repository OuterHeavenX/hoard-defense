"""Builds, rigs, animates and renders the stone golem boss with Blender (bpy).

Run:  python3 tools/build_golem.py
Out:  models/golem.blend                 the rigged, animated model
      assets/golem_walk_0..7.png         walk cycle from the game camera
      assets/golem_slam_0..3.png         slam wind-up and strike
      assets/golem_manifest.js           frame sizes and the ground anchor

The golem is segmented stone: every body part is its own rock chunk, and each
chunk is bound rigidly to one bone (all its vertices weighted 1.0 to that
bone). That is the honest way to rig a creature made of loose blocks - the
pieces move with the skeleton but never stretch, which is exactly how the
references look in Pose Mode.
"""
import math, os, sys, json
import bpy
from mathutils import Vector

TILT = 0.58
HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, '..', 'assets')
MODELS = os.path.join(HERE, '..', 'models')
UNIT_PX = 10
SS = 3                   # bosses are big on screen; keep them crisp
SAMPLES = int(os.environ.get('SAMPLES', '48'))
WALK_LEN = 24            # frames per loop
WALK_FRAMES = 8          # rendered
SLAM_START = 30
FACING = math.radians(62)  # three-quarter turn toward screen right


# ------------------------------------------------------------------ scene

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    sc.frame_start = 1
    sc.frame_end = 60

    world = bpy.data.worlds.new('World')
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.55, 0.62, 0.75, 1)
    bg.inputs[1].default_value = 0.35

    sun_data = bpy.data.lights.new('Light_Sun', 'SUN')
    sun_data.energy = 5.0
    sun_data.color = (1.0, 0.94, 0.84)
    sun_data.angle = math.radians(5)
    sun = bpy.data.objects.new('Light_Sun', sun_data)
    sc.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(50), math.radians(-25), math.radians(-40))
    return sc


# --------------------------------------------------------------- material

def golem_material():
    """Grey rock with moss settling on the upward faces, and a fine bump.
    The moss follows the surface normal's Z, so it grows where rain would
    sit - the reference's green is on tops of blocks, not their undersides."""
    m = bpy.data.materials.new('Golem_Stone')
    m.use_nodes = True
    nt = m.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.9

    coords = nodes.new('ShaderNodeTexCoord')

    rock = nodes.new('ShaderNodeTexNoise')
    rock.inputs['Scale'].default_value = 3.5
    rock.inputs['Detail'].default_value = 9.0
    rock.inputs['Roughness'].default_value = 0.65
    links.new(coords.outputs['Object'], rock.inputs['Vector'])
    rock_ramp = nodes.new('ShaderNodeValToRGB')
    rock_ramp.color_ramp.elements[0].position = 0.3
    rock_ramp.color_ramp.elements[0].color = (0.22, 0.22, 0.21, 1)
    rock_ramp.color_ramp.elements[1].position = 0.75
    rock_ramp.color_ramp.elements[1].color = (0.55, 0.55, 0.52, 1)
    links.new(rock.outputs['Fac'], rock_ramp.inputs['Fac'])

    # Moss mask: upward-facing AND noisy, so it patches rather than coats.
    geo = nodes.new('ShaderNodeNewGeometry')
    sep = nodes.new('ShaderNodeSeparateXYZ')
    links.new(geo.outputs['Normal'], sep.inputs['Vector'])
    up = nodes.new('ShaderNodeMath'); up.operation = 'MULTIPLY_ADD'
    up.inputs[1].default_value = 1.4; up.inputs[2].default_value = -0.35
    links.new(sep.outputs['Z'], up.inputs[0])
    moss_noise = nodes.new('ShaderNodeTexNoise')
    moss_noise.inputs['Scale'].default_value = 2.2
    moss_noise.inputs['Detail'].default_value = 6.0
    links.new(coords.outputs['Object'], moss_noise.inputs['Vector'])
    mask = nodes.new('ShaderNodeMath'); mask.operation = 'MULTIPLY'
    links.new(up.outputs[0], mask.inputs[0])
    links.new(moss_noise.outputs['Fac'], mask.inputs[1])
    mask_ramp = nodes.new('ShaderNodeValToRGB')
    mask_ramp.color_ramp.elements[0].position = 0.28
    mask_ramp.color_ramp.elements[1].position = 0.55
    links.new(mask.outputs[0], mask_ramp.inputs['Fac'])

    moss = nodes.new('ShaderNodeRGB')
    moss.outputs[0].default_value = (0.22, 0.34, 0.12, 1)
    mix = nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    links.new(mask_ramp.outputs['Color'], mix.inputs['Factor'])
    links.new(rock_ramp.outputs['Color'], mix.inputs[6])
    links.new(moss.outputs[0], mix.inputs[7])
    links.new(mix.outputs[2], bsdf.inputs['Base Color'])

    grain = nodes.new('ShaderNodeTexNoise')
    grain.inputs['Scale'].default_value = 28.0
    grain.inputs['Detail'].default_value = 5.0
    links.new(coords.outputs['Object'], grain.inputs['Vector'])
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.45
    bump.inputs['Distance'].default_value = 0.1
    links.new(grain.outputs['Fac'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def eye_material():
    m = bpy.data.materials.new('Golem_Eye')
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.2, 0.9, 1.0, 1)
    bsdf.inputs['Emission Color'].default_value = (0.3, 0.95, 1.0, 1)
    bsdf.inputs['Emission Strength'].default_value = 6.0
    return m


# --------------------------------------------------------------- geometry

_rock_tex = None

def rock_texture():
    global _rock_tex
    if _rock_tex is None:
        _rock_tex = bpy.data.textures.new('Rock_Noise', 'CLOUDS')
        _rock_tex.noise_scale = 0.55
        _rock_tex.noise_depth = 3
    return _rock_tex


def chunk(name, center, size, bone, mat, arm, rot=(0, 0, 0), displace=0.11, bevel=0.09):
    """One stone block. Bevel breaks the cube's edges, a simple subdivision
    gives the displacement vertices to push, and the displacement makes it
    rock rather than a box. Flat shading keeps the facets."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    o.rotation_euler = rot
    o.data.materials.append(mat)
    for p in o.data.polygons:
        p.use_smooth = False

    bev = o.modifiers.new('Bevel', 'BEVEL')
    bev.width = bevel
    bev.segments = 2
    sub = o.modifiers.new('Subdiv', 'SUBSURF')
    sub.subdivision_type = 'SIMPLE'
    sub.levels = sub.render_levels = 2
    dis = o.modifiers.new('Displace', 'DISPLACE')
    dis.texture = rock_texture()
    dis.strength = displace
    dis.mid_level = 0.5
    dis.texture_coords = 'GLOBAL'

    # Rigid binding: every vertex weighted 1.0 to one bone.
    vg = o.vertex_groups.new(name=bone)
    vg.add([v.index for v in o.data.vertices], 1.0, 'REPLACE')
    am = o.modifiers.new('Armature', 'ARMATURE')
    am.object = arm
    o.parent = arm
    return o


# ------------------------------------------------------------------- rig

BONES = [
    # name,          head,               tail,               parent
    ('root',         (0, 0, 4.7),        (0, 0, 5.5),        None),
    ('spine',        (0, 0, 5.5),        (0, 0, 6.6),        'root'),
    ('chest',        (0, 0, 6.6),        (0, 0, 8.1),        'spine'),
    ('neck',         (0, 0, 8.1),        (0, 0, 8.5),        'chest'),
    ('head',         (0, 0, 8.5),        (0, 0, 9.7),        'neck'),
    ('shoulder.L',   (1.2, 0, 7.9),      (2.9, 0, 7.8),      'chest'),
    ('upper_arm.L',  (3.1, 0, 7.5),      (3.4, 0, 5.7),      'shoulder.L'),
    ('forearm.L',    (3.4, 0, 5.7),      (3.5, 0, 3.6),      'upper_arm.L'),
    ('hand.L',       (3.5, 0, 3.6),      (3.5, 0, 2.3),      'forearm.L'),
    ('shoulder.R',   (-1.2, 0, 7.9),     (-2.9, 0, 7.8),     'chest'),
    ('upper_arm.R',  (-3.1, 0, 7.5),     (-3.4, 0, 5.7),     'shoulder.R'),
    ('forearm.R',    (-3.4, 0, 5.7),     (-3.5, 0, 3.6),     'upper_arm.R'),
    ('hand.R',       (-3.5, 0, 3.6),     (-3.5, 0, 2.3),     'forearm.R'),
    ('thigh.L',      (1.15, 0, 4.7),     (1.25, 0, 2.7),     'root'),
    ('shin.L',       (1.25, 0, 2.7),     (1.3, 0, 0.9),      'thigh.L'),
    ('foot.L',       (1.3, 0, 0.9),      (1.35, -0.9, 0.3),  'shin.L'),
    ('thigh.R',      (-1.15, 0, 4.7),    (-1.25, 0, 2.7),    'root'),
    ('shin.R',       (-1.25, 0, 2.7),    (-1.3, 0, 0.9),     'thigh.R'),
    ('foot.R',       (-1.3, 0, 0.9),     (-1.35, -0.9, 0.3), 'shin.R'),
]


def build_armature(sc):
    arm_data = bpy.data.armatures.new('Golem_Skeleton')
    arm = bpy.data.objects.new('Golem_Skeleton', arm_data)
    sc.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for name, head, tail, parent in BONES:
        eb = arm_data.edit_bones.new(name)
        eb.head = head
        eb.tail = tail
        if parent:
            eb.parent = arm_data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in arm.pose.bones:
        pb.rotation_mode = 'XYZ'
    return arm


def build_body(sc, arm):
    """Every part is a rock. Sizes are (x, y, z) half-extents times two."""
    stone = golem_material()
    eye = eye_material()
    C = lambda *a, **k: chunk(*a, mat=stone, arm=arm, **k)

    # Head: a heavy block with a jutting brow, and two lit eyes set under it.
    C('Head', (0, 0, 9.05), (1.7, 1.55, 1.35), 'head')
    C('Brow', (0, -0.7, 9.45), (1.6, 0.6, 0.4), 'head', displace=0.06)
    for s in (-1, 1):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(s * 0.42, -0.84, 9.0))
        e = bpy.context.active_object
        e.name = f'Eye{"L" if s > 0 else "R"}'
        e.scale = (0.28, 0.08, 0.12)
        e.data.materials.append(eye)
        vg = e.vertex_groups.new(name='head')
        vg.add([v.index for v in e.data.vertices], 1.0, 'REPLACE')
        am = e.modifiers.new('Armature', 'ARMATURE'); am.object = arm
        e.parent = arm

    # Torso: a massive chest slab, a belly nearly as wide, a pelvis block.
    C('Chest', (0, 0, 7.3), (3.6, 2.3, 1.9), 'chest', displace=0.15)
    C('Chest_Plate', (0, -1.05, 7.35), (2.2, 0.7, 1.3), 'chest', displace=0.05)
    C('Belly', (0, 0, 6.0), (2.9, 2.0, 1.2), 'spine')
    C('Pelvis', (0, 0, 5.0), (3.0, 2.0, 0.9), 'root')

    for s, side in ((1, 'L'), (-1, 'R')):
        # Shoulders are boulders in their own right; forearms and fists are
        # the golem's weapons and read as the heaviest stone on him.
        C(f'Shoulder.{side}', (s * 2.7, 0, 7.85), (2.3, 2.1, 1.9), f'shoulder.{side}', displace=0.17)
        C(f'UpperArm.{side}', (s * 3.25, 0, 6.5), (1.7, 1.6, 2.0), f'upper_arm.{side}')
        C(f'Elbow.{side}', (s * 3.4, 0, 5.65), (1.5, 1.4, 0.9), f'forearm.{side}', displace=0.08)
        C(f'Forearm.{side}', (s * 3.45, 0, 4.6), (2.0, 1.85, 2.0), f'forearm.{side}', displace=0.15)
        C(f'Fist.{side}', (s * 3.5, 0, 2.95), (2.0, 1.9, 1.6), f'hand.{side}', displace=0.13)
        C(f'Thigh.{side}', (s * 1.2, 0, 3.75), (1.8, 1.7, 2.0), f'thigh.{side}')
        C(f'Knee.{side}', (s * 1.25, -0.15, 2.7), (1.4, 1.3, 0.8), f'shin.{side}', displace=0.07)
        C(f'Shin.{side}', (s * 1.3, 0, 1.75), (1.65, 1.55, 1.7), f'shin.{side}')
        C(f'Foot.{side}', (s * 1.35, -0.5, 0.48), (1.8, 2.5, 0.95), f'foot.{side}', displace=0.09)


# -------------------------------------------------------------- animation

def key(arm, bone, frame, rot=None, loc=None):
    pb = arm.pose.bones[bone]
    if rot is not None:
        pb.rotation_euler = tuple(math.radians(a) for a in rot)
        pb.keyframe_insert('rotation_euler', frame=frame)
    if loc is not None:
        pb.location = loc
        pb.keyframe_insert('location', frame=frame)


def animate(arm):
    """Walk cycle over WALK_LEN frames starting at 1, then a slam from
    SLAM_START. Heavy, planted, slow: the golem does not jog."""
    L = WALK_LEN
    q = L / 4
    # Legs: thighs swing fore and aft, shins fold on the swing-through.
    for i, t in enumerate([0, q, 2 * q, 3 * q, L]):
        f = 1 + t
        sw = [28, 0, -28, 0, 28][i]
        key(arm, 'thigh.L', f, rot=(sw, 0, 0))
        key(arm, 'thigh.R', f, rot=(-sw, 0, 0))
        key(arm, 'shin.L', f, rot=([-4, -46, -4, -2, -4][i], 0, 0))
        key(arm, 'shin.R', f, rot=([-4, -2, -4, -46, -4][i], 0, 0))
        key(arm, 'foot.L', f, rot=([4, 10, -3, 0, 4][i], 0, 0))
        key(arm, 'foot.R', f, rot=([-3, 0, 4, 10, -3][i], 0, 0))
        # Arms counter-swing, elbows stay bent - fists never fully drop.
        key(arm, 'upper_arm.L', f, rot=([-22, 0, 22, 0, -22][i], 0, 8))
        key(arm, 'upper_arm.R', f, rot=([22, 0, -22, 0, 22][i], 0, -8))
        key(arm, 'forearm.L', f, rot=(18, 0, 0))
        key(arm, 'forearm.R', f, rot=(18, 0, 0))
        # Body: a bob on each footfall, a twist against the stride.
        key(arm, 'root', f, loc=(0, 0, [0, -0.22, 0, -0.22, 0][i]))
        key(arm, 'spine', f, rot=(4, 0, [0, 6, 0, -6, 0][i]))
        key(arm, 'chest', f, rot=(3, 0, [0, 4, 0, -4, 0][i]))
        key(arm, 'head', f, rot=(-5, 0, [0, -3, 0, 3, 0][i]))

    # Slam: a wind-up with both arms raised and the torso back, then the
    # strike, then a recovery back to standing.
    S = SLAM_START
    for f, chest, arm_x, fore, root_z, head in [
        (S,      3,   0,    18,  0,     -5),
        (S + 6,  -22, -150, 25,  0.15,  -14),   # both fists overhead, leaning back
        (S + 10, 32,  -35,  60,  -0.55, 10),    # driven down in front of him
        (S + 16, 3,   0,    18,  0,     -5),
    ]:
        key(arm, 'chest', f, rot=(chest, 0, 0))
        key(arm, 'spine', f, rot=(chest * 0.4, 0, 0))
        key(arm, 'upper_arm.L', f, rot=(arm_x, 0, 12))
        key(arm, 'upper_arm.R', f, rot=(arm_x, 0, -12))
        key(arm, 'forearm.L', f, rot=(fore, 0, 0))
        key(arm, 'forearm.R', f, rot=(fore, 0, 0))
        key(arm, 'root', f, loc=(0, 0, root_z))
        key(arm, 'head', f, rot=(head, 0, 0))
        key(arm, 'thigh.L', f, rot=(12, 0, 0))
        key(arm, 'thigh.R', f, rot=(-12, 0, 0))
        key(arm, 'shin.L', f, rot=(-8, 0, 0))
        key(arm, 'shin.R', f, rot=(-8, 0, 0))


# ---------------------------------------------------------------- render

def add_camera(sc, width, lo, hi):
    """Game camera: orthographic, pitched so ground circles render at TILT."""
    aspect = (hi - lo) / width
    cam_data = bpy.data.cameras.new('Camera_Active')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = width * max(1.0, aspect)
    cam_data.clip_end = 500
    cam = bpy.data.objects.new('Camera_Active', cam_data)
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
    return cam, aspect


def fit_frame(sc, arm, frames, margin=0.45):
    """Projects every mesh's evaluated bounding box, at every frame that will
    be rendered, into camera space and returns the tight extents. Guessing
    the frame clipped the raised fists off the wind-up; measuring it cannot."""
    elev = math.asin(TILT)
    up = Vector((0, math.sin(elev), math.cos(elev)))
    right = Vector((1, 0, 0))
    umin = vmin = 1e9
    umax = vmax = -1e9
    for f in frames:
        sc.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        for ob in sc.objects:
            if ob.type != 'MESH':
                continue
            ev = ob.evaluated_get(dg)
            for corner in ev.bound_box:
                P = ev.matrix_world @ Vector(corner)
                u, v = P.dot(right), P.dot(up)
                umin, umax = min(umin, u), max(umax, u)
                vmin, vmax = min(vmin, v), max(vmax, v)
    return umin - margin, umax + margin, vmin - margin, vmax + margin


def render_frames(sc, arm):
    elev = math.asin(TILT)
    arm.rotation_euler = (0, 0, FACING)
    walk = [1 + int(i * WALK_LEN / WALK_FRAMES) for i in range(WALK_FRAMES)]
    slam = [SLAM_START, SLAM_START + 6, SLAM_START + 10, SLAM_START + 16]

    umin, umax, lo, hi = fit_frame(sc, arm, walk + slam)
    width = umax - umin
    cam, aspect = add_camera(sc, width, lo, hi)
    cam.location += Vector((1, 0, 0)) * ((umin + umax) / 2)

    manifest = {
        'unitPx': UNIT_PX, 'ss': SS,
        'w': sc.render.resolution_x, 'h': sc.render.resolution_y,
        # Where the ground origin lands in the image, as fractions.
        'anchorX': (0 - umin) / width,
        'anchorY': hi / (hi - lo),
        'bodyUnits': 9.7,
        'walk': [], 'slam': []
    }
    for i, f in enumerate(walk):
        sc.frame_set(f)
        name = f'golem_walk_{i}.png'
        sc.render.filepath = os.path.join(ASSETS, name)
        bpy.ops.render.render(write_still=True)
        manifest['walk'].append(name)
        print('rendered', name)
    for i, f in enumerate(slam):
        sc.frame_set(f)
        name = f'golem_slam_{i}.png'
        sc.render.filepath = os.path.join(ASSETS, name)
        bpy.ops.render.render(write_still=True)
        manifest['slam'].append(name)
        print('rendered', name)
    sc.frame_set(1)
    with open(os.path.join(ASSETS, 'golem_manifest.js'), 'w') as fh:
        fh.write('/* Generated by tools/build_golem.py - do not edit. */\n')
        fh.write("'use strict';\nconst GOLEM_MANIFEST = " + json.dumps(manifest, indent=2) + ';\n')
    print('wrote golem_manifest.js', {k: manifest[k] for k in ('w', 'h', 'anchorX', 'anchorY')})


if __name__ == '__main__':
    os.makedirs(ASSETS, exist_ok=True)
    os.makedirs(MODELS, exist_ok=True)
    sc = reset_scene()
    arm = build_armature(sc)
    build_body(sc, arm)
    animate(arm)
    # Save the rigged, animated model facing forward, before the render turn.
    arm.rotation_euler = (0, 0, 0)
    blend = os.path.join(MODELS, 'golem.blend')
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    print('saved', blend)
    if 'norender' not in sys.argv:
        render_frames(sc, arm)
