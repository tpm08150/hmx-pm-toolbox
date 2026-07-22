import { DEFAULT_TASKS, PHASES, phaseProgress } from "../lib/checklist";

export default function Checklist({ event, tasks = DEFAULT_TASKS, canEdit, onToggle }) {
  const checklist = event.checklist || {};

  return (
    <div>
      {PHASES.map((phase) => {
        const phaseTasks = tasks.filter((t) => t.phase === phase.id);
        if (!phaseTasks.length) return null;
        const { done, total } = phaseProgress(event, tasks, phase.id);

        return (
          <section className="phase" key={phase.id}>
            <div className="phase-head">
              <h2 style={{ margin: 0 }}>{phase.label}</h2>
              <span className="eyebrow mono">
                {done} of {total}
              </span>
            </div>

            {phaseTasks.map((task) => {
              const state = checklist[task.id];
              const isDone = !!state?.done;

              return (
                <div className={`task${isDone ? " task-done" : ""}`} key={task.id}>
                  <input
                    type="checkbox"
                    id={`task-${task.id}`}
                    checked={isDone}
                    disabled={!canEdit}
                    onChange={(e) => onToggle(task.id, e.target.checked)}
                  />
                  <label className="task-label" htmlFor={`task-${task.id}`}>
                    {task.label}
                  </label>
                  {isDone && state.doneBy && (
                    <span className="task-by">
                      {firstName(state.doneBy)} · {shortDate(state.doneAt)}
                    </span>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function firstName(name) {
  return String(name).split(" ")[0];
}

function shortDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
