const subSlotCache = new Map<symbol, Map<string, symbol>>();
const bareSlotCache = new Map<string, symbol>();

/**
 * Octane identifies hooks by compiler-provided call-site slots. A composed hook
 * must give each hook it calls a stable child slot of its own.
 *
 * @internal
 */
export function subSlot(slot: symbol | undefined, tag: string): symbol {
  if (slot === undefined) {
    let child = bareSlotCache.get(tag);
    if (child === undefined) {
      child = Symbol.for(`reactivity-store/octane:${tag}`);
      bareSlotCache.set(tag, child);
    }
    return child;
  }

  let children = subSlotCache.get(slot);
  if (children === undefined) {
    children = new Map();
    subSlotCache.set(slot, children);
  }

  let child = children.get(tag);
  if (child === undefined) {
    child = Symbol.for(`${slot.description ?? "reactivity-store"}:${tag}`);
    children.set(tag, child);
  }
  return child;
}

/** @internal */
export function splitSlot(args: unknown[]): [unknown[], symbol | undefined] {
  const tail = args[args.length - 1];
  const slot = typeof tail === "symbol" ? tail : undefined;
  return [slot === undefined ? args : args.slice(0, -1), slot];
}
