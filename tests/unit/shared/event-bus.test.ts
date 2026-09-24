import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../src/shared/events/event-bus.js';

interface TestEvents {
  'thing.happened': { id: string };
  'other.happened': { count: number };
}

describe('EventBus', () => {
  it('delivers payloads to every subscriber of the event', async () => {
    const bus = new EventBus<TestEvents>();
    const first = vi.fn();
    const second = vi.fn();
    bus.subscribe('thing.happened', first);
    bus.subscribe('thing.happened', second);

    await bus.publish('thing.happened', { id: 'a' });

    expect(first).toHaveBeenCalledWith({ id: 'a' });
    expect(second).toHaveBeenCalledWith({ id: 'a' });
  });

  it('does not deliver other events', async () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    bus.subscribe('other.happened', handler);

    await bus.publish('thing.happened', { id: 'a' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('isolates failing handlers and reports their errors', async () => {
    const onError = vi.fn();
    const bus = new EventBus<TestEvents>(onError);
    const healthy = vi.fn();
    bus.subscribe('thing.happened', () => {
      throw new Error('boom');
    });
    bus.subscribe('thing.happened', async () => {
      await Promise.reject(new Error('async boom'));
    });
    bus.subscribe('thing.happened', healthy);

    await expect(bus.publish('thing.happened', { id: 'a' })).resolves.toBeUndefined();

    expect(healthy).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'thing.happened');
  });

  it('supports unsubscribing', async () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe('thing.happened', handler);

    unsubscribe();
    await bus.publish('thing.happened', { id: 'a' });

    expect(handler).not.toHaveBeenCalled();
  });
});
