type Listener = () => void;

const listenersByKey = new Map<string, Set<Listener>>();

export function subscribe(key: string, cb: Listener): () => void {
  let set = listenersByKey.get(key);
  if (!set) {
    set = new Set();
    listenersByKey.set(key, set);
  }
  set.add(cb);
  return () => {
    set.delete(cb);
  };
}

export function notify(key: string): void {
  const set = listenersByKey.get(key);
  if (set) {
    set.forEach((cb) => cb());
  }
}
