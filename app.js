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
  const panel = document.getElementById("panel-body");

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
      };
    });
    row.querySelector(".remove-player-btn").onclick = () => {
      players.splice(pi, 1);
      saveScores();
      renderScorecard();
    };

    updateRowTotals(pi);
  });
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

loadScores();
renderScorecard();

// ---------- PWA / mobile ----------

if ("serviceWorker" in navigator) {
  addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Offline support just won't be available -- the app still works online.
    });
  });
}

function wireMobileToggle(toggleId, panelId) {
  const btn = document.getElementById(toggleId);
  const panel = document.getElementById(panelId);
  if (!btn || !panel) return;
  btn.onclick = () => {
    const collapsed = panel.classList.toggle("collapsed");
    btn.textContent = collapsed ? "+" : "−";
  };
}
wireMobileToggle("panel-toggle", "panel");
wireMobileToggle("scorecard-toggle", "scorecard");

// On phones/touch devices, start both panels collapsed so the 3D view is immediately
// usable for orbiting/placing instead of being covered by two full panels; desktop
// keeps them expanded by default, as before.
if (matchMedia("(max-width: 700px), (pointer: coarse)").matches) {
  ["panel", "scorecard"].forEach((id) => document.getElementById(id)?.classList.add("collapsed"));
  ["panel-toggle", "scorecard-toggle"].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.textContent = "+";
  });
}
