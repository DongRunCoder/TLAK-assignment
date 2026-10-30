import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRecoveryBridge } from '../anna/recoveryBridge';

interface Handoff { draft: string; acknowledge: () => void }
export function useSessionRecovery(draft: string, changeDraft: (draft: string) => void, uncertain: boolean, lost: boolean) {
  const latest = useRef({ draft, changeDraft, uncertain, lost });
  latest.current = { draft, changeDraft, uncertain, lost };
  const [pendingAck, setPendingAck] = useState<Handoff>();
  const [handoff, setHandoff] = useState<Handoff>();
  const handoffRef = useRef<Handoff | undefined>(undefined);
  const [bridge] = useState(() => createRecoveryBridge(window, (text, acknowledge) => {
    // Retain conflicts visibly in memory. ACK is deferred until the user has
    // copied/cleared their current input and explicitly retrieved this draft.
    if (latest.current.draft || latest.current.uncertain) {
      const pending = { draft: text, acknowledge };
      handoffRef.current = pending; setHandoff(pending); return;
    }
    latest.current.changeDraft(text);
    setPendingAck({ draft: text, acknowledge });
  }, () => !latest.current.uncertain && !handoffRef.current));
  const snapshot = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot);
  useEffect(() => { bridge.start(); return () => bridge.dispose(); }, [bridge]);
  useEffect(() => {
    if (pendingAck && draft === pendingAck.draft) {
      pendingAck.acknowledge(); setPendingAck(undefined);
      handoffRef.current = undefined; setHandoff(undefined);
    }
  }, [draft, pendingAck]);
  return { ...snapshot, hasPendingDraft: !!handoff, isRecovering: () => bridge.getSnapshot().recovering,
    takePendingDraft: () => {
      const pending = handoffRef.current;
      if (!pending || latest.current.draft || latest.current.uncertain || bridge.getSnapshot().recovering) return;
      latest.current.changeDraft(pending.draft); setPendingAck(pending);
    },
    recover: () => { if (latest.current.lost && !latest.current.uncertain && !handoffRef.current) bridge.recover(latest.current.draft); } };
}
