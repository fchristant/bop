// One-off data-generation script (not part of the Eleventy build).
// Run manually with `XC_API_KEY=... node scripts/fetch-audio.js` whenever
// the species list changes. Downloads one representative recording per
// species from Xeno-canto and stores it locally (self-hosted, not
// hot-linked) - explicitly permitted by XC's Terms of Use under all of
// their CC license variants, provided recordist, license, and XC
// catalogue number are credited wherever the recording is used. That
// attribution is rendered on each bird page from the `audio` field this
// script writes into birds.json.
//
// Requires a personal Xeno-canto API key (tied to a verified account,
// from your XC account page) passed via the XC_API_KEY env var. Never
// hardcode it here or commit it - XC's own docs warn against publishing
// keys in git repositories.
const fs = require("fs");
const path = require("path");

const BIRDS_PATH = path.join(__dirname, "..", "src", "_data", "birds.json");
const OUT_DIR = path.join(__dirname, "..", "src", "audio");
const XC_DELAY_MS = 500;

const API_KEY = process.env.XC_API_KEY;
if (!API_KEY) {
  console.error("Set XC_API_KEY (your personal Xeno-canto API key) before running this script.");
  process.exit(1);
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// "https://creativecommons.org/licenses/by-nc-sa/4.0/" -> "CC BY-NC-SA 4.0"
function licenseLabel(licenseUrl) {
  const match = licenseUrl.match(/licenses\/([a-z-]+)\/([\d.]+)/);
  if (!match) return licenseUrl;
  const [, code, version] = match;
  return `CC ${code.toUpperCase()} ${version}`;
}

// Xeno-canto files some species under a different genus than iNaturalist
// (the source for birds.json) uses - a naming disagreement, not a
// different bird. Only add an alias here when the species identity is
// unambiguous; genuine taxonomic splits XC hasn't adopted yet are left
// without audio rather than guessing.
const XC_GENUS_ALIASES = {
  "Paradisornis rudolphi": "Paradisaea",
};

function lengthInSeconds(length) {
  const parts = length.split(":").map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

// Prefer a song over a call (more distinctive/representative), then a
// short clip over a long one (some recordings run many minutes - trimming
// would count as "altering" the work, which some XC licenses forbid, so
// we pick short to begin with instead), then the highest XC quality rating.
const MAX_PREFERRED_SECONDS = 90;

function pickBest(recordings) {
  const QUALITY_ORDER = { A: 0, B: 1, C: 2, D: 3, E: 4 };
  const candidates = recordings.filter((r) => r.status === "identified" && r.file);
  candidates.sort((a, b) => {
    const aSong = a.type.includes("song") ? 0 : 1;
    const bSong = b.type.includes("song") ? 0 : 1;
    if (aSong !== bSong) return aSong - bSong;

    const aSeconds = lengthInSeconds(a.length);
    const bSeconds = lengthInSeconds(b.length);
    const aShort = aSeconds <= MAX_PREFERRED_SECONDS ? 0 : 1;
    const bShort = bSeconds <= MAX_PREFERRED_SECONDS ? 0 : 1;
    if (aShort !== bShort) return aShort - bShort;

    const qualityDiff = (QUALITY_ORDER[a.q] ?? 9) - (QUALITY_ORDER[b.q] ?? 9);
    if (qualityDiff !== 0) return qualityDiff;

    return aSeconds - bSeconds;
  });
  return candidates[0];
}

async function xcSearch(genus, species) {
  const url = new URL("https://xeno-canto.org/api/3/recordings");
  url.searchParams.set("query", `gen:${genus} sp:${species}`);
  url.searchParams.set("key", API_KEY);
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`XC API error for ${genus} ${species}: ${JSON.stringify(data.error)}`);
  return data.recordings || [];
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
}

async function main() {
  const birds = JSON.parse(fs.readFileSync(BIRDS_PATH, "utf8"));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const bird of birds) {
    const [, species] = bird.binomial_name.split(" ");
    const genus = XC_GENUS_ALIASES[bird.binomial_name] || bird.genus;
    const slug = slugify(bird.binomial_name);
    process.stdout.write(`${bird.binomial_name} ... `);

    const recordings = await xcSearch(genus, species);
    const best = pickBest(recordings);

    if (!best) {
      console.log("no usable recording found");
      bird.audio = null;
      await new Promise((resolve) => setTimeout(resolve, XC_DELAY_MS));
      continue;
    }

    const ext = path.extname(best["file-name"] || "").toLowerCase() || ".mp3";
    const fileName = `${slug}${ext}`;
    await downloadFile(best.file, path.join(OUT_DIR, fileName));

    bird.audio = {
      file: fileName,
      xcId: best.id,
      recordist: best.rec,
      license: best.lic,
      licenseLabel: licenseLabel(best.lic),
      url: best.url,
      type: best.type,
      quality: best.q,
    };
    console.log(`XC${best.id} (${best.type}, q=${best.q}, ${best.rec})`);
    await new Promise((resolve) => setTimeout(resolve, XC_DELAY_MS));
  }

  fs.writeFileSync(BIRDS_PATH, JSON.stringify(birds, null, 2) + "\n");
}

main();
