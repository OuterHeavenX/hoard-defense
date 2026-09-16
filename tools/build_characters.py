"""Builds, rigs, animates and renders every character with Blender (bpy).

Run:  python3 tools/build_characters.py
Out:  models/characters.blend                      all six, rigged and animated
      assets/char_<name>_<frame>.png              6 walk frames each
      assets/char_manifest.js                     frame sizes and ground anchors

Same approach as the golem: rounded blocks bound rigidly to a skeleton, a
walk cycle keyed on it, frames rendered from the game camera. The hero, the
four enemy types and the Juggernaut share one skeleton layout scaled per
character, so one animate() serves all of them with per-character
amplitude and a constant pose offset - the shamblers hold their arms out,
the runner leans in.
"""
import math, os, sys, json, importlib.util
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('golem', os.path.join(HERE, 'build_golem.py'))
golem = importlib.util.module_from_spec(spec)
spec.loader.exec_module(golem)

ASSETS = os.path.join(HERE, '..', 'assets')
MODELS = os.path.join(HERE, '..', 'models')
TILT = golem.TILT
UNIT_PX = 10
SS = 3
FRAMES = 6
WALK_LEN = 24
FACING = math.radians(62)


# --------------------------------------------------------------- materials

def flat_material(name, rgb, rough=0.85, noise=0.12):
    """Cloth, skin, metal: a base colour with a little noise so it is not a
    vector fill, and a fine bump so light catches it."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = rough
    coords = nodes.new('ShaderNodeTexCoord')
    n = nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = 9.0
    n.inputs['Detail'].default_value = 4.0
    links.new(coords.outputs['Object'], n.inputs['Vector'])
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (rgb[0] * (1 - noise), rgb[1] * (1 - noise), rgb[2] * (1 - noise), 1)
    ramp.color_ramp.elements[1].position = 0.65
    ramp.color_ramp.elements[1].color = (min(1, rgb[0] * (1 + noise)), min(1, rgb[1] * (1 + noise)), min(1, rgb[2] * (1 + noise)), 1)
    links.new(n.outputs['Fac'], ramp.inputs['Fac'])
    links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.18
    links.new(n.outputs['Fac'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def glow_material(name, rgb, strength=5.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Emission Color'].default_value = (*rgb, 1)
    bsdf.inputs['Emission Strength'].default_value = strength
    return m


# ---------------------------------------------------------------- geometry

def part(name, center, size, bone, mat, arm, shape='round', rot=(0, 0, 0)):
    """A body part. 'round' is a bevelled cube under a Catmull-Clark subsurf,
    which reads as a soft stylised solid; 'ball' is a sphere; 'box' keeps
    its edges (plates, weapons)."""
    if shape == 'ball':
        bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=0.5, location=center)
    else:
        bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    o.rotation_euler = rot
    o.data.materials.append(mat)
    smooth = shape != 'box'
    for p in o.data.polygons:
        p.use_smooth = smooth
    if shape == 'round':
        bev = o.modifiers.new('Bevel', 'BEVEL')
        bev.width = 0.18
        bev.segments = 3
        sub = o.modifiers.new('Subdiv', 'SUBSURF')
        sub.levels = sub.render_levels = 1
    elif shape == 'box':
        bev = o.modifiers.new('Bevel', 'BEVEL')
        bev.width = 0.05
        bev.segments = 1
    vg = o.vertex_groups.new(name=bone)
    vg.add([v.index for v in o.data.vertices], 1.0, 'REPLACE')
    am = o.modifiers.new('Armature', 'ARMATURE')
    am.object = arm
    o.parent = arm
    return o


def bones_for(s, armx, legx, hunch=0.0):
    """The golem's skeleton layout at scale s, arms armx out and legs legx
    apart. hunch pulls the shoulders forward for the shamblers."""
    z = lambda v: v * s
    return [
        ('root',        (0, 0, z(4.6)),           (0, 0, z(5.3)),            None),
        ('spine',       (0, 0, z(5.3)),           (0, 0, z(6.3)),            'root'),
        ('chest',       (0, 0, z(6.3)),           (0, -hunch, z(7.8)),       'spine'),
        ('neck',        (0, -hunch, z(7.8)),      (0, -hunch, z(8.15)),      'chest'),
        ('head',        (0, -hunch, z(8.15)),     (0, -hunch, z(9.2)),       'neck'),
        ('shoulder.L',  (0.5 * s, -hunch, z(7.6)), (armx, -hunch, z(7.5)),   'chest'),
        ('upper_arm.L', (armx, -hunch, z(7.4)),   (armx * 1.05, -hunch, z(5.8)), 'shoulder.L'),
        ('forearm.L',   (armx * 1.05, -hunch, z(5.8)), (armx * 1.1, -hunch, z(4.2)), 'upper_arm.L'),
        ('hand.L',      (armx * 1.1, -hunch, z(4.2)), (armx * 1.1, -hunch, z(3.5)), 'forearm.L'),
        ('shoulder.R',  (-0.5 * s, -hunch, z(7.6)), (-armx, -hunch, z(7.5)), 'chest'),
        ('upper_arm.R', (-armx, -hunch, z(7.4)),  (-armx * 1.05, -hunch, z(5.8)), 'shoulder.R'),
        ('forearm.R',   (-armx * 1.05, -hunch, z(5.8)), (-armx * 1.1, -hunch, z(4.2)), 'upper_arm.R'),
        ('hand.R',      (-armx * 1.1, -hunch, z(4.2)), (-armx * 1.1, -hunch, z(3.5)), 'forearm.R'),
        ('thigh.L',     (legx, 0, z(4.6)),        (legx, 0, z(2.6)),         'root'),
        ('shin.L',      (legx, 0, z(2.6)),        (legx, 0, z(0.7)),         'thigh.L'),
        ('foot.L',      (legx, 0, z(0.7)),        (legx, -0.7 * s, z(0.2)),  'shin.L'),
        ('thigh.R',     (-legx, 0, z(4.6)),       (-legx, 0, z(2.6)),        'root'),
        ('shin.R',      (-legx, 0, z(2.6)),       (-legx, 0, z(0.7)),        'thigh.R'),
        ('foot.R',      (-legx, 0, z(0.7)),       (-legx, -0.7 * s, z(0.2)), 'shin.R'),
    ]


def build_armature(sc, bones):
    arm_data = bpy.data.armatures.new('Skeleton')
    arm = bpy.data.objects.new('Skeleton', arm_data)
    sc.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for name, head, tail, parent in bones:
        eb = arm_data.edit_bones.new(name)
        eb.head, eb.tail = head, tail
        if parent:
            eb.parent = arm_data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in arm.pose.bones:
        pb.rotation_mode = 'XYZ'
    return arm


# --------------------------------------------------------------- characters

def humanoid(sc, arm, s, armx, legx, hunch, mats, bulk=1.0, belly=1.0, helmet=False, plates=False):
    """Shared body: head, torso, pelvis, limbs. Per-character extras follow."""
    skin, cloth, dark, boot = mats['skin'], mats['cloth'], mats['dark'], mats['boot']
    z = lambda v: v * s
    P = lambda *a, **k: part(*a, arm=arm, **k)
    y = -hunch

    P('Head', (0, y, z(8.7)), (1.3 * s, 1.25 * s, 1.35 * s), 'head', skin, shape='ball')
    if helmet:
        P('Helmet', (0, y - 0.05 * s, z(8.95)), (1.5 * s, 1.45 * s, 0.9 * s), 'head', dark, shape='round')
        P('Brim', (0, y - 0.55 * s, z(8.6)), (1.55 * s, 0.6 * s, 0.18 * s), 'head', dark, shape='box')
    else:
        P('Hair', (0, y + 0.1 * s, z(9.1)), (1.25 * s, 1.2 * s, 0.5 * s), 'head', dark, shape='round')

    P('Chest', (0, y, z(7.0)), (2.1 * s * bulk, 1.25 * s * bulk, 1.8 * s), 'chest', cloth)
    P('Belly', (0, y + 0.05 * s, z(5.85)), (1.9 * s * bulk * belly, 1.3 * s * belly, 1.1 * s), 'spine', cloth)
    P('Pelvis', (0, 0, z(4.95)), (1.9 * s * bulk, 1.15 * s, 0.8 * s), 'root', dark)
    if plates:
        P('Plate', (0, y - 0.7 * s * bulk, z(7.05)), (1.5 * s * bulk, 0.35 * s, 1.5 * s), 'chest', mats['metal'], shape='box')

    for sg, side in ((1, 'L'), (-1, 'R')):
        ax = armx * sg
        P(f'Shoulder.{side}', (ax * 0.95, y, z(7.55)), (1.0 * s * bulk, 0.95 * s * bulk, 0.9 * s), f'shoulder.{side}', cloth if not plates else mats['metal'])
        P(f'UpperArm.{side}', (ax * 1.02, y, z(6.6)), (0.8 * s * bulk, 0.8 * s * bulk, 1.6 * s), f'upper_arm.{side}', cloth)
        P(f'Forearm.{side}', (ax * 1.08, y, z(5.0)), (0.72 * s * bulk, 0.72 * s * bulk, 1.6 * s), f'forearm.{side}', skin if not plates else cloth)
        P(f'Hand.{side}', (ax * 1.1, y, z(3.85)), (0.75 * s, 0.7 * s, 0.75 * s), f'hand.{side}', skin, shape='ball')
        lx = legx * sg
        P(f'Thigh.{side}', (lx, 0, z(3.65)), (0.95 * s * bulk, 0.95 * s * bulk, 1.9 * s), f'thigh.{side}', dark)
        P(f'Shin.{side}', (lx, 0, z(1.7)), (0.8 * s * bulk, 0.8 * s * bulk, 1.9 * s), f'shin.{side}', dark)
        P(f'Boot.{side}', (lx, -0.35 * s, z(0.42)), (0.9 * s, 1.45 * s, 0.75 * s), f'foot.{side}', boot, shape='round')


CHARACTERS = {
    'player': dict(s=1.0, armx=1.35, legx=0.55, hunch=0.0, bulk=1.0, belly=1.0, helmet=True, plates=True,
                   colors=dict(skin=(0.86, 0.64, 0.5), cloth=(0.22, 0.34, 0.22), dark=(0.13, 0.15, 0.13), boot=(0.12, 0.1, 0.09), metal=(0.3, 0.33, 0.36)),
                   weapon='rifle', pose=dict(), stride=1.0, arms=1.0),
    'grunt':  dict(s=0.92, armx=1.25, legx=0.5, hunch=0.35, bulk=0.95, belly=1.0, helmet=False, plates=False,
                   colors=dict(skin=(0.5, 0.62, 0.38), cloth=(0.38, 0.36, 0.28), dark=(0.2, 0.19, 0.15), boot=(0.15, 0.13, 0.11)),
                   weapon=None, pose=dict(upper_arm=-75, forearm=-10, head=18, chest=10), stride=0.8, arms=0.25),
    'runner': dict(s=0.9, armx=1.15, legx=0.45, hunch=0.15, bulk=0.8, belly=0.9, helmet=False, plates=False,
                   colors=dict(skin=(0.78, 0.44, 0.28), cloth=(0.55, 0.28, 0.16), dark=(0.25, 0.14, 0.09), boot=(0.15, 0.1, 0.08)),
                   weapon=None, pose=dict(chest=22, head=-12, upper_arm=-25), stride=1.5, arms=1.4),
    'tank':   dict(s=1.15, armx=1.65, legx=0.7, hunch=0.1, bulk=1.35, belly=1.1, helmet=True, plates=True,
                   colors=dict(skin=(0.6, 0.66, 0.78), cloth=(0.36, 0.42, 0.6), dark=(0.18, 0.21, 0.32), boot=(0.12, 0.13, 0.18), metal=(0.45, 0.5, 0.6)),
                   weapon=None, pose=dict(upper_arm=-20), stride=0.7, arms=0.6),
    'brute':  dict(s=1.6, armx=1.9, legx=0.85, hunch=0.2, bulk=1.5, belly=1.7, helmet=False, plates=False,
                   colors=dict(skin=(0.86, 0.5, 0.6), cloth=(0.78, 0.25, 0.4), dark=(0.42, 0.12, 0.22), boot=(0.2, 0.1, 0.12)),
                   weapon='club', pose=dict(upper_arm=-30, chest=8), stride=0.6, arms=0.7),
    'ally':   dict(s=1.35, armx=1.8, legx=0.75, hunch=0.0, bulk=1.4, belly=1.05, helmet=True, plates=True,
                   colors=dict(skin=(0.8, 0.66, 0.52), cloth=(0.5, 0.55, 0.4), dark=(0.2, 0.22, 0.17), boot=(0.12, 0.12, 0.1), metal=(0.55, 0.58, 0.55)),
                   weapon='gatling', pose=dict(upper_arm=-40, forearm=-35), stride=0.7, arms=0.5),
}


def add_weapon(kind, arm, s, armx, mats):
    P = lambda *a, **k: part(*a, arm=arm, **k)
    ax = -armx * 1.1            # right hand
    if kind == 'rifle':
        P('Rifle', (ax, -1.2 * s, 3.9 * s), (0.22 * s, 2.6 * s, 0.26 * s), 'hand.R', mats['dark'], shape='box')
        P('Stock', (ax, 0.15 * s, 3.85 * s), (0.28 * s, 0.7 * s, 0.4 * s), 'hand.R', mats['boot'], shape='box')
    elif kind == 'club':
        P('Club', (ax, -0.9 * s, 3.9 * s), (0.45 * s, 2.4 * s, 0.45 * s), 'hand.R', mats['boot'], shape='round',
          rot=(math.radians(-20), 0, 0))
    elif kind == 'gatling':
        for i in range(3):
            a = 2 * math.pi * i / 3
            P(f'Barrel{i}', (ax + math.cos(a) * 0.22 * s, -1.6 * s, 4.0 * s + math.sin(a) * 0.22 * s),
              (0.16 * s, 2.8 * s, 0.16 * s), 'hand.R', mats['metal'], shape='box')
        P('Drum', (ax, -0.2 * s, 4.0 * s), (0.75 * s, 0.9 * s, 0.75 * s), 'hand.R', mats['dark'], shape='round')


def animate(arm, cfg):
    L, q = WALK_LEN, WALK_LEN / 4
    pose = cfg['pose']
    st, am = cfg['stride'], cfg['arms']
    for i, t in enumerate([0, q, 2 * q, 3 * q, L]):
        f = 1 + t
        sw = [28, 0, -28, 0, 28][i] * st
        golem.key(arm, 'thigh.L', f, rot=(sw, 0, 0))
        golem.key(arm, 'thigh.R', f, rot=(-sw, 0, 0))
        golem.key(arm, 'shin.L', f, rot=([-4, -50, -4, -2, -4][i] * st, 0, 0))
        golem.key(arm, 'shin.R', f, rot=([-4, -2, -4, -50, -4][i] * st, 0, 0))
        golem.key(arm, 'foot.L', f, rot=([4, 12, -3, 0, 4][i], 0, 0))
        golem.key(arm, 'foot.R', f, rot=([-3, 0, 4, 12, -3][i], 0, 0))
        ua = pose.get('upper_arm', 0)
        golem.key(arm, 'upper_arm.L', f, rot=(ua + [-24, 0, 24, 0, -24][i] * am, 0, 6))
        golem.key(arm, 'upper_arm.R', f, rot=(ua + [24, 0, -24, 0, 24][i] * am, 0, -6))
        fa = pose.get('forearm', 0)
        golem.key(arm, 'forearm.L', f, rot=(-25 + fa, 0, 0))
        golem.key(arm, 'forearm.R', f, rot=(-25 + fa, 0, 0))
        golem.key(arm, 'root', f, loc=(0, 0, [0, -0.12, 0, -0.12, 0][i] * st))
        golem.key(arm, 'spine', f, rot=(3, 0, [0, 5, 0, -5, 0][i]))
        golem.key(arm, 'chest', f, rot=(pose.get('chest', 0), 0, [0, 3, 0, -3, 0][i]))
        golem.key(arm, 'head', f, rot=(pose.get('head', -3), 0, [0, -2, 0, 2, 0][i]))


def build_character(sc, name, cfg):
    s, armx, legx, hunch = cfg['s'], cfg['armx'] * cfg['s'], cfg['legx'] * cfg['s'], cfg['hunch'] * cfg['s']
    mats = {k: flat_material(f'{name}_{k}', v) for k, v in cfg['colors'].items()}
    if 'metal' in mats:
        mats['metal'].node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.45
        mats['metal'].node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 0.6
    arm = build_armature(sc, bones_for(s, armx, legx, hunch))
    arm.name = f'{name}_Skeleton'
    humanoid(sc, arm, s, armx, legx, hunch, mats, bulk=cfg['bulk'], belly=cfg['belly'],
             helmet=cfg['helmet'], plates=cfg['plates'])
    if cfg['weapon']:
        add_weapon(cfg['weapon'], arm, s, armx, mats)
    animate(arm, cfg)
    return arm, 9.3 * s


def render_character(sc, arm, name, body_units, manifest):
    arm.rotation_euler = (0, 0, FACING)
    frames = [1 + int(i * WALK_LEN / FRAMES) for i in range(FRAMES)]
    umin, umax, lo, hi = golem.fit_frame(sc, arm, frames, margin=0.3)
    width = umax - umin
    golem.UNIT_PX, golem.SS = UNIT_PX, SS
    cam, aspect = golem.add_camera(sc, width, lo, hi)
    cam.location += Vector((1, 0, 0)) * ((umin + umax) / 2)
    entry = {'w': sc.render.resolution_x, 'h': sc.render.resolution_y,
             'anchorX': (0 - umin) / width, 'anchorY': hi / (hi - lo),
             'bodyUnits': body_units, 'frames': []}
    for i, f in enumerate(frames):
        sc.frame_set(f)
        fname = f'char_{name}_{i}.png'
        sc.render.filepath = os.path.join(ASSETS, fname)
        bpy.ops.render.render(write_still=True)
        entry['frames'].append(fname)
    manifest[name] = entry
    arm.rotation_euler = (0, 0, 0)
    print(f'rendered {name}: {entry["w"]}x{entry["h"]}')


if __name__ == '__main__':
    os.makedirs(ASSETS, exist_ok=True)
    os.makedirs(MODELS, exist_ok=True)
    manifest = {'unitPx': UNIT_PX, 'ss': SS, 'characters': {}}
    only = sys.argv[1:] or list(CHARACTERS)
    # One scene per character for the renders; the .blend keeps them all.
    for name in only:
        sc = golem.reset_scene()
        sc.cycles.samples = int(os.environ.get('SAMPLES', '32'))
        arm, body = build_character(sc, name, CHARACTERS[name])
        render_character(sc, arm, name, body, manifest['characters'])
    # Save a single file with every character side by side for editing.
    sc = golem.reset_scene()
    for i, name in enumerate(CHARACTERS):
        arm, _ = build_character(sc, name, CHARACTERS[name])
        arm.location.x = (i - 2.5) * 6.0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(MODELS, 'characters.blend'))
    with open(os.path.join(ASSETS, 'char_manifest.js'), 'w') as fh:
        fh.write('/* Generated by tools/build_characters.py - do not edit. */\n')
        fh.write("'use strict';\nconst CHAR_MANIFEST = " + json.dumps(manifest, indent=2) + ';\n')
    print('wrote char_manifest.js and models/characters.blend')
