/**
 * PCCOE campus geography — the digital reconstruction of the surveyed site
 * plan displayed on the college's campus board (Akurdi, Pune).
 *
 * Every coordinate below was traced from that board plan, keeping the real
 * perimeter, the real building footprints, the two open grounds, the internal
 * road links and the building numbers exactly as surveyed. The plan is stored
 * in one local coordinate space (the board plan's own proportions, offset so
 * the top-left of the site sits near the origin) so the SVG can scale it
 * losslessly to any viewport.
 *
 * The file is deliberately data-only: components under `components/map/`
 * render it, and nothing here knows about colours or interaction.
 */

/** The traced plan's bounding box in local coordinates. */
export const CAMPUS_VIEWBOX = { x: 0, y: 0, width: 1700, height: 2320 };

/**
 * The campus perimeter wall, one closed polygon, clockwise from the north
 * gate (Gate No. 4) on the 18 m wide road.
 */
export const CAMPUS_PERIMETER = [
  [1093, 43],
  [1207, 53],
  [1268, 70],
  [1300, 95],
  [1500, 67],
  [1657, 67],
  [1653, 163],
  [1557, 780],
  [1457, 893],
  [1223, 1490],
  [1063, 1460],
  [777, 2250],
  [40, 1410],
  [320, 1197],
  [613, 990],
  [827, 830],
  [1073, 697],
  [1043, 200],
];

/** Internal road links, drawn as quiet bands between the blocks they serve. */
export const CAMPUS_ROADS = [
  // North spine: Gate No. 4 down between the hostel column and the ground.
  { id: 'road-north', points: [[1188, 60], [1266, 60], [1266, 726], [1188, 726]] },
  // Service lane under the Boys Hostel, linking the spine to the ground edge.
  { id: 'road-hostel', points: [[1267, 205], [1587, 205], [1587, 278], [1267, 278]] },
  // The diagonal main road from the central junction to Gate No. 1.
  { id: 'road-wing', points: [[1073, 690], [1103, 760], [420, 1310], [390, 1240]] },
  // Cross road separating the academic block (06) from the workshop row (08).
  { id: 'road-mid', points: [[1063, 900], [1120, 910], [1080, 1350], [1023, 1340]] },
  // South road from the central lawn junction down past 09 to Gate No. 3.
  { id: 'road-south', points: [[980, 1420], [1050, 1440], [860, 2100], [790, 2080]] },
];

/** The two major open grounds of the campus, plus their surveyed markings. */
export const CAMPUS_GROUNDS = [
  {
    id: 'ground-main',
    label: 'GROUND',
    sublabel: 'CRICKET PITCH',
    points: [
      [1267, 280],
      [1627, 280],
      [1503, 760],
      [1283, 733],
    ],
    labelAt: [1447, 350],
    // The pitch marking surveyed at the centre of the ground.
    mark: [
      [1392, 470],
      [1404, 470],
      [1404, 560],
      [1392, 560],
    ],
  },
  {
    id: 'ground-lawn',
    label: 'OPEN SPACE',
    sublabel: '(LAWN)',
    points: [
      [697, 1170],
      [893, 1410],
      [520, 1677],
      [330, 1433],
    ],
    labelAt: [610, 1420],
  },
];

/**
 * Numbered building footprints, exactly as surveyed. A directory entry may
 * span several footprints (the polytechnic occupies blocks 1, 1-EXT and 2).
 */
export const CAMPUS_FOOTPRINTS = [
  {
    id: 'b1',
    label: '1',
    labelAt: [455, 1172],
    polys: [
      [
        [330, 1183],
        [537, 1103],
        [587, 1160],
        [380, 1243],
      ],
    ],
  },
  {
    id: 'b1x',
    label: '1-EXT',
    small: true,
    labelAt: [836, 980],
    polys: [
      [
        [610, 1100],
        [1017, 800],
        [1063, 857],
        [657, 1160],
      ],
    ],
  },
  {
    id: 'b2',
    label: '2',
    labelAt: [220, 1354],
    polys: [
      [
        [143, 1363],
        [260, 1297],
        [300, 1343],
        [183, 1413],
      ],
    ],
  },
  {
    id: 'b3',
    label: '3',
    labelAt: [1427, 170],
    polys: [
      [
        [1267, 137],
        [1587, 137],
        [1587, 203],
        [1267, 203],
      ],
    ],
  },
  {
    id: 'b5',
    label: '5',
    labelAt: [358, 1595],
    polys: [
      [
        [243, 1490],
        [397, 1467],
        [473, 1687],
        [320, 1737],
      ],
    ],
  },
  {
    id: 'b6',
    label: '6',
    labelAt: [1210, 1160],
    polys: [
      [
        [1097, 917],
        [1387, 960],
        [1310, 1200],
        [1220, 1427],
        [1067, 1343],
      ],
    ],
  },
  {
    id: 'b7',
    label: '7',
    labelAt: [1145, 545],
    polys: [
      [
        [1100, 403],
        [1180, 410],
        [1187, 687],
        [1113, 687],
      ],
    ],
  },
  {
    id: 'b7a',
    label: '7A',
    labelAt: [1135, 235],
    polys: [
      [
        [1100, 80],
        [1163, 93],
        [1167, 387],
        [1110, 387],
      ],
    ],
  },
  {
    id: 'b8',
    label: '8',
    labelAt: [930, 1105],
    polys: [
      [
        [780, 1117],
        [1060, 940],
        [1063, 1103],
        [1000, 1160],
        [1023, 1217],
        [957, 1293],
      ],
    ],
  },
  {
    id: 'b9',
    label: '9',
    labelAt: [855, 1660],
    polys: [
      [
        [783, 1473],
        [927, 1500],
        [863, 1873],
        [743, 1820],
      ],
    ],
  },
  {
    id: 'b10',
    label: '10',
    labelAt: [700, 1975],
    polys: [
      [
        [627, 1877],
        [803, 1947],
        [767, 2040],
        [720, 2023],
        [697, 2093],
        [583, 2047],
      ],
    ],
  },
  {
    id: 'b11',
    label: '11',
    labelAt: [553, 1806],
    polys: [
      [
        [463, 1690],
        [677, 1743],
        [633, 1923],
        [440, 1870],
      ],
    ],
  },
];

/** Unnumbered surveyed structures kept for geographical fidelity. */
export const CAMPUS_LANDMARKS = [
  {
    id: 'sports',
    label: 'SPORTS COMPLEX',
    labelAt: [1315, 823],
    points: [
      [1213, 740],
      [1436, 780],
      [1399, 907],
      [1199, 867],
    ],
  },
];

/** Covered walkway slats surveyed along the academic block's west face. */
export const CAMPUS_WALKWAY = [
  [
    [1040, 883],
    [1093, 893],
    [1080, 990],
    [1027, 980],
  ],
  [
    [1013, 990],
    [1067, 1000],
    [1053, 1097],
    [1000, 1087],
  ],
  [
    [987, 1097],
    [1040, 1107],
    [1027, 1203],
    [973, 1193],
  ],
  [
    [960, 1203],
    [1013, 1213],
    [1000, 1310],
    [947, 1300],
  ],
];

/** Hatched surveyed areas (parking / paved wedges) between the blocks. */
export const CAMPUS_HATCHES = [
  [
    [760, 1090],
    [830, 1150],
    [770, 1170],
  ],
  [
    [733, 1420],
    [860, 1350],
    [800, 1580],
  ],
  [
    [1080, 700],
    [1140, 700],
    [1100, 760],
  ],
];

/** The four surveyed gates, with the board's own numbering. */
export const CAMPUS_GATES = [
  { id: 'gate-4', label: 'GATE NO. 4', at: [1284, 82] },
  { id: 'gate-1', label: 'GATE NO. 1', at: [40, 1410] },
  { id: 'gate-2', label: 'GATE NO. 2', at: [360, 1843] },
  { id: 'gate-3', label: 'GATE NO. 3', at: [667, 2213] },
];

/** Surrounding road annotations carried over from the board plan. */
export const CAMPUS_CONTEXT = [
  { id: 'ctx-west', text: '7.50 M. WIDE ROAD', at: [905, 300], rotate: -90 },
  { id: 'ctx-sw', text: '18 M. WIDE ROAD', at: [255, 1690], rotate: 49 },
  { id: 'ctx-s', text: 'TO AKURDI RAILWAY STATION', at: [760, 2300], rotate: 0 },
];

/**
 * The building directory, in the board plan's own order. Names are the
 * board's "details of building" column verbatim; nothing is invented.
 */
export const BUILDING_DIRECTORY = [
  { no: '1,2', name: 'Pimpri Chinchwad Polytechnic', footprints: ['b1', 'b1x', 'b2'] },
  { no: '3', name: 'Boys Hostel', footprints: ['b3'] },
  { no: '5', name: 'Admin Office (P. Dept., Trust Office)', footprints: ['b5'] },
  { no: '6', name: 'Academic Building', footprints: ['b6'] },
  { no: '7', name: 'S.B. Patil Institute of Management', footprints: ['b7'] },
  { no: '7A', name: 'Girls Hostel', footprints: ['b7a'] },
  {
    no: '8',
    name: 'Training & Placement Department, Workshop, S.B. Patil College of Architecture & Design',
    footprints: ['b8'],
  },
  { no: '9', name: 'Civil & Mechanical Engineering', footprints: ['b9'] },
  { no: '10', name: 'Girls Hostel & Canteen', footprints: ['b10'] },
  {
    no: '11',
    name: 'Library, Computer Engineering, Examination & Evaluation',
    footprints: ['b11'],
  },
];

/** Footprint id → footprint, for components that render the plan directly. */
export const FOOTPRINT_BY_ID = Object.fromEntries(CAMPUS_FOOTPRINTS.map((footprint) => [footprint.id, footprint]));

/** Directory entry → the footprint ids it lights up on the plan. */
export function footprintsForEntry(entry) {
  return entry?.footprints ?? [];
}

/** Find directory entries whose number or name matches a free-text query. */
export function searchDirectory(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return BUILDING_DIRECTORY.filter((entry) => {
    const no = entry.no.toLowerCase();
    return no === q || no.includes(q) || entry.name.toLowerCase().includes(q);
  });
}
