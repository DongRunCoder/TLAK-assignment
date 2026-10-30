import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AnnaRuntime } from '../anna/types';
import { documentFingerprint, EMPTY_DOCUMENT, messageOf } from './model';
import { NotesRepository, type RepositorySnapshot } from './repository';
import { summarizeNotes, type SummaryResult } from '../summary/service';
import { SummaryRequestError } from '../summary/errors';
import { HostSession, type HostStatus } from '../anna/session';
import { useSessionRecovery } from './useSessionRecovery';

export interface RuntimeConnection { connect(): Promise<AnnaRuntime> }
interface SummaryState { status: 'idle' | 'running' | 'success' | 'error' | 'stale' | 'no-llm'; running: boolean; result?: SummaryResult; error?: string }
const idleSnapshot: RepositorySnapshot = { document: EMPTY_DOCUMENT, notes: [], status: 'loading', error: null, mutation: null };
const idleSubscribe = () => () => {};
const getIdleSnapshot = () => idleSnapshot;
const canSummarizeSnapshot = (snapshot: RepositorySnapshot) => !snapshot.mutation && snapshot.notes.length > 0 &&
  (snapshot.status === 'ready' || snapshot.status === 'loading');

export function useMiniNotes(connection: RuntimeConnection) {
  const [runtimeStatus, setRuntimeStatus] = useState<'connecting' | 'ready' | 'failed'>('connecting');
  const [hostStatus, setHostStatus] = useState<HostStatus>('checking');
  const session = useRef<HostSession | undefined>(undefined);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [repository, setRepository] = useState<NotesRepository>();
  const runtime = useRef<AnnaRuntime | undefined>(undefined);
  const alive = useRef(false);
  const [composer, setComposer] = useState('');
  const [operationError, setOperationError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryState>({ status: 'idle', running: false });
  const summaryToken = useRef(0);
  const summaryFingerprint = useRef<string | undefined>(undefined);
  const summaryInFlight = useRef(false);
  const snapshot = useSyncExternalStore(repository?.subscribe ?? idleSubscribe, repository?.getSnapshot ?? getIdleSnapshot);
  const recovery = useSessionRecovery(composer, setComposer, !!snapshot.mutation, hostStatus === 'expired' || hostStatus === 'unavailable');

  useEffect(() => {
    let current = true;
    let repo: NotesRepository | undefined;
    let unsubscribe: (() => void) | undefined;
    alive.current = true;
    setRuntimeStatus('connecting'); setConnectionError(null);
    setHostStatus('checking');
    const hostSession = new HostSession(status => {
      if (!current) return;
      setHostStatus(status);
      if (status !== 'online') invalidateSummary();
    });
    session.current = hostSession;
    void connection.connect().then(anna => {
      if (!current) return;
      const observed = hostSession.observe(anna);
      runtime.current = observed;
      repo = new NotesRepository(observed);
      setRepository(repo); setRuntimeStatus('ready');
      unsubscribe = anna.on?.('runtime_state_synced', () => repo?.requestSync());
      void repo.refresh().catch(() => {});
    }).catch(error => {
      if (!current) return;
      hostSession.fail(error); setHostStatus(hostSession.getStatus() === 'expired' ? 'expired' : 'unavailable');
      setRuntimeStatus('failed'); setConnectionError(`连接 Anna 失败：${messageOf(error)}。请在 Anna harness 中打开应用后重试。`);
    });
    return () => {
      current = false; alive.current = false; summaryToken.current++;
      unsubscribe?.(); repo?.dispose();
    };
  }, [connection, retry]);

  useEffect(() => {
    if (!repository) return;
    const check = () => { if (document.visibilityState === 'visible') repository.requestSync(); };
    const timer = window.setInterval(check, 15_000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [repository]);

  function invalidateSummary() {
    summaryToken.current++;
    summaryFingerprint.current = undefined;
    setSummary(previous => previous.status === 'idle' ? previous : { status: 'stale', running: previous.running });
  }
  const fingerprint = documentFingerprint(snapshot.document);
  const previousFingerprint = useRef(fingerprint);
  useEffect(() => {
    if (fingerprint !== previousFingerprint.current) {
      previousFingerprint.current = fingerprint;
      if (summaryFingerprint.current && summaryFingerprint.current !== fingerprint) invalidateSummary();
    }
  }, [fingerprint]);

  async function save() {
    if (!repository || recovery.isRecovering() || session.current?.getStatus() !== 'online') return;
    setOperationError(null);
    const operation = repository.add(composer);
    if (repository.getSnapshot().mutation) invalidateSummary();
    try { await operation; if (alive.current && session.current?.getStatus() === 'online') setComposer(''); }
    catch (error) { if (alive.current) setOperationError(messageOf(error)); }
  }
  async function remove(id: string) {
    if (!repository || recovery.isRecovering() || session.current?.getStatus() !== 'online') return;
    setOperationError(null);
    const operation = repository.remove(id);
    if (repository.getSnapshot().mutation) invalidateSummary();
    try { await operation; }
    catch (error) { if (alive.current) setOperationError(messageOf(error)); }
  }
  async function reread() {
    if (!repository) return;
    setOperationError(null);
    try { await repository.refresh(); } catch { /* Repository owns the visible read error. */ }
  }
  async function summarize() {
    if (!repository || !runtime.current || recovery.isRecovering() || session.current?.getStatus() !== 'online' || summaryInFlight.current || !canSummarizeSnapshot(repository.getSnapshot())) return;
    summaryInFlight.current = true;
    summaryFingerprint.current = undefined;
    const token = ++summaryToken.current;
    setSummary({ status: 'running', running: true }); setOperationError(null);
    let expectedFingerprint: string | undefined;
    try {
      const document = await repository.refresh();
      expectedFingerprint = documentFingerprint(document);
      summaryFingerprint.current = expectedFingerprint;
      if (!alive.current) return;
      // A queued sync may already be reading again. Its loading status keeps
      // the latest read document valid until a changed fingerprint is observed.
      const current = repository.getSnapshot();
      if (session.current?.getStatus() !== 'online' || token !== summaryToken.current || !canSummarizeSnapshot(current) ||
          expectedFingerprint !== documentFingerprint(current.document)) {
        setSummary({ status: 'stale', running: false });
        return;
      }
      const result = await summarizeNotes(runtime.current, document);
      if (!alive.current) return;
      const latest = repository.getSnapshot();
      if (session.current?.getStatus() !== 'online' || token !== summaryToken.current || !canSummarizeSnapshot(latest) ||
          expectedFingerprint !== documentFingerprint(latest.document)) {
        setSummary({ status: 'stale', running: false });
      } else setSummary({ status: 'success', running: false, result });
    } catch (error) {
      if (!alive.current) return;
      const latest = repository.getSnapshot();
      if (token !== summaryToken.current || (expectedFingerprint &&
          (!canSummarizeSnapshot(latest) || expectedFingerprint !== documentFingerprint(latest.document)))) {
        setSummary({ status: 'stale', running: false });
      } else if (error instanceof SummaryRequestError && error.kind === 'no-llm') {
        setSummary({ status: 'no-llm', running: false });
      } else setSummary({ status: 'error', running: false, error: `总结失败：${messageOf(error)}` });
    } finally {
      summaryInFlight.current = false;
      if (alive.current) setSummary(previous => previous.running ? { ...previous, running: false } : previous);
    }
  }
  return { runtimeStatus, hostStatus, recovery, anna: runtimeStatus === 'ready' ? runtime.current : undefined, snapshot, composer, summary,
    error: connectionError ?? operationError ?? snapshot.error ?? summary.error ?? null,
    changeComposer: (text: string) => { if (!recovery.isRecovering()) { setComposer(text); setOperationError(null); } },
    retryConnection: () => { if (session.current?.getStatus() !== 'expired') setRetry(value => value + 1); }, save, remove, reread, summarize };
}
