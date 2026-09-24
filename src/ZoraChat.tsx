import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Loader2, MessageCircle, Send, ShieldAlert, Sparkles, X } from 'lucide-react';
import { supabase } from './supabase';
import './zora-chat.css';

type ZoraMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  localOnly?: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientName: string;
  currentSection: string;
};

const quickPrompts = [
  'When is my next treatment?',
  'Explain my treatment progress',
  'Show me my recent symptom pattern',
  'What should I ask my care team?',
];

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function ZoraChat({ open, onOpenChange, patientName, currentSection }: Props) {
  const firstName = patientName.trim().split(/\s+/)[0] || 'there';
  const welcome = useMemo<ZoraMessage>(() => ({
    id: 'zora-welcome',
    role: 'assistant',
    localOnly: true,
    content: `Hi ${firstName}, I’m Zora. I can help you understand your RTTRACK records, find information in the app, and explain general radiotherapy topics. What would you like to ask?`,
  }), [firstName]);

  const [messages, setMessages] = useState<ZoraMessage[]>([welcome]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMessages(current => {
      const rest = current.filter(message => message.id !== 'zora-welcome');
      return [welcome, ...rest];
    });
  }, [welcome]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end' }));
  }, [open, messages, sending]);

  async function sendQuestion(rawQuestion: string) {
    const question = rawQuestion.trim();
    if (!question || sending) return;

    const client = supabase;
    if (!client) {
      setError('Zora cannot connect to RTTRACK right now.');
      return;
    }

    const userMessage: ZoraMessage = { id: makeId(), role: 'user', content: question };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft('');
    setError('');
    setSending(true);

    try {
      const payloadMessages = nextMessages
        .filter(message => !message.localOnly)
        .slice(-10)
        .map(({ role, content }) => ({ role, content }));

      const { data, error: invokeError } = await client.functions.invoke('zora-chat', {
        body: {
          messages: payloadMessages,
          currentSection,
        },
      });

      if (invokeError) throw invokeError;
      if (!data || typeof data.reply !== 'string' || !data.reply.trim()) {
        throw new Error('Zora returned an empty response.');
      }

      setMessages(current => [...current, {
        id: makeId(),
        role: 'assistant',
        content: data.reply.trim(),
      }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Zora could not answer right now.');
    } finally {
      setSending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendQuestion(draft);
  }

  const onlyWelcome = messages.every(message => message.localOnly);

  return <>
    <button
      type="button"
      className={`zora-fab ${open ? 'zora-fab-open' : ''}`}
      aria-label={open ? 'Close Zora' : 'Ask Zora'}
      aria-expanded={open}
      onClick={() => onOpenChange(!open)}
    >
      {open ? <X size={20}/> : <Sparkles size={20}/>}
      <span>{open ? 'Close' : 'Ask Zora'}</span>
    </button>

    {open && <section className="zora-panel" aria-label="Ask Zora">
      <header className="zora-header">
        <div className="zora-avatar"><Sparkles size={20}/></div>
        <div><strong>Zora</strong><small>RTTRACK AI assistant</small></div>
        <button type="button" aria-label="Close Zora" onClick={() => onOpenChange(false)}><X size={19}/></button>
      </header>

      <div className="zora-safety" role="note">
        <ShieldAlert size={16}/>
        <span>Zora can explain information and help you navigate RTTRACK. It cannot diagnose, prescribe, change treatment, or handle emergencies.</span>
      </div>

      <div className="zora-messages" role="log" aria-live="polite">
        {messages.map(message => <article key={message.id} className={`zora-message zora-${message.role}`}>
          {message.role === 'assistant' && <span className="zora-message-icon"><MessageCircle size={14}/></span>}
          <p>{message.content}</p>
        </article>)}

        {sending && <article className="zora-message zora-assistant zora-thinking">
          <span className="zora-message-icon"><Loader2 size={14}/></span>
          <p>Zora is thinking…</p>
        </article>}

        {error && <p className="zora-error" role="alert">{error}</p>}
        <div ref={endRef}/>
      </div>

      {onlyWelcome && <div className="zora-prompts" aria-label="Suggested questions">
        {quickPrompts.map(prompt => <button type="button" key={prompt} onClick={() => void sendQuestion(prompt)} disabled={sending}>{prompt}</button>)}
      </div>}

      <form className="zora-form" onSubmit={submit}>
        <label className="zora-sr" htmlFor="zora-question">Ask Zora a question</label>
        <textarea
          id="zora-question"
          rows={2}
          maxLength={1600}
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder="Ask Zora…"
          disabled={sending}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (draft.trim()) void sendQuestion(draft);
            }
          }}
        />
        <button type="submit" aria-label="Send to Zora" disabled={sending || !draft.trim()}><Send size={18}/></button>
      </form>

      <footer className="zora-footer">For urgent concerns, use the Emergency page or contact your local emergency service or hospital.</footer>
    </section>}
  </>;
}
