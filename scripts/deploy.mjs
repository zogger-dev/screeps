// Uploads dist/main.js to a Screeps server branch via the HTTP API.
// Config comes from .screeps.json (gitignored) or env: SCREEPS_TOKEN, SCREEPS_BRANCH, SCREEPS_HOST.
import { existsSync, readFileSync } from "node:fs";

const fileConfig = existsSync(".screeps.json") ? JSON.parse(readFileSync(".screeps.json", "utf8")) : {};
const token = process.env.SCREEPS_TOKEN ?? fileConfig.token;
const branch = process.env.SCREEPS_BRANCH ?? fileConfig.branch ?? "default";
const host = process.env.SCREEPS_HOST ?? fileConfig.host ?? "https://screeps.com";

if (!token || token === "YOUR_AUTH_TOKEN") {
  console.error("Missing auth token. Copy .screeps.example.json to .screeps.json and fill in your token.");
  process.exit(1);
}

const res = await fetch(`${host}/api/user/code`, {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8", "X-Token": token },
  body: JSON.stringify({ branch, modules: { main: readFileSync("dist/main.js", "utf8") } }),
});
const body = await res.json().catch(() => ({}));

if (!res.ok || body.ok !== 1) {
  console.error(`Deploy failed (${res.status}):`, body);
  process.exit(1);
}
console.log(`Deployed dist/main.js to branch "${branch}" on ${host}`);
