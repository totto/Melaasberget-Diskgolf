# Melåsberget Diskgolf — 3D course builder

An interactive 3D map of the 4-hole disc golf course at Flotsvegen 5, 2416 Jømna — real terrain,
real satellite imagery, click-to-place holes.

**Live**: https://totto.github.io/Melaasberget-Diskgolf/ (once GitHub Pages is enabled on this repo)

## What this actually is

- **Real elevation data**: 441 points (21×21 grid) from [opentopodata.org](https://www.opentopodata.org/)'s
  EU-DEM 25m dataset, covering a 400m × 400m box centered on the farm. There's genuine relief here —
  about 38m of elevation change across the parcel, not a flat plane.
- **Real satellite imagery**: 42 tiles (zoom 18) from Esri World Imagery, stitched into one texture
  and draped over the heightmap.
- **No build tooling needed to view it** — `index.html` is fully self-contained (data embedded
  inline), loads Three.js from a CDN via an import map, and runs as a static page.

## Using it

1. Serve the repo root over HTTP (ES modules don't load from `file://`):
   ```
   python3 -m http.server 8000
   ```
   then open `http://localhost:8000/`. (Or just use the GitHub Pages URL above once it's live.)
2. Orbit/zoom/pan to look around the real terrain.
3. The course start (parking) and all 4 tee pads load pre-placed at their real measured
   positions — click the corresponding button again to move one. Baskets aren't hardcoded
   since they're portable and get moved between rounds; click "Place basket" for each hole
   and click on the terrain where it actually is.
4. "Copy placements" exports all placed points as JSON (lat/lon/elevation — durable across
   rebuilds, not tied to this specific Three.js scene).
5. "Preview flythrough" auto-plays the whole course in order: start → hole 1 tee → hole 1 basket →
   hole 2 tee → ... At each tee it pauses briefly (camera lines up the shot, disc held ready),
   then throws — a spinning disc flies an arced, turn-then-fade path to the basket with a chase
   camera. Everything else (walking between a basket and the next tee) is a walking hop. No
   further clicks needed once it starts; it runs straight through to the last hole.

## Regenerating the data

The `tools/` directory has the scripts that produced `elevation.json` and `tiles.json`:

```
node tools/fetch-elevation.mjs   # re-fetch the elevation grid
node tools/fetch-tiles.mjs       # re-fetch satellite tiles (reads elevation.json for the bounding box)
node tools/build.mjs             # re-embed both into index.html from tools/index.template.html
```

Only needed if you want to change the coverage area/resolution — the checked-in `index.html`
already has everything baked in.

## Status

Terrain and satellite alignment confirmed working in-browser (farmhouse, second building, and
patio all recognizable in the right places relative to the real slopes). Course start and all
4 tees are hardcoded to their real measured positions; basket positions still need placing
each round since the baskets are portable.
