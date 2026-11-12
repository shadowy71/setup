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
 *
 * Geometry correction (traced against the board photograph):
 * - The main ground is a near-rectangle under the Boys Hostel — only its
 *   south-east corner is chamfered — not a tapering wedge.
 * - Building 06 is the long notched block east of the central road: its west
 *   face is a comb of three courtyard teeth, its east face carries two small
 *   steps. Building 08 west of that road has the matching stair-stepped east
 *   face, and the hatched walkway pockets sit in 06's west notches.
 * - 1-EXT is one long thin bar hugging the north-west boundary, well clear of
 *   08; 01 and 02 are separate shorter bars in the same row, clear of the lawn.
 * - The lawn ("OPEN SPACE") is an elongated rectangle (long axis NE–SW),
 *   not a diamond. 05 is a long thin bar behind its south-west edge, parallel
 *   to the 18 m road; 09 is a long block east of the lawn with the hatched
 *   triangle between them; 11 is near-square and 10 carries its notch on the
 *   face toward 09. No footprint overlaps another or crosses the perimeter.
 */

/** The traced plan's bounding box in local coordinates. */
export const CAMPUS_VIEWBOX = { x: 0, y: 0, width: 1700, height: 2320 };

/**
 * The campus perimeter wall, one closed polygon, clockwise from the north
 * gate (Gate No. 4) on the 18 m wide road. The wall pinches at the central
 * junction (west [1046,706], east [1552,942]) where the north lobe meets the
 * diagonal south-west strip, exactly as drawn on the board.
 */
export const CAMPUS_PERIMETER = [
  [1093, 43],
  [1207, 53],
  [1285, 58],
  [1500, 60],
  [1657, 62],
  [1653, 168],
  [1598, 758],
  [1565, 942],
  [1555, 1248],
  [1520, 1505],
  [1180, 1490],
  [1085, 1925],
  [787, 2188],
  [40, 1410],
  [322, 1198],
  [612, 992],
  [828, 830],
  [1046, 706],
  [1040, 202],
];

/** Internal road links, drawn as quiet bands between the blocks they serve. */
export const CAMPUS_ROADS = [
  // North spine: Gate No. 4 down between the hostel column (7A/7) and the ground.
  { id: 'road-north', points: [[1196, 62], [1264, 62], [1270, 732], [1202, 732]] },
  // Service lane between the Boys Hostel (03) and the ground's top edge.
  { id: 'road-hostel', points: [[1268, 210], [1648, 210], [1648, 276], [1268, 276]] },
  // Diagonal link from the ground's south-west corner to the central junction.
  { id: 'road-junction', points: [[1198, 724], [1268, 738], [1108, 978], [1038, 942]] },
  // The central north–south road between the workshop block (08) and 06.
  { id: 'road-mid', points: [[1188, 928], [1258, 944], [1140, 1422], [1070, 1406]] },
  // Cross road along the lawn's north-east edge, below 08 and above 09.
  { id: 'road-cross', points: [[690, 1080], [980, 1395], [1040, 1335], [750, 1020]] },
  // South road from the cross junction down the west face of 09 to Gate No. 3.
  { id: 'road-south', points: [[980, 1415], [1052, 1445], [905, 1995], [833, 1965]] },
  // Lane north-west of the lawn, between the polytechnic row (1-EXT/01/02) and the lawn.
  { id: 'road-nw', points: [[270, 1400], [720, 1085], [760, 1145], [310, 1460]] },
  // Lane south-west of the lawn, between the lawn and the Admin block (05) / 11.
  { id: 'road-sw', points: [[300, 1410], [540, 1690], [600, 1640], [360, 1360]] },
];

/** The two major open grounds of the campus, plus their surveyed markings. */
export const CAMPUS_GROUNDS = [
  {
    id: 'ground-main',
    label: 'GROUND',
    sublabel: 'CRICKET PITCH',
    // Near-rectangle below the Boys Hostel; only the SE corner is chamfered
    // where the boundary diagonal cuts toward the Sports Complex.
    points: [
      [1278, 282],
      [1605, 282],
      [1600, 610],
      [1568, 738],
      [1290, 720],
    ],
    labelAt: [1450, 352],
    // The pitch marking surveyed just east of the ground's centre.
    mark: [
      [1442, 468],
      [1454, 468],
      [1454, 558],
      [1442, 558],
    ],
  },
  {
    id: 'ground-lawn',
    label: 'OPEN SPACE',
    sublabel: '(LAWN)',
    // Elongated rectangle, long axis NE–SW, short axis NW–SE.
    points: [
      [760, 1110],
      [964, 1382],
      [532, 1706],
      [328, 1434],
    ],
    labelAt: [646, 1408],
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
    labelAt: [506, 1216],
    polys: [
      [
        [436, 1328],
        [600, 1205],
        [562, 1153],
        [398, 1276],
      ],
    ],
  },
  {
    id: 'b1x',
    label: '1-EXT',
    small: true,
    labelAt: [733, 974],
    // One long thin bar along the north-west boundary, ending clear of 08.
    polys: [
      [
        [486, 1123],
        [946, 779],
        [980, 825],
        [520, 1169],
      ],
    ],
  },
  {
    id: 'b2',
    label: '2',
    labelAt: [321, 1374],
    polys: [
      [
        [286, 1435],
        [390, 1357],
        [356, 1313],
        [252, 1391],
      ],
    ],
  },
  {
    id: 'b3',
    label: '3',
    labelAt: [1458, 172],
    // Long horizontal bar spanning the head of the ground to the NE corner.
    polys: [
      [
        [1268, 137],
        [1648, 137],
        [1648, 205],
        [1268, 205],
      ],
    ],
  },
  {
    id: 'b5',
    label: '5',
    labelAt: [374, 1612],
    // Long thin bar (3:1) behind the lawn's south-west edge, parallel to the
    // 18 m wide road and clear of Gate No. 2.
    polys: [
      [
        [316, 1468],
        [496, 1708],
        [432, 1756],
        [252, 1516],
      ],
    ],
  },
  {
    id: 'b6',
    label: '6',
    labelAt: [1385, 1235],
    // Long block east of the central road: comb of three teeth on the west
    // face, two small steps on the east face, as drawn on the board.
    polys: [
      [
        [1258, 978],
        [1488, 1008],
        [1500, 1148],
        [1458, 1158],
        [1460, 1208],
        [1502, 1218],
        [1505, 1358],
        [1462, 1368],
        [1464, 1418],
        [1492, 1428],
        [1468, 1492],
        [1278, 1458],
        [1270, 1362],
        [1328, 1352],
        [1322, 1292],
        [1266, 1282],
        [1262, 1192],
        [1320, 1182],
        [1314, 1122],
        [1260, 1112],
      ],
    ],
  },
  {
    id: 'b7',
    label: '7',
    labelAt: [1150, 552],
    polys: [
      [
        [1112, 415],
        [1182, 420],
        [1188, 688],
        [1118, 685],
      ],
    ],
  },
  {
    id: 'b7a',
    label: '7A',
    labelAt: [1140, 238],
    polys: [
      [
        [1102, 88],
        [1170, 98],
        [1178, 385],
        [1110, 382],
      ],
    ],
  },
  {
    id: 'b8',
    label: '8',
    labelAt: [990, 1080],
    // Broad block west of the central road, stair-stepped down its east face.
    polys: [
      [
        [802, 1064],
        [1102, 838],
        [1246, 1030],
        [1186, 1075],
        [1169, 1053],
        [1117, 1092],
        [1100, 1070],
        [1048, 1109],
        [976, 1228],
        [896, 1273],
        [815, 1150],
      ],
    ],
  },
  {
    id: 'b9',
    label: '9',
    labelAt: [949, 1650],
    // Long block south-east of the lawn, leaning with the eastern boundary.
    polys: [
      [
        [968, 1400],
        [1108, 1456],
        [1018, 1900],
        [878, 1844],
      ],
    ],
  },
  {
    id: 'b10',
    label: '10',
    labelAt: [758, 1995],
    // Block south-east of 11, with the surveyed notch bitten out of the
    // face that looks toward 09.
    polys: [
      [
        [647, 1973],
        [763, 1881],
        [815, 1945],
        [780, 1975],
        [869, 2013],
        [753, 2105],
      ],
    ],
  },
  {
    id: 'b11',
    label: '11',
    labelAt: [640, 1845],
    // Near-square block between 05 and 10, on the same grid as both.
    polys: [
      [
        [647, 1718],
        [765, 1866],
        [633, 1972],
        [515, 1824],
      ],
    ],
  },
];

/** Unnumbered surveyed structures kept for geographical fidelity. */
export const CAMPUS_LANDMARKS = [
  {
    id: 'sports',
    label: 'SPORTS COMPLEX',
    labelAt: [1425, 868],
    // Rectangle below the ground's chamfered corner, offset east of the
    // junction road and clear of both the ground and Building 06.
    points: [
      [1330, 790],
      [1545, 825],
      [1520, 945],
      [1305, 910],
    ],
  },
];

/** Covered walkway pockets in the west-face notches of Building 06. */
export const CAMPUS_WALKWAY = [
  [
    [1196, 1122],
    [1252, 1134],
    [1242, 1188],
    [1186, 1176],
  ],
  [
    [1182, 1238],
    [1238, 1250],
    [1228, 1304],
    [1172, 1292],
  ],
  [
    [1168, 1354],
    [1224, 1366],
    [1214, 1420],
    [1158, 1408],
  ],
];

/** Hatched surveyed areas (parking / paved wedges) between the blocks. */
export const CAMPUS_HATCHES = [
  // Wedge between the NE end of 1-EXT and the workshop block (08).
  [
    [990, 862],
    [1062, 842],
    [1082, 902],
    [1010, 922],
  ],
  // Small paved square at the lawn's NE corner, south of 08.
  [
    [893, 1180],
    [953, 1218],
    [917, 1278],
    [857, 1240],
  ],
  // Large paved triangle between the lawn's SE edge and the west face of 09.
  [
    [972, 1438],
    [1020, 1470],
    [905, 1660],
  ],
  // Paved apron at the south-east end of the Admin block (05).
  [
    [500, 1715],
    [555, 1755],
    [520, 1810],
    [465, 1770],
  ],
  // Small paved pocket between the polytechnic bars 01 and 02.
  [
    [408, 1255],
    [456, 1288],
    [428, 1338],
    [380, 1305],
  ],
];

/** The four surveyed gates, with the board's own numbering. */
export const CAMPUS_GATES = [
  { id: 'gate-4', label: 'GATE NO. 4', at: [1285, 58] },
  { id: 'gate-1', label: 'GATE NO. 1', at: [40, 1410] },
  { id: 'gate-2', label: 'GATE NO. 2', at: [385, 1771] },
  { id: 'gate-3', label: 'GATE NO. 3', at: [700, 2101] },
];

/** Surrounding road annotations carried over from the board plan. */
export const CAMPUS_CONTEXT = [
  { id: 'ctx-north', text: '18 M. WIDE ROAD', at: [1450, 28], rotate: 0 },
  { id: 'ctx-west', text: '7.50 M. WIDE ROAD', at: [965, 360], rotate: -90 },
  { id: 'ctx-sw', text: '18 M. WIDE ROAD', at: [240, 1740], rotate: 46 },
  { id: 'ctx-s', text: 'TO AKURDI RAILWAY STATION', at: [760, 2295], rotate: 0 },
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
