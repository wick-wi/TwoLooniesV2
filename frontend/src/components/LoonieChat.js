import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, Loader } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import './LoonieChat.css';

const API_BASE = process.env.REACT_APP_API_URL ?? '';

function TypingIndicator() {
  return (
    <div className="loonie-msg loonie-msg-assistant">
      <div className="loonie-avatar" aria-hidden>🪙</div>
      <div className="loonie-bubble loonie-bubble-assistant loonie-typing">
        <span className="loonie-dot" />
        <span className="loonie-dot" />
        <span className="loonie-dot" />
      </div>
    </div>
  );
}

function ChatMessage({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`loonie-msg ${isUser ? 'loonie-msg-user' : 'loonie-msg-assistant'}`}>
      {!isUser && <div className="loonie-avatar" aria-hidden>🪙</div>}
      <div className={`loonie-bubble ${isUser ? 'loonie-bubble-user' : 'loonie-bubble-assistant'}`}>
        {isUser ? (
          <p className="loonie-line">{msg.content}</p>
        ) : (
          <ReactMarkdown
            components={{
              p: ({ children }) => <p className="loonie-md-p">{children}</p>,
              ul: ({ children }) => <ul className="loonie-md-ul">{children}</ul>,
              ol: ({ children }) => <ol className="loonie-md-ol">{children}</ol>,
              li: ({ children }) => <li className="loonie-md-li">{children}</li>,
              strong: ({ children }) => <strong className="loonie-md-strong">{children}</strong>,
              em: ({ children }) => <em>{children}</em>,
              code: ({ children }) => <code className="loonie-md-code">{children}</code>,
              h3: ({ children }) => <p className="loonie-md-heading">{children}</p>,
              h2: ({ children }) => <p className="loonie-md-heading">{children}</p>,
            }}
          >
            {msg.content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}

export default function LoonieChat() {
  const { getAccessToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: "Hi! I'm Loonie 🪙 — your personal finance AI. Ask me anything about your finances, spending habits, or how to reach your financial goals.",
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // Scroll to bottom whenever messages change or drawer opens
  useEffect(() => {
    if (open) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }, [messages, open]);

  // Focus input when drawer opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const token = getAccessToken?.();
      // Build history excluding the welcome message (index 0) and the just-added user msg
      const history = messages.slice(1).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await axios.post(
        `${API_BASE}/api/chat`,
        { message: text, history },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 }
      );

      const reply = res.data?.reply || "I couldn't get a response. Please try again.";
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (e) {
      const errMsg = e.response?.data?.detail || 'Something went wrong. Please try again.';
      setMessages((prev) => [...prev, { role: 'assistant', content: errMsg }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, getAccessToken]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      {/* Floating action button */}
      <button
        className={`loonie-fab ${open ? 'loonie-fab-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close Loonie chat' : 'Open Loonie chat'}
        title="Ask Loonie"
      >
        {open ? <X size={22} strokeWidth={2.5} /> : <MessageCircle size={22} strokeWidth={2} />}
        {!open && <span className="loonie-fab-label">Ask Loonie</span>}
      </button>

      {/* Chat drawer */}
      <div className={`loonie-drawer ${open ? 'loonie-drawer-open' : ''}`} role="dialog" aria-label="Loonie AI chat" aria-modal="true">
        {/* Header */}
        <div className="loonie-header">
          <div className="loonie-header-info">
            <span className="loonie-header-avatar">🪙</span>
            <div>
              <p className="loonie-header-name">Loonie</p>
              <p className="loonie-header-sub">Your personal finance AI</p>
            </div>
          </div>
          <button className="loonie-close-btn" onClick={() => setOpen(false)} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Messages */}
        <div className="loonie-messages">
          {messages.map((msg, i) => (
            <ChatMessage key={i} msg={msg} />
          ))}
          {loading && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="loonie-input-row">
          <textarea
            ref={inputRef}
            className="loonie-input"
            placeholder="Ask about your finances…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={loading}
            aria-label="Chat message"
          />
          <button
            className="loonie-send-btn"
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            aria-label="Send message"
          >
            {loading ? <Loader size={18} className="loonie-spin" /> : <Send size={18} />}
          </button>
        </div>
      </div>

      {/* Backdrop for mobile */}
      {open && (
        <div className="loonie-backdrop" onClick={() => setOpen(false)} aria-hidden />
      )}
    </>
  );
}
