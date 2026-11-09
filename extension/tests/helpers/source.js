const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "../../..");

/**
 * Returns the concatenated source of sidepanel scripts as actually declared
 * in sidepanel.html (<script src="..."> tags).
 */
function getSidepanelSource() {
  const htmlPath = path.join(ROOT_DIR, "extension", "sidepanel", "sidepanel.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const scriptRegex = /<script\s+src=["']([^"']+)["']/g;
  const sources = [];
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const rel = match[1];
    const scriptPath = path.resolve(path.dirname(htmlPath), rel);
    if (fs.existsSync(scriptPath)) {
      sources.push(fs.readFileSync(scriptPath, "utf8"));
    }
  }
  if (sources.length > 0) {
    return sources.join("\n;\n");
  }
  const mainJs = path.join(ROOT_DIR, "extension", "sidepanel", "sidepanel.js");
  return fs.readFileSync(mainJs, "utf8");
}

function parseVideoMiningScriptsFromBackground() {
  const bgPath = path.join(ROOT_DIR, "extension", "background.js");
  if (!fs.existsSync(bgPath)) {
    return [
      "lib/subtitle-parser.js",
      "lib/subtitle-provider.js",
      "lib/jimaku-provider.js",
      "lib/image-cropper.js",
      "link/clip.js",
      "content/video-mining/controller.js",
      "content/video-mining.js"
    ];
  }
  const code = fs.readFileSync(bgPath, "utf8");
  const match = code.match(/const\s+VIDEO_MINING_SCRIPTS\s*=\s*\[([\s\S]*?)\];/);
  if (match) {
    const list = [];
    const itemRe = /["']([^"']+)["']/g;
    let m;
    while ((m = itemRe.exec(match[1])) !== null) {
      list.push(m[1]);
    }
    if (list.length > 0) return list;
  }
  return [
    "lib/subtitle-parser.js",
    "lib/subtitle-provider.js",
    "lib/jimaku-provider.js",
    "lib/image-cropper.js",
    "link/clip.js",
    "content/video-mining/controller.js",
    "content/video-mining.js"
  ];
}

/**
 * Returns the concatenated source of video-mining scripts as defined
 * in background.js (VIDEO_MINING_SCRIPTS).
 */
function getVideoMiningSource() {
  const scriptList = parseVideoMiningScriptsFromBackground();
  const sources = [];
  for (const rel of scriptList) {
    const fullPath = path.join(ROOT_DIR, "extension", rel);
    if (fs.existsSync(fullPath)) {
      sources.push(fs.readFileSync(fullPath, "utf8"));
    }
  }
  return sources.join("\n;\n");
}

function resolveVideoMiningPath() {
  const vmNew = path.join(ROOT_DIR, "extension", "content", "video-mining.js");
  if (fs.existsSync(vmNew)) return vmNew;
  return path.join(ROOT_DIR, "extension", "content", "video-mining-poc.js");
}

module.exports = {
  getSidepanelSource,
  getVideoMiningSource,
  sidepanelPath: path.join(ROOT_DIR, "extension", "sidepanel", "sidepanel.js"),
  videoMiningPath: resolveVideoMiningPath()
};
