import { forceCollide, forceSimulation, type Force, type Simulation } from "d3-force";
import { within, type GraphNode, type Positions } from "./graph";

/**
 * The feel of the map:
 *  - Every circle is tied by a spring to its preferred spot *relative to its parent*,
 *    so dragging a category pulls its whole bubble of brands along, slightly springy.
 *  - Circles never overlap; whatever you drag through gets nudged out of the way.
 *  - Drop something and it stays where you put it.
 */

/** Spring stiffness toward the anchor, per tick. */
const FOLLOW = 0.22; // things being carried along by a drag
const SETTLE = 0.05; // everything else, drifting back after being nudged

function anchorForce(stiffness: (n: GraphNode) => number): Force<GraphNode, undefined> {
  let nodes: GraphNode[] = [];
  const force = () => {
    for (const n of nodes) {
      if (n.fx != null) continue;
      const k = stiffness(n);
      n.vx! += ((n.parent ? n.parent.x : 0) + n.ax - n.x) * k;
      n.vy! += ((n.parent ? n.parent.y : 0) + n.ay - n.y) * k;
    }
  };
  force.initialize = (all: GraphNode[]) => {
    nodes = all;
  };
  return force;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

export class Physics {
  private readonly sim: Simulation<GraphNode, undefined>;
  private readonly collide = forceCollide<GraphNode>((n) => n.collideR).strength(0.8).iterations(2);
  private carried = new Set<GraphNode>();
  private grab = { dx: 0, dy: 0 };
  private tween = 0;
  /** Resolves the running animateTo() promise, so an interrupted transition never leaves callers waiting. */
  private finishTween: (() => void) | null = null;
  private releaseTimer = 0;
  private readonly onFrame: () => void;

  constructor(nodes: GraphNode[], onFrame: () => void) {
    this.onFrame = onFrame;
    this.sim = forceSimulation<GraphNode>(nodes)
      .velocityDecay(0.42)
      .alphaDecay(0.035)
      .force("anchor", anchorForce((n) => (this.carried.has(n) ? FOLLOW : SETTLE)))
      .force("collide", this.collide)
      .on("tick", onFrame)
      .stop();
    this.sim.alpha(0);
  }

  /** Which nodes take part (focus mode leaves out hidden ones so they don't push anything). */
  setNodes(nodes: GraphNode[]): void {
    this.sim.nodes(nodes);
  }

  /** Re-read collision radii (after a brand opens or closes) and let things shuffle. */
  nudge(energy = 0.5): void {
    this.collide.radius((n) => n.collideR);
    this.sim.alpha(Math.max(this.sim.alpha(), energy)).restart();
  }

  dragStart(n: GraphNode, gx: number, gy: number): void {
    this.cancelTween();
    clearTimeout(this.releaseTimer);
    this.carried = new Set(this.sim.nodes().filter((m) => m !== n && within(m, n)));
    this.grab = { dx: n.x - gx, dy: n.y - gy };
    n.fx = n.x;
    n.fy = n.y;
    this.sim.alphaTarget(0.3).restart();
  }

  drag(n: GraphNode, gx: number, gy: number): void {
    n.fx = gx + this.grab.dx;
    n.fy = gy + this.grab.dy;
  }

  /** Releases the node where it was dropped; returns its new offset from its parent. */
  dragEnd(n: GraphNode, keepPinned: boolean): { ax: number; ay: number } {
    n.ax = n.x - (n.parent ? n.parent.x : 0);
    n.ay = n.y - (n.parent ? n.parent.y : 0);
    if (!keepPinned) n.fx = n.fy = null;
    this.sim.alphaTarget(0);
    // Let carried nodes finish catching up before they relax to the gentle spring.
    this.releaseTimer = window.setTimeout(() => this.carried.clear(), 600);
    return { ax: n.ax, ay: n.ay };
  }

  /** Smoothly moves nodes to fixed targets (mode changes). Physics pauses meanwhile. */
  animateTo(targets: Positions, duration = 750): Promise<void> {
    this.cancelTween();
    this.sim.stop();
    const from = new Map([...targets.keys()].map((n) => [n, { x: n.x, y: n.y }]));
    const ms = reducedMotion.matches ? 0 : duration;
    const start = performance.now();
    return new Promise((resolve) => {
      this.finishTween = resolve;
      const step = (now: number) => {
        const u = ms ? Math.min(1, (now - start) / ms) : 1;
        const e = easeInOut(u);
        for (const [n, to] of targets) {
          const a = from.get(n)!;
          n.x = a.x + (to.x - a.x) * e;
          n.y = a.y + (to.y - a.y) * e;
          n.vx = n.vy = 0;
          if (n.fx != null) (n.fx = n.x), (n.fy = n.y);
        }
        this.onFrame();
        if (u < 1) this.tween = requestAnimationFrame(step);
        else this.cancelTween();
      };
      this.tween = requestAnimationFrame(step);
    });
  }

  private cancelTween(): void {
    if (this.tween) cancelAnimationFrame(this.tween);
    this.tween = 0;
    const finish = this.finishTween;
    this.finishTween = null;
    finish?.();
  }
}
