import { globalEventBus, EVENT_TYPES } from "./eventBus";
import { AppSettings, Character, Message } from "../types";
import { makeLLMRequest } from "../services/geminiService";

// Declare global TypeScript type for MyApp
declare global {
  interface Window {
    MyApp: {
      getContext: () => {
        eventSource: typeof globalEventBus;
        event_types: typeof EVENT_TYPES;
        chat: {
          character: Character | null;
          messages: Message[];
          setMessages: (msgs: Message[]) => void;
          sendMessage: (text: string) => Promise<void>;
        };
        settings: AppSettings | null;
        callLLM: (prompt: string, systemInstruction?: string) => Promise<string>;
      };
      libs: {
        eventBus: typeof globalEventBus;
      };
    };
    extension_settings: Record<string, any>;
    saveSettingsDebounced: () => void;
    toastr: {
      success: (msg: string) => void;
      error: (msg: string) => void;
      info: (msg: string) => void;
      warning: (msg: string) => void;
    };
    jQuery: any;
    $: any;
  }
}

interface LiveChatContext extends Array<any> {
  character: Character | null;
  messages: Message[];
  setMessages: (msgs: Message[]) => void;
  sendMessage: (text: string) => Promise<void>;
}

// Global live state container accessed by MyApp.getContext()
let liveChatContext: LiveChatContext = Object.assign([], {
  character: null,
  messages: [],
  setMessages: () => {},
  sendMessage: async () => {},
});

let currentAppSettings: AppSettings | null = null;

/**
 * Initialize the global MyApp object so extensions can hook into it.
 */
export function initExtensionSystem(settings: AppSettings) {
  currentAppSettings = settings;
  
  if (!window.extension_settings) {
    try {
      window.extension_settings = JSON.parse(localStorage.getItem("st_extension_settings") || "{}");
    } catch {
      window.extension_settings = {};
    }
  }

  if (!window.saveSettingsDebounced) {
    window.saveSettingsDebounced = () => {
      localStorage.setItem("st_extension_settings", JSON.stringify(window.extension_settings));
    };
  }

  if (!window.toastr) {
    window.toastr = {
      success: (msg) => console.log("%cSuccess: " + msg, "color: green"),
      error: (msg) => console.log("%cError: " + msg, "color: red"),
      info: (msg) => console.log("%cInfo: " + msg, "color: blue"),
      warning: (msg) => console.log("%cWarning: " + msg, "color: orange"),
    };
  }

  if (!window.MyApp) {
    window.MyApp = {
      getContext: () => ({
        eventSource: globalEventBus,
        event_types: EVENT_TYPES,
        chat: liveChatContext,
        settings: currentAppSettings,
        characters: liveChatContext.character ? [liveChatContext.character] : [],
        characterId: liveChatContext.character ? 0 : undefined,
        groupId: undefined,
        POPUP_TYPE: {
          CONFIRM: 'confirm',
          TEXT: 'text',
          HTML: 'html',
        },
        Popup: class MckPopup {
            show() { return Promise.resolve(true); }
        },
        callLLM: async (prompt: string, systemInstruction?: string) => {
          if (!currentAppSettings) {
            throw new Error("Settings not loaded in Extension System!");
          }
          return await makeLLMRequest(
            currentAppSettings,
            [{ role: 'user', content: prompt }],
            systemInstruction || "You are an AI assistant helping a custom roleplay extension."
          );
        }
      }),
      libs: {
        eventBus: globalEventBus,
      }
    };
  } else {
    // If window.MyApp already exists, update settings reference
    const oldContext = window.MyApp.getContext;
    window.MyApp.getContext = () => ({
      ...oldContext(),
      settings: currentAppSettings
    });
  }
}

/**
 * Sync active chat state into the extension context so extensions get ultra-live states
 */
export function syncActiveChatContext(
  character: Character | null,
  messages: Message[],
  setMessages: (msgs: Message[]) => void,
  sendMessage: (text: string) => Promise<void>
) {
  // Reset liveChatContext to act strictly as an array of messages
  liveChatContext.length = 0;
  messages.forEach((m, i) => { liveChatContext[i] = m as any; });
  liveChatContext.character = character;
  liveChatContext.messages = messages;
  liveChatContext.setMessages = setMessages;
  liveChatContext.sendMessage = sendMessage;
}

/**
 * Inject stylesheet dynamically into head
 */
function injectStylesheet(url: string) {
  const id = `ext-css-${url.replace(/[^a-z0-9]/gi, "-")}`;
  if (document.getElementById(id)) return;

  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = url;
  document.head.appendChild(link);
}

/**
 * Loads list of extensions from API, imports active ones
 */
export async function loadExtensions(): Promise<{ name: string; success: boolean; error?: string }[]> {
  try {
    const listResponse = await fetch("/api/extensions/list");
    if (!listResponse.ok) {
      throw new Error(`Failed to fetch extension list (HTTP ${listResponse.status})`);
    }

    const extensions: { name: string; manifest: any }[] = await listResponse.json();
    
    // Check enabled states in LocalStorage (default enabled = true if never toggled)
    const enabledStates = JSON.parse(localStorage.getItem("grh_enabled_extensions") || "{}");
    
    // Sort by loading_order in manifest
    extensions.sort((a, b) => {
      const orderA = a.manifest.loading_order ?? 10;
      const orderB = b.manifest.loading_order ?? 10;
      return orderA - orderB;
    });

    const results = [];

    for (const ext of extensions) {
      const isEnabled = enabledStates[ext.name] !== false; // Active by default
      if (!isEnabled) {
        results.push({ name: ext.name, success: false, error: "Disabled in settings" });
        continue;
      }

      try {
        // Inject stylesheet if manifest defines one
        if (ext.manifest.css) {
          injectStylesheet(`/scripts/extensions/third-party/${ext.name}/${ext.manifest.css}`);
        }

        // Import the main JS file
        const jsUrl = `/scripts/extensions/third-party/${ext.name}/${ext.manifest.js}?t=${Date.now()}`;
        
        // Dynamic import with Vite Ignore so bundler skips compilation
        const module = await import(/* @vite-ignore */ jsUrl);
        
        if (module && typeof module.activate === "function") {
          await module.activate();
        }

        results.push({ name: ext.name, success: true });
        console.log(`[Extension] Loaded and activated successfully: ${ext.name}`);
      } catch (err: any) {
        console.error(`[Extension] Failed to load extension "${ext.name}":`, err);
        results.push({ name: ext.name, success: false, error: err.message || "Failed to import" });
      }
    }

    // Emit APP_READY
    await globalEventBus.emit(EVENT_TYPES.APP_READY, null);
    return results;
  } catch (error: any) {
    console.error("Failed to run loadExtensions:", error);
    return [];
  }
}
