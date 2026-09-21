// Fetch Esri World Imagery satellite tiles covering the same bounding box as elevation.json,
// base64-encode them, and save a manifest for the browser to stitch into one canvas texture.
import { readFileSync, writeFileSync } from "fs";

const elevation = JSON.parse(readFileSync(new URL("./elevation.json", import.meta.url), "utf8"));
const { bounds } = elevation;
const ZOOM = 18;

function lon2tileX(lon, z) { return Math.floor(((lon + 180) / 360) * Math.pow(2, z)); }
function lat2tileY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z));
}
function tileX2lon(x, z) { return (x / Math.pow(2, z)) * 360 - 180; }
function tileY2lat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

const xMin = lon2tileX(bounds.lonMin, ZOOM);
const xMax = lon2tileX(bounds.lonMax, ZOOM);
const yMin = lat2tileY(bounds.latMax, ZOOM);
const yMax = lat2tileY(bounds.latMin, ZOOM);

console.error(`Zoom ${ZOOM}: tiles x=${xMin}..${xMax}, y=${yMin}..${yMax} (${(xMax - xMin + 1) * (yMax - yMin + 1)} tiles)`);

const tiles = [];
for (let x = xMin; x <= xMax; x++) {
  for (let y = yMin; y <= yMax; y++) {
    const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${ZOOM}/${y}/${x}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`  tile ${x},${y} failed: ${res.status}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    tiles.push({
      x, y, z: ZOOM,
      lonMin: tileX2lon(x, ZOOM), lonMax: tileX2lon(x + 1, ZOOM),
      latMax: tileY2lat(y, ZOOM), latMin: tileY2lat(y + 1, ZOOM),
      dataUri: `data:image/jpeg;base64,${buf.toString("base64")}`,
    });
    console.error(`  tile ${x},${y}: ok (${(buf.length / 1024).toFixed(0)}KB)`);
  }
}

writeFileSync(new URL("./tiles.json", import.meta.url), JSON.stringify({ zoom: ZOOM, tiles }));
console.error(`Wrote tiles.json with ${tiles.length} tiles`);
