/**
 * FileCloud, through Anvil. Credentials and the path allowlist live server-side.
 */

const BASE = import.meta.env.VITE_ANVIL_BASE;
const KEY = import.meta.env.VITE_TOOLBOX_KEY;

/**
 * Listings live here rather than in the component, so switching tabs doesn't
 * throw them away. Anvil's round trip is 1.5-2 seconds even when the server
 * has the folder cached, so a revisit only feels instant if it never leaves
 * the browser. Keyed by full path, which makes it safe across events.
 */
const listingCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

export function cachedListing(path) {
  const hit = listingCache.get(path);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.items;
  return null;
}

export function cacheListing(path, items) {
  listingCache.set(path, { items, at: Date.now() });
}

export function forgetListing(path) {
  listingCache.delete(path);
}

export function clearListings() {
  listingCache.clear();
}

async function call(path, { method = "GET", body } = {}) {
  if (!BASE || !KEY) {
    throw new Error("Files aren't configured. Set VITE_ANVIL_BASE and VITE_TOOLBOX_KEY.");
  }

  const options = { method, headers: { "X-Toolbox-Key": KEY } };
  if (body) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE}${path}`, options);
  if (res.status === 401) throw new Error("FileCloud rejected the toolbox key.");

  const data = await res.json().catch(() => null);
  if (!res.ok || data?.error) {
    throw new Error(data?.error || `Request failed (${res.status}).`);
  }
  return data;
}

/**
 * The folders inside one path, for walking the tree.
 *
 * Pass a year to start there, or a path to go deeper. The response says
 * whether the current folder holds a Production Folder, so the picker can
 * offer it without the PM having to click in.
 */
export function browseFolders({ path, year, search } = {}) {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  else if (year) params.set("year", String(year));
  if (search) params.set("search", search);
  return call(`/files/folders?${params}`);
}

/**
 * Folder contents. Listings are cached server-side for a short window, so pass
 * fresh when the user explicitly refreshes or has just uploaded something.
 */
export function listFolder(path, { fresh = false } = {}) {
  const params = new URLSearchParams({ path });
  if (fresh) params.set("fresh", "1");
  return call(`/files/list?${params}`);
}

/**
 * Read a file's bytes, reporting progress as they arrive.
 *
 * onProgress({ loaded, total, percent }) fires as the stream fills. total is
 * null when the server doesn't send a length, in which case percent is null
 * too — better to show nothing than to invent a number.
 */
async function fetchBlob(path, onProgress) {
  const res = await fetch(`${BASE}/files/download?path=${encodeURIComponent(path)}`, {
    headers: { "X-Toolbox-Key": KEY },
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error || `Download failed (${res.status}).`);
  }

  const lengthHeader = res.headers.get("Content-Length");
  const total = lengthHeader ? Number(lengthHeader) : null;

  // Without a readable stream there's nothing to measure; take the whole body.
  if (!res.body || !onProgress) {
    return res.blob();
  }

  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress({
      loaded,
      total,
      percent: total ? Math.round((loaded / total) * 100) : null,
    });
  }

  return new Blob(chunks);
}

/** Fetch a file and hand it to the browser as a download. */
export async function downloadFile(path, onProgress) {
  const blob = await fetchBlob(path, onProgress);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = path.split("/").pop();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Fetch a file as a blob URL, for previewing in place. */
export async function previewUrl(path, onProgress) {
  const blob = await fetchBlob(path, onProgress);
  return URL.createObjectURL(blob);
}

/**
 * Upload a file, reporting progress.
 *
 * This uses XMLHttpRequest rather than fetch because fetch still has no upload
 * progress events — the one thing the older API does better.
 */
export function uploadFile({ path, file, onProgress }) {
  return new Promise((resolve, reject) => {
    if (!BASE || !KEY) {
      reject(new Error("Files aren't configured. Set VITE_ANVIL_BASE and VITE_TOOLBOX_KEY."));
      return;
    }

    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Couldn't read that file."));

    reader.onload = () => {
      const contentBase64 = String(reader.result).split(",")[1];
      const xhr = new XMLHttpRequest();

      xhr.open("POST", `${BASE}/files/upload`);
      xhr.setRequestHeader("X-Toolbox-Key", KEY);
      xhr.setRequestHeader("Content-Type", "application/json");

      xhr.upload.onprogress = (e) => {
        if (!onProgress || !e.lengthComputable) return;
        onProgress({
          loaded: e.loaded,
          total: e.total,
          percent: Math.round((e.loaded / e.total) * 100),
        });
      };

      xhr.onload = () => {
        let data = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          // fall through to the status check
        }
        if (xhr.status === 401) {
          reject(new Error("FileCloud rejected the toolbox key."));
        } else if (xhr.status >= 200 && xhr.status < 300 && !data?.error) {
          resolve(data);
        } else {
          reject(new Error(data?.error || `Upload failed (${xhr.status}).`));
        }
      };

      xhr.onerror = () => reject(new Error("Upload failed — the connection dropped."));

      xhr.send(JSON.stringify({ path, filename: file.name, contentBase64 }));
    };

    reader.readAsDataURL(file);
  });
}

export function sendToSlack({ path, size, channelId, comment, maxCopyBytes }) {
  return call("/files/toslack", {
    method: "POST",
    body: { path, size, channelId, comment, maxCopyBytes },
  });
}

/** What the browser can show inline versus what has to be downloaded. */
export function previewKind(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (["txt", "csv", "md", "log"].includes(ext)) return "text";
  return null;
}

export function fileIcon(item) {
  if (item.isDir) return "📁";
  const ext = (item.name.split(".").pop() || "").toLowerCase();
  if (ext === "pdf") return "📕";
  if (["xlsx", "xls", "csv"].includes(ext)) return "📊";
  if (["docx", "doc"].includes(ext)) return "📄";
  if (["pptx", "ppt"].includes(ext)) return "📽";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "🖼";
  if (["mp4", "mov", "avi"].includes(ext)) return "🎬";
  if (["zip", "rar", "7z"].includes(ext)) return "🗜";
  return "📎";
}

export function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
