export default function ShowInfo({ sections = [], canEdit, onChange }) {
  function update(id, patch) {
    onChange(sections.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function add() {
    onChange([
      ...sections,
      {
        id: crypto.randomUUID(),
        header: "",
        body: "",
        order: sections.length,
      },
    ]);
  }

  function remove(id) {
    onChange(sections.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i })));
  }

  function move(id, dir) {
    const idx = sections.findIndex((s) => s.id === id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next.map((s, i) => ({ ...s, order: i })));
  }

  const ordered = [...sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  if (!ordered.length) {
    return (
      <div className="empty">
        <p>No sections yet. Add one for each department working this show.</p>
        {canEdit && (
          <button className="btn btn-primary" onClick={add}>
            Add section
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      {ordered.map((section, i) => (
        <div className="dept card card-pad" key={section.id} style={{ marginBottom: 12 }}>
          <div className="dept-head">
            <input
              className="dept-name"
              value={section.header}
              placeholder="Department"
              disabled={!canEdit}
              onChange={(e) => update(section.id, { header: e.target.value })}
            />
            {canEdit && (
              <div className="dept-actions">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => move(section.id, -1)}
                  disabled={i === 0}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => move(section.id, 1)}
                  disabled={i === ordered.length - 1}
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  className="btn btn-ghost btn-sm btn-danger"
                  onClick={() => remove(section.id)}
                  title="Remove section"
                >
                  Remove
                </button>
              </div>
            )}
          </div>

          <textarea
            className="textarea"
            value={section.body}
            placeholder={`What the ${section.header || "department"} package includes, who's running it, anything the crew needs to know.`}
            disabled={!canEdit}
            onChange={(e) => update(section.id, { body: e.target.value })}
          />
        </div>
      ))}

      {canEdit && (
        <button className="btn" onClick={add}>
          Add section
        </button>
      )}
    </div>
  );
}
