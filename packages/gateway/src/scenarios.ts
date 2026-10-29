import type { Db } from "./db.js";

export type Scenario = { id: number; name: string; kind: "web" | "api"; target: string; steps: string; expect: string; updated: number };
export type Mode = "browser" | "code" | "qa" | "api";

export const listScenarios = (db: Db) => db.prepare("SELECT * FROM scenarios ORDER BY id").all() as Scenario[];
export const getScenario = (db: Db, id: number) => db.prepare("SELECT * FROM scenarios WHERE id=?").get(id) as Scenario | undefined;

export function saveScenario(db: Db, b: Partial<Scenario>, id?: number) {
  if (!b.name || !b.steps || (b.kind !== "web" && b.kind !== "api")) throw new Error("scenario needs name, kind (web|api) and steps");
  if (id) { db.prepare("UPDATE scenarios SET name=?,kind=?,target=?,steps=?,expect=?,updated=? WHERE id=?").run(b.name, b.kind, b.target ?? "", b.steps, b.expect ?? "", Date.now(), id); return id; }
  return Number(db.prepare("INSERT INTO scenarios(name,kind,target,steps,expect,updated) VALUES(?,?,?,?,?,?)").run(b.name, b.kind, b.target ?? "", b.steps, b.expect ?? "", Date.now()).lastInsertRowid);
}

/** Turn a user-written scenario into an agent task. Jobs can schedule one with the task text `scenario:<id>`. */
export function compileScenario(s: Scenario): { task: string; mode: Mode } {
  const steps = s.steps.split("\n").map((l) => l.trim()).filter(Boolean).map((l, i) => `${i + 1}. ${l}`).join("\n");
  const common = `Scenario "${s.name}".${s.target ? ` Target: ${s.target}.` : ""}\nSteps:\n${steps}\n${s.expect ? `Expected outcome: ${s.expect}\n` : ""}`;
  return s.kind === "api"
    ? { mode: "api", task: `${common}Execute every step as an API call with assertions. Report PASS or FAIL per step, then call finish_api_report.` }
    : { mode: "qa", task: `${common}Execute these steps exactly in order, checking after each step that the page behaves as expected. Call report_bug for any deviation, then finish_report. Only explore beyond the steps if they say so.` };
}
