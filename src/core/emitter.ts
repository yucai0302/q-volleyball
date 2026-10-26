type Listener<T> = (payload: T) => void;

/** 极简类型安全事件总线，用于模拟层 -> 表现层单向通信 */
export class Emitter<E extends object> {
  private map = new Map<keyof E, Set<Listener<never>>>();

  on<K extends keyof E>(key: K, fn: Listener<E[K]>): () => void {
    let set = this.map.get(key);
    if (!set) {
      set = new Set();
      this.map.set(key, set);
    }
    set.add(fn as Listener<never>);
    return () => this.off(key, fn);
  }

  off<K extends keyof E>(key: K, fn: Listener<E[K]>): void {
    this.map.get(key)?.delete(fn as Listener<never>);
  }

  emit<K extends keyof E>(key: K, payload: E[K]): void {
    const set = this.map.get(key);
    if (!set) return;
    for (const fn of set) (fn as Listener<E[K]>)(payload);
  }

  clear(): void {
    this.map.clear();
  }
}
