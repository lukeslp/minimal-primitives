// Rimlight's boards are authored little solar systems. Coordinates live in a
// 600 by 600 well whose centre is (300, 300); an orbit only advances in flight.
const C = 300;
const rad = degrees => degrees * Math.PI / 180;
const point = (radius, degrees) => ({ x: Math.round(C + Math.cos(rad(degrees)) * radius), y: Math.round(C + Math.sin(rad(degrees)) * radius) });
const world = (radius, degrees, { target = false, size = 16, mass = Math.round(size * size * 0.62), kind = 'planet', tilt = rad(degrees + 28), orbit } = {}) => ({
  ...point(radius, degrees), r: size, mass, kind, target, tilt, ...(orbit ? { orbit } : {})
});
const moon = (radius, degrees, size = 7, options = {}) => world(radius, degrees, { ...options, size, mass: options.mass ?? 150, kind: 'moon' });
const target = (radius, degrees, options = {}) => world(radius, degrees, { ...options, target: true });
const planet = (radius, degrees, options = {}) => world(radius, degrees, options);
const orbiter = (radius, phase, options = {}) => world(radius, phase * 180 / Math.PI, {
  ...options,
  orbit: { radius, phase, speed: options.speed ?? 0.19 }
});

// Every target is deliberately small and kept well clear of other bodies.
// Beyond the opening, planetary masses make a centred proposal miss.
export const levels = [
  {
    name: 'First light', concept: 'Fire', star: false, decay: 0, balls: 3,
    hint: '',
    pegs: [target(118, 90, { size: 11, mass: 180 })]
  },
  {
    name: 'The bend', concept: 'Curve around the star', star: { mass: 1000 }, decay: 0.2, starDrain: true, balls: 3,
    hint: '',
    pegs: [target(118, 90, { size: 11, mass: 180 })]
  },
  {
    name: 'Slingshot', concept: 'Slingshot through a well', balls: 3,
    hint: 'Skim the well: the far ring needs its slingshot.',
    pegs: [planet(197, 27, { size: 30, mass: 8000 }), target(175, 0, { size: 11, mass: 300 })]
  },
  {
    name: 'Moon lace', concept: 'Loose moon screen', balls: 2,
    hint: 'Thread the loose moon lace; their small wells still tug.',
    pegs: [
      target(175, -150, { size: 11, mass: 200 }),
      moon(229, -143, 9, { mass: 1200 }),
      moon(176, -77, 6, { mass: 165 }),
      moon(208, -104, 9, { mass: 250 }),
      moon(152, -12, 5, { mass: 125 })
    ]
  },
  {
    name: 'Relay', concept: 'Two-target chain', balls: 4,
    hint: 'Use the central assist to relay one ring into the other.',
    pegs: [
      planet(170, 150, { size: 30, mass: 8000 }),
      target(130, 120, { size: 11, mass: 10 }),
      planet(197, 27, { size: 20, mass: 20000 }),
      target(175, 0, { size: 11, mass: 10 })
    ]
  },
  {
    name: 'Three turns', concept: 'Capture orbit', balls: 2,
    hint: 'This deep well rewards a calm orbit before the exit.',
    pegs: [planet(197, 117.2, { size: 20, mass: 20000 }), target(160, 90, { size: 11, mass: 10 })]
  },
  {
    name: 'Far side', concept: 'Far side of the star', starDrain: true, balls: 2,
    hint: 'The far ring is beyond the drain. Go around it.',
    pegs: [planet(197, 153, { size: 24, mass: 24000 }), target(160, 180, { size: 11, mass: 10 })]
  },
  {
    name: 'Field notes', concept: 'Three-planet field', balls: 2,
    hint: 'Read all three wells; each bends the same line differently.',
    pegs: [
      planet(140, -100, { size: 18, mass: 3000 }),
      planet(220, 150, { size: 25, mass: 6000 }),
      planet(197, 27, { size: 29, mass: 8000 }),
      target(175, 0, { size: 11, mass: 400 })
    ]
  },
  {
    name: 'Moving line', concept: 'Moving timing line', starDrain: true, balls: 2,
    hint: 'The orbit starts only after launch. Time the opening.',
    pegs: [
      orbiter(197, rad(27), { size: 27, mass: 18000, speed: 0.16 }),
      planet(140, -100, { size: 21, mass: 3000 }),
      target(160, 0, { size: 11, mass: 400 }),
      moon(220, 150, 7, { mass: 300 })
    ]
  },
  {
    name: 'Transit', concept: 'Moving transit', balls: 4,
    hint: 'A moving well crosses the transit; use its first bend.',
    pegs: [
      orbiter(197, rad(27), { size: 24, mass: 18000, speed: 0.18 }),
      planet(220, 165, { size: 26, mass: 8000 }),
      target(175, 0, { size: 11, mass: 400 }),
      target(130, 175, { size: 11, mass: 400 })
    ]
  },
  {
    name: 'Paired orbits', concept: 'Paired moving wells', balls: 2,
    hint: 'Two moving wells change the route after the probe leaves.',
    pegs: [
      orbiter(220, rad(165), { size: 26, mass: 30000, speed: 0.22 }),
      orbiter(220, rad(-90), { size: 12, mass: 4000, speed: -0.19 }),
      planet(210, 0, { size: 12, mass: 3000 }),
      target(145, 175, { size: 11, mass: 10 })
    ]
  },
  {
    name: 'Rimlight', concept: 'Moving final field', balls: 2,
    hint: 'Every clear changes the moving field. Leave room to read it.',
    pegs: [
      planet(220, 165, { size: 26, mass: 16000 }),
      orbiter(220, rad(-90), { size: 12, mass: 4000, speed: 0.17 }),
      orbiter(210, 0, { size: 14, mass: 5000, speed: -0.23 }),
      planet(220, 90, { size: 12, mass: 3000 }),
      target(130, 175, { size: 11, mass: 10 })
    ]
  }
];

export const WELL = { width: 600, height: 600, centre: C, rim: 270, hole: 30 };
