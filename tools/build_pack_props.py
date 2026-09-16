"""Renders the walls, gates and camp props from the Craftpix fortress packs.

    python3 tools/build_pack_props.py

Two things come out of here. Barricades are the tiered walls the player buys
during a run: a fence, a low wall and a rampart, each rendered as one short
piece that the game tiles along a line. Props are the fixed dressing that
makes an arena look like a fortified place rather than a floor - braziers,
an arsenal, barracks, a gate the horde pours through.

A barricade piece is rendered twice, once running east-west and once running
north-south, because in a 2.5D projection a wall seen broadside and a wall
receding from the camera are not the same picture. The game picks by the
line's direction and depth-sorts each piece on its own, so a receding wall
interleaves with the crowd correctly.

Writes assets/prop_<family>_<name>.png and assets/props.js.
"""
import json, math, os, sys
import bpy
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render_assets import UNIT_PX, SS, reset_scene, render_to
from build_pack_towers import (TILT, PACKS, PACK_TEX, pack_dir, light_scene,
                               atlas_material, import_model, world_box,
                               screen_box, apply, add_camera, foot_radius)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')

# One barricade piece spans this many Blender units along its run. At the
# game's 7.5 px per unit that is a 46px segment, short enough that a wall
# breaks in belieavable chunks and long enough not to cost a sprite each.
SEG_UNITS = 6.13

# What a north-south wall's thickness is opened up to, in Blender units.
NS_THICK_UNITS = 6.2

ELF = 'fortress-of-the-elves'
ORC = 'orc-fortress'

# Barricade tiers. Each entry is the piece whose run length is normalised to
# SEG_UNITS; its height then follows from the model, which is what gives the
# tiers their step up from waist-high fence to rampart.
BARRICADES = {
    'elven': {'pack': ELF, 'dir': 'fbx/parts', 'tiers': ['_FENSE_LINE', 'wall_1_part_02', 'wall_1_part_01']},
    'orc':   {'pack': ORC, 'dir': 'FBX/PARTS', 'tiers': ['_FENSE_LINE_01', '_WALL_1_PART_2_01', '_WALL_1_PART_1_01']},
}

# Fixed dressing. `h` is the height the sprite should stand in game pixels.
PROPS = {
    'elven': {'pack': ELF, 'dir': 'fbx/full', 'items': [
        ('brazier',  '_BRAZIER_1',   34),
        ('arsenal',  '_arsenal_1',   96),
        ('barracks', '_kazarm_1',    76),
        ('bell',     '_fire_bell_1', 44),
        ('gate',     '_minnor_gates_4', 104),
        ('stack',    'props_full',   72),
    ]},
    'orc': {'pack': ORC, 'dir': 'FBX/full', 'items': [
        ('brazier',  '_BRAZIER_01',  32),
        ('arsenal',  '_ARSENAL',     96),
        ('barracks', '_BARRACKS',    78),
        ('bell',     '_ALARM_DRUM',  44),
        ('gate',     '_MINNOR_GATES_01', 100),
        ('stack',    '_FIREWOODS',   34),
        ('shed',     '_SHED_01',     58),
    ]},
}

# The game draws every one of these at the tower sprites' scale, so a unit of
# Blender is this many world pixels once it lands on screen.
PX_PER_UNIT = UNIT_PX * 0.75


def lay_flat(meshes):
    """Turns a piece so its long horizontal axis runs east-west. The packs are
    inconsistent about this - the elven fence is modelled along X and the orc
    one along Y - and a wall that tiles has to start from a known direction."""
    lo, hi = world_box(meshes)
    if (hi.y - lo.y) > (hi.x - lo.x):
        apply(meshes, Matrix.Rotation(math.radians(90), 4, 'Z'))


def ground_centre(meshes):
    lo, hi = world_box(meshes)
    apply(meshes, Matrix.Translation((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)))


def shoot(sc, meshes, name, margin=0.3):
    """Frames the piece on the game camera and writes the sprite."""
    umin, umax, vmin, vmax = screen_box(meshes)
    lo, hi = world_box(meshes)
    u0, u1 = umin - margin, umax + margin
    v0, v1 = vmin - margin, vmax + margin
    cam = add_camera(sc, u1 - u0, v0, v1)
    cam.location += Vector((1, 0, 0)) * ((u0 + u1) / 2)
    render_to(os.path.join(OUT, name + '.png'))
    return {
        'file': name + '.png',
        'w': sc.render.resolution_x,
        'h': sc.render.resolution_y,
        # Where the ground origin falls in the image, as a fraction of each
        # side, so the game can stand the sprite on a world position.
        'anchorX': (0.0 - u0) / (u1 - u0),
        'anchorY': (v1 - 0.0) / (v1 - v0),
        'baseR': foot_radius(meshes, lo.z + (hi.z - lo.z) * 0.25),
    }


def open_scene(pack):
    sc = light_scene(reset_scene())
    root = pack_dir(pack)
    mat = atlas_material(pack + '_atlas', os.path.join(root, PACK_TEX[pack]))
    return sc, root, mat


def render_barricades(family, spec):
    out = []
    for tier, model in enumerate(spec['tiers']):
        for run in ('ew', 'ns'):
            sc, root, mat = open_scene(spec['pack'])
            if run == 'ns':
                # A north-south wall turns its long faces east and west, away
                # from both the camera and the scene's usual key, so lit like
                # everything else it renders as a black stripe. Its own key
                # comes across the wall instead of along it.
                for o in sc.collection.objects:
                    if o.type == 'LIGHT' and o.name == 'Sun':
                        o.rotation_euler = (math.radians(56), math.radians(26), math.radians(52))
                        o.data.energy = 7.0
            meshes = import_model(os.path.join(root, spec['dir'], model + '.fbx'), mat)
            ground_centre(meshes)
            lay_flat(meshes)
            ground_centre(meshes)

            lo, hi = world_box(meshes)
            apply(meshes, Matrix.Scale(SEG_UNITS / (hi.x - lo.x), 4))
            if run == 'ns':
                # A wall running away from the camera shows the camera almost
                # nothing but its end, which is geometrically right and reads
                # as a stick. Thickening the short axis until it has a face to
                # catch the light turns it back into a wall climbing the
                # screen. Only the thickness moves, so the battlements along
                # the top keep their spacing.
                lo, hi = world_box(meshes)
                thick = hi.y - lo.y
                if thick < NS_THICK_UNITS:
                    apply(meshes, Matrix.Scale(NS_THICK_UNITS / thick, 4, Vector((0, 1, 0))))
                apply(meshes, Matrix.Rotation(math.radians(90), 4, 'Z'))

            entry = shoot(sc, meshes, 'prop_%s_wall%d_%s' % (family, tier + 1, run))
            lo, hi = world_box(meshes)
            entry['run'] = (hi.x - lo.x if run == 'ew' else hi.y - lo.y) * PX_PER_UNIT
            entry['thick'] = (hi.y - lo.y if run == 'ew' else hi.x - lo.x) * PX_PER_UNIT
            entry['tall'] = (hi.z - lo.z) * PX_PER_UNIT
            out.append(entry)
            print('rendered', family, 'wall%d' % (tier + 1), run, flush=True)
    return out


def render_props(family, spec):
    out = {}
    for name, model, target_px in spec['items']:
        sc, root, mat = open_scene(spec['pack'])
        meshes = import_model(os.path.join(root, spec['dir'], model + '.fbx'), mat)
        ground_centre(meshes)
        # Props face the camera three-quarters on, the same turn the towers
        # take, so the whole set reads as one scene.
        apply(meshes, Matrix.Rotation(math.radians(34), 4, 'Z'))
        ground_centre(meshes)
        lo, hi = world_box(meshes)
        apply(meshes, Matrix.Scale((target_px / PX_PER_UNIT) / (hi.z - lo.z), 4))
        out[name] = shoot(sc, meshes, 'prop_%s_%s' % (family, name))
        print('rendered', family, name, flush=True)
    return out


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else 'all'
    path = os.path.join(OUT, 'props.js')
    manifest = {'unitPx': UNIT_PX, 'ss': SS, 'seg': SEG_UNITS * PX_PER_UNIT, 'families': {}}
    if only == 'walls' and os.path.exists(path):
        raw = open(path).read()
        manifest = json.loads(raw[raw.index('{'):raw.rindex('}') + 1])
    for family, spec in BARRICADES.items():
        walls = render_barricades(family, spec)
        if only == 'walls':
            manifest['families'][family]['walls'] = [walls[i * 2:i * 2 + 2] for i in range(len(spec['tiers']))]
            continue
        # [tier][0] is east-west, [tier][1] is north-south.
        manifest['families'][family] = {
            'walls': [walls[i * 2:i * 2 + 2] for i in range(len(spec['tiers']))],
            'props': render_props(family, PROPS[family]),
        }
    with open(path, 'w') as f:
        f.write('/* Generated by tools/build_pack_props.py - do not edit. */\n')
        f.write("'use strict';\n")
        f.write('const PROP_MANIFEST = ' + json.dumps(manifest, indent=2) + ';\n')
    print('wrote', path)


if __name__ == '__main__':
    main()
