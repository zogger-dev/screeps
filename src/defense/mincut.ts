/** Capacity standing in for "can't be cut". */
export const INFINITE = 1e9;

/**
 * Max-flow (Dinic's algorithm) on a small directed graph, kept in flat arrays. Used to find the
 * minimum set of tiles separating room exits from what we want to protect.
 */
export class FlowGraph {
  private readonly head: Int32Array;
  private readonly to: number[] = [];
  private readonly cap: number[] = [];
  private readonly next: number[] = [];
  private level = new Int32Array(0);
  private iter = new Int32Array(0);

  constructor(private readonly nodes: number) {
    this.head = new Int32Array(nodes).fill(-1);
  }

  addEdge(from: number, to: number, capacity: number): void {
    this.to.push(to, from);
    this.cap.push(capacity, 0);
    this.next.push(this.head[from], this.head[to]);
    this.head[from] = this.to.length - 2;
    this.head[to] = this.to.length - 1;
  }

  /** Levels by BFS over edges with spare capacity; false if the sink is unreachable. */
  private bfs(source: number, sink: number): boolean {
    this.level = new Int32Array(this.nodes).fill(-1);
    this.level[source] = 0;
    const queue = [source];
    for (let i = 0; i < queue.length; i++) {
      const u = queue[i];
      for (let e = this.head[u]; e !== -1; e = this.next[e]) {
        if (this.cap[e] > 0 && this.level[this.to[e]] < 0) {
          this.level[this.to[e]] = this.level[u] + 1;
          queue.push(this.to[e]);
        }
      }
    }
    return this.level[sink] >= 0;
  }

  /** Pushes a blocking flow along level-increasing edges, iteratively to avoid deep recursion. */
  private dfs(source: number, sink: number): number {
    let total = 0;
    const path: number[] = [];
    let u = source;
    for (;;) {
      if (u === sink) {
        let push = INFINITE;
        for (const e of path) push = Math.min(push, this.cap[e]);
        for (const e of path) {
          this.cap[e] -= push;
          this.cap[e ^ 1] += push;
        }
        total += push;
        path.length = 0;
        u = source;
        continue;
      }
      let advanced = false;
      for (; this.iter[u] !== -1; this.iter[u] = this.next[this.iter[u]]) {
        const e = this.iter[u];
        if (this.cap[e] > 0 && this.level[this.to[e]] === this.level[u] + 1) {
          path.push(e);
          u = this.to[e];
          advanced = true;
          break;
        }
      }
      if (advanced) continue;
      if (u === source) return total;
      // Dead end: retreat and skip this edge from the previous node.
      this.level[u] = -1;
      const e = path.pop()!;
      u = this.to[e ^ 1];
      this.iter[u] = this.next[this.iter[u]];
    }
  }

  maxFlow(source: number, sink: number): number {
    let flow = 0;
    while (this.bfs(source, sink)) {
      this.iter = Int32Array.from(this.head);
      flow += this.dfs(source, sink);
      if (flow >= INFINITE) break;
    }
    return flow;
  }

  /** Nodes reachable from `source` over edges with spare capacity (the source side of the cut). */
  reachable(source: number): Uint8Array {
    const seen = new Uint8Array(this.nodes);
    seen[source] = 1;
    const queue = [source];
    for (let i = 0; i < queue.length; i++) {
      for (let e = this.head[queue[i]]; e !== -1; e = this.next[e]) {
        if (this.cap[e] > 0 && !seen[this.to[e]]) {
          seen[this.to[e]] = 1;
          queue.push(this.to[e]);
        }
      }
    }
    return seen;
  }
}
