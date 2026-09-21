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
      uvs.push(lonToU(lon), 1 - latToV(lat));
    }
  }

  for (let i = 0; i < gridN - 1; i++) {
    for (let j = 0; j < gridN - 1; j++) {
      const a = i * gridN + j;
      const b = i * gridN + j + 1;
      const c = (i + 1) * gridN + j;
      const d = (i + 1) * gridN + j + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95, metalness: 0.0 });
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
const state = {};
let armedKey = null;

const markers = {};
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function colorFor(kind) { return kind === "tee" ? 0x2ecc71 : 0xff7f27; }

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
  const kind = armedKey.split("-")[1];
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

let flying = false;
document.getElementById("fly-btn").onclick = () => {
  const seq = [];
  HOLES.forEach((h) => {
    const tee = state[`${h}-tee`];
    const basket = state[`${h}-basket`];
    if (tee) seq.push(tee);
    if (basket) seq.push(basket);
  });
  if (seq.length < 2) {
    alert("Place at least two points first (e.g. hole 1 tee + basket).");
    return;
  }
  flying = true;
  flyIndex = 0;
  flyPoints = seq;
  flyT = 0;
};

let flyPoints = [];
let flyIndex = 0;
let flyT = 0;

function updateFlight(dt) {
  if (!flying || flyPoints.length < 2) return;
  flyT += dt * 0.25;
  if (flyT >= 1) { flyT = 0; flyIndex++; }
  if (flyIndex >= flyPoints.length - 1) { flying = false; return; }
  const a = flyPoints[flyIndex];
  const b = flyPoints[flyIndex + 1];
  const cx = a.x + (b.x - a.x) * flyT;
  const cz = a.z + (b.z - a.z) * flyT;
  const cy = Math.max(a.y, b.y) + 30;
  camera.position.set(cx, cy, cz + 40);
  controls.target.set(cx, Math.max(a.y, b.y), cz);
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
