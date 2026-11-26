import { useEffect, useRef } from 'react';
import type { ActivityEvent } from '@upgradezin/shared';

export function trackActivity(event: ActivityEvent): void {
  if (typeof window === 'undefined') return;
  void fetch('/api/activity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Usage': '1' },
    body: JSON.stringify(event),
    keepalive: true,
  }).catch(() => {});
}

export function useActivityView(event: Omit<ActivityEvent, 'action'>, enabled = true): void {
  const { screen, category, mode, product } = event;
  const previous = useRef<string>(undefined);
  useEffect(() => {
    if (!enabled) return;
    const key = JSON.stringify([screen, category, mode, product]);
    if (previous.current === key) return;
    previous.current = key;
    trackActivity({ screen, action: 'view', category, mode, product });
  }, [screen, category, mode, product, enabled]);
}
