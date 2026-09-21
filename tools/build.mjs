import { readFileSync, writeFileSync } from "fs";

const DIR = new URL(".", import.meta.url);
const elevation = readFileSync(new URL("./elevation.json", DIR), "utf8");
const tiles = readFileSync(new URL("./tiles.json", DIR), "utf8");
let html = readFileSync(new URL("./index.template.html", DIR), "utf8");

html = html.replace("__ELEVATION_JSON__", elevation).replace("__TILES_JSON__", tiles);

writeFileSync(new URL("../index.html", DIR), html);
console.error(`Wrote index.html (${(html.length / 1024).toFixed(0)}KB)`);
