// Protocol communication.md "Routing and duplicates": handle each (sender, seq) once.
const WINDOW = 1024;

export function dedupe() {
  const seen = new Map(); // sender -> { set, order, high }
  return (sender, m) => {
    let s = seen.get(sender);
    if (s?.set.has(m.seq)) return false;
    if (!s || (/^admin\.(operator_)?hello$/.test(m.type) && m.seq < s.high)) seen.set(sender, s = { set: new Set(), order: [], high: -1 });
    s.set.add(m.seq); s.order.push(m.seq); s.high = Math.max(s.high, m.seq);
    if (s.order.length > WINDOW) s.set.delete(s.order.shift());
    return true;
  };
}
