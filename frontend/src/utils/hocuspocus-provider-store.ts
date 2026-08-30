import type { HocuspocusProvider } from "@hocuspocus/provider";

export interface ProviderStore<S> {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => S;
}

/**
 * Wraps a HocuspocusProvider's lifecycle as an external store read via
 * useSyncExternalStore: the provider is created when the store gains its
 * first subscriber (the same passive-effect timing effect-managed state had)
 * and destroyed with the last one, resetting the snapshot to
 * `initialSnapshot`. A null factory models "no session" (e.g. chat closed)
 * with the fixed `offlineSnapshot`.
 */
export function createHocuspocusProviderStore<
  S extends { provider: HocuspocusProvider | null },
>(
  factory:
    | ((update: (partial: Partial<S>) => void, read: () => S) => HocuspocusProvider)
    | null,
  initialSnapshot: S,
  offlineSnapshot: S = initialSnapshot,
): ProviderStore<S> {
  let snapshot: S = factory ? initialSnapshot : offlineSnapshot;
  const listeners = new Set<() => void>();
  let provider: HocuspocusProvider | null = null;

  const read = () => snapshot;
  const update = (partial: Partial<S>) => {
    snapshot = { ...snapshot, ...partial };
    for (const listener of [...listeners]) {
      listener();
    }
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (factory && !provider) {
        provider = factory(update, read);
        update({ provider } as Partial<S>);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && provider) {
          provider.destroy();
          provider = null;
          snapshot = initialSnapshot;
        }
      };
    },
    getSnapshot: read,
  };
}
