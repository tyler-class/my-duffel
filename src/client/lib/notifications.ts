// Notifications on this device (Selfhost Kit: src/client/kit/push.ts): taps on a notification
// route in-app, and the app-icon badge follows the to-dos.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { onPushOpen, syncBadge } from '../kit/push';

/** Mount once inside the router. */
export function useNotifications() {
  const nav = useNavigate();
  const qc = useQueryClient();
  useEffect(() => onPushOpen((url) => nav(url)), [nav]);
  useEffect(() => {
    void syncBadge();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void syncBadge(), 800);
    };
    // A trip's data changed (a to-do ticked, added or moved): the count may have too.
    const unsub = qc.getQueryCache().subscribe((e) => {
      if (e.type === 'updated' && e.action.type === 'success' && e.query.queryKey[0] === 'trip')
        soon();
    });
    const onShow = () => document.visibilityState === 'visible' && soon();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      clearTimeout(timer);
      unsub();
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [qc]);
}
