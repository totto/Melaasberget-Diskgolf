# Melåsberget Diskgolf — 3D course builder

An interactive 3D map of the out-and-back disc golf course at Flotsvegen 5, 2416 Jømna — real
terrain, real satellite imagery, click-to-place holes. 7 holes: 1-4 head out, 5-7 play the way back.

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
3. The course start (parking) and holes 1-4 (tees + baskets) load pre-placed at their real
   measured positions. Holes 5-7 (the way back) load placeholder positions that just retrace
   1-4 in reverse — overwrite them via the UI once actually walked/thrown for real. Baskets
   are portable, so if one's been moved, click its button again and either click the new spot
   on the terrain, or tap "Use my GPS location" if you're standing there with your phone
   (elevation still comes from the terrain's own DEM data, not phone GPS altitude, which is
   commonly off by tens of meters). Either way it's saved to localStorage and sticks across
   reloads.
4. "Copy placements" exports all placed points as JSON (lat/lon/elevation — durable across
   rebuilds, not tied to this specific Three.js scene).
5. "Preview flythrough" auto-plays the whole course in order: start → hole 1 tee → hole 1 basket →
   hole 2 tee → ... At each tee it pauses briefly (camera lines up the shot, disc held ready),
   then throws — a spinning disc flies an arced, turn-then-fade path to the basket with a chase
   camera. Everything else (walking between a basket and the next tee) is a walking hop. No
   further clicks needed once it starts; it runs straight through to the last hole.
6. The **Photos** panel has two sections: a "Course gallery" — shared photos anyone visiting
   the site sees, added as static files in `public-photos/` (see that folder's README —
   requires repo push access, so it can't be spammed by random visitors) — and "My photos",
   private-to-this-device shots you add yourself via separate "Camera" (opens the phone
   camera directly) and "Choose file" (photo library / file picker) buttons. Private photos
   are stored in IndexedDB (not localStorage — photos are too big for that), fully offline,
   never uploaded anywhere. Tap a thumbnail to view
   full-size; private photos can be deleted from there too.
7. The scorecard has a "fun" strip under the table: a live leader (👑), an ace/eagle/birdie
   highlight feed, and per-hole course records pulled from past rounds. "Finish round" archives
   the current scores to a round history (used for those records) and offers to clear the card
   for a new round.
8. Current weather (temperature, wind speed/direction, precipitation) shows at the top of the
   Scorecard panel, fetched from [Open-Meteo](https://open-meteo.com) for the farm's exact
   coordinates — free, no API key, refreshes every 10 minutes. Each "Finish round" also
   snapshots the conditions into that round's history entry.

## Regenerating the data

The `tools/` directory has the scripts that produced `elevation.json` and `tiles.json`:

```
node tools/fetch-elevation.mjs   # re-fetch the elevation grid
node tools/fetch-tiles.mjs       # re-fetch satellite tiles (reads elevation.json for the bounding box)
node tools/build.mjs             # re-embed both into index.html from tools/index.template.html
```

Only needed if you want to change the coverage area/resolution — the checked-in `index.html`
already has everything baked in.

## Mobile / PWA

Installable as a home-screen app (manifest + service worker) — on Android, Chrome will offer
"Add to Home Screen"; on iOS Safari, use Share → "Add to Home Screen". Once installed (or just
visited once), the whole app works offline: terrain and satellite imagery are already embedded
in `index.html`, and the service worker (`sw.js`) caches the app shell plus the Three.js CDN
modules on first load. A top nav bar (Course / Scorecard / Photos) shows one panel at a time —
tap a tab to open it, tap it again (or the ✕ in the panel) to close, leaving the 3D view
unobstructed by default. Works the same way on desktop and mobile.

## Status

Terrain and satellite alignment confirmed working in-browser (farmhouse, second building, and
patio all recognizable in the right places relative to the real slopes). Holes 1-4 (start, tees,
baskets) hardcoded to real measured positions; holes 5-7 (the way back) have placeholder
positions pending a real walkthrough. A scorecard panel tracks players, strokes, and some "fun"
stats (leader, highlights, course records, round history), persisted to localStorage. A Photos
panel stores camera/gallery photos in IndexedDB. Mobile-friendly and installable as a PWA.
(Photo gallery and scorecard fun-stats designed and implemented with Claude Fable 5.)
