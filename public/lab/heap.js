/** Binary min-heap. Duplicate priorities are intentional; the solver skips stale entries. */
export class MinHeap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  push(value) {
    const a = this.items;
    a.push(value);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].cost <= a[i].cost) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    if (!a.length) return undefined;
    const root = a[0],
      last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      while (true) {
        let k = i;
        const l = i * 2 + 1,
          r = l + 1;
        if (l < a.length && a[l].cost < a[k].cost) k = l;
        if (r < a.length && a[r].cost < a[k].cost) k = r;
        if (k === i) break;
        [a[i], a[k]] = [a[k], a[i]];
        i = k;
      }
    }
    return root;
  }
}
