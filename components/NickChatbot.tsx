'use client';

import { useState, useRef, useEffect } from 'react';
import './NickChatbot.css';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'nick';
  timestamp: Date;
  isLoading?: boolean;
}

export default function NickChatbot() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      text: "Hi! I'm Nick, your AI assistant. How can I help you today?",
      sender: 'nick',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  };

  useEffect(() => {
    // Only scroll to bottom when new messages are added (not on initial load)
    // Check if the last message is not the initial welcome message
    if (messages.length > 1) {
      const lastMessage = messages[messages.length - 1];
      // Only scroll if it's a new message (not the initial welcome message)
      if (lastMessage.id !== '1' && !lastMessage.isLoading) {
        // Use requestAnimationFrame for smoother scrolling
        requestAnimationFrame(() => {
          setTimeout(() => {
            scrollToBottom();
          }, 50);
        });
      }
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: input.trim(),
      sender: 'user',
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Add loading message
    const loadingMessageId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      {
        id: loadingMessageId,
        text: '',
        sender: 'nick',
        timestamp: new Date(),
        isLoading: true,
      },
    ]);

    try {
      // Prepare conversation history (last 10 messages for context)
      const conversationHistory = messages
        .filter(msg => msg.id !== '1' && !msg.isLoading) // Exclude welcome message and loading states
        .slice(-10) // Last 10 messages
        .map(msg => ({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: msg.text,
        }));

      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          query: userMessage.text,
          conversationHistory: conversationHistory,
        }),
        cache: 'no-store',
      });

      if (!response.ok) {
        // Try to get error message from response
        let errorMessage = 'Failed to get response';
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.error || `Server error: ${response.status}`;
        } catch (e) {
          errorMessage = `Server error: ${response.status} ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      
      // Check if there's an error message from the API
      if (data.error) {
        throw new Error(data.message || data.error);
      }
      
      const answer = data.answer || 'Sorry, I could not generate a response.';

      // Remove loading message and add actual response
      setMessages((prev) =>
        prev
          .filter((msg) => msg.id !== loadingMessageId)
          .concat({
            id: Date.now().toString(),
            text: answer,
            sender: 'nick',
            timestamp: new Date(),
          })
      );
    } catch (error) {
      console.error('Error:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Sorry, I encountered an error. Please try again.';
      
      // Check if it's a configuration error
      let displayMessage = errorMessage;
      if (errorMessage.includes('environment variables') || 
          errorMessage.includes('OPENAI_API_KEY') || 
          errorMessage.includes('PINECONE') ||
          errorMessage.includes('Configuration error')) {
        displayMessage = 'Configuration Error: Please check that your environment variables (OPENAI_API_KEY, PINECONE_API_KEY, PINECONE_INDEX) are set correctly in Vercel.';
      } else if (errorMessage.includes('Failed to get response') || errorMessage.includes('Server error')) {
        displayMessage = `Server Error: ${errorMessage}. Please check Vercel function logs for more details.`;
      }
      
      setMessages((prev) =>
        prev
          .filter((msg) => msg.id !== loadingMessageId)
          .concat({
            id: Date.now().toString(),
            text: displayMessage,
            sender: 'nick',
            timestamp: new Date(),
          })
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize textarea
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  return (
    <div className="chatbot-container">
      {/* Header */}
      <div className="chatbot-header">
        <div className="header-content">
          <div className="avatar-container">
            <div className="avatar">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <div className="status-indicator"></div>
          </div>
          <div className="header-text">
            <h1>Nick</h1>
            <p className="status-text">Online • Ready to help</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="messages-container">
        <div className="messages-list">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`message ${message.sender === 'user' ? 'user-message' : 'nick-message'}`}
            >
              {message.sender === 'nick' && (
                <div className="message-avatar">
                  <div className="avatar-small">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"
                        fill="currentColor"
                      />
                    </svg>
                  </div>
                </div>
              )}
              <div className="message-content">
                {message.isLoading ? (
                  <div className="loading-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                ) : (
                  <div className="message-text">{message.text}</div>
                )}
                <div className="message-time">
                  {message.timestamp.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="input-container">
        <div className="input-wrapper">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyPress={handleKeyPress}
            placeholder="Type your message... (Press Enter to send, Shift+Enter for new line)"
            className="message-input"
            rows={1}
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="send-button"
            aria-label="Send message"
          >
            {isLoading ? (
              <div className="spinner"></div>
            ) : (
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"
                  fill="currentColor"
                />
              </svg>
            )}
          </button>
        </div>
        <p className="input-hint">
          Nick is powered by advanced AI. Ask me anything!
        </p>
      </div>
    </div>
  );
}

