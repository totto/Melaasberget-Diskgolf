// Fetch a real elevation grid around the Jømna farm coordinates from opentopodata.org (EU-DEM 25m).
// Bounding box ~400m x 400m, grid spacing ~20m (matches native dataset resolution).
import { writeFileSync } from "fs";

const CENTER = { lat: 60.8272707, lon: 11.7213612 };
const HALF_SIZE_M = 200; // 400m x 400m box
const GRID_N = 21; // 21x21 = 441 points, ~20m spacing

const metersPerDegLat = 111320;
const metersPerDegLon = 111320 * Math.cos((CENTER.lat * Math.PI) / 180);

const dLat = HALF_SIZE_M / metersPerDegLat;
const dLon = HALF_SIZE_M / metersPerDegLon;

const bounds = {
  latMin: CENTER.lat - dLat, latMax: CENTER.lat + dLat,
  lonMin: CENTER.lon - dLon, lonMax: CENTER.lon + dLon,
};

const points = [];
for (let i = 0; i < GRID_N; i++) {
  for (let j = 0; j < GRID_N; j++) {
    const lat = bounds.latMin + (bounds.latMax - bounds.latMin) * (i / (GRID_N - 1));
    const lon = bounds.lonMin + (bounds.lonMax - bounds.lonMin) * (j / (GRID_N - 1));
    points.push({ i, j, lat, lon });
  }
}

console.error(`Fetching elevation for ${points.length} points in batches of 90...`);

const elevations = new Array(points.length).fill(null);
const BATCH = 90;
for (let start = 0; start < points.length; start += BATCH) {
  const batch = points.slice(start, start + BATCH);
  const locStr = batch.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join("|");
  const url = `https://api.opentopodata.org/v1/eudem25m?locations=${locStr}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Batch starting at ${start} failed: ${res.status}`);
    await new Promise((r) => setTimeout(r, 1200));
    continue;
  }
  const json = await res.json();
  json.results.forEach((r, k) => {
    elevations[start + k] = r.elevation;
  });
  console.error(`  batch ${start}-${start + batch.length}: ok`);
  await new Promise((r) => setTimeout(r, 1100)); // respect ~1 req/sec limit
}

const missing = elevations.filter((e) => e === null).length;
console.error(`Done. ${missing} missing points out of ${points.length}.`);

for (let k = 0; k < elevations.length; k++) {
  if (elevations[k] === null) {
    let radius = 1;
    while (elevations[k] === null && radius < GRID_N) {
      const { i, j } = points[k];
      for (let di = -radius; di <= radius && elevations[k] === null; di++) {
        for (let dj = -radius; dj <= radius && elevations[k] === null; dj++) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= GRID_N || nj >= GRID_N) continue;
          const idx = ni * GRID_N + nj;
          if (elevations[idx] !== null) elevations[k] = elevations[idx];
        }
      }
      radius++;
    }
  }
}

const out = {
  center: CENTER,
  bounds,
  gridN: GRID_N,
  halfSizeMeters: HALF_SIZE_M,
  elevations,
};

writeFileSync(new URL("./elevation.json", import.meta.url), JSON.stringify(out));
console.error("Wrote elevation.json");
console.error("Elevation range:", Math.min(...elevations), "to", Math.max(...elevations));
