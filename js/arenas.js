/* Stage definitions. Each arena owns its size, node layout, ground palette,
   spawn pressure and boss, so adding a stage is a data change rather than a
   code change. WORLD_W/WORLD_H are set from the active arena at load. */
'use strict';

/* Node positions are offsets from the arena centre. */
const ARENAS = [
  {
    id: 'dustbowl',
    towers: 'archer',       // warm earth, elven sandstone archer towers
    name: 'THE DUST BOWL',
    blurb: 'Open ground, six nodes in a wide ring. Nowhere to hide and nothing in your way.',
    width: 1900,
    height: 1350,
    ground: { base: '#2b2f26', fleck: [[40, 70], [44, 74], [34, 56]] },
    tile: 'earth',
    border: 'rgba(210,225,180,0.35)',
    nodes: [
      [0, -285], [0, 285],
      [-355, -115], [355, -115],
      [-355, 115], [355, 115]
    ],
    spawnRate: (p) => 14 + p * 62,
    surgeSize: (p) => lerp(60, 220, p),
    boss: 'matriarch',
    bossScale: 1,
    ambient: 'dust',
    grade: 'rgba(255,225,170,0.06)'
  },
  {
    id: 'foundry',
    towers: 'cannon',       // ash and embers, iron cannon towers
    name: 'THE FOUNDRY',
    blurb: 'Tighter, hotter, and they come faster. Four nodes to hold instead of six.',
    width: 1500,
    height: 1100,
    ground: { base: '#33261f', fleck: [[62, 48], [44, 34], [30, 24]] },
    tile: 'ash',
    border: 'rgba(255,190,140,0.35)',
    nodes: [
      [-300, -190], [300, -190],
      [-300, 190], [300, 190]
    ],
    spawnRate: (p) => 20 + p * 80,
    surgeSize: (p) => lerp(75, 260, p),
    boss: 'foreman',
    bossScale: 1,
    ambient: 'embers',
    grade: 'rgba(255,120,60,0.09)'
  },
  {
    id: 'ascent',
    towers: 'orc',          // the orc fortress the corridor climbs through
    void: '#0e1014',      // the dark either side of the corridor
    name: 'THE ASCENT',
    blurb: 'A climb, not a hold. They pour down the stairs; the Juggernaut waits caged at the top.',
    width: 1000,
    height: 3400,
    mode: 'gauntlet',
    ground: { base: '#262a2e', fleck: [[52, 74], [56, 78], [62, 86]] },
    tile: 'stone',
    border: 'rgba(170,190,220,0.45)',
    // Offsets from centre (500, 1700): a node every ~600 up the corridor.
    nodes: [
      [-230, 1250], [230, 700], [-230, 150], [230, -400], [-230, -950]
    ],
    // Enemy sources. Alternating walls, denser toward the top.
    stairs: [
      { side: 'left', y: 3120 }, { side: 'right', y: 2700 },
      { side: 'left', y: 2280 }, { side: 'right', y: 1880 },
      { side: 'left', y: 1480 }, { side: 'right', y: 1120 },
      { side: 'left', y: 760 },  { side: 'right', y: 480 },
      { side: 'left', y: 260 },  { side: 'right', y: 260 }
    ],
    ally: { x: 500, y: 150 },
    playerStart: { x: 500, y: 3230 },
    spawnRate: (p) => 15 + p * 50,
    surgeSize: (p) => lerp(45, 170, p),
    boss: 'warden',
    bossScale: 1,
    ambient: 'mist',
    grade: 'rgba(120,150,210,0.08)'
  },
  {
    id: 'crossroads',
    towers: 'ballista',     // earth again, but bolt throwers
    name: 'THE CROSSROADS',
    blurb: 'Two roads meet. One node at the junction buys time; the four at the road ends decide whether you keep it.',
    width: 1800,
    height: 1300,
    tile: 'earth',
    ground: { base: '#2b2f26', fleck: [[40, 70], [44, 74], [34, 56]] },
    border: 'rgba(210,225,180,0.35)',
    // A junction node the player can reach from anywhere, and a node on
    // each arm covering the lane the crowd uses to reach it.
    nodes: [
      [0, 0],
      [0, -430], [0, 430],
      [-620, 0], [620, 0]
    ],
    spawnRate: (p) => 16 + p * 66,
    surgeSize: (p) => lerp(65, 230, p),
    boss: 'foreman',
    bossScale: 1.15,
    ambient: 'dust',
    grade: 'rgba(255,225,170,0.06)'
  },
  {
    id: 'bridge',
    towers: 'elven',        // the high elven fortress over the chasm
    void: '#0a0f1a',        // the chasm
    name: 'THE BRIDGE',
    blurb: 'A long span with the hoard at both ends. Nodes at each abutment hold a side; the one at mid-span is the only place that covers both.',
    width: 2400,
    height: 700,
    tile: 'stone',
    ground: { base: '#262a2e', fleck: [[52, 74], [56, 78], [62, 86]] },
    border: 'rgba(170,190,220,0.45)',
    spawnSides: [1, 3],       // east and west only - it is a bridge
    nodes: [
      [-900, -120], [-900, 120],
      [0, 0],
      [900, -120], [900, 120]
    ],
    spawnRate: (p) => 18 + p * 70,
    surgeSize: (p) => lerp(70, 250, p),
    boss: 'warden',
    bossScale: 1.2,
    ambient: 'mist',
    grade: 'rgba(120,150,210,0.08)'
  },
  {
    id: 'pit',
    towers: 'flame',        // fire towers for a pit that already burns
    name: 'THE PIT',
    blurb: 'Nowhere to run. Three nodes in a tight triangle at the centre: hold the middle or lose everything at once.',
    width: 1200,
    height: 950,
    tile: 'ash',
    ground: { base: '#33261f', fleck: [[62, 48], [44, 34], [30, 24]] },
    border: 'rgba(255,190,140,0.35)',
    nodes: [
      [0, -150], [-140, 100], [140, 100]
    ],
    spawnRate: (p) => 22 + p * 84,
    surgeSize: (p) => lerp(70, 240, p),
    boss: 'matriarch',
    bossScale: 1.3,
    ambient: 'embers',
    grade: 'rgba(255,120,60,0.1)'
  },
  {
    id: 'bastion',
    towers: 'arcane',       // arcane spires on the last stand
    name: 'THE BASTION',
    blurb: 'They come from the north, all of them. Five nodes in a line make a wall; the surges try to walk around its ends.',
    width: 2000,
    height: 1200,
    tile: 'stone',
    ground: { base: '#262a2e', fleck: [[52, 74], [56, 78], [62, 86]] },
    border: 'rgba(170,190,220,0.45)',
    spawnSides: [0],          // the north edge
    surgeSides: [1, 3],       // surges flank around the wall's ends
    nodes: [
      [-700, 60], [-350, 20], [0, 0], [350, 20], [700, 60]
    ],
    playerStart: { x: 1000, y: 850 },
    spawnRate: (p) => 20 + p * 78,
    surgeSize: (p) => lerp(80, 260, p),
    boss: 'warden',
    bossScale: 1.4,
    ambient: 'mist',
    grade: 'rgba(120,150,210,0.08)'
  }
];

function arenaById(id) {
  return ARENAS.find((a) => a.id === id) || ARENAS[0];
}

/* Which stages the player has cleared, so stage 2 can stay locked. */
const Progress = {
  cleared: {},

  load() {
    try {
      this.cleared = JSON.parse(localStorage.getItem('hoard.cleared') || '{}') || {};
    } catch (e) {
      this.cleared = {};
    }
  },

  markCleared(id) {
    this.cleared[id] = true;
    try { localStorage.setItem('hoard.cleared', JSON.stringify(this.cleared)); } catch (e) { /* ignore */ }
  },

  isUnlocked(index) {
    return index === 0 || !!this.cleared[ARENAS[index - 1].id];
  }
};
