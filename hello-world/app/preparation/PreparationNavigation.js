"use client";

import styles from "./preparation.module.css";

const PHASES = [
  { label: "Understand", ids: ["brief", "role", "company", "interviewer"] },
  { label: "Prepare answers", ids: ["candidacy", "examples", "practical", "questions"] },
  { label: "Practice", ids: ["mock", "repair"] },
  { label: "Interview day", ids: ["reference", "followup"] },
];

export default function PreparationNavigation({ stage, stages, artifacts, attempts, onSelect }) {
  const status = (id) => {
    const artifact = artifacts[id === "mock" ? "sample" : id === "repair" ? "repairSuggestion" : id];
    if (artifact?.suggestion) return "Unreviewed suggestion";
    if (artifact?.draft) return "Draft saved";
    if (["mock", "repair"].includes(id) && attempts.length) return `${attempts.length} saved practice answers`;
    return "Not started";
  };
  return <details className={styles.activityDisclosure}>
    <summary><span>Choose an activity</span><strong>{stages.find((entry) => entry.id === stage)?.label}</strong><small>{status(stage)}</small></summary>
    <nav className={styles.steps} aria-label="Interview preparation activities">
      <p className={styles.navigationTitle}>PREPARATION PATH</p>
      {PHASES.map((phase) => <div className={styles.phase} key={phase.label}>
        <h4>{phase.label}</h4>
        {stages.filter((entry) => phase.ids.includes(entry.id)).map((entry) => <button type="button" key={entry.id} aria-current={stage === entry.id ? "step" : undefined} className={stage === entry.id ? styles.activeStep : ""} onClick={() => onSelect(entry.id)}><span>{entry.label}</span><small>{status(entry.id)}</small></button>)}
      </div>)}
    </nav>
  </details>;
}
