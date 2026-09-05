/**
 * Lightweight undirected weighted graph for Kruskal MST region splitting.
 *
 * Used by the OCR post-processing pipeline to decide which detected text
 * polygons belong to the same speech bubble and which should be kept separate.
 */
export class Graph {
  nodes = new Set<number>();
  edges: { u: number; v: number; weight: number }[] = [];

  /**
   * Register a node index in the graph.
   * @param n - Node identifier (typically a polygon/region index).
   */
  addNode(n: number) { this.nodes.add(n); }

  /**
   * Add an undirected weighted edge between two nodes.
   * @param u - First node index.
   * @param v - Second node index.
   * @param weight - Edge weight (e.g. spatial distance between regions).
   */
  addEdge(u: number, v: number, weight: number = 0) { this.edges.push({ u, v, weight }); }

  /**
   * Build a Minimum Spanning Tree using Kruskal's algorithm with
   * union-find path compression.
   *
   * @returns Sorted list of MST edges in ascending weight order.
   */
  kruskalMST(): { u: number; v: number; weight: number }[] {
    const parent = new Map<number, number>();
    const find = (i: number): number => {
      if (!parent.has(i)) parent.set(i, i);
      if (parent.get(i) === i) return i;
      parent.set(i, find(parent.get(i)!));
      return parent.get(i)!;
    };
    const union = (i: number, j: number) => {
      const rootI = find(i);
      const rootJ = find(j);
      if (rootI !== rootJ) parent.set(rootI, rootJ);
    };

    const sortedEdges = [...this.edges].sort((a, b) => a.weight - b.weight);
    const mst: { u: number; v: number; weight: number }[] = [];

    for (const edge of sortedEdges) {
      if (find(edge.u) !== find(edge.v)) {
        union(edge.u, edge.v);
        mst.push(edge);
      }
    }
    return mst;
  }

  /**
   * Partition the graph into connected components using union-find.
   *
   * @returns Array of node-index sets, one per connected component.
   */
  connectedComponents(): Set<number>[] {
    const parent = new Map<number, number>();
    for (const n of this.nodes) parent.set(n, n);

    const find = (i: number): number => {
      if (parent.get(i) === i) return i;
      parent.set(i, find(parent.get(i)!));
      return parent.get(i)!;
    };
    const union = (i: number, j: number) => {
      const rootI = find(i);
      const rootJ = find(j);
      if (rootI !== rootJ) parent.set(rootI, rootJ);
    };

    for (const edge of this.edges) {
      union(edge.u, edge.v);
    }

    const groups = new Map<number, Set<number>>();
    for (const n of this.nodes) {
      const root = find(n);
      if (!groups.has(root)) groups.set(root, new Set());
      groups.get(root)!.add(n);
    }
    return Array.from(groups.values());
  }
}
