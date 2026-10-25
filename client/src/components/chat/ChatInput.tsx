import React, { useState, KeyboardEvent } from 'react';
import { ArrowUp, Paperclip } from 'lucide-react';

interface ChatInputProps {
  channelName: string;
  onSendMessage: (content: string) => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({ channelName, onSendMessage }) => {
  const [content, setContent] = useState('');

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    if (!content.trim()) return;
    onSendMessage(content.trim());
    setContent('');
  };

  return (
    <div className="p-4 bg-obsidian-bg shrink-0 select-none">
      <div className="bg-obsidian-card border border-obsidian-border rounded-xl flex items-center px-3.5 py-2 focus-within:border-obsidian-accent/60 focus-within:shadow-[0_0_15px_rgba(99,102,241,0.15)] transition-all">
        <button
          type="button"
          className="text-obsidian-text-secondary hover:text-white transition-colors mr-2.5 p-1.5 rounded-lg hover:bg-obsidian-surface border border-transparent hover:border-obsidian-border"
          title="Anexar arquivo"
        >
          <Paperclip className="w-4 h-4" />
        </button>

        <input
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Enviar mensagem em #${channelName}...`}
          className="bg-transparent flex-1 text-obsidian-text-primary placeholder-obsidian-text-muted text-xs outline-none"
        />

        <div className="flex items-center space-x-2 ml-2">
          {content.trim() ? (
            <button
              type="button"
              onClick={handleSubmit}
              className="w-7 h-7 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center transition-all shadow-md shadow-indigo-600/30 border border-indigo-400/40"
              title="Enviar mensagem"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          ) : (
            <span className="text-[10px] text-obsidian-text-muted font-mono px-2 py-0.5 rounded-lg bg-obsidian-surface border border-obsidian-border">
              ↵ Enter
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
