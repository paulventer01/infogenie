/**
 * Harden Node.removeChild / insertBefore against third-party DOM moves
 * (Chart.js wrappers, field enhancer bars, browser translate, etc.).
 *
 * React 19 assumes exclusive ownership of its host nodes. When something else
 * reparents a node, reconciler removeChild throws NotFoundError and can white-
 * screen the migrated panel host. This patch no-ops the mismatched call so
 * navigation stays usable.
 */

let installed = false;

export function installDomSafetyPatch(): void {
  if (installed || typeof Node === "undefined") return;
  installed = true;

  const proto = Node.prototype;
  const originalRemoveChild = proto.removeChild;
  const originalInsertBefore = proto.insertBefore;

  proto.removeChild = function <T extends Node>(child: T): T {
    if (child && child.parentNode !== this) {
      // Already moved/detached — treat as success so React can continue.
      return child;
    }
    return originalRemoveChild.call(this, child) as T;
  };

  proto.insertBefore = function <T extends Node>(newNode: T, referenceNode: Node | null): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      return originalInsertBefore.call(this, newNode, null) as T;
    }
    try {
      return originalInsertBefore.call(this, newNode, referenceNode) as T;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/insertBefore|NotFoundError|not a child/i.test(msg)) {
        return originalInsertBefore.call(this, newNode, null) as T;
      }
      throw err;
    }
  };
}

/** Chart.js may wrap <canvas> in a sizing div — put the canvas back for React. */
export function restoreCanvasForReact(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas || typeof document === "undefined") return;
  const parent = canvas.parentElement;
  if (!parent || parent === document.body) return;
  const grand = parent.parentElement;
  if (!grand) return;
  // Chart.js 3+/4 responsive wrapper is an anonymous div around the canvas.
  if (
    parent.tagName === "DIV" &&
    !parent.id &&
    parent.childElementCount === 1 &&
    parent.firstElementChild === canvas
  ) {
    try {
      grand.insertBefore(canvas, parent);
      if (parent.parentNode === grand) grand.removeChild(parent);
    } catch {
      /* noop */
    }
  }
}

export function isDomReconcileError(error: unknown): boolean {
  if (!error) return false;
  const name = error instanceof Error ? error.name : "";
  const msg = error instanceof Error ? error.message : String(error);
  return (
    name === "NotFoundError" ||
    /removeChild|insertBefore|The node to be removed is not a child/i.test(msg)
  );
}
