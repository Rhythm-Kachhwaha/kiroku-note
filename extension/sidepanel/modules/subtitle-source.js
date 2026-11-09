// ==========================================================================
// Module: subtitle-source.js
// Local subtitle folder selection and file save
// ==========================================================================

// -------------------------------------------------------------
// Subtitle Directory / Local Folder Selection
// -------------------------------------------------------------
function saveSubtitleToDisk(text, filename, subfolder = "KirokuSubtitles") {
  if (!text || !filename) return;
  try {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const cleanSubfolder = (subfolder || "").trim().replace(/[\\/]+$/, "");
    a.download = cleanSubfolder ? `${cleanSubfolder}/${filename}` : filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (_) {}
}

async function loadSubtitleFolderPreferences() {
  try {
    let savedFolderName = "";
    let downloadFolder = "KirokuSubtitles";
    let autoSave = true;

    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get([
        "subtitle_folder_name",
        "subtitle_download_folder",
        "auto_save_subtitle_file"
      ]);
      if (stored?.subtitle_folder_name) savedFolderName = stored.subtitle_folder_name;
      if (stored?.subtitle_download_folder) downloadFolder = stored.subtitle_download_folder;
      if (typeof stored?.auto_save_subtitle_file === "boolean") autoSave = stored.auto_save_subtitle_file;
    } else if (typeof localStorage !== "undefined") {
      savedFolderName = localStorage.getItem("subtitle_folder_name") || "";
      downloadFolder = localStorage.getItem("subtitle_download_folder") || "KirokuSubtitles";
      const storedAutoSave = localStorage.getItem("auto_save_subtitle_file");
      if (storedAutoSave !== null) autoSave = storedAutoSave === "true";
    }

    if (jimakuDownloadFolderInput) jimakuDownloadFolderInput.value = downloadFolder;
    if (toggleSaveSubtitleDisk) toggleSaveSubtitleDisk.checked = autoSave;
    if (savedFolderName && folderNameLabel) {
      folderNameLabel.textContent = `${savedFolderName}:`;
    }
  } catch (_) {}
}

async function saveSubtitleFolderPreferences() {
  try {
    const downloadFolder = (jimakuDownloadFolderInput?.value || "KirokuSubtitles").trim();
    const autoSave = Boolean(toggleSaveSubtitleDisk?.checked);
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({
        subtitle_download_folder: downloadFolder,
        auto_save_subtitle_file: autoSave
      });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem("subtitle_download_folder", downloadFolder);
      localStorage.setItem("auto_save_subtitle_file", String(autoSave));
    }
  } catch (_) {}
}

async function handleSubtitleFolderSelect(files) {
  if (!files || files.length === 0) return;

  const validExts = [".srt", ".vtt", ".ass", ".ssa"];
  const subtitleFiles = [];

  for (const file of files) {
    const lowerName = file.name.toLowerCase();
    if (validExts.some(ext => lowerName.endsWith(ext))) {
      subtitleFiles.push(file);
    }
  }

  if (subtitleFiles.length === 0) {
    setStatus("No valid subtitle files (.srt, .vtt, .ass, .ssa) found in selected directory.", true);
    return;
  }

  // Sort files naturally by name
  subtitleFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

  // Extract root folder name from webkitRelativePath if available
  let folderName = "Subtitles";
  if (subtitleFiles[0]?.webkitRelativePath) {
    const parts = subtitleFiles[0].webkitRelativePath.split("/");
    if (parts.length > 1) folderName = parts[0];
  }
  currentSubtitleDirectoryName = folderName;

  selectedSubtitleFolderFiles.clear();
  if (folderSubtitlesSelect) {
    folderSubtitlesSelect.replaceChildren();
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = `— Select subtitle (${subtitleFiles.length} available) —`;
    folderSubtitlesSelect.appendChild(defaultOption);

    for (const file of subtitleFiles) {
      selectedSubtitleFolderFiles.set(file.name, file);
      const opt = document.createElement("option");
      opt.value = file.name;
      opt.textContent = file.name;
      folderSubtitlesSelect.appendChild(opt);
    }
  }

  if (folderNameLabel) {
    folderNameLabel.textContent = `${folderName} (${subtitleFiles.length}):`;
  }
  if (subtitleFolderBar) {
    subtitleFolderBar.hidden = false;
  }

  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({
        subtitle_folder_name: folderName
      });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem("subtitle_folder_name", folderName);
    }
  } catch (_) {}

  setStatus(`Loaded folder "${folderName}" with ${subtitleFiles.length} subtitle files.`);
}

function addFileToFolderDropdown(filename, content) {
  if (!filename || !folderSubtitlesSelect) return;
  selectedSubtitleFolderFiles.set(filename, { name: filename, content });
  
  let existingOpt = Array.from(folderSubtitlesSelect.options).find(opt => opt.value === filename);
  if (!existingOpt) {
    const opt = document.createElement("option");
    opt.value = filename;
    opt.textContent = `[Jimaku] ${filename}`;
    folderSubtitlesSelect.appendChild(opt);
  }
  folderSubtitlesSelect.value = filename;
  if (subtitleFolderBar) subtitleFolderBar.hidden = false;
}

