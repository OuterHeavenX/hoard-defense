"""Renders the game's castle assets with Blender (via the bpy module).

Run:  python3 tools/render_assets.py
Out:  assets/tower_L0.png .. tower_L5.png, assets/ground_stone.png

The camera is orthographic at the elevation whose sine is the game's TILT
(0.58). At that angle a circle on the ground renders as an ellipse with the
same 0.58 aspect the game already uses for node pads, so a rendered tower's
round top sits flush on its pad without any fudging in the renderer.
"""
import math, os, sys
import bpy

TILT = 0.58
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
UNIT_PX = 10          # 1 Blender unit == 10 game-world px
SS = 2                # supersample; the game draws sprites at half this size
SAMPLES = int(os.environ.get('SAMPLES', '48'))


# ---------------------------------------------------------------- scene

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

    world = bpy.data.worlds.new('World')
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.55, 0.62, 0.75, 1)   # cool sky fill
    bg.inputs[1].default_value = 0.32

    # Key light: warm sun from upper-left, like the reference photos.
    sun_data = bpy.data.lights.new('Sun', 'SUN')
    sun_data.energy = 5.5
    sun_data.color = (1.0, 0.93, 0.8)
    sun_data.angle = math.radians(6)
    sun = bpy.data.objects.new('Sun', sun_data)
    sc.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(48), math.radians(-28), math.radians(-40))
    return sc


def add_camera(sc, ortho_width, look_at_z, aspect):
    """Orthographic camera on the game's tilt, framing `ortho_width` units."""
    cam_data = bpy.data.cameras.new('Cam')
    cam_data.type = 'ORTHO'
    # Blender's ortho_scale spans the LONGER frame side, so a portrait frame
    # must scale it up by the aspect or the width shrinks to fit the height.
    cam_data.ortho_scale = ortho_width * max(1.0, aspect)
    cam_data.clip_end = 500
    cam = bpy.data.objects.new('Cam', cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    elev = math.asin(TILT)                     # 35.5 degrees above horizontal
    dist = 120
    cam.location = (0, -math.cos(elev) * dist, look_at_z + math.sin(elev) * dist)
    cam.rotation_euler = (math.pi / 2 - elev, 0, 0)
    sc.render.resolution_x = int(ortho_width * UNIT_PX * SS)
    sc.render.resolution_y = int(ortho_width * UNIT_PX * SS * aspect)
    return cam


# ------------------------------------------------------------- material

def stone_material(name, base=(0.62, 0.55, 0.42), mortar=(0.32, 0.29, 0.25), brick_scale=5.0, cylindrical=True):
    """Coursed sandstone: brick texture for the joints, noise for weathering,
    both feeding the bump so the relief reads at sprite size."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nodes, links = nt.nodes, nt.links
    nodes.clear()

    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Roughness'].default_value = 0.85
    links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    coords = nodes.new('ShaderNodeTexCoord')

    # Wrap the coursing around the drum: u = arc length, v = height. The
    # atan2 seam is placed at +Y, the side the camera never sees.
    sep = nodes.new('ShaderNodeSeparateXYZ')
    links.new(coords.outputs['Object'], sep.inputs['Vector'])
    neg_y = nodes.new('ShaderNodeMath'); neg_y.operation = 'MULTIPLY'; neg_y.inputs[1].default_value = -1.0
    links.new(sep.outputs['Y'], neg_y.inputs[0])
    ang = nodes.new('ShaderNodeMath'); ang.operation = 'ARCTAN2'
    links.new(sep.outputs['X'], ang.inputs[0])
    links.new(neg_y.outputs[0], ang.inputs[1])
    arc = nodes.new('ShaderNodeMath'); arc.operation = 'MULTIPLY'; arc.inputs[1].default_value = 2.8
    links.new(ang.outputs[0], arc.inputs[0])
    cyl = nodes.new('ShaderNodeCombineXYZ')
    links.new(arc.outputs[0], cyl.inputs['X'])
    links.new(sep.outputs['Z'], cyl.inputs['Y'])
    # Flat surfaces (the floor tile) keep plain XY; drums use the wrap.
    tex_vec = cyl.outputs['Vector'] if cylindrical else coords.outputs['Object']

    brick = nodes.new('ShaderNodeTexBrick')
    brick.inputs['Scale'].default_value = brick_scale * 0.32
    brick.inputs['Mortar Size'].default_value = 0.035
    brick.inputs['Mortar Smooth'].default_value = 0.25
    brick.inputs['Bias'].default_value = 0.0
    brick.inputs['Brick Width'].default_value = 1.1
    brick.inputs['Row Height'].default_value = 0.5
    brick.inputs['Color1'].default_value = (*base, 1)
    brick.inputs['Color2'].default_value = (base[0] * 0.86, base[1] * 0.86, base[2] * 0.86, 1)
    brick.inputs['Mortar'].default_value = (*mortar, 1)
    links.new(tex_vec, brick.inputs['Vector'])

    # Per-block colour variation and grime.
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 3.0
    noise.inputs['Detail'].default_value = 6.0
    noise.inputs['Roughness'].default_value = 0.6
    links.new(coords.outputs['Object'], noise.inputs['Vector'])

    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (0.72, 0.68, 0.62, 1)
    ramp.color_ramp.elements[1].position = 0.7
    ramp.color_ramp.elements[1].color = (1.05, 1.02, 0.98, 1)
    links.new(noise.outputs['Fac'], ramp.inputs['Fac'])

    mix = nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    links.new(brick.outputs['Color'], mix.inputs[6])
    links.new(ramp.outputs['Color'], mix.inputs[7])
    links.new(mix.outputs[2], bsdf.inputs['Base Color'])

    # Bump: mortar recesses plus fine grain.
    grain = nodes.new('ShaderNodeTexNoise')
    grain.inputs['Scale'].default_value = 40.0
    grain.inputs['Detail'].default_value = 4.0
    links.new(coords.outputs['Object'], grain.inputs['Vector'])
    bump_mix = nodes.new('ShaderNodeMath')
    bump_mix.operation = 'ADD'
    links.new(brick.outputs['Fac'], bump_mix.inputs[0])
    scaled = nodes.new('ShaderNodeMath')
    scaled.operation = 'MULTIPLY'
    scaled.inputs[1].default_value = 0.25
    links.new(grain.outputs['Fac'], scaled.inputs[0])
    links.new(scaled.outputs[0], bump_mix.inputs[1])
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.55
    bump.inputs['Distance'].default_value = 0.08
    links.new(bump_mix.outputs[0], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return m


# ------------------------------------------------------------ geometry

def link(obj, sc):
    sc.collection.objects.link(obj)
    return obj


def cylinder(sc, name, radius, height, z0=0.0, verts=48, mat=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=height,
                                        location=(0, 0, z0 + height / 2))
    o = bpy.context.active_object
    o.name = name
    if mat:
        o.data.materials.append(mat)
    return o


def ring_of_merlons(sc, name, radius, z, count, w, h, d, mat):
    """Battlements: `count` blocks around the parapet at height z."""
    made = []
    for i in range(count):
        a = 2 * math.pi * i / count
        bpy.ops.mesh.primitive_cube_add(size=1, location=(math.cos(a) * radius, math.sin(a) * radius, z + h / 2))
        o = bpy.context.active_object
        o.scale = (w, d, h)
        o.rotation_euler = (0, 0, a)
        o.name = f'{name}_{i}'
        o.data.materials.append(mat)
        made.append(o)
    return made


def arrow_slits(sc, name, radius, z, count, h, mat_dark):
    """Thin dark recesses around the drum, offset so they read from the camera."""
    for i in range(count):
        a = 2 * math.pi * i / count + math.pi / count
        bpy.ops.mesh.primitive_cube_add(size=1, location=(math.cos(a) * (radius - 0.02), math.sin(a) * (radius - 0.02), z))
        o = bpy.context.active_object
        o.scale = (0.12, 0.35, h)
        o.rotation_euler = (0, 0, a)
        o.name = f'{name}_{i}'
        o.data.materials.append(mat_dark)


def corbels(sc, name, radius, z, count, mat):
    """Machicolation brackets under the parapet, the Warwick detail."""
    for i in range(count):
        a = 2 * math.pi * i / count
        bpy.ops.mesh.primitive_cube_add(size=1, location=(math.cos(a) * radius, math.sin(a) * radius, z))
        o = bpy.context.active_object
        o.scale = (0.28, 0.5, 0.42)
        o.rotation_euler = (0, 0, a)
        o.name = f'{name}_{i}'
        o.data.materials.append(mat)


def build_tower(sc, level, stone, dark, floor):
    """Level 0 is an unbuilt foundation; each tier adds height and detail."""
    spec = {
        0: dict(r=2.7, h=1.2, merlons=0,  slits=0, corbel=False, tiers=1),
        1: dict(r=2.6, h=6.0, merlons=10, slits=0, corbel=False, tiers=1),
        2: dict(r=2.7, h=8.5, merlons=12, slits=4, corbel=False, tiers=1),
        3: dict(r=2.8, h=11.0, merlons=12, slits=6, corbel=True, tiers=1),
        4: dict(r=2.9, h=13.5, merlons=14, slits=6, corbel=True, tiers=2),
        5: dict(r=3.1, h=16.5, merlons=16, slits=8, corbel=True, tiers=2),
    }[level]
    r, h = spec['r'], spec['h']

    # Battered plinth so the base reads as sitting in the ground.
    cylinder(sc, 'plinth', r * 1.15, 0.9, z0=0, mat=stone)
    drum = cylinder(sc, 'drum', r, h, z0=0.9, mat=stone)
    top = 0.9 + h

    if spec['corbel']:
        corbels(sc, 'corbel', r + 0.05, top - 0.55, spec['merlons'], stone)
        # Parapet oversails the drum on the corbels.
        cylinder(sc, 'parapet', r + 0.32, 0.7, z0=top - 0.2, mat=stone)
        top += 0.5
        pr = r + 0.32
    else:
        pr = r

    if spec['merlons']:
        # Parapet floor, then the merlons standing on it.
        cylinder(sc, 'deck', pr, 0.25, z0=top, mat=stone)
        ring_of_merlons(sc, 'merlon', pr - 0.2, top + 0.25, spec['merlons'], 0.55, 0.4, 0.9, stone)
        # Inner walkway floor sits slightly below the parapet lip, in shadow.
        cylinder(sc, 'walk', pr - 0.45, 0.05, z0=top + 0.22, mat=floor)

    if spec['slits']:
        step = h / (spec['slits'] // 2 + 1)
        for k in range(1, spec['slits'] // 2 + 1):
            arrow_slits(sc, f'slit{k}', r, 0.9 + step * k, 4, 0.9, dark)

    if spec['tiers'] == 2:
        # A turret cap: a smaller drum rising from the walkway.
        cr = pr * 0.42
        cylinder(sc, 'turret', cr, 2.6, z0=top + 0.25, mat=stone)
        ring_of_merlons(sc, 'tmerlon', cr - 0.1, top + 0.25 + 2.6, 6, 0.3, 0.25, 0.5, stone)

    deck = top + 0.25
    return top + (3.5 if spec['tiers'] == 2 else 1.4), deck, r * 1.15


def render_to(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def render_towers():
    """Six sprites plus a manifest the game reads to place them: where the
    ground origin and the walkway deck fall in each image, as fractions of
    its height, and the pixel scale."""
    import json
    manifest = {'unitPx': UNIT_PX, 'ss': SS, 'levels': []}
    elev = math.asin(TILT)
    for level in range(6):
        sc = reset_scene()
        stone = stone_material('stone')
        dark = bpy.data.materials.new('dark')
        dark.use_nodes = True
        dark.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.04, 0.04, 0.05, 1)
        floor = bpy.data.materials.new('floor')
        floor.use_nodes = True
        floor.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.16, 0.15, 0.14, 1)
        floor.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.95
        top, deck, base_r = build_tower(sc, level, stone, dark, floor)

        width = 9.0
        lo = -base_r * math.sin(elev) - 0.4        # plinth's near rim
        hi = top * math.cos(elev) + 0.5             # highest point
        aspect = (hi - lo) / width
        cam = add_camera(sc, width, 0, aspect)
        mid = (hi + lo) / 2
        cam.location = (cam.location.x, cam.location.y + math.sin(elev) * mid, cam.location.z + math.cos(elev) * mid)

        name = f'tower_L{level}.png'
        render_to(os.path.join(OUT, name))
        manifest['levels'].append({
            'file': name,
            'w': sc.render.resolution_x, 'h': sc.render.resolution_y,
            # Fractions of image height, measured from the top edge.
            'anchorY': hi / (hi - lo),                          # ground origin
            'deckY': (hi - deck * math.cos(elev)) / (hi - lo),  # walkway centre
            'baseR': base_r
        })
        print(f'rendered {name}: top={top:.1f} deck={deck:.1f}')

    # Embedded as JS: fetch() of a local JSON file is blocked over file://,
    # and the game must keep opening straight from index.html.
    with open(os.path.join(OUT, 'manifest.js'), 'w') as f:
        f.write('/* Generated by tools/render_assets.py - do not edit. */\n')
        f.write("'use strict';\nconst TOWER_MANIFEST = " + json.dumps(manifest, indent=2) + ';\n')
    print('wrote manifest.js')


def earth_material(name, base, dark):
    """Packed dirt: no coursing, just layered noise and a little grit."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.95
    coords = nodes.new('ShaderNodeTexCoord')
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 2.2
    noise.inputs['Detail'].default_value = 8.0
    noise.inputs['Roughness'].default_value = 0.7
    links.new(coords.outputs['Object'], noise.inputs['Vector'])
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.38
    ramp.color_ramp.elements[0].color = (*dark, 1)
    ramp.color_ramp.elements[1].position = 0.66
    ramp.color_ramp.elements[1].color = (*base, 1)
    links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    grit = nodes.new('ShaderNodeTexNoise')
    grit.inputs['Scale'].default_value = 60.0
    links.new(coords.outputs['Object'], grit.inputs['Vector'])
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.35
    links.new(grit.outputs['Fac'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return m


TILE_UNITS = 16       # world span of one floor tile, in Blender units
TILE_PX = 512         # the game repeats the tile at 1 image px per world px


def render_ground():
    """Top-down tiles. The flagstone brick count divides the tile exactly so
    the coursing repeats seamlessly; the noise does not, so it is kept low
    contrast where it would show a seam. Brick size is fixed per Blender unit,
    so a larger tile means fewer visible seams and a sharper floor, not bigger
    bricks."""
    tiles = [
        ('ground_stone.png', 'flag', dict(base=(0.17, 0.18, 0.20), mortar=(0.06, 0.06, 0.07))),
        ('ground_earth.png', 'earth', dict(base=(0.16, 0.15, 0.10), dark=(0.06, 0.06, 0.04))),
        ('ground_ash.png', 'earth', dict(base=(0.17, 0.11, 0.09), dark=(0.06, 0.04, 0.04))),
    ]
    for name, kind, pal in tiles:
        sc = reset_scene()
        sc.render.film_transparent = False
        if kind == 'flag':
            m = stone_material('floor', base=pal['base'], mortar=pal['mortar'], brick_scale=1.0, cylindrical=False)
            brick = next(n for n in m.node_tree.nodes if n.type == 'TEX_BRICK')
            brick.inputs['Scale'].default_value = 1.0
            brick.inputs['Brick Width'].default_value = 1.0     # TILE_UNITS across the tile
            brick.inputs['Row Height'].default_value = 0.5      # 2 * TILE_UNITS rows
            brick.inputs['Mortar Size'].default_value = 0.05
            ramp = next(n for n in m.node_tree.nodes if n.type == 'VALTORGB')
            ramp.color_ramp.elements[0].color = (0.86, 0.85, 0.84, 1)   # quieter variation
        else:
            m = earth_material('floor', pal['base'], pal['dark'])
        bpy.ops.mesh.primitive_plane_add(size=TILE_UNITS, location=(0, 0, 0))
        plane = bpy.context.active_object
        plane.data.materials.append(m)
        cam_data = bpy.data.cameras.new('Cam')
        cam_data.type = 'ORTHO'
        cam_data.ortho_scale = TILE_UNITS
        cam = bpy.data.objects.new('Cam', cam_data)
        sc.collection.objects.link(cam)
        sc.camera = cam
        cam.location = (0, 0, 40)
        sc.render.resolution_x = sc.render.resolution_y = TILE_PX
        for o in sc.collection.objects:
            if o.type == 'LIGHT':
                o.rotation_euler = (math.radians(18), math.radians(-8), math.radians(-35))
                o.data.energy = 2.0
        render_to(os.path.join(OUT, name))
        print('rendered', name)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    which = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if which in ('all', 'towers'):
        render_towers()
    if which in ('all', 'ground'):
        render_ground()
