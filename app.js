// Jømna disc golf course — interactive 3D terrain + hole placement.
// Real elevation (opentopodata EU-DEM 25m) + real satellite imagery (Esri World Imagery),
// draped over an actual heightmap of the parcel. Click a "place" button, then click the
// terrain to drop that point. Export when done.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const METERS_PER_DEG_LAT = 111320;

function metersPerDegLon(lat) {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

// ---------- Scene setup ----------

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb8d8);
scene.fog = new THREE.Fog(0x8fb8d8, 400, 900);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 3000);
camera.position.set(0, 140, 220);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById("app").appendChild(renderer.domElement);

// A generated (non-photo) environment map so PBR materials get realistic-looking
// reflections/specular response instead of the flat, shadeless look of ambient-only
// lighting -- the single biggest lever toward "photoreal" without a real HDRI asset.
const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 10, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 15;
controls.maxDistance = 700;

const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(200, 300, 150);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -250;
sun.shadow.camera.right = 250;
sun.shadow.camera.top = 250;
sun.shadow.camera.bottom = -250;
sun.shadow.camera.far = 800;
scene.add(sun);
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x3a4a2a, 0.4));

// ---------- Terrain from the real elevation grid ----------

const { gridN, bounds, elevations, center } = ELEVATION;
const elevMin = Math.min(...elevations);
const elevMax = Math.max(...elevations);

function latLonToLocal(lat, lon) {
  const x = (lon - center.lon) * metersPerDegLon(center.lat);
  const z = (center.lat - lat) * METERS_PER_DEG_LAT; // north = -Z
  return [x, z];
}

// Composite texture geographic extent, from the tile manifest.
const tLonMin = Math.min(...TILES.tiles.map((t) => t.lonMin));
const tLonMax = Math.max(...TILES.tiles.map((t) => t.lonMax));
const tLatMin = Math.min(...TILES.tiles.map((t) => t.latMin));
const tLatMax = Math.max(...TILES.tiles.map((t) => t.latMax));

const xs = [...new Set(TILES.tiles.map((t) => t.x))].sort((a, b) => a - b);
const ys = [...new Set(TILES.tiles.map((t) => t.y))].sort((a, b) => a - b);
const TILE_PX = 256;
const canvas = document.createElement("canvas");
canvas.width = xs.length * TILE_PX;
canvas.height = ys.length * TILE_PX;
const ctx = canvas.getContext("2d");

let tilesLoaded = 0;
const totalTiles = TILES.tiles.length;

function loadTile(t) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const px = (t.x - xs[0]) * TILE_PX;
      const py = (t.y - ys[0]) * TILE_PX;
      ctx.drawImage(img, px, py, TILE_PX, TILE_PX);
      tilesLoaded++;
      updateLoading();
      resolve();
    };
    img.onerror = resolve;
    img.src = t.dataUri;
  });
}

function updateLoading() {
  const el = document.getElementById("loading");
  if (el) el.textContent = `Loading satellite imagery… ${tilesLoaded}/${totalTiles}`;
}

function lonToU(lon) { return (lon - tLonMin) / (tLonMax - tLonMin); }
function latToV(lat) { return (lat - tLatMin) / (tLatMax - tLatMin); }

function buildTerrain(texture) {
  const geo = new THREE.BufferGeometry();
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i < gridN; i++) {
    for (let j = 0; j < gridN; j++) {
      const lat = bounds.latMin + (bounds.latMax - bounds.latMin) * (i / (gridN - 1));
      const lon = bounds.lonMin + (bounds.lonMax - bounds.lonMin) * (j / (gridN - 1));
      const elev = elevations[i * gridN + j];
      const [x, z] = latLonToLocal(lat, lon);
      positions.push(x, elev - elevMin, z);
      // CanvasTexture flips vertically by default (flipY=true), so v should map
      // directly to latToV, not 1-latToV -- the "1 -" here was double-flipping the
      // satellite image north/south relative to the (unflipped) heightmap, which is
      // why buildings/patio ended up displaced onto the wrong slopes.
      uvs.push(lonToU(lon), latToV(lat));
    }
  }

  for (let i = 0; i < gridN - 1; i++) {
    for (let j = 0; j < gridN - 1; j++) {
      const a = i * gridN + j;
      const b = i * gridN + j + 1;
      const c = (i + 1) * gridN + j;
      const d = (i + 1) * gridN + j + 1;
      // Winding order matters: (a,b,c)/(b,d,c) gives an upward-facing (+Y) normal for
      // this grid's coordinate convention (X=east, Z=south). The previous (a,c,b)/(b,c,d)
      // order produced downward-facing normals -- invisible from above with backface
      // culling on, which is exactly the "no terrain" bug this comment is fixing.
      indices.push(a, b, c, b, d, c);
    }
  }

  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = "terrain";
  scene.add(mesh);
  return mesh;
}

let terrainMesh = null;

Promise.all(TILES.tiles.map(loadTile)).then(() => {
  document.getElementById("loading").style.display = "none";
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  terrainMesh = buildTerrain(texture);
  animate();
});

// ---------- Hole placement ----------

// Out-and-back: holes 1-4 head out, 5-7 play the way back. 5-7 have no default
// placements (or confirmed pars) yet -- place their tees/baskets via the UI once
// measured, and update PARS below to match.
const HOLES = [1, 2, 3, 4, 5, 6, 7];
const PARS = { 1: 1, 2: 3, 3: 2, 4: 2, 5: 3, 6: 3, 7: 3 };
const POINT_KINDS = ["tee", "basket"];
const START_KEY = "start";
const state = {};
let armedKey = null;

const markers = {};
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

const discGeo = new THREE.CylinderGeometry(1.1, 1.1, 0.18, 24);
const discMat = new THREE.MeshPhysicalMaterial({
  color: 0xffb703,
  metalness: 0.05,
  roughness: 0.22,
  clearcoat: 0.6,
  clearcoatRoughness: 0.25,
});
const discMesh = new THREE.Mesh(discGeo, discMat);
discMesh.castShadow = true;
discMesh.visible = false;

// Two-tone rim, like a real driver's colored edge band -- also makes the spin read
// much more clearly than a flat single-color disc would.
const discRim = new THREE.Mesh(
  new THREE.TorusGeometry(1.08, 0.09, 10, 28),
  new THREE.MeshPhysicalMaterial({ color: 0xff5a1f, metalness: 0.05, roughness: 0.3, clearcoat: 0.5 }),
);
discRim.rotation.x = Math.PI / 2;
discMesh.add(discRim);
scene.add(discMesh);

// A short trail of fading ghost copies behind the disc during a throw, to sell the
// speed/spin at a glance -- cheap stand-in for real motion blur.
const DISC_TRAIL_LEN = 5;
const discTrailMeshes = Array.from({ length: DISC_TRAIL_LEN }, (_, i) => {
  const m = new THREE.Mesh(discGeo, discMat.clone());
  m.material.transparent = true;
  m.material.opacity = 0.3 * (1 - i / DISC_TRAIL_LEN);
  m.visible = false;
  scene.add(m);
  return m;
});
let discTrail = [];

function hideDiscTrail() {
  discTrail = [];
  discTrailMeshes.forEach((m) => (m.visible = false));
}

function colorFor(kind) {
  if (kind === "tee") return 0x2ecc71;
  if (kind === "start") return 0x3498db;
  return 0xff7f27;
}

function makeMarker(kind) {
  const group = new THREE.Group();
  if (kind === "tee") {
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, 0.4, 16),
      new THREE.MeshStandardMaterial({ color: colorFor(kind) }),
    );
    pad.position.y = 0.2;
    pad.castShadow = true;
    group.add(pad);
  } else if (kind === "start") {
    // Ground pad (visible from orbit/top-down, like the tee pads) + a tall flag with a
    // glowing finial, so the start point reads clearly even from far away.
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(2.4, 2.4, 0.4, 20),
      new THREE.MeshStandardMaterial({ color: colorFor(kind) }),
    );
    pad.position.y = 0.2;
    pad.castShadow = true;

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 7, 8),
      new THREE.MeshStandardMaterial({ color: 0x888888 }),
    );
    pole.position.y = 3.5;
    pole.castShadow = true;

    const flag = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 1.6, 0.06),
      new THREE.MeshStandardMaterial({ color: colorFor(kind), side: THREE.DoubleSide }),
    );
    flag.position.set(1.3, 6.2, 0);
    flag.castShadow = true;

    const finial = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x3498db, emissiveIntensity: 0.6 }),
    );
    finial.position.y = 7.1;

    group.add(pad, pole, flag, finial);
  } else {
    // A real "mobile" (portable) disc golf basket: weighted flat base, yellow pole, a
    // catcher tray partway up, a wireframe chain shroud, and a top rim.
    const YELLOW = 0xffd400;

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 0.9, 0.15, 16),
      new THREE.MeshStandardMaterial({ color: 0x222222 }),
    );
    base.position.y = 0.075;
    base.castShadow = true;

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 5.4, 8),
      new THREE.MeshStandardMaterial({ color: YELLOW }),
    );
    pole.position.y = 2.85;
    pole.castShadow = true;

    const tray = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 0.5, 0.5, 12),
      new THREE.MeshStandardMaterial({ color: YELLOW }),
    );
    tray.position.y = 1.0;
    tray.castShadow = true;

    const chains = new THREE.Mesh(
      new THREE.CylinderGeometry(1.3, 0.7, 2.2, 12, 1, true),
      new THREE.MeshStandardMaterial({ color: YELLOW, side: THREE.DoubleSide, transparent: true, opacity: 0.55, wireframe: true }),
    );
    chains.position.y = 3.6;

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(1.3, 0.06, 8, 20),
      new THREE.MeshStandardMaterial({ color: YELLOW }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 4.7;

    group.add(base, pole, tray, chains, rim);
  }
  return group;
}

function buildUI() {
  const panel = document.getElementById("panel");

  const startDiv = document.createElement("div");
  startDiv.className = "hole-row";
  startDiv.innerHTML = `<strong>Course start</strong>`;
  const startBtn = document.createElement("button");
  startBtn.textContent = "Place start (parking)";
  startBtn.className = "place-btn start";
  startBtn.onclick = () => {
    armedKey = START_KEY;
    document.querySelectorAll(".place-btn").forEach((b) => b.classList.remove("armed"));
    startBtn.classList.add("armed");
    document.getElementById("hint").textContent = "Click on the terrain to place the course start (parking).";
  };
  const startStatus = document.createElement("span");
  startStatus.className = "status";
  startStatus.id = `status-${START_KEY}`;
  startStatus.textContent = "not placed";
  startDiv.appendChild(startBtn);
  startDiv.appendChild(startStatus);
  panel.appendChild(startDiv);

  HOLES.forEach((h) => {
    const holeDiv = document.createElement("div");
    holeDiv.className = "hole-row";
    holeDiv.innerHTML = `<strong>Hole ${h} — Par ${PARS[h]}</strong>`;
    POINT_KINDS.forEach((kind) => {
      const key = `${h}-${kind}`;
      const btn = document.createElement("button");
      btn.textContent = kind === "tee" ? "Place tee" : "Place basket";
      btn.className = "place-btn " + kind;
      btn.onclick = () => {
        armedKey = key;
        document.querySelectorAll(".place-btn").forEach((b) => b.classList.remove("armed"));
        btn.classList.add("armed");
        document.getElementById("hint").textContent =
          `Click on the terrain to place Hole ${h} ${kind}.`;
      };
      const status = document.createElement("span");
      status.className = "status";
      status.id = `status-${key}`;
      status.textContent = "not placed";
      holeDiv.appendChild(btn);
      holeDiv.appendChild(status);
    });
    panel.appendChild(holeDiv);
  });
}
buildUI();

// Real measured positions for the whole course as it stands today. Baskets are portable
// and can still get moved between rounds -- these are just the current real spots, and
// like every other default, loading them runs through the same placement path as a
// manual click (see placePoint), so they're editable seed data, not fixed: click a
// button again to move one, and it'll stick via localStorage (see STORAGE_KEY below).
const DEFAULT_PLACEMENTS = {
  start: { lat: 60.82746012321331, lon: 11.721275733853467, elevation: 197.19862189521584 },
  "1-tee": { lat: 60.82744269656808, lon: 11.721259779903708, elevation: 197.14099169615326 },
  "2-tee": { lat: 60.827252557666206, lon: 11.72067139340881, elevation: 195.67743953386466 },
  "3-tee": { lat: 60.82663251431697, lon: 11.72104690075786, elevation: 196.11763584996888 },
  "4-tee": { lat: 60.826818447033965, lon: 11.7214226073954, elevation: 197.30675588915744 },
  "1-basket": { lat: 60.827265033595054, lon: 11.72069809964349, elevation: 195.7400446976676 },
  "2-basket": { lat: 60.82664571303842, lon: 11.721020763098315, elevation: 196.039260515232 },
  "3-basket": { lat: 60.826806848158554, lon: 11.721372333176669, elevation: 197.16076997832974 },
  "4-basket": { lat: 60.82710849154285, lon: 11.721845459491078, elevation: 198.52997262344545 },
  // Holes 5-7 (the way back) have no real measurement yet -- these placeholders retrace
  // the outbound holes in reverse using coordinates we already have: tee off from where
  // the previous hole landed, throw back toward the previous hole's tee spot. So 5/6/7
  // mirror 3/2/1, with hole 4 as the turnaround. Overwrite via the UI once actually
  // walked/thrown for real.
  "5-tee": { lat: 60.82710849154285, lon: 11.721845459491078, elevation: 198.52997262344545 }, // = 4-basket
  "5-basket": { lat: 60.82663251431697, lon: 11.72104690075786, elevation: 196.11763584996888 }, // = 3-tee
  "6-tee": { lat: 60.82663251431697, lon: 11.72104690075786, elevation: 196.11763584996888 }, // = 3-tee (5-basket)
  "6-basket": { lat: 60.827252557666206, lon: 11.72067139340881, elevation: 195.67743953386466 }, // = 2-tee
  "7-tee": { lat: 60.827252557666206, lon: 11.72067139340881, elevation: 195.67743953386466 }, // = 2-tee (6-basket)
  "7-basket": { lat: 60.82744269656808, lon: 11.721259779903708, elevation: 197.14099169615326 }, // = 1-tee
};

// Shared by defaults, localStorage restore, and manual clicks, so all three placement
// paths (marker creation, state, status text) stay in sync automatically.
function placePoint(key, lat, lon, elevation) {
  const kind = key === START_KEY ? "start" : key.split("-")[1];
  const [x, z] = latLonToLocal(lat, lon);
  const y = elevation - elevMin;

  if (markers[key]) scene.remove(markers[key]);
  const marker = makeMarker(kind);
  marker.position.set(x, y, z);
  scene.add(marker);
  markers[key] = marker;

  state[key] = { x, y, z, lat, lon, elev: elevation };
  const statusEl = document.getElementById(`status-${key}`);
  if (statusEl) statusEl.textContent = `placed (${lat.toFixed(6)}, ${lon.toFixed(6)})`;
}

const STORAGE_KEY = "melasberget-diskgolf-placements-v1";

function savePlacements() {
  const out = {};
  Object.keys(state).forEach((k) => {
    out[k] = { lat: state[k].lat, lon: state[k].lon, elevation: state[k].elev };
  });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  } catch (e) {
    // Private browsing / storage disabled -- placements just won't survive a reload.
  }
}

function loadSavedPlacements() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch (e) {
    saved = {};
  }
  Object.entries(saved).forEach(([key, { lat, lon, elevation }]) => {
    placePoint(key, lat, lon, elevation);
  });
}

function applyDefaultPlacements() {
  Object.entries(DEFAULT_PLACEMENTS).forEach(([key, { lat, lon, elevation }]) => {
    placePoint(key, lat, lon, elevation);
  });
}
applyDefaultPlacements();
// Anything saved from a previous session (crucially, basket positions -- see
// placePoint/STORAGE_KEY) overrides the hardcoded defaults above, since it reflects
// the most recently placed real positions. Without this, every reload wiped baskets
// back to "not placed" and the flythrough had no tee->basket legs to throw the disc on.
loadSavedPlacements();
drawHolePaths();

function localToLatLon(x, z) {
  const lat = center.lat - z / METERS_PER_DEG_LAT;
  const lon = center.lon + x / metersPerDegLon(center.lat);
  return [lat, lon];
}

renderer.domElement.addEventListener("click", (ev) => {
  if (!armedKey || !terrainMesh) return;
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(terrainMesh);
  if (!hits.length) return;
  const p = hits[0].point;
  const [lat, lon] = localToLatLon(p.x, p.z);
  const elev = p.y + elevMin;

  placePoint(armedKey, lat, lon, elev);
  savePlacements();
  drawHolePaths();
});

function drawHolePaths() {
  scene.children.filter((c) => c.name === "hole-path").forEach((c) => scene.remove(c));
  HOLES.forEach((h) => {
    const tee = state[`${h}-tee`];
    const basket = state[`${h}-basket`];
    if (!tee || !basket) return;
    const points = [
      new THREE.Vector3(tee.x, tee.y + 1, tee.z),
      new THREE.Vector3(basket.x, basket.y + 1, basket.z),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 2, gapSize: 1 }));
    line.computeLineDistances();
    line.name = "hole-path";
    scene.add(line);
  });
}

// ---------- Export ----------

document.getElementById("export-btn").onclick = () => {
  const out = {};
  Object.keys(state).forEach((k) => {
    out[k] = { lat: state[k].lat, lon: state[k].lon, elevation: state[k].elev };
  });
  const json = JSON.stringify(out, null, 2);
  navigator.clipboard?.writeText(json).catch(() => {});
  const el = document.getElementById("export-output");
  el.value = json;
  el.style.display = "block";
};

document.getElementById("reset-btn").onclick = () => {
  if (!confirm("Reset all placements to the hardcoded defaults? This clears anything saved from clicking on the terrain.")) return;
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
};

// ---------- Flythrough preview ----------
// Walks start (parking) -> hole 1 tee -> hole 1 basket -> hole 2 tee -> ... in order.
// A tee-to-basket leg on the same hole is simulated as an actual disc throw (arc +
// turn/fade curve, spinning disc, chase camera); every other leg is a walking hop.

function buildSequence() {
  const seq = [];
  if (state[START_KEY]) seq.push({ kind: "start", hole: null, point: state[START_KEY] });
  HOLES.forEach((h) => {
    const tee = state[`${h}-tee`];
    const basket = state[`${h}-basket`];
    if (tee) seq.push({ kind: "tee", hole: h, point: tee });
    if (basket) seq.push({ kind: "basket", hole: h, point: basket });
  });
  return seq;
}

function buildLegs(seq) {
  const legs = [];
  for (let i = 0; i < seq.length - 1; i++) {
    const a = seq[i];
    const b = seq[i + 1];
    const isThrow = a.kind === "tee" && b.kind === "basket" && a.hole === b.hole;
    const dist = Math.hypot(b.point.x - a.point.x, b.point.z - a.point.z);
    const hole = b.hole ?? a.hole; // whichever end belongs to a hole (start has hole=null)
    if (isThrow) {
      // Brief "set up the shot" beat at the tee before the disc actually launches.
      legs.push({ type: "pause", from: a.point, to: b.point, duration: 0.9, hole });
    }
    legs.push({
      type: isThrow ? "throw" : "walk",
      from: a.point,
      to: b.point,
      duration: isThrow ? Math.min(2.5, 1.0 + dist * 0.02) : Math.min(6, 1.5 + dist * 0.05),
      hole,
    });
  }
  return legs;
}

let flying = false;
let flyLegs = [];
let flyIndex = 0;
let flyElapsed = 0;

document.getElementById("fly-btn").onclick = () => {
  const seq = buildSequence();
  if (seq.length < 2) {
    alert("Place the course start plus at least one hole (tee + basket) first.");
    return;
  }
  flyLegs = buildLegs(seq);
  flying = true;
  flyIndex = 0;
  flyElapsed = 0;
  // OrbitControls' minDistance (15) would otherwise clamp the tight chase camera used
  // during throws back out to 15 units, since it always adjusts camera.position to sit
  // on the controls.target sphere. Driving the camera by hand during flight (see
  // animate()) avoids that entirely, so disable input for the duration.
  controls.enabled = false;
};

function updateWalk(t, leg) {
  const { from, to } = leg;
  const cx = from.x + (to.x - from.x) * t;
  const cz = from.z + (to.z - from.z) * t;
  const cy = Math.max(from.y, to.y);

  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz) || 1;
  const dirX = dx / dist;
  const dirZ = dz / dist;

  // Elevated overview, but oriented along the actual walking direction (behind and
  // above, looking ahead toward the destination) instead of a fixed south-facing
  // offset -- the old fixed offset made this look sideways or even backward relative
  // to travel on any hole whose walk didn't happen to run roughly north-south.
  camera.position.set(cx - dirX * 20, cy + 22, cz - dirZ * 20);
  camera.lookAt(cx + dirX * 15, cy + 3, cz + dirZ * 15);
}

function updatePause(t, leg, dt) {
  const { from, to } = leg;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz) || 1;
  const dirX = dx / dist;
  const dirZ = dz / dist;

  // Hold behind the tee looking down the fairway, like a player lining up the throw.
  camera.position.set(from.x - dirX * 6, from.y + 3.5, from.z - dirZ * 6);
  camera.lookAt(from.x + dirX * 10, from.y + 2, from.z + dirZ * 10);

  discMesh.visible = true;
  discMesh.position.set(from.x, from.y + 1.1, from.z);
  discMesh.rotation.y += dt * 3; // idle wobble while held, not yet thrown
  hideDiscTrail();
}

// Bilinear-interpolated terrain height at a local (x, z), from the same elevation grid
// the terrain mesh is built from -- mirrors buildTerrain's lat/lon -> grid-index mapping.
function terrainElevationAt(x, z) {
  const [lat, lon] = localToLatLon(x, z);
  const fi = ((lat - bounds.latMin) / (bounds.latMax - bounds.latMin)) * (gridN - 1);
  const fj = ((lon - bounds.lonMin) / (bounds.lonMax - bounds.lonMin)) * (gridN - 1);
  const i0 = Math.max(0, Math.min(gridN - 2, Math.floor(fi)));
  const j0 = Math.max(0, Math.min(gridN - 2, Math.floor(fj)));
  const ti = Math.min(1, Math.max(0, fi - i0));
  const tj = Math.min(1, Math.max(0, fj - j0));
  const e00 = elevations[i0 * gridN + j0];
  const e01 = elevations[i0 * gridN + j0 + 1];
  const e10 = elevations[(i0 + 1) * gridN + j0];
  const e11 = elevations[(i0 + 1) * gridN + j0 + 1];
  const e0 = e00 + (e01 - e00) * tj;
  const e1 = e10 + (e11 - e10) * tj;
  return e0 + (e1 - e0) * ti - elevMin;
}

function discPositionAt(leg, t) {
  const { from, to } = leg;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz) || 1;
  const perpX = -dz / dist;
  const perpZ = dx / dist;

  const peak = Math.min(dist * 0.12, 12); // throw apex height
  const curveAmp = Math.min(dist * 0.07, 7); // turn-then-fade lateral swing
  const arc = 4 * peak * t * (1 - t);
  const curve = curveAmp * Math.sin(Math.PI * t);

  const releaseY = from.y + 1.1;
  const landY = to.y + 0.9;
  const x = from.x + dx * t + perpX * curve;
  const z = from.z + dz * t + perpZ * curve;
  let y = releaseY + (landY - releaseY) * t + arc;

  // The arc above only interpolates between the tee and basket heights -- on a hole
  // where real terrain rises in between (this parcel has ~38m of relief), that put the
  // disc's simulated flight path below the actual rendered ground for most of the
  // throw, occluded by the hill, only re-emerging near the basket where the two
  // heights happened to line back up. Clamp to a minimum clearance above the real
  // terrain sampled directly under the disc.
  const groundY = terrainElevationAt(x, z);
  y = Math.max(y, groundY + 1.4);

  return { x, y, z };
}

function updateThrow(t, leg, dt) {
  const p0 = discPositionAt(leg, t);

  discMesh.visible = true;
  discMesh.position.set(p0.x, p0.y, p0.z);
  discMesh.rotation.y += dt * 30; // spin
  discMesh.rotation.z = THREE.MathUtils.lerp(-0.05, 0.05, t); // slight settle wobble

  discTrail.push({ x: p0.x, y: p0.y, z: p0.z, rotY: discMesh.rotation.y });
  if (discTrail.length > 24) discTrail.shift();
  discTrailMeshes.forEach((m, i) => {
    const idx = discTrail.length - 1 - (i + 1) * 3;
    if (idx >= 0) {
      const s = discTrail[idx];
      m.position.set(s.x, s.y, s.z);
      m.rotation.y = s.rotY;
      m.visible = true;
    } else {
      m.visible = false;
    }
  });

  // Tangent of the actual (curved) flight path, via a small lookahead sample -- using the
  // straight tee->basket direction here would point the chase camera along the wrong line
  // once the turn/fade curve pulls the disc off it, which is what made the camera seem to
  // look back down the fairway instead of ahead of the disc.
  const tAhead = Math.min(t + 0.05, 1);
  const p1 = t < 1 ? discPositionAt(leg, tAhead) : discPositionAt(leg, Math.max(t - 0.05, 0));
  let fx = t < 1 ? p1.x - p0.x : p0.x - p1.x;
  let fz = t < 1 ? p1.z - p0.z : p0.z - p1.z;
  const flen = Math.hypot(fx, fz) || 1;
  fx /= flen;
  fz /= flen;

  // Tight, low, GoPro-behind-the-disc framing. This is much closer than OrbitControls'
  // minDistance (15) would allow, which is exactly why flight bypasses it (see
  // animate() and the fly-btn handler) and drives the camera by hand instead.
  const chaseDist = 7;
  const chaseHeight = 2.2;
  camera.position.set(p0.x - fx * chaseDist, p0.y + chaseHeight, p0.z - fz * chaseDist);
  // Look past the disc, toward where it's headed, not at the disc itself.
  camera.lookAt(p0.x + fx * 10, p0.y + 0.3, p0.z + fz * 10);

  // A brief wide-FOV "whoosh" at release, settling back down as the disc arrives --
  // a cheap but effective cinematic speed cue.
  camera.fov = THREE.MathUtils.lerp(64, 52, t);
  camera.updateProjectionMatrix();
}

let hudHole = null;
function updateHud(hole) {
  if (hole === hudHole) return;
  hudHole = hole;
  const el = document.getElementById("hole-hud");
  if (!el) return;
  if (hole) {
    el.textContent = `Hole ${hole} · Par ${PARS[hole]}`;
    el.style.display = "block";
  } else {
    el.style.display = "none";
  }
}

function updateDebugHud(leg, t) {
  const el = document.getElementById("debug-hud");
  if (!el) return;
  el.textContent = `leg ${flyIndex + 1}/${flyLegs.length} · ${leg.type} · ${Math.round(t * 100)}% · disc visible: ${discMesh.visible}`;
  el.style.display = "block";
}

function updateFlight(dt) {
  if (!flying || flyLegs.length === 0) return;
  const leg = flyLegs[flyIndex];
  updateHud(leg.hole);
  flyElapsed += dt;
  const t = Math.min(flyElapsed / leg.duration, 1);

  if (leg.type === "throw") {
    updateThrow(t, leg, dt);
  } else if (leg.type === "pause") {
    updatePause(t, leg, dt);
  } else {
    discMesh.visible = false;
    hideDiscTrail();
    updateWalk(t, leg);
  }
  updateDebugHud(leg, t);

  if (t >= 1) {
    flyElapsed = 0;
    flyIndex++;
    if (flyIndex >= flyLegs.length) {
      flying = false;
      discMesh.visible = false;
      hideDiscTrail();
      updateHud(null);
      const dbgEl = document.getElementById("debug-hud");
      if (dbgEl) dbgEl.style.display = "none";
      camera.fov = 55;
      camera.updateProjectionMatrix();
      // Hand orientation back to OrbitControls from wherever the flight left the camera,
      // looking roughly at the point the last leg ended on.
      controls.target.set(leg.to.x, leg.to.y + 1, leg.to.z);
      controls.enabled = true;
    }
  }
}

// ---------- Render loop ----------

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  updateFlight(dt);
  // While flying, the camera is driven by hand (see updateThrow/updatePause/updateWalk)
  // to get a much closer chase view than OrbitControls' minDistance would otherwise
  // allow. Calling controls.update() here would fight that every frame.
  if (!flying) controls.update();
  renderer.render(scene, camera);
}

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- Scorecard ----------
// players: [{ name, scores: { [holeNumber]: strokes|undefined } }], persisted separately
// from placements so clearing one doesn't touch the other.

const SCORES_KEY = "melasberget-diskgolf-scores-v1";
let players = [];

function loadScores() {
  try {
    players = JSON.parse(localStorage.getItem(SCORES_KEY) || "[]");
  } catch (e) {
    players = [];
  }
}

function saveScores() {
  try {
    localStorage.setItem(SCORES_KEY, JSON.stringify(players));
  } catch (e) {
    // Private browsing / storage disabled -- scores just won't survive a reload.
  }
}

function totalPar() {
  return HOLES.reduce((sum, h) => sum + (PARS[h] || 0), 0);
}

function updateRowTotals(pi) {
  const row = document.querySelector(`tr[data-player-row="${pi}"]`);
  const p = players[pi];
  if (!row || !p) return;
  let total = 0;
  let counted = 0;
  HOLES.forEach((h) => {
    const v = p.scores[h];
    if (typeof v === "number" && !Number.isNaN(v)) {
      total += v;
      counted++;
    }
  });
  const totalCell = row.querySelector(".total-cell");
  const diffCell = row.querySelector(".diff-cell");
  if (counted === 0) {
    totalCell.textContent = "-";
    diffCell.textContent = "-";
  } else {
    totalCell.textContent = total;
    if (counted === HOLES.length) {
      const diff = total - totalPar();
      diffCell.textContent = diff === 0 ? "E" : diff > 0 ? `+${diff}` : `${diff}`;
    } else {
      diffCell.textContent = "…";
    }
  }
}

function renderScorecard() {
  const header = document.getElementById("scorecard-header");
  const body = document.getElementById("scorecard-body");
  if (!header || !body) return;

  header.innerHTML =
    `<th>Player</th>` +
    HOLES.map((h) => `<th>H${h}<span class="par-label">Par ${PARS[h]}</span></th>`).join("") +
    `<th>Tot</th><th>+/-</th><th></th>`;

  body.innerHTML = "";
  players.forEach((p, pi) => {
    const row = document.createElement("tr");
    row.dataset.playerRow = pi;
    const cells = HOLES.map((h) => {
      const val = p.scores[h];
      return `<td><input type="number" min="1" class="score-input" data-hole="${h}" value="${val ?? ""}"></td>`;
    }).join("");
    row.innerHTML =
      `<td>${p.name}</td>${cells}<td class="total-cell">-</td><td class="diff-cell">-</td>` +
      `<td><button class="remove-player-btn" title="Remove player">✕</button></td>`;
    body.appendChild(row);

    row.querySelectorAll(".score-input").forEach((input) => {
      input.oninput = () => {
        const h = Number(input.dataset.hole);
        const v = input.value === "" ? undefined : Number(input.value);
        if (v === undefined) delete p.scores[h];
        else p.scores[h] = v;
        saveScores();
        updateRowTotals(pi); // update this row's totals in place -- rebuilding the
        // whole table here would blow away focus mid-keystroke on the input.
        updateFunStats();
      };
    });
    row.querySelector(".remove-player-btn").onclick = () => {
      players.splice(pi, 1);
      saveScores();
      renderScorecard();
    };

    updateRowTotals(pi);
  });
  updateFunStats();
}

document.getElementById("add-player-btn").onclick = () => {
  const input = document.getElementById("player-name-input");
  const name = input.value.trim();
  if (!name) return;
  players.push({ name, scores: {} });
  input.value = "";
  saveScores();
  renderScorecard();
};
document.getElementById("player-name-input").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") document.getElementById("add-player-btn").click();
});

document.getElementById("clear-scores-btn").onclick = () => {
  if (!confirm("Remove all players and scores?")) return;
  players = [];
  saveScores();
  renderScorecard();
};

// ---------- Weather ----------
// Open-Meteo: free, no API key, CORS-friendly straight from the browser -- fits this
// app's no-backend approach. Shown in the scorecard panel (see renderWeather) and
// snapshotted into each saved round (see finishRound below) so round history retains
// what conditions it was played in.

const WMO_WEATHER = {
  0: ["☀️", "Clear"],
  1: ["\u{1F324}", "Mainly clear"],
  2: ["⛅", "Partly cloudy"],
  3: ["☁️", "Overcast"],
  45: ["\u{1F32B}", "Fog"],
  48: ["\u{1F32B}", "Fog"],
  51: ["\u{1F326}", "Drizzle"],
  53: ["\u{1F326}", "Drizzle"],
  55: ["\u{1F326}", "Drizzle"],
  56: ["\u{1F326}", "Freezing drizzle"],
  57: ["\u{1F326}", "Freezing drizzle"],
  61: ["\u{1F327}", "Rain"],
  63: ["\u{1F327}", "Rain"],
  65: ["\u{1F327}", "Heavy rain"],
  66: ["\u{1F327}", "Freezing rain"],
  67: ["\u{1F327}", "Freezing rain"],
  71: ["\u{1F328}", "Snow"],
  73: ["\u{1F328}", "Snow"],
  75: ["\u{1F328}", "Heavy snow"],
  77: ["\u{1F328}", "Snow grains"],
  80: ["\u{1F326}", "Showers"],
  81: ["\u{1F326}", "Showers"],
  82: ["\u{1F326}", "Heavy showers"],
  85: ["\u{1F328}", "Snow showers"],
  86: ["\u{1F328}", "Snow showers"],
  95: ["⛈️", "Thunderstorm"],
  96: ["⛈️", "Thunderstorm + hail"],
  99: ["⛈️", "Thunderstorm + hail"],
};

function degToCompass(deg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

let currentWeather = null;

function renderWeather() {
  const el = document.getElementById("weather");
  if (!el) return;
  if (!currentWeather) {
    el.textContent = "";
    return;
  }
  const [emoji, label] = WMO_WEATHER[currentWeather.code] || ["", "Weather"];
  const parts = [`${emoji} ${label}, ${currentWeather.temp.toFixed(1)}°C`];
  parts.push(`\u{1F4A8} ${currentWeather.windSpeed.toFixed(1)} m/s ${degToCompass(currentWeather.windDir)}`);
  if (currentWeather.precip > 0) parts.push(`☔ ${currentWeather.precip.toFixed(1)}mm`);
  el.textContent = parts.join(" · ");
}

async function fetchWeather() {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${center.lat}&longitude=${center.lon}` +
      `&current=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation,weather_code` +
      `&wind_speed_unit=ms&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`weather fetch failed: ${res.status}`);
    const data = await res.json();
    currentWeather = {
      temp: data.current.temperature_2m,
      windSpeed: data.current.wind_speed_10m,
      windDir: data.current.wind_direction_10m,
      precip: data.current.precipitation,
      code: data.current.weather_code,
      time: data.current.time,
    };
    renderWeather();
  } catch (e) {
    // Weather is a nice-to-have -- never block anything else on the fetch failing
    // (offline, API down, etc.). Just leave whatever was last shown, if anything.
  }
}
fetchWeather();
setInterval(fetchWeather, 10 * 60 * 1000); // conditions can change over a round

// ---------- Scorecard fun ----------
// Casual, low-stakes additions on top of the plain scorecard: a live leader line, an
// ace/eagle/birdie highlight strip, and per-hole "course records" pulled from both the
// current round and every round saved via "Finish round".

const ROUNDS_KEY = "melasberget-diskgolf-rounds-v1";

function readRounds() {
  try {
    return JSON.parse(localStorage.getItem(ROUNDS_KEY) || "[]");
  } catch (e) {
    return [];
  }
}

function holeScore(p, h) {
  return Number(p.scores && p.scores[h]) || 0;
}

function scoreEmoji(strokes, par) {
  if (strokes === 1 && par >= 2) return "\u{1F31F}"; // ace
  if (strokes - par <= -2) return "\u{1F985}"; // eagle
  if (strokes - par === -1) return "\u{1F426}"; // birdie
  return "";
}

function updateFunStats() {
  const leaderEl = document.getElementById("fun-leader");
  if (!leaderEl) return;

  let best = null;
  players.forEach((p) => {
    let diff = 0;
    let played = 0;
    HOLES.forEach((h) => {
      const s = holeScore(p, h);
      if (s > 0) {
        diff += s - PARS[h];
        played++;
      }
    });
    if (!played) return;
    if (!best || diff < best.diff) best = { names: [p.name], diff };
    else if (diff === best.diff) best.names.push(p.name);
  });
  leaderEl.textContent = best
    ? `\u{1F451} ${best.names.join(" & ")} (${best.diff === 0 ? "E" : best.diff > 0 ? `+${best.diff}` : best.diff})`
    : "";

  const notes = [];
  players.forEach((p) => {
    HOLES.forEach((h) => {
      const s = holeScore(p, h);
      const emoji = s && scoreEmoji(s, PARS[h]);
      if (emoji) notes.push(`${emoji} ${p.name} H${h}`);
    });
  });
  document.getElementById("fun-highlights").textContent = notes.join("  ");

  const bestHole = {};
  const consider = (name, h, s) => {
    if (s > 0 && (!bestHole[h] || s < bestHole[h].s)) bestHole[h] = { s, name };
  };
  readRounds().forEach((r) => (r.players || []).forEach((p) => HOLES.forEach((h) => consider(p.name, h, holeScore(p, h)))));
  players.forEach((p) => HOLES.forEach((h) => consider(p.name, h, holeScore(p, h))));
  const recs = HOLES.filter((h) => bestHole[h]).map((h) => `H${h}: ${bestHole[h].s} (${bestHole[h].name})`);
  document.getElementById("fun-records").textContent = recs.length ? `\u{1F3C6} ${recs.join(" · ")}` : "";
}

function finishRound() {
  if (!players.some((p) => HOLES.some((h) => holeScore(p, h) > 0))) {
    alert("No scores to save yet.");
    return;
  }
  const rounds = readRounds();
  rounds.push({
    date: new Date().toISOString(),
    players: JSON.parse(JSON.stringify(players)),
    weather: currentWeather,
  });
  while (rounds.length > 100) rounds.shift();
  try {
    localStorage.setItem(ROUNDS_KEY, JSON.stringify(rounds));
  } catch (e) {
    // Private browsing / storage disabled -- the round just won't be remembered.
  }
  if (confirm("Round saved. Clear scores for a new round?")) {
    players = [];
    saveScores();
    renderScorecard();
  }
  updateFunStats();
}
document.getElementById("save-round").onclick = finishRound;

loadScores();
renderScorecard();

// ---------- Photo gallery ----------
// Photos are stored in IndexedDB, not localStorage -- localStorage's ~5-10MB quota
// would fill up fast with images, while IndexedDB comfortably holds many photos and
// (like everything else in this app) works fully offline.

const PHOTO_DB = "melasberget-diskgolf-photos";
const PHOTO_STORE = "photos";

function openPhotoDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PHOTO_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(PHOTO_STORE, { keyPath: "id", autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function photoTx(mode, fn) {
  return openPhotoDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(PHOTO_STORE, mode);
        const req = fn(tx.objectStore(PHOTO_STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req && req.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

async function decodeImage(file) {
  if ("createImageBitmap" in window) {
    try {
      // "from-image" applies the photo's EXIF rotation so phone photos taken in
      // portrait don't get stored sideways.
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (e) {
      // Fall through to the <img> decode path below.
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("could not decode image"));
    };
    img.src = url;
  });
}

// If canvas.toBlob doesn't actually support encoding the requested type, it silently
// falls back to image/png -- lossless, so a 1600px photo could balloon to several MB
// instead of shrinking, defeating the point. Feature-detect once and use JPEG on the
// (now rare) browsers that can't encode WebP via canvas.
const PHOTO_MIME = (() => {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    return c.toDataURL("image/webp").startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
  } catch (e) {
    return "image/jpeg";
  }
})();

function scaleToBlob(img, maxDim, quality) {
  const w = img.width;
  const h = img.height;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), PHOTO_MIME, quality),
  );
}

async function addPhoto(file, hole, caption) {
  const img = await decodeImage(file);
  // Store one downscaled "full" copy plus a small thumbnail -- never the raw,
  // multi-megabyte camera original, or IndexedDB usage would balloon fast.
  const [blob, thumb] = await Promise.all([scaleToBlob(img, 1600, 0.85), scaleToBlob(img, 240, 0.7)]);
  if (img.close) img.close(); // release ImageBitmap memory, if that's what decodeImage returned
  await photoTx("readwrite", (s) =>
    s.add({ ts: Date.now(), hole: hole || null, caption: caption || "", blob, thumb }),
  );
  await renderGallery();
}

let galleryUrls = [];
async function renderGallery() {
  const grid = document.getElementById("gallery-grid");
  if (!grid) return;
  const photos = (await photoTx("readonly", (s) => s.getAll())) || [];
  galleryUrls.forEach((u) => URL.revokeObjectURL(u));
  galleryUrls = [];
  grid.innerHTML = "";
  document.getElementById("gallery-empty").hidden = photos.length > 0;
  photos.reverse().forEach((p) => {
    const url = URL.createObjectURL(p.thumb);
    galleryUrls.push(url);
    const btn = document.createElement("button");
    btn.className = "gallery-thumb";
    btn.style.backgroundImage = `url(${url})`;
    btn.setAttribute("aria-label", p.caption || "Photo");
    if (p.hole) {
      const badge = document.createElement("span");
      badge.className = "thumb-hole";
      badge.textContent = p.hole;
      btn.appendChild(badge);
    }
    btn.onclick = () => openLightbox(p.id);
    grid.appendChild(btn);
  });
}

// Shared by both private (IndexedDB blob) and public (static file) photos -- only
// private photos are deletable, so onDelete is omitted for public ones. Revoking any
// previous blob: URL is each opener's own job (they know whether one exists), not
// showLightbox's -- it just updates the DOM.
let lightboxObjectUrl = null;

function showLightbox(src, metaText, onDelete) {
  document.getElementById("lightbox-img").src = src;
  document.getElementById("lightbox-meta").textContent = metaText;
  const delBtn = document.getElementById("lightbox-delete");
  delBtn.style.display = onDelete ? "" : "none";
  delBtn.onclick = onDelete
    ? async () => {
        if (!confirm("Delete this photo?")) return;
        await onDelete();
        closeLightbox();
      }
    : null;
  document.getElementById("lightbox").hidden = false;
}

async function openLightbox(id) {
  const p = await photoTx("readonly", (s) => s.get(id));
  if (!p) return;
  if (lightboxObjectUrl) URL.revokeObjectURL(lightboxObjectUrl);
  lightboxObjectUrl = URL.createObjectURL(p.blob);
  const parts = [];
  if (p.hole) parts.push(`Hole ${p.hole}`);
  parts.push(new Date(p.ts).toLocaleString());
  if (p.caption) parts.push(p.caption);
  showLightbox(lightboxObjectUrl, parts.join(" — "), async () => {
    await photoTx("readwrite", (s) => s.delete(id));
    renderGallery();
  });
}

function openPublicLightbox(entry) {
  if (lightboxObjectUrl) {
    URL.revokeObjectURL(lightboxObjectUrl);
    lightboxObjectUrl = null;
  }
  const parts = [];
  if (entry.hole) parts.push(`Hole ${entry.hole}`);
  if (entry.caption) parts.push(entry.caption);
  showLightbox(`./public-photos/${entry.file}`, parts.join(" — "), null);
}

function closeLightbox() {
  document.getElementById("lightbox").hidden = true;
  if (lightboxObjectUrl) {
    URL.revokeObjectURL(lightboxObjectUrl);
    lightboxObjectUrl = null;
  }
}

function initGallery() {
  const holeSel = document.getElementById("photo-hole");
  holeSel.innerHTML =
    `<option value="">No hole</option>` + HOLES.map((h) => `<option value="${h}">Hole ${h}</option>`).join("");

  // Two separate inputs rather than one: capture="environment" forces the camera
  // directly on most phones, but then some Android browsers won't offer the photo
  // library at all -- so "Camera" and "Choose file" need to be genuinely separate
  // entry points, not just one input with capture set.
  ["photo-input-camera", "photo-input-file"].forEach((inputId) => {
    const input = document.getElementById(inputId);
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      input.value = "";
      if (!file) return;
      const buttons = document.querySelectorAll(".photo-btn");
      buttons.forEach((b) => b.classList.add("busy"));
      try {
        await addPhoto(file, Number(holeSel.value) || null, document.getElementById("photo-caption").value.trim());
        document.getElementById("photo-caption").value = "";
      } catch (e) {
        alert("Could not save photo: " + (e && e.message ? e.message : e));
      } finally {
        buttons.forEach((b) => b.classList.remove("busy"));
      }
    });
  });

  document.getElementById("lightbox-close").onclick = closeLightbox;
  document.getElementById("lightbox").addEventListener("click", (ev) => {
    if (ev.target.id === "lightbox") closeLightbox();
  });

  // Ask the browser not to evict the photo store under storage pressure.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  renderGallery().catch(() => {});
  loadPublicGallery().catch(() => {});
}
initGallery();

// Static files committed to public-photos/ -- see public-photos/README.md. No upload
// endpoint or account needed: only whoever can push to this repo can add one, so
// there's no open-write abuse surface like an unsigned third-party upload API would have.
async function loadPublicGallery() {
  const grid = document.getElementById("public-gallery-grid");
  const emptyEl = document.getElementById("public-gallery-empty");
  if (!grid) return;
  const res = await fetch("./public-photos/manifest.json");
  if (!res.ok) throw new Error(`manifest fetch failed: ${res.status}`);
  const entries = await res.json();
  grid.innerHTML = "";
  emptyEl.hidden = entries.length > 0;
  entries.forEach((entry) => {
    const btn = document.createElement("button");
    btn.className = "gallery-thumb";
    btn.style.backgroundImage = `url(./public-photos/${entry.file})`;
    btn.setAttribute("aria-label", entry.caption || "Photo");
    if (entry.hole) {
      const badge = document.createElement("span");
      badge.className = "thumb-hole";
      badge.textContent = entry.hole;
      btn.appendChild(badge);
    }
    btn.onclick = () => openPublicLightbox(entry);
    grid.appendChild(btn);
  });
}

// ---------- PWA / mobile ----------

if ("serviceWorker" in navigator) {
  // Register immediately rather than waiting for `load` -- this app decodes 42
  // embedded satellite tiles on load, which delays that event, and Chrome's install
  // criteria need an active, controlling service worker. Registering as soon as
  // possible (module scripts already run after DOM parsing) gives it the best chance
  // of being active by the time a user tries "Add to Home Screen".
  navigator.serviceWorker.register("./sw.js").catch(() => {
    // Offline support / installability just won't be available -- the app still works online.
  });
}

// ---------- Top navigation ----------
// One consistent, always-visible way to find Course/Scorecard/Photos, replacing three
// separate +/- toggles that used to live in each panel's own corner of the screen.
// Exactly one panel (or none) is shown at a time -- simpler to find things, and it
// sidesteps the overlap problems that came from positioning multiple simultaneously-
// open floating panels around the screen edges.

const NAV_PANEL_IDS = ["panel", "scorecard", "gallery"];

function showPanel(id) {
  NAV_PANEL_IDS.forEach((pid) => {
    document.getElementById(pid)?.classList.toggle("active", pid === id);
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.target === id);
  });
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.onclick = () => showPanel(btn.classList.contains("active") ? null : btn.dataset.target);
});
document.querySelectorAll(".panel-close").forEach((btn) => {
  btn.onclick = () => showPanel(null);
});
