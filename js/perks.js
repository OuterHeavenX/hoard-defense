/* Level-up perk draft.

   Kills earn XP; each level pauses the fight and offers three perks. Effects
   are applied as multipliers held on the Game so the draft never has to reach
   into the simulation at more than one point per stat. */
'use strict';

/* Thresholds climb quadratically: a cleared run kills upwards of 14,000, and
   a flat cost would hand out hundreds of levels. This lands around 12-15. */
function xpForLevel(level) {
  return 55 + level * level * 16;
}

const PERKS = [
  {
    id: 'pierce', name: 'ARMOUR PIERCING', max: 3,
    desc: 'Your shots pass through +1 extra body.',
    apply: (g) => { g.player.pierce += 1; }
  },
  {
    id: 'firerate', name: 'TRIGGER DISCIPLINE', max: 5,
    desc: 'Fire 15% faster.',
    apply: (g) => { g.player.fireInterval *= 0.85; }
  },
  {
    id: 'damage', name: 'HEAVY ROUNDS', max: 5,
    desc: '+3 damage per shot.',
    apply: (g) => { g.player.damage += 3; }
  },
  {
    id: 'multishot', name: 'SPLIT BARREL', max: 2,
    desc: 'Fire one additional shot in a spread.',
    apply: (g) => { g.player.shots += 1; }
  },
  {
    id: 'magnet', name: 'PROSPECTOR', max: 3,
    desc: 'Gold is pulled in from 45% further away.',
    apply: (g) => { g.player.magnetRadius *= 1.45; }
  },
  {
    id: 'goldvalue', name: 'FENCE CONTACT', max: 3,
    desc: 'Every coin is worth 30% more.',
    apply: (g) => { g.goldMul *= 1.3; }
  },
  {
    id: 'deposit', name: 'FAST HANDS', max: 2,
    desc: 'Pour gold into nodes 60% faster.',
    apply: (g) => { g.depositMul *= 1.6; }
  },
  {
    id: 'turretdmg', name: 'CALIBRATED NODES', max: 4,
    desc: 'Every turret deals 25% more damage.',
    apply: (g) => { g.turretDamageMul *= 1.25; }
  },
  {
    id: 'turretrate', name: 'AUTOLOADERS', max: 3,
    desc: 'Every turret fires 18% faster.',
    apply: (g) => { g.turretRateMul *= 0.82; }
  },
  {
    id: 'speed', name: 'LIGHT BOOTS', max: 3,
    desc: 'Move 9% faster.',
    apply: (g) => { g.player.speed *= 1.09; }
  },
  {
    id: 'dash', name: 'SECOND WIND', max: 3,
    desc: 'Dash recharges 30% sooner.',
    apply: (g) => { g.player.dashCooldownMax *= 0.7; }
  },
  {
    id: 'health', name: 'FIELD PLATING', max: 4,
    desc: '+30 max health, and heal that much now.',
    apply: (g) => { g.player.maxHp += 30; g.player.heal(30); }
  },
  {
    id: 'scavenger', name: 'SCAVENGER', max: 2,
    desc: 'Every coin you collect heals 1 health.',
    apply: (g) => { g.scavenger += 1; }
  },
  {
    id: 'nova', name: 'PULSE CHARGE', max: 3,
    desc: 'Release a damaging shockwave around you every few seconds.',
    apply: (g) => { g.novaLevel += 1; }
  }
];

/* Three distinct perks the player has not already maxed out. */
function rollPerks(game, count) {
  const pool = PERKS.filter((p) => (game.perkStacks[p.id] || 0) < p.max);
  const picked = [];
  while (picked.length < count && pool.length) {
    const i = (Math.random() * pool.length) | 0;
    picked.push(pool.splice(i, 1)[0]);
  }
  return picked;
}

function applyPerk(game, perk) {
  perk.apply(game);
  game.perkStacks[perk.id] = (game.perkStacks[perk.id] || 0) + 1;
}
