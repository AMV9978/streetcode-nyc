/**
 * Binary min-heap keyed by a numeric priority.
 * push/pop are O(log n). Duplicate entries are allowed: callers use
 * "lazy deletion" and skip an entry whose priority is no longer the best known.
 */
export class MinHeap {
  constructor(priority = (x) => x.cost) {
    this.items = [];
    this.priority = priority;
  }
  get size() {
    return this.items.length;
  }
  push(value) {
    const a = this.items,
      key = this.priority(value);
    let i = a.length;
    a.push(value);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.priority(a[p]) <= key) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = value;
  }
  pop() {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0],
      last = a.pop();
    if (a.length) {
      const key = this.priority(last);
      let i = 0;
      for (;;) {
        let child = i * 2 + 1;
        if (child >= a.length) break;
        if (
          child + 1 < a.length &&
          this.priority(a[child + 1]) < this.priority(a[child])
        )
          child++;
        if (key <= this.priority(a[child])) break;
        a[i] = a[child];
        i = child;
      }
      a[i] = last;
    }
    return top;
  }
}
