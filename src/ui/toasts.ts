import type { Vec2 } from '../domain/public/geometry';

export type ToastLevel = 'urgent' | 'main' | 'sent';

export type Toast = Readonly<{
  id: number;
  senderId: string;
  level: ToastLevel;
  sender: string;
  text: string;
  point: Vec2 | null;
  secondsLeft: number;
}>;

const MAX_TOASTS = 4;
const SECONDS_ON_SCREEN: Readonly<Record<ToastLevel, number>> = { urgent: 12, main: 6, sent: 4 };

/**
 * Pop-overs on the map, timed in real seconds so they can be read at any game speed.
 * One per sender, so a unit's burst of reports doesn't fill the map.
 */
export class ToastQueue {
  private toasts: Toast[] = [];
  private nextId = 1;

  get visible(): readonly Toast[] {
    return this.toasts;
  }

  add(toast: Omit<Toast, 'id' | 'secondsLeft'>): void {
    const held = this.toasts.find((entry) => entry.senderId === toast.senderId);
    if (held?.level === 'urgent' && toast.level === 'main') return;
    const others = this.toasts.filter((entry) => entry !== held);
    const added = { ...toast, id: this.nextId, secondsLeft: SECONDS_ON_SCREEN[toast.level] };
    this.nextId += 1;
    const kept = [...others, added];
    if (kept.length > MAX_TOASTS) {
      const oldestMain = kept.find((entry) => entry.level === 'main');
      kept.splice(oldestMain === undefined ? 0 : kept.indexOf(oldestMain), 1);
    }
    this.toasts = kept;
  }

  advance(seconds: number): void {
    this.toasts = this.toasts
      .map((entry) => ({ ...entry, secondsLeft: entry.secondsLeft - seconds }))
      .filter((entry) => entry.secondsLeft > 0);
  }

  dismiss(id: number): void {
    this.toasts = this.toasts.filter((entry) => entry.id !== id);
  }
}
