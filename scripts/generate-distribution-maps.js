// One-off data-generation script (not part of the Eleventy build).
// Run manually with `node scripts/generate-distribution-maps.js` whenever
// the species list changes. Fetches occurrence data from GBIF (open,
// CC0/CC-BY, no reuse-license friction) and land outlines from Natural
// Earth (public domain), then renders a static sepia-toned SVG map per
// species into src/images/maps/. No client-side JS or live map involved.
//
// Most Paradisaeidae live around New Guinea, but two riflebirds
// (Ptiloris paradiseus, Ptiloris victoriae) live only in temperate eastern
// Australia, far south of that cluster. One shared frame for all 44 would
// make the New Guinea cluster tiny to accommodate two outliers, so each
// region gets its own fixed frame; maps are consistent within a region.
const fs = require("fs");
const path = require("path");

const BIRDS_PATH = path.join(__dirname, "..", "src", "_data", "birds.json");
const OUT_DIR = path.join(__dirname, "..", "src", "images", "maps");
const LAND_CACHE = path.join(__dirname, ".cache", "land50.geojson");
const LAND_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson";

const WIDTH = 800;
const GBIF_DELAY_MS = 300;

const AUSTRALIA_SPECIES = new Set(["Ptiloris paradiseus", "Ptiloris victoriae"]);

const REGIONS = {
  newGuinea: { minLon: 124, maxLon: 163, minLat: -13, maxLat: 3 },
  // Whole mainland + Tasmania, not just the species' coastal strip, so the
  // continent's recognizable outline gives context for where that strip is.
  australia: { minLon: 112, maxLon: 154, minLat: -44, maxLat: -10 },
};

function regionFor(binomialName) {
  return AUSTRALIA_SPECIES.has(binomialName) ? "australia" : "newGuinea";
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function ringBounds(ring) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, maxLon, minLat, maxLat };
}

function bboxIntersects(a, b) {
  return a.minLon <= b.maxLon && a.maxLon >= b.minLon && a.minLat <= b.maxLat && a.maxLat >= b.minLat;
}

function perpDist(p, a, b) {
  const [x, y] = p, [x1, y1] = a, [x2, y2] = b;
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(x - x1, y - y1);
  let t = ((x - x1) * dx + (y - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

// Douglas-Peucker simplification, tolerance matched to each region's fixed
// zoom level so coastlines stay smooth without shipping full-resolution data.
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  let maxDist = 0, index = 0;
  const first = points[0], last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], first, last);
    if (d > maxDist) { maxDist = d; index = i; }
  }
  if (maxDist > tolerance) {
    const left = simplify(points.slice(0, index + 1), tolerance);
    const right = simplify(points.slice(index), tolerance);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

// Convex hull (monotone chain) - approximates a species' range from its
// scattered occurrence points, drawn like a traditional field-guide range fill.
function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of pts.slice().reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

async function loadLandGeojson() {
  fs.mkdirSync(path.dirname(LAND_CACHE), { recursive: true });
  if (fs.existsSync(LAND_CACHE)) {
    return JSON.parse(fs.readFileSync(LAND_CACHE, "utf8"));
  }
  const res = await fetch(LAND_URL);
  const text = await res.text();
  fs.writeFileSync(LAND_CACHE, text);
  return JSON.parse(text);
}

function landRingsFor(geojson, bbox) {
  const rings = [];
  for (const feature of geojson.features) {
    const geom = feature.geometry;
    const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
    for (const poly of polys) {
      const outer = poly[0];
      if (bboxIntersects(ringBounds(outer), bbox)) rings.push(outer);
    }
  }
  return rings;
}

// Builds the fixed frame (dimensions, projector, land path) once per region.
function buildFrame(geojson, bbox) {
  const height = Math.round((WIDTH * (bbox.maxLat - bbox.minLat)) / (bbox.maxLon - bbox.minLon));
  const tolerance = ((bbox.maxLon - bbox.minLon) / WIDTH) * 2.5;

  function project([lon, lat]) {
    const x = ((lon - bbox.minLon) / (bbox.maxLon - bbox.minLon)) * WIDTH;
    const y = ((bbox.maxLat - lat) / (bbox.maxLat - bbox.minLat)) * height;
    return [Number(x.toFixed(1)), Number(y.toFixed(1))];
  }
  function ringToPath(ring) {
    return "M" + ring.map(project).map((p) => p.join(",")).join("L") + "Z";
  }

  const landPaths = landRingsFor(geojson, bbox)
    .map((r) => simplify(r, tolerance))
    .filter((r) => r.length >= 3)
    .map(ringToPath)
    .join(" ");

  return { bbox, width: WIDTH, height, project, ringToPath, landPaths };
}

async function gbifOccurrences(binomialName, bbox) {
  const matchRes = await fetch(
    `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(binomialName)}`
  );
  const match = await matchRes.json();
  if (!match.usageKey) return { points: [], countries: [] };

  const occRes = await fetch(
    `https://api.gbif.org/v1/occurrence/search?taxonKey=${match.usageKey}&hasCoordinate=true&hasGeospatialIssue=false&limit=300`
  );
  const occ = await occRes.json();
  const records = occ.results
    .filter((r) => typeof r.decimalLongitude === "number" && typeof r.decimalLatitude === "number")
    // GBIF includes the occasional captive/zoo observation or mislabeled
    // museum specimen far outside a species' real range (e.g. an aviary bird
    // logged in Singapore). Each species' region bbox is its known wild
    // range, so anything outside it is bad data, not a real occurrence.
    .filter(
      (r) =>
        r.decimalLongitude >= bbox.minLon &&
        r.decimalLongitude <= bbox.maxLon &&
        r.decimalLatitude >= bbox.minLat &&
        r.decimalLatitude <= bbox.maxLat
    );

  const points = records.map((r) => [r.decimalLongitude, r.decimalLatitude]);
  const countries = [...new Set(records.map((r) => r.country).filter(Boolean))].sort();
  return { points, countries };
}

// Below this on-screen size, a real range fill would be invisible (or a
// sub-pixel dot). Below it we draw a fixed-size locality marker instead -
// the standard atlas convention for "real, but too small to show at scale."
const MIN_RANGE_DIAGONAL_PX = 18;

function centroidOf(points) {
  const lon = points.reduce((s, p) => s + p[0], 0) / points.length;
  const lat = points.reduce((s, p) => s + p[1], 0) / points.length;
  return [lon, lat];
}

function markerMarkup(frame, points) {
  const [cx, cy] = frame.project(centroidOf(points));
  return `<circle cx="${cx}" cy="${cy}" r="11" fill="#45592f" fill-opacity="0.2" />
  <circle cx="${cx}" cy="${cy}" r="5" fill="#45592f" stroke="#f1e6cf" stroke-width="1.5" />`;
}

function renderSvg(frame, occurrences) {
  let rangeMarkup = "";
  if (occurrences.length >= 3) {
    const hull = convexHull(occurrences);
    const px = hull.map(frame.project);
    const xs = px.map((p) => p[0]), ys = px.map((p) => p[1]);
    const diagonal = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    rangeMarkup =
      diagonal >= MIN_RANGE_DIAGONAL_PX
        ? `<path d="${frame.ringToPath(hull)}" fill="#45592f" fill-opacity="0.5" stroke="#45592f" stroke-width="1.5" />`
        : markerMarkup(frame, occurrences);
  } else if (occurrences.length > 0) {
    rangeMarkup = markerMarkup(frame, occurrences);
  }

  return `<svg width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Distribution map">
  <rect x="0" y="0" width="${frame.width}" height="${frame.height}" fill="#f1e6cf" />
  <path d="${frame.landPaths}" fill="#e8dab8" stroke="#3d2f22" stroke-width="1" />
  ${rangeMarkup}
</svg>
`;
}

async function main() {
  const birds = JSON.parse(fs.readFileSync(BIRDS_PATH, "utf8"));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const geojson = await loadLandGeojson();
  const frames = {
    newGuinea: buildFrame(geojson, REGIONS.newGuinea),
    australia: buildFrame(geojson, REGIONS.australia),
  };

  for (const bird of birds) {
    const region = regionFor(bird.binomial_name);
    const frame = frames[region];
    const slug = slugify(bird.binomial_name);
    process.stdout.write(`${bird.binomial_name} (${region}) ... `);
    const { points, countries } = await gbifOccurrences(bird.binomial_name, frame.bbox);
    const svg = renderSvg(frame, points);
    fs.writeFileSync(path.join(OUT_DIR, `${slug}.svg`), svg);
    bird.countries = countries;
    console.log(`${points.length} occurrences, ${countries.join(", ")}`);
    await new Promise((resolve) => setTimeout(resolve, GBIF_DELAY_MS));
  }

  fs.writeFileSync(BIRDS_PATH, JSON.stringify(birds, null, 2) + "\n");
}

main();
