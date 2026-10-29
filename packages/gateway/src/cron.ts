function field(spec: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const [range, step] = part.split("/");
    const [a, b] = range === "*" ? [min, max] : range.includes("-") ? range.split("-").map(Number) : [Number(range), step ? max : Number(range)];
    if ([a, b].some(Number.isNaN)) throw new Error(`bad cron field: ${spec}`);
    for (let i = a; i <= b; i += step ? Number(step) : 1) out.add(i);
  }
  return out;
}

export function parseCron(expr: string) {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) throw new Error("cron needs 5 fields: min hour dom month dow");
  return { min: field(p[0], 0, 59), hour: field(p[1], 0, 23), dom: field(p[2], 1, 31), mon: field(p[3], 1, 12), dow: field(p[4], 0, 6) };
}

export function nextRun(expr: string, from = new Date()): number {
  const c = parseCron(expr);
  const d = new Date(from);
  d.setSeconds(0, 0);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    d.setMinutes(d.getMinutes() + 1);
    if (c.min.has(d.getMinutes()) && c.hour.has(d.getHours()) && c.dom.has(d.getDate()) && c.mon.has(d.getMonth() + 1) && c.dow.has(d.getDay())) return d.getTime();
  }
  throw new Error("cron never fires");
}
