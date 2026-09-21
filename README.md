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
3. Click "Place start (parking)" for where the walkthrough should begin, and "Place tee" /
   "Place basket" for each of the 4 holes, then click on the terrain where that point actually is.
4. "Copy placements" exports all placed points as JSON (lat/lon/elevation — durable across
   rebuilds, not tied to this specific Three.js scene).
5. "Preview flythrough" walks start → hole 1 tee → hole 1 basket → hole 2 tee → ... in order.
   Tee-to-basket legs are simulated as an actual disc throw (a spinning disc flies an arced,
   turn-then-fade path from tee to basket with a chase camera); other legs are a walking hop.

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
patio all recognizable in the right places relative to the real slopes). Course start point and
disc-simulated flythrough added; still need the actual tee/basket positions placed.
