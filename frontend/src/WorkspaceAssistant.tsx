import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronUp } from 'lucide-react';
import { flushSync } from 'react-dom';
import { cloudRequest, type Account, type Operation } from './cloud';
import { emptyScenario, type Need, type Offer, type Scenario } from './types';
import type { SupplierAnalysis } from './Fulfillment';
import { Icon } from './Icons';

export type OfferDraft = { supplier: string; supply: string | null; unit_cost_cents: number | null; stock: number | null; delivery_days: number | null };
export type SetupDraft = { name: string | null; households: number | null; deadline_days: number | null;
  needs: { name: string; category: string | null; quantity: number | null }[]; offers: OfferDraft[] };
export type ReceiptDraft = { accepted_units: number | null; rejected_units: number | null; location: string | null;
  reference: string | null; short: boolean; quote: string | null };
export type AssistantReply = {
  message: string;
  action: 'none' | 'draft' | 'offer' | 'grant' | 'funding' | 'plan' | 'purchases' | 'delivery' | 'reports' | 'activity';
  operation: SetupDraft | null;
  offer: OfferDraft | null;
  purchase_id: string | null;
  receipt: ReceiptDraft | null;
  short_delivery_draft?: SupplierAnalysis | null;
};
type Turn = { user: string; reply: AssistantReply };
export type AssistantThreads = Map<string, Turn[]>;
type QuickAction = { label: string; reply: AssistantReply };

const storageKey = (userId: string) => `reliefops:assistant:${userId}`;

export function loadAssistantThreads(userId?: string): AssistantThreads {
  if (!userId) return new Map();
  try {
    const saved = sessionStorage.getItem(storageKey(userId));
    return new Map(saved ? JSON.parse(saved) : []);
  } catch {
    return new Map();
  }
}

export function saveAssistantThreads(userId: string, threads: AssistantThreads) {
  try {
    if (threads.size) sessionStorage.setItem(storageKey(userId), JSON.stringify([...threads].slice(-15)));
    else sessionStorage.removeItem(storageKey(userId));
  } catch {
    // Keep the current workspace usable when browser storage is restricted.
  }
}

export function draftOffer(draft: OfferDraft, needs: Need[]): Offer {
  return { id: `offer-${crypto.randomUUID()}`, supplier: draft.supplier,
    need_id: needs.find(need => need.name.toLowerCase() === draft.supply?.trim().toLowerCase())?.id ?? '',
    unit_cost_cents: draft.unit_cost_cents ?? Number.NaN, stock: draft.stock ?? Number.NaN,
    delivery_days: draft.delivery_days ?? Number.NaN, active: true };
}

export function draftScenario(draft: SetupDraft): Scenario {
  const needs = draft.needs.map(row => ({ id: `need-${crypto.randomUUID()}`, name: row.name,
    category: row.category ?? '', quantity: row.quantity ?? Number.NaN }));
  return { ...emptyScenario(), target_kits: draft.households ?? Number.NaN, deadline_days: draft.deadline_days ?? Number.NaN,
    needs, offers: draft.offers.map(row => draftOffer(row, needs)) };
}

export function assistantAction(action: AssistantReply['action'], purchaseId: string | null = null): AssistantReply {
  return { message: '', action, operation: null, offer: null, purchase_id: purchaseId, receipt: null };
}

const actionLabel: Record<AssistantReply['action'], string> = {
  none: '', draft: 'Review operation draft', offer: 'Review supplier offer', grant: 'Review grant',
  funding: 'Review funding', plan: 'Calculate purchasing plan', purchases: 'Open purchases',
  delivery: 'Review delivery', reports: 'Open records', activity: 'Open activity',
};

export function WorkspaceAssistant({ account, operation, threads, busy, quickActions, onAction, onOpenEditor }: {
  account: Account; operation: Operation | null; threads: AssistantThreads; busy: boolean;
  quickActions: QuickAction[]; onAction: (reply: AssistantReply, source: string) => void; onOpenEditor: () => void;
}) {
  const key = operation?.id ?? 'new';
  const [turns, setTurns] = useState(() => threads.get(key) ?? []);
  const [input, setInput] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  const [pendingMessage, setPendingMessage] = useState('');
  const live = useRef(true);
  const transcript = useRef<HTMLDivElement>(null);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [turns.length, pendingMessage, collapsed]);

  async function ask(event: FormEvent) {
    event.preventDefault();
    const source = input.trim();
    if (!source || waiting || busy) return;
    setWaiting(true);
    setPendingMessage(source);
    setError('');
    const messages: { role: 'user' | 'assistant'; text: string }[] = [{ role: 'user', text: source }];
    let total = source.length;
    for (const turn of turns.slice(-3).reverse()) {
      total += turn.user.length + turn.reply.message.length;
      if (total > 12000) break;
      messages.unshift({ role: 'user', text: turn.user }, { role: 'assistant', text: turn.reply.message });
    }
    try {
      const reply = await cloudRequest<AssistantReply>(account, '/assistant', 'POST', { operation_id: operation?.id ?? null, messages });
      if (!live.current) return;
      const next = [...turns, { user: source, reply }].slice(-20);
      threads.set(key, next);
      saveAssistantThreads(account.session.user.id, threads);
      setTurns(next);
      setInput('');
    } catch (err) {
      if (live.current) setError(err instanceof Error ? err.message : 'Could not reach the assistant. Try again or open the form.');
    } finally {
      if (live.current) { setWaiting(false); setPendingMessage(''); }
    }
  }

  return <section className="assistant-panel card" data-collapsed={collapsed || undefined} aria-label="Ask ReliefOps" id="workspace-assistant">
    <header><div className={collapsed ? 'sr-only' : 'assistant-title'}><span className="assistant-mark"><Icon name="chat" size={22} /></span>
      <div><h1 id="workspace-chat-heading" tabIndex={-1} onFocus={() => setCollapsed(false)}>Ask ReliefOps</h1><p>{operation ? operation.name : 'What does your relief team need?'}</p></div></div>
      <div className="assistant-header-actions">
        {!collapsed && <button className="button subtle" onClick={onOpenEditor} disabled={busy}>{operation ? 'Edit operation' : 'Open setup form'}</button>}
        <button className="icon-button" type="button" aria-expanded={!collapsed} aria-controls="workspace-chat-content"
          aria-label={collapsed ? 'Expand chat' : 'Collapse chat'} title={collapsed ? 'Expand chat' : 'Collapse chat'}
          onClick={() => {
            const toggle = () => setCollapsed(!collapsed);
            if (!document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
              toggle();
              return;
            }
            const root = document.documentElement;
            root.dataset.chatTransition = '';
            const transition = document.startViewTransition(() => flushSync(toggle));
            const cleanUp = () => { delete root.dataset.chatTransition; };
            void transition.ready.catch(() => {});
            void transition.finished.then(cleanUp, cleanUp);
          }}>
          {collapsed ? <Icon name="chat" size={20} /> : <ChevronUp size={18} aria-hidden="true" />}
        </button>
      </div>
    </header>
    <div id="workspace-chat-content" className="assistant-content" hidden={collapsed}>
    {(turns.length > 0 || pendingMessage) && <div ref={transcript} className="assistant-transcript" aria-live="polite" aria-label="Conversation">
      {turns.map(({ user, reply }, index) => <div className="assistant-turn" key={index}>
        <p className="assistant-user"><span className="sr-only">You: </span>{user}</p>
        <div className="assistant-answer"><p><span className="sr-only">ReliefOps: </span>{reply.message}</p>{reply.action !== 'none' && index === turns.length - 1 &&
          <button className="button assistant-review" onClick={() => onAction(reply, user)} disabled={busy || waiting}>{actionLabel[reply.action]} <Icon name="arrow" size={16} /></button>}</div>
      </div>)}
      {pendingMessage && <div className="assistant-turn"><p className="assistant-user">{pendingMessage}</p>
        <div className="assistant-answer"><p role="status">Reviewing your message…</p></div></div>}
    </div>}
    <form onSubmit={ask} className="assistant-compose">
      <label htmlFor="assistant-message">Message ReliefOps</label>
      <textarea id="assistant-message" maxLength={4000} rows={3} value={input}
        placeholder={operation ? 'Ask a question or paste a supplier update…' : 'We need hygiene kits for 12 households within two days…'}
        disabled={waiting} onChange={event => setInput(event.target.value)} />
      {error && <p className="error-banner" role="alert">{error}</p>}
      <div className="assistant-compose-footer"><small>Messages are analyzed by Groq.</small>
        <button className="button primary" disabled={busy || waiting || !input.trim()}>{waiting ? 'Reading…' : 'Send message'} <Icon name="send" size={17} /></button></div>
    </form>
    {quickActions.length > 0 && <div className="assistant-shortcuts" aria-label="Next actions">{quickActions.map(({ label, reply }) =>
      <button className="button subtle" key={label} onClick={() => onAction(reply, '')} disabled={busy}>{label} <Icon name="arrow" size={15} /></button>)}</div>}
    </div>
  </section>;
}
