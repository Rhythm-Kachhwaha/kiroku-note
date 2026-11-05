const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "../../..");

/**
 * Returns the concatenated source of sidepanel scripts.
 * Supports both split modules and single bundle.
 */
function getSidepanelSource() {
  const modulesDir = path.join(ROOT_DIR, "extension", "sidepanel", "modules");
  if (fs.existsSync(modulesDir)) {
    const moduleFiles = [
      "core.js",
      "dictionaries.js",
      "card-preview.js",
      "video-tab.js",
      "layout.js",
      "ask-tab.js"
    ];
    return moduleFiles
      .map(file => fs.readFileSync(path.join(modulesDir, file), "utf8"))
      .join("\n;\n");
  }
  const mainJs = path.join(ROOT_DIR, "extension", "sidepanel", "sidepanel.js");
  return fs.readFileSync(mainJs, "utf8");
}

/**
 * Returns the concatenated source of video-mining scripts.
 * Supports both split files and renamed video-mining.js or legacy video-mining-poc.js.
 */
function getVideoMiningSource() {
  const vmDir = path.join(ROOT_DIR, "extension", "content", "video-mining");
  if (fs.existsSync(vmDir)) {
    const vmFiles = [
      "detector.js",
      "sync.js",
      "overlay.js",
      "controls.js",
      "main.js"
    ];
    return vmFiles
      .map(file => fs.readFileSync(path.join(vmDir, file), "utf8"))
      .join("\n;\n");
  }
  const vmNew = path.join(ROOT_DIR, "extension", "content", "video-mining.js");
  if (fs.existsSync(vmNew)) {
    return fs.readFileSync(vmNew, "utf8");
  }
  const vmPoc = path.join(ROOT_DIR, "extension", "content", "video-mining-poc.js");
  return fs.readFileSync(vmPoc, "utf8");
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
