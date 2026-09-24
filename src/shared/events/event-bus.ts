export type EventHandler<TPayload> = (payload: TPayload) => void | Promise<void>;

export type EventErrorReporter = (error: unknown, eventName: string) => void;

/**
 * A small, typed, in-process publish/subscribe bus.
 *
 * Handlers are isolated from each other and from the publisher: a failing
 * listener is reported through `onError` but never breaks the use case that
 * published the event (the state change has already been committed).
 */
export class EventBus<TEvents extends object> {
  private readonly handlers = new Map<keyof TEvents, EventHandler<never>[]>();

  constructor(private readonly onError: EventErrorReporter = () => undefined) {}

  subscribe<K extends keyof TEvents>(name: K, handler: EventHandler<TEvents[K]>): () => void {
    const list = this.handlers.get(name) ?? [];
    list.push(handler);
    this.handlers.set(name, list);
    return () => {
      const current = this.handlers.get(name) ?? [];
      this.handlers.set(
        name,
        current.filter((candidate) => candidate !== handler),
      );
    };
  }

  async publish<K extends keyof TEvents>(name: K, payload: TEvents[K]): Promise<void> {
    const list = (this.handlers.get(name) ?? []) as EventHandler<TEvents[K]>[];
    const results = await Promise.allSettled(
      list.map(async (handler) => {
        await handler(payload);
      }),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        this.onError(result.reason, String(name));
      }
    }
  }
}
