# Course gallery

Public, shared photos shown in the app's Photos panel — these are plain static files
committed to the repo, not uploaded through the app. Safe by construction: only
whoever can push to this repo can add one (no open upload endpoint, no external
service, no account to manage).

## Adding a photo

1. Add the image file to this folder (any reasonable size — it's served as-is, so
   pre-shrink large camera originals if you care about page weight).
2. Add an entry to `manifest.json`:
   ```json
   { "file": "hole3-view.jpg", "hole": 3, "caption": "Optional caption" }
   ```
   `hole` and `caption` are both optional.
3. Commit and push. GitHub Pages serves the new file immediately, no build step needed
   — the app fetches `manifest.json` at runtime.

Easiest ways to do steps 1-3 from a phone: use GitHub's own mobile web UI ("Add file"
on this folder, then edit `manifest.json` in the same way), or just send the photo to
Claude and ask it to add it to the course gallery.
