// Jømna disc golf course — interactive 3D terrain + hole placement.
// Real elevation (opentopodata EU-DEM 25m) + real satellite imagery (Esri World Imagery),
// draped over an actual heightmap of the parcel. Click a "place" button, then click the
// terrain to drop that point. Export when done.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

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
document.getElementById("app").appendChild(renderer.domElement);

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

const HOLES = [1, 2, 3, 4];
const POINT_KINDS = ["tee", "basket"];
const START_KEY = "start";
const state = {};
let armedKey = null;

const markers = {};
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

const discGeo = new THREE.CylinderGeometry(1.1, 1.1, 0.18, 24);
const discMat = new THREE.MeshStandardMaterial({ color: 0xffb703, metalness: 0.1, roughness: 0.35 });
const discMesh = new THREE.Mesh(discGeo, discMat);
discMesh.castShadow = true;
discMesh.visible = false;
scene.add(discMesh);

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
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x888888 }),
    );
    pole.position.y = 2;
    pole.castShadow = true;
    const flag = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 1.0, 0.06),
      new THREE.MeshStandardMaterial({ color: colorFor(kind), side: THREE.DoubleSide }),
    );
    flag.position.set(0.8, 3.4, 0);
    flag.castShadow = true;
    group.add(pole, flag);
  } else {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 6, 8),
      new THREE.MeshStandardMaterial({ color: 0x888888 }),
    );
    pole.position.y = 3;
    pole.castShadow = true;
    const basket = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.0, 1.2, 12, 1, true),
      new THREE.MeshStandardMaterial({ color: colorFor(kind), side: THREE.DoubleSide }),
    );
    basket.position.y = 5.6;
    basket.castShadow = true;
    group.add(pole, basket);
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
    holeDiv.innerHTML = `<strong>Hole ${h}</strong>`;
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

// Real measured positions for the fixed points (parking + tee pads). Baskets aren't
// hardcoded because they're portable and get moved between rounds -- place those per
// session via the UI. Loading these just runs them through the same placement path as
// a manual click, so they're seed data, not read-only: click a button again to move one.
const DEFAULT_PLACEMENTS = {
  start: { lat: 60.82746012321331, lon: 11.721275733853467, elevation: 197.19862189521584 },
  "1-tee": { lat: 60.82727870995245, lon: 11.720750744649953, elevation: 195.85749312012138 },
  "2-tee": { lat: 60.82665352000554, lon: 11.72095956367916, elevation: 195.84659042335778 },
  "3-tee": { lat: 60.82680736930721, lon: 11.721531234465367, elevation: 197.62694691183492 },
  "4-tee": { lat: 60.826944833898814, lon: 11.72147335639348, elevation: 197.4362516054343 },
};

function applyDefaultPlacements() {
  Object.entries(DEFAULT_PLACEMENTS).forEach(([key, { lat, lon, elevation }]) => {
    const kind = key === START_KEY ? "start" : key.split("-")[1];
    const [x, z] = latLonToLocal(lat, lon);
    const y = elevation - elevMin;

    const marker = makeMarker(kind);
    marker.position.set(x, y, z);
    scene.add(marker);
    markers[key] = marker;

    state[key] = { x, y, z, lat, lon, elev: elevation };
    const statusEl = document.getElementById(`status-${key}`);
    if (statusEl) statusEl.textContent = `placed (${lat.toFixed(6)}, ${lon.toFixed(6)})`;
  });
  drawHolePaths();
}
applyDefaultPlacements();

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

  if (markers[armedKey]) scene.remove(markers[armedKey]);
  const kind = armedKey === START_KEY ? "start" : armedKey.split("-")[1];
  const marker = makeMarker(kind);
  marker.position.set(p.x, p.y, p.z);
  scene.add(marker);
  markers[armedKey] = marker;

  state[armedKey] = { x: p.x, y: p.y, z: p.z, lat, lon, elev };
  document.getElementById(`status-${armedKey}`).textContent =
    `placed (${lat.toFixed(6)}, ${lon.toFixed(6)})`;

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
    if (isThrow) {
      // Brief "set up the shot" beat at the tee before the disc actually launches.
      legs.push({ type: "pause", from: a.point, to: b.point, duration: 0.9 });
    }
    legs.push({
      type: isThrow ? "throw" : "walk",
      from: a.point,
      to: b.point,
      duration: isThrow ? Math.min(2.5, 1.0 + dist * 0.02) : Math.min(6, 1.5 + dist * 0.05),
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
};

function updateWalk(t, leg) {
  const { from, to } = leg;
  const cx = from.x + (to.x - from.x) * t;
  const cz = from.z + (to.z - from.z) * t;
  const cy = Math.max(from.y, to.y) + 25;
  camera.position.set(cx, cy, cz + 35);
  controls.target.set(cx, Math.max(from.y, to.y), cz);
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
  controls.target.set(from.x + dirX * 10, from.y + 2, from.z + dirZ * 10);

  discMesh.visible = true;
  discMesh.position.set(from.x, from.y + 1.1, from.z);
  discMesh.rotation.y += dt * 3; // idle wobble while held, not yet thrown
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
  const y = releaseY + (landY - releaseY) * t + arc;
  return { x, y, z };
}

function updateThrow(t, leg, dt) {
  const p0 = discPositionAt(leg, t);

  discMesh.visible = true;
  discMesh.position.set(p0.x, p0.y, p0.z);
  discMesh.rotation.y += dt * 30; // spin
  discMesh.rotation.z = THREE.MathUtils.lerp(-0.05, 0.05, t); // slight settle wobble

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

  const chaseDist = 14;
  const chaseHeight = 6;
  camera.position.set(p0.x - fx * chaseDist, p0.y + chaseHeight, p0.z - fz * chaseDist);
  // Look past the disc, toward where it's headed, not at the disc itself.
  controls.target.set(p0.x + fx * 8, p0.y, p0.z + fz * 8);
}

function updateFlight(dt) {
  if (!flying || flyLegs.length === 0) return;
  const leg = flyLegs[flyIndex];
  flyElapsed += dt;
  const t = Math.min(flyElapsed / leg.duration, 1);

  if (leg.type === "throw") {
    updateThrow(t, leg, dt);
  } else if (leg.type === "pause") {
    updatePause(t, leg, dt);
  } else {
    discMesh.visible = false;
    updateWalk(t, leg);
  }

  if (t >= 1) {
    flyElapsed = 0;
    flyIndex++;
    if (flyIndex >= flyLegs.length) {
      flying = false;
      discMesh.visible = false;
    }
  }
}

// ---------- Render loop ----------

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  updateFlight(dt);
  controls.update();
  renderer.render(scene, camera);
}

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
