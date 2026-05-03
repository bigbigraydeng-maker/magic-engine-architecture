'use client';

import { useState, useRef, useEffect } from 'react';
import type { MasterBrief, BriefChatMessage } from '@/types/magic-engine';

interface Props {
  briefId: string;
  clientId: string;
  disabled?: boolean;
  onBriefUpdated: (b: MasterBrief) => void;
}

export function BriefChat({ briefId, clientId, disabled = false, onBriefUpdated }: Props) {
  const [messages, setMessages] = useState<BriefChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending || disabled) return;

    const userMsg: BriefChatMessage = { role: 'user', content: text, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);
    setError('');

    try {
      const res = await fetch(`/api/clients/${clientId}/brief/${briefId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: messages }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Request failed');

      const assistantMsg: BriefChatMessage = {
        role: 'assistant',
        content: json.reasoning ?? 'Brief updated.',
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);
      if (json.brief) onBriefUpdated(json.brief);
    } catch (err) {
      setError((err as Error).message);
      // Remove the optimistically-added user message
      setMessages(prev => prev.slice(0, -1));
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-700">Claude Refinement</h3>
        <p className="text-xs text-gray-400 mt-0.5">
          {disabled
            ? 'Generate a brief first to enable chat.'
            : 'Describe changes — Claude updates only the relevant fields.'}
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {messages.length === 0 && !disabled && (
          <div className="space-y-2">
            <p className="text-xs text-gray-400 text-center pt-4">Try asking:</p>
            {[
              '语气改得更年轻、更活泼',
              'Add "sustainability" to the content pillars',
              'Update target audience to 25-35 female professionals',
              'Make the brand story more emotional',
            ].map((ex, i) => (
              <button
                key={i}
                onClick={() => setInput(ex)}
                className="block w-full text-left text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg px-3 py-2 transition-colors"
              >
                {ex}
              </button>
            ))}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-md'
                  : 'bg-gray-100 text-gray-800 rounded-bl-md'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl rounded-bl-md px-3 py-2">
              <div className="flex gap-1 items-center h-4">
                {[0, 1, 2].map(i => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {error && (
          <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-100 p-3">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? 'Generate a brief first…' : 'Ask Claude to refine the brief…'}
            disabled={disabled || sending}
            rows={2}
            className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white resize-none disabled:opacity-60 disabled:text-gray-400 transition-colors"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || disabled || sending}
            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-3 py-2 disabled:opacity-40 transition-colors"
            title="Send (Enter)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1">Enter to send · Shift+Enter for newline</p>
      </div>
    </div>
  );
}
