import { describe, expect, it } from 'vitest';
import { ToastQueue, type ToastLevel } from '../../src/ui/toasts';

const toast = (senderId: string, level: ToastLevel = 'main') => ({
  senderId,
  level,
  sender: senderId,
  text: 'Report',
  point: null,
});

const senders = (queue: ToastQueue): readonly string[] => queue.visible.map((entry) => entry.senderId);

describe('map pop-overs', () => {
  it('leaves after its time, and urgent ones stay longer', () => {
    const queue = new ToastQueue();
    queue.add(toast('A'));
    queue.add(toast('B', 'urgent'));
    queue.advance(7);
    expect(senders(queue)).toEqual(['B']);
    queue.advance(6);
    expect(senders(queue)).toEqual([]);
  });

  it('keeps one per sender, so a newer report replaces the older one', () => {
    const queue = new ToastQueue();
    queue.add(toast('A'));
    queue.add({ ...toast('A'), text: 'Newer' });
    expect(queue.visible.map((entry) => entry.text)).toEqual(['Newer']);
  });

  it('never lets a main report replace an urgent one from the same sender', () => {
    const queue = new ToastQueue();
    queue.add({ ...toast('A', 'urgent'), text: 'TIC' });
    queue.add(toast('A'));
    expect(queue.visible.map((entry) => entry.text)).toEqual(['TIC']);
  });

  it('drops main reports first when the map fills up', () => {
    const queue = new ToastQueue();
    queue.add(toast('A', 'urgent'));
    queue.add(toast('B'));
    queue.add(toast('C', 'urgent'));
    queue.add(toast('D', 'urgent'));
    queue.add(toast('E', 'urgent'));
    expect(senders(queue)).toEqual(['A', 'C', 'D', 'E']);
  });

  it('goes when dismissed', () => {
    const queue = new ToastQueue();
    queue.add(toast('A'));
    queue.dismiss(queue.visible[0]?.id ?? 0);
    expect(senders(queue)).toEqual([]);
  });
});
