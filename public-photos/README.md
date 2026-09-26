# Course gallery

Public, shared photos shown in the app's Photos panel — these are plain static files
committed to the repo, not uploaded through the app. Safe by construction: only
whoever can push to this repo can add one (no open upload endpoint, no external
service, no account to manage).

## Adding a photo

1. Add the image file to this folder (any reasonable size — it's served as-is, so
   pre-shrink large camera originals if you care about page weight).
2. Add a 400x400 square crop of it to `thumbs/` under the same filename — that's what the
   grid actually displays, so without one every visitor who opens the Photos panel
   downloads the whole gallery at full size.
3. Add an entry to `manifest.json`:
   ```json
   { "file": "hole3-view.webp", "thumb": "thumbs/hole3-view.webp", "hole": 3, "caption": "Optional caption" }
   ```
   `thumb`, `hole` and `caption` are all optional — without `thumb` the grid falls back to
   the full-size file.
4. Commit and push. GitHub Pages serves the new files immediately, no build step needed
   — the app fetches `manifest.json` at runtime.

Conventions used so far: `YYYY-MM-DD-short-slug.webp` filenames, images downscaled to
1280px on the long edge and converted to WebP at quality 75 (roughly 15-20% smaller
than an equivalent JPEG, e.g. sharp's `.webp({ quality: 75 })`) — plenty for the
full-size lightbox, and it keeps the whole gallery well under 2MB instead of 35MB of
camera originals. Thumbnails are center-cropped to 400x400 and encoded the same way —
the grid renders every entry at once, so at 15 photos that's ~550KB of thumbnails
instead of ~5MB of full-size files, and a photo's full file is fetched only when someone
opens it. Newest first in `manifest.json` — the same order "My photos" uses.

Easiest ways to do steps 1-4 from a phone: use GitHub's own mobile web UI ("Add file"
on this folder, then edit `manifest.json` in the same way), or just send the photo to
Claude and ask it to add it to the course gallery.
