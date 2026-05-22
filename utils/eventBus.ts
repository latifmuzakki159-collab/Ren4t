/**
 * Simple Lightweight Event Bus for SillyTavern-style Extensions in GeminiRP.
 */
export const EVENT_TYPES = {
  MESSAGE_SENDING: 'MESSAGE_SENDING', // Fired before sending to AI, allows message modification or validation.
  MESSAGE_SENT: 'MESSAGE_SENT',       // Fired after message is added to history.
  MESSAGE_RECEIVED: 'MESSAGE_RECEIVED', // Fired when the AI responds, before rendering or adding to history.
  CHARACTER_CHANGED: 'CHARACTER_CHANGED', // Fired when switching active character.
  CHAT_RESET: 'CHAT_RESET',           // Fired when the chat history of a character is cleared.
  APP_READY: 'APP_READY',             // Fired when the application has loaded and loaded all enabled extensions.
  CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
};

type EventCallback = (data: any) => void | Promise<void>;

class EventBus {
  private listeners: Record<string, EventCallback[]> = {};

  on(event: string, callback: EventCallback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
    return () => this.off(event, callback);
  }

  off(event: string, callback: EventCallback) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }

  async emit(event: string, data: any): Promise<any> {
    if (!this.listeners[event]) return data;
    
    let currentData = data;
    for (const callback of this.listeners[event]) {
      try {
        // Run callbacks sequentially. If the callback returns a new value, we propagate it (filters/mutators)
        const result = await callback(currentData);
        if (result !== undefined) {
          currentData = result;
        }
      } catch (err) {
        console.error(`Error in event listener for ${event}:`, err);
      }
    }
    return currentData;
  }
}

export const globalEventBus = new EventBus();
