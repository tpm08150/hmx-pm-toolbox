import { useState, useEffect, useRef, useCallback } from "react";
import {
  browseFolders,
  listFolder,
  downloadFile,
  previewUrl,
  uploadFile,
  sendToSlack,
  previewKind,
  fileIcon,
  formatSize,
  cachedListing,
  cacheListing,
  forgetListing,
  clearListings,
} from "../lib/files";
import { getSettings } from "../lib/settings";

/**
 * How many subfolders to warm at once after a folder renders. Low enough not
 * to hammer FileCloud or a phone's connection, high enough that the folders
 * near the top of the list are ready before anyone clicks one.
 */
const PREFETCH_CONCURRENCY = 3;

/** Below this, a transfer finishes before a progress bar would even register. */
const PROGRESS_MIN_BYTES = 2 * 1024 * 1024;

export default function Files({ event, canEdit, onFolderChange }) {
  const meta = event.meta || {};
  const linked = event.fileCloudFolder || null;

  const [path, setPath] = useState(linked?.path || null);
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [picking, setPicking] = useState(!linked);
  const [year, setYear] = useState(
    () => (meta.plannedStart || "").slice(0, 4) || String(new Date().getFullYear())
  );
  const [search, setSearch] = useState("");
  const [browse, setBrowse] = useState(null);
  const [browsing, setBrowsing] = useState(false);

  const [preview, setPreview] = useState(null);
  const [sending, setSending] = useState(null);
  const [transfer, setTransfer] = useState(null); // { kind, name, percent }

  const fileInput = useRef(null);
  const prefetchRun = useRef(0);

  const prefetch = useCallback(async (contents, runId) => {
    const queue = contents.filter((i) => i.isDir && !cachedListing(i.path));
    let index = 0;

    async function worker() {
      while (index < queue.length) {
        // A newer navigation started — stop spending requests on the old one.
        if (prefetchRun.current !== runId) return;

        const item = queue[index++];
        try {
          const { items: sub } = await listFolder(item.path);
          if (prefetchRun.current !== runId) return;
          cacheListing(item.path, sub);
        } catch {
          // A folder that fails to prefetch just loads normally when clicked.
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(PREFETCH_CONCURRENCY, queue.length) }, worker)
    );
  }, []);

  const load = useCallback(
    async (target, { fresh = false } = {}) => {
      if (!target) return;

      const runId = ++prefetchRun.current;

      if (!fresh) {
        const cached = cachedListing(target);
        if (cached) {
          setItems(cached);
          setPath(target);
          prefetch(cached, runId);
          return;
        }
      }

      setLoading(true);
      setError(null);
      try {
        const { items: contents } = await listFolder(target, { fresh });
        cacheListing(target, contents);
        setItems(contents);
        setPath(target);
        prefetch(contents, runId);
      } catch (e) {
        setError(e.message);
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [prefetch]
  );

  useEffect(() => {
    if (linked?.path && !items) load(linked.path);
  }, [linked?.path, items, load]);

  /**
   * Walk the folder tree. Most shows sit under the year, but a client folder
   * can hold a season's worth of events, so this browses rather than assuming
   * a shape.
   */
  const loadFolders = useCallback(
    async ({ path, year: y, search: term } = {}) => {
      setBrowsing(true);
      setError(null);
      try {
        const data = await browseFolders({ path, year: y, search: term });
        setBrowse(data);
      } catch (e) {
        setError(e.message);
        setBrowse(null);
      } finally {
        setBrowsing(false);
      }
    },
    []
  );

  // Opening the picker starts where the event is already linked, so changing
  // a deep folder doesn't mean walking down from the year again.
  useEffect(() => {
    if (!picking) return;
    const start = linked?.path
      ? linked.path.split("/").slice(0, -1).join("/")
      : null;
    loadFolders(start ? { path: start } : { year });
    setSearch("");
  }, [picking, linked?.path, year, loadFolders]);

  // Searching only makes sense at the level you're standing on.
  useEffect(() => {
    if (!picking || !browse?.path) return;
    const t = setTimeout(() => {
      loadFolders({ path: browse.path, search: search.trim() });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function chooseFolder(path, name) {
    onFolderChange({ name, path });
    setPicking(false);
    setItems(null);
    clearListings();
    load(path);
  }

  /** Only track progress on transfers big enough for it to mean anything. */
  function progressFor(kind, name, size) {
    if (size && size < PROGRESS_MIN_BYTES) return undefined;
    setTransfer({ kind, name, percent: 0 });
    return ({ percent }) => setTransfer({ kind, name, percent });
  }

  async function doDownload(item) {
    setError(null);
    try {
      await downloadFile(item.path, progressFor("Downloading", item.name, item.size));
    } catch (e) {
      setError(e.message);
    } finally {
      setTransfer(null);
    }
  }

  function openItem(item) {
    if (item.isDir) {
      load(item.path);
      return;
    }
    const kind = previewKind(item.name);
    if (kind) {
      openPreview(item, kind);
    } else {
      doDownload(item);
    }
  }

  async function openPreview(item, kind) {
    setPreview({ item, kind, url: null, loading: true });
    try {
      const url = await previewUrl(item.path, progressFor("Opening", item.name, item.size));
      setPreview({ item, kind, url, loading: false });
    } catch (e) {
      setPreview(null);
      setError(e.message);
    } finally {
      setTransfer(null);
    }
  }

  function closePreview() {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file || !path) return;

    setError(null);
    setNotice(null);
    setTransfer({ kind: "Uploading", name: file.name, percent: 0 });

    try {
      await uploadFile({
        path,
        file,
        onProgress: ({ percent }) =>
          setTransfer({ kind: "Uploading", name: file.name, percent }),
      });
      setNotice(`Uploaded ${file.name}.`);
      forgetListing(path);
      await load(path, { fresh: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setTransfer(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function slackFile(item) {
    if (!event.slackChannelId) {
      setError("This event has no Slack channel yet. Send the crew packet first to create one.");
      return;
    }

    setSending(item.path);
    setError(null);
    setNotice(null);
    try {
      const settings = await getSettings();
      const maxCopyBytes = (Number(settings.files?.slackCopyMaxMb) || 20) * 1024 * 1024;

      const result = await sendToSlack({
        path: item.path,
        size: item.size,
        channelId: event.slackChannelId,
        comment: "",
        maxCopyBytes,
      });

      setNotice(
        result.mode === "copy"
          ? `Sent ${item.name} to #${event.slackChannelName}.`
          : `Posted a link to ${item.name} in #${event.slackChannelName}.`
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(null);
    }
  }

  function refresh() {
    forgetListing(path);
    load(path, { fresh: true });
  }

  // Breadcrumbs stop at the Production Folder — above that is the show root,
  // which PMs don't need and the server won't serve anyway.
  const crumbs = (() => {
    if (!path || !linked?.path) return [];
    if (!path.startsWith(linked.path)) return [];
    const rest = path.slice(linked.path.length).split("/").filter(Boolean);
    let current = linked.path;
    return [
      { name: linked.name, path: linked.path },
      ...rest.map((segment) => {
        current = `${current}/${segment}`;
        return { name: segment, path: current };
      }),
    ];
  })();

  const years = (() => {
    const base = Number((meta.plannedStart || "").slice(0, 4)) || new Date().getFullYear();
    return [base - 1, base, base + 1];
  })();

  const uploading = transfer?.kind === "Uploading";

  // ── Folder picker ───────────────────────────────────────────────────────
  if (picking) {
    const crumbs = folderCrumbs(browse?.path, browse?.root);

    return (
      <div>
        {error && (
          <div className="banner banner-error">
            {error}
            <div className="banner-spacer" />
            <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        <div className="card card-pad">
          <h2>{linked ? "Change folder" : "Pick the FileCloud folder"}</h2>
          <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 14 }}>
            {linked
              ? `Currently linked to ${linked.name}.`
              : "Click into folders to find this show. Link whichever one holds its files."}
          </p>

          <div className="picker-bar">
            <select
              className="select"
              style={{ maxWidth: 100 }}
              value={year}
              onChange={(e) => {
                setYear(e.target.value);
                loadFolders({ year: e.target.value });
              }}
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>

            <input
              className="input"
              style={{ maxWidth: 260 }}
              placeholder="Filter this folder"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            {browse?.parent && (
              <button className="btn btn-sm" onClick={() => loadFolders({ path: browse.parent })}>
                ↑ Up
              </button>
            )}
          </div>

          {crumbs.length > 0 && (
            <div className="crumbs picker-crumbs">
              {crumbs.map((c, i) => (
                <span key={c.path}>
                  {i > 0 && <span className="crumb-sep">/</span>}
                  <button
                    className={`crumb${i === crumbs.length - 1 ? " crumb-current" : ""}`}
                    onClick={() => loadFolders({ path: c.path })}
                  >
                    {c.name}
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Most shows still keep their files in a Production Folder, so
              offer it rather than making the PM click in and back out. */}
          {browse?.hasProductionFolder && (
            <div className="picker-suggest">
              <span>
                This folder has a <b>{PRODUCTION_FOLDER_NAME}</b>.
              </span>
              <div style={{ flex: 1 }} />
              <button
                className="btn btn-sm btn-primary"
                onClick={() =>
                  chooseFolder(browse.productionFolder, folderLabel(browse.path))
                }
              >
                Link it
              </button>
            </div>
          )}

          {browsing ? (
            <div className="muted" style={{ fontSize: 13, padding: "10px 0" }}>Loading…</div>
          ) : !browse?.folders?.length ? (
            <div className="muted" style={{ padding: "10px 0", fontSize: 13 }}>
              {search ? "Nothing matches that here." : "No folders in here."}
            </div>
          ) : (
            <div className="picker-list">
              {browse.folders.map((f) => (
                <div className="picker-row picker-row-split" key={f.path}>
                  <button className="picker-open" onClick={() => loadFolders({ path: f.path })}>
                    <span className="file-icon">📁</span>
                    <span className="picker-name">{f.name}</span>
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => chooseFolder(f.path, f.name)}
                    title="Link this folder"
                  >
                    Link
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="picker-foot">
            {browse?.path && browse.path !== browse.root && (
              <button
                className="btn btn-sm"
                onClick={() => chooseFolder(browse.path, folderLabel(browse.path))}
              >
                Link this folder
              </button>
            )}
            {linked && (
              <button className="btn btn-sm btn-ghost" onClick={() => setPicking(false)}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── File browser ────────────────────────────────────────────────────────
  return (
    <div>
      {notice && (
        <div className="banner banner-info">
          {notice}
          <div className="banner-spacer" />
          <button className="btn btn-ghost btn-sm" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}
      {error && (
        <div className="banner banner-error">
          {error}
          <div className="banner-spacer" />
          <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {transfer && (
        <div className="transfer">
          <span className="transfer-label">
            {transfer.kind} <b>{transfer.name}</b>
          </span>
          <div className="transfer-track">
            <div className="transfer-fill" style={{ width: `${transfer.percent || 0}%` }} />
          </div>
          <span className="transfer-percent mono">{transfer.percent || 0}%</span>
        </div>
      )}

      <div className="files-bar">
        <div className="crumbs">
          {crumbs.map((c, i) => (
            <span key={c.path}>
              {i > 0 && <span className="crumb-sep">/</span>}
              <button
                className={`crumb${i === crumbs.length - 1 ? " crumb-current" : ""}`}
                onClick={() => load(c.path)}
              >
                {c.name}
              </button>
            </span>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        <div className="files-actions">
          <button className="btn btn-sm" onClick={refresh} disabled={loading}>
            Refresh
          </button>
          {canEdit && (
            <>
              <input
                ref={fileInput}
                type="file"
                style={{ display: "none" }}
                onChange={handleUpload}
              />
              <button
                className="btn btn-sm"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
              >
                {uploading ? "Uploading…" : "Upload"}
              </button>
              <button className="btn btn-sm" onClick={() => setPicking(true)}>
                Change folder
              </button>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <SkeletonList />
      ) : !items?.length ? (
        <div className="empty">
          <p>This folder is empty.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="event-table files-table">
            <thead>
              <tr>
                <th>Name</th>
                <th style={{ width: 90 }}>Size</th>
                <th style={{ width: 160 }} />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.path} className="file-row">
                  <td>
                    <button className="file-name" onClick={() => openItem(item)}>
                      <span className="file-icon">{fileIcon(item)}</span>
                      {item.name}
                    </button>
                  </td>
                  <td className="mono muted" style={{ fontSize: 12 }}>
                    {item.isDir ? "" : formatSize(item.size)}
                  </td>
                  <td>
                    {!item.isDir && (
                      <div className="row-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => doDownload(item)}>
                          Download
                        </button>
                        {event.slackChannelId && (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => slackFile(item)}
                            disabled={sending === item.path}
                            title={`Send to #${event.slackChannelName}`}
                          >
                            {sending === item.path ? "Sending…" : "Slack"}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview && (
        <div className="preview-overlay" onClick={closePreview}>
          <div className="preview-box" onClick={(e) => e.stopPropagation()}>
            <div className="preview-head">
              <span className="preview-title">{preview.item.name}</span>
              <div style={{ flex: 1 }} />
              <button className="btn btn-sm" onClick={() => doDownload(preview.item)}>
                Download
              </button>
              <button className="btn btn-sm" onClick={closePreview}>Close</button>
            </div>

            <div className="preview-body">
              {preview.loading ? (
                <div className="loading">Opening…</div>
              ) : preview.kind === "image" ? (
                <img src={preview.url} alt={preview.item.name} className="preview-image" />
              ) : (
                <iframe title={preview.item.name} src={preview.url} className="preview-frame" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Placeholder rows while a listing loads. The table keeps its shape, so
 * nothing jumps when the real names arrive — which reads as faster than a
 * spinner even when it isn't.
 */
function SkeletonList() {
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <table className="event-table files-table">
        <thead>
          <tr>
            <th>Name</th>
            <th style={{ width: 90 }}>Size</th>
            <th style={{ width: 160 }} />
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 7 }, (_, i) => (
            <tr key={i}>
              <td>
                <div className="skeleton" style={{ width: `${45 + ((i * 13) % 40)}%` }} />
              </td>
              <td>
                <div className="skeleton" style={{ width: "60%" }} />
              </td>
              <td />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PRODUCTION_FOLDER_NAME = "02 Production Folder";

/** The trail from the events root down to where the picker is standing. */
function folderCrumbs(path, root) {
  if (!path || !root || !path.startsWith(root)) return [];
  const rest = path.slice(root.length).split("/").filter(Boolean);
  let current = root;
  return [
    { name: "Events", path: root },
    ...rest.map((segment) => {
      current = `${current}/${segment}`;
      return { name: segment, path: current };
    }),
  ];
}

/** A folder's own name, for labelling a link. */
function folderLabel(path) {
  return String(path || "").split("/").filter(Boolean).pop() || "Folder";
}
