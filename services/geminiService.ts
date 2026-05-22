
import { GoogleGenAI } from "@google/genai";
import { AppSettings, Message, Character, LorebookEntry } from "../types";
import { processPrompt } from "../utils/promptUtils";
import { scanLorebook } from "../utils/loreUtils";
import { globalEventBus, EVENT_TYPES } from "../utils/eventBus";

// --- HELPERS ---

// Context Management (Token Estimation) logic shared by both providers
const prepareHistory = (history: Message[], newMessage: string, limit: number): Message[] => {
    const estimatedTokenLimit = limit; 
    let currentTokenCount = 0;
    const historyToSend: Message[] = [];

    // Always include the new message (approx calc)
    currentTokenCount += newMessage.length / 4;

    // Process history backwards
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        const estimatedTokens = msg.content.length / 4;

        if (currentTokenCount + estimatedTokens > estimatedTokenLimit) {
        break; 
        }

        historyToSend.unshift(msg); 
        currentTokenCount += estimatedTokens;
    }
    return historyToSend;
};

const buildSystemPrompt = (character: Character, settings: AppSettings, history: Message[], newMessage: string): { systemInstruction: string; activeLoreIds: string[] } => {
    
    let systemInstruction = "";

    // 1. Add specific character details
    systemInstruction += `[Character Name: ${character.name}]\n[Description: ${character.description}]\n[Personality: ${character.personality}]\n[Scenario: ${processPrompt(character.scenario || 'Free roam', character.name, settings.userName)}]\n\n`;

    // 3. Lorebook Scanning: Scan more deep into history to improve reliability
    const recentHistoryText = history.slice(-6).map(m => m.content).join('\n---\n');
    const textToScan = recentHistoryText + '\n---\n' + newMessage;
    
    const loreResult = scanLorebook(
        textToScan, 
        character.lorebook, 
        character.name, 
        settings.userName
    );

    if (loreResult.loreText) {
        systemInstruction += `[LOREBOOK/WORLD INFO]:\n${loreResult.loreText}\n\n[DIRECTIVE]: Gunakan informasi di atas (Lorebook/World Info) jika relevan dengan situasi saat ini untuk memperkaya narasi dan menjaga konsistensi dunia. JANGAN abaikan detail tersebut jika sedang dibahas.\n\n`;
    }

    // 4. Process Advanced Prompting Entries (SillyTavern Style System Prompts)
    // Placed at the very end of the system block so the model prioritizes these rules (Jailbreak style).
    if (settings.promptEntries && settings.promptEntries.length > 0) {
        // Sort by injection position if provided
        const sortedPrompts = [...settings.promptEntries]
            .filter(p => p.enabled && p.role === 'system' && (p.injectionDepth === undefined || p.injectionDepth < 0))
            .sort((a, b) => (a.injectionPosition || 0) - (b.injectionPosition || 0));

        let systemPromptsText = "";
        sortedPrompts.forEach(p => {
            systemPromptsText += `\n\n${processPrompt(p.content, character.name, settings.userName)}`;
        });

        if (systemPromptsText) {
            systemInstruction += `[SYSTEM/JAILBREAK DIRECTIVES]:${systemPromptsText}`;
        }
    } else {
        // Fallback to legacy systemPrompt
        if (settings.systemPrompt) {
            systemInstruction += `\n\n[SYSTEM/JAILBREAK DIRECTIVES]:\n${processPrompt(settings.systemPrompt, character.name, settings.userName)}`;
        }
    }

    return {
        systemInstruction,
        activeLoreIds: loreResult.matchedEntries.map(e => e.id)
    };
};

// --- Zhipu AI JWT Generator ---
// Zhipu requires a specific JWT format signed with the API Secret (HS256)
const generateZhipuToken = async (apiKey: string): Promise<string> => {
    try {
        const [id, secret] = apiKey.split('.');
        if (!id || !secret) return apiKey; // Return raw if format is unexpected

        const now = Date.now();
        const header = { alg: "HS256", sign_type: "SIGN" };
        const payload = {
            api_key: id,
            exp: now + 3600 * 1000, // 1 hour expiration
            timestamp: now
        };

        const base64UrlEncode = (str: string) => {
            return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        };

        const encodedHeader = base64UrlEncode(JSON.stringify(header));
        const encodedPayload = base64UrlEncode(JSON.stringify(payload));
        const dataToSign = `${encodedHeader}.${encodedPayload}`;

        const encoder = new TextEncoder();
        const keyData = encoder.encode(secret);
        
        const cryptoKey = await crypto.subtle.importKey(
            "raw", 
            keyData, 
            { name: "HMAC", hash: "SHA-256" }, 
            false, 
            ["sign"]
        );

        const signature = await crypto.subtle.sign(
            "HMAC", 
            cryptoKey, 
            encoder.encode(dataToSign)
        );

        // Convert signature buffer to binary string manually to avoid stack overflow on large buffers (though sig is small)
        const signatureArray = new Uint8Array(signature);
        let signatureBinary = '';
        for (let i = 0; i < signatureArray.length; i++) {
            signatureBinary += String.fromCharCode(signatureArray[i]);
        }
        
        const encodedSignature = base64UrlEncode(signatureBinary);

        return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
    } catch (e) {
        console.warn("JWT Generation failed, falling back to raw key", e);
        return apiKey;
    }
};


// --- GENERIC LLM REQUEST HANDLER ---
// This function handles the actual API call logic for both Chat and Utility tasks
export const makeLLMRequest = async (
    settings: AppSettings,
    messages: { role: string; content: string }[],
    systemInstruction?: string,
    jsonMode: boolean = false
): Promise<string> => {
    
    // Check for OpenAI Compatible Providers (SumoPod / ElectronHub / GLM / BytePlus / NVIDIA / Custom)
    if (['sumopod', 'electronhub', 'glm', 'byteplus', 'nvidia', 'custom'].includes(settings.serviceProvider)) {
        
        let endpoint = "";
        let apiKey = "";
        let providerName = "";

        if (settings.serviceProvider === 'sumopod') {
            endpoint = "https://ai.sumopod.com/v1/chat/completions";
            apiKey = settings.sumoPodApiKey;
            providerName = "SumoPod";
        } else if (settings.serviceProvider === 'electronhub') {
            endpoint = "https://api.electronhub.ai/v1/chat/completions";
            apiKey = settings.electronHubApiKey;
            providerName = "ElectronHub";
        } else if (settings.serviceProvider === 'glm') {
            endpoint = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
            // Zhipu AI usually needs JWT, let's generate it
            apiKey = await generateZhipuToken(settings.glmApiKey);
            providerName = "GLM";
        } else if (settings.serviceProvider === 'byteplus') {
            endpoint = "https://ark.byteplusapi.com/api/v3/chat/completions";
            apiKey = settings.byteplusApiKey;
            providerName = "BytePlus";
        } else if (settings.serviceProvider === 'nvidia') {
            endpoint = "https://integrate.api.nvidia.com/v1/chat/completions";
            apiKey = settings.nvidiaApiKey;
            providerName = "NVIDIA";
        } else if (settings.serviceProvider === 'custom') {
            let sanitizedUrl = settings.customEndpoint.trim();
            if (sanitizedUrl && !sanitizedUrl.startsWith('http://') && !sanitizedUrl.startsWith('https://')) {
                // Default to HTTPS if no protocol provided, but allow HTTP for local addresses
                if (sanitizedUrl.startsWith('localhost') || sanitizedUrl.startsWith('127.0.0.1') || sanitizedUrl.startsWith('192.168.')) {
                    sanitizedUrl = 'http://' + sanitizedUrl;
                } else {
                    sanitizedUrl = 'https://' + sanitizedUrl;
                }
            }
            
            // Auto-correct Google Gemini's endpoint if user tries to use it in Custom Provider 
            // but forgets the /openai/ wrapper route
            if (sanitizedUrl.includes('generativelanguage.googleapis.com') && !sanitizedUrl.includes('/openai/')) {
                sanitizedUrl = sanitizedUrl.replace('/v1beta/chat/completions', '/v1beta/openai/chat/completions');
            }
            
            endpoint = sanitizedUrl;
            apiKey = settings.customApiKey?.trim() || "";
            providerName = "Custom Provider";
        }
        
        // SumoPod / ElectronHub / GLM / BytePlus / NVIDIA / OpenAI Format
        const payloadMessages = [];
        if (systemInstruction) {
            payloadMessages.push({ role: "system", content: systemInstruction });
        }
        // Ensure content is not empty (Zhipu/BytePlus compatibility fix)
        const safeMessages = messages.map(m => ({
            ...m,
            content: m.content || " " 
        }));
        payloadMessages.push(...safeMessages);

        // Failsafe: If model is left empty, or if they switched providers but left default 'gemini'
        let modelId = settings.model;
        if (!modelId || (modelId.startsWith('gemini') && settings.serviceProvider !== 'custom' && settings.serviceProvider !== 'google')) {
             if (settings.serviceProvider === 'glm') modelId = 'glm-4-flash';
             else if (settings.serviceProvider === 'byteplus') modelId = 'doubao-pro-32k';
             else if (settings.serviceProvider === 'nvidia') modelId = 'meta/llama-3.1-405b-instruct'; // Good default for NVIDIA
             else modelId = 'gpt-4o-mini';
        }

        // Failsafe: Temperature range (Zhipu < 1.0 strict)
        let temp = settings.temperature;
        if (settings.serviceProvider === 'glm') {
            if (temp >= 1.0) temp = 0.95;
            if (temp <= 0.0) temp = 0.01;
        }

        const payload: any = {
            model: modelId,
            messages: payloadMessages,
            temperature: temp,
            stream: false
        };

        // Specific configurations for specific providers
        if (settings.serviceProvider === 'nvidia') {
            // NVIDIA NIMs often require explicit max_tokens.
            // Using 4096 as a safer default to prevent context length errors
            payload.max_tokens = 4096; 
            payload.top_p = 1.0; 

            // Logic for GLM-5 / Kimi / Thinking Models on NVIDIA
            // This enables the "Thinking" process if the model supports it (like z-ai/glm5)
            if (modelId === 'z-ai/glm5') {
                payload.chat_template_kwargs = { 
                    enable_thinking: true,
                    clear_thinking: false 
                };
            }
        }

        if (jsonMode) {
            payload.response_format = { type: "json_object" };
        }

        try {
            const headers: any = {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            };
            
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload),
                mode: 'cors'
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                let errorMsg = err.error?.message || err.message || "";
                
                if (!errorMsg) {
                    if (response.status === 502) {
                        errorMsg = "Bad Gateway (502) - Server/Proxy tidak dapat merespons atau sedang down. Periksa URL Endpoint Anda atau coba lagi nanti.";
                    } else {
                        errorMsg = `Status ${response.status} ${response.statusText || 'Unknown Error'}`;
                    }
                }
                
                throw new Error(`${providerName} Error: ${errorMsg}`);
            }

            const data = await response.json();
            const message = data.choices?.[0]?.message;
            let content = message?.content || "";

            // Handle "Reasoning Content" (DeepSeek/GLM-5 Style)
            // If the API returns reasoning in a separate field, we wrap it in <think> tags
            // so our frontend parser can display it correctly.
            if (message?.reasoning_content && !jsonMode) {
                const thought = message.reasoning_content;
                content = `<think>${thought}</think>\n${content}`;
            }

            return content;
        } catch (error: any) {
            if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
                throw new Error(`${providerName} Network Error. Kemungkinan CORS atau parameter max_tokens terlalu tinggi. Coba gunakan Proxy atau kurangi context.`);
            }
            throw error;
        }

    } else {
        // Google Gemini Logic
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY });
        
        const geminiConfig: any = {
            temperature: settings.temperature,
            safetySettings: [
                {
                    category: "HARM_CATEGORY_HARASSMENT",
                    threshold: "BLOCK_NONE",
                },
                {
                    category: "HARM_CATEGORY_HATE_SPEECH",
                    threshold: "BLOCK_NONE",
                },
                {
                    category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                    threshold: "BLOCK_NONE",
                },
                {
                    category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                    threshold: "BLOCK_NONE",
                },
            ]
        };

        if (systemInstruction) {
            geminiConfig.systemInstruction = systemInstruction;
        }

        if (jsonMode) {
            geminiConfig.responseMimeType = "application/json";
        }

        try {
            // Gemini SDK requires alternating roles (user -> model -> user -> model)
            // We must merge adjacent messages of the same role to prevent crashes
            const rawHistory = messages.slice(0, -1);
            const alternatingHistory: any[] = [];
            
            for (let i = 0; i < rawHistory.length; i++) {
                const currentMsg = rawHistory[i];
                const mappedRole = currentMsg.role === 'assistant' || currentMsg.role === 'model' ? 'model' : 'user';
                
                if (alternatingHistory.length > 0 && alternatingHistory[alternatingHistory.length - 1].role === mappedRole) {
                    alternatingHistory[alternatingHistory.length - 1].parts[0].text += `\n\n${currentMsg.content}`;
                } else {
                    alternatingHistory.push({
                        role: mappedRole,
                        parts: [{ text: currentMsg.content || " " }]
                    });
                }
            }

            const chat = ai.chats.create({
                model: settings.model,
                config: geminiConfig,
                history: alternatingHistory
            });

            const lastMsg = messages[messages.length - 1];
            const response = await chat.sendMessage({
                message: lastMsg.content || "Lanjutkan"
            });

            const resultText = response?.text;
            if (!resultText || resultText.trim() === "") {
                return "[Peringatan: Model Gemini mengembalikan respons kosong. Hal ini biasanya terjadi jika pesan melanggar filter keamanan sisa server atau terjadi error internal API. Cobalah edit pesan terakhir Anda atau tekan 'Regenerate']";
            }

            return resultText;
        } catch (error: any) {
            console.error("Gemini SDK Error:", error);
            const errMsg = error.message || "";
            if (errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("quota")) {
                throw new Error("Telah mencapai batas kuota (Rate Limit/Token Per Minute). Pada API key gratis, jumlah teks yang dikirim tidak boleh melebihi batas. Solusi: Kurangi 'Batas Konteks' di pengaturan (misal: ubah ke 8000), atau gunakan model versi 'Flash' yang memiliki limit lebih besar. (Atau tunggu 1 menit lalu coba lagi).");
            }
            throw new Error(`Error: ${error.message || "Gagal menghubungi AI Service"}`);
        }
    }
};


// --- MAIN FUNCTIONS ---

export const generateReply = async (
  history: Message[],
  newMessage: string,
  character: Character,
  settings: AppSettings,
  activeSummary?: { content: string, messageCount: number } | null
): Promise<{ content: string; activeLoreIds: string[] }> => {
  
  let historyToSend = history;
  
  if (activeSummary && activeSummary.messageCount > 0 && history.length >= activeSummary.messageCount) {
      historyToSend = history.slice(activeSummary.messageCount);
  }

  historyToSend = prepareHistory(historyToSend, newMessage, settings.contextLimit);
  const { systemInstruction, activeLoreIds } = buildSystemPrompt(character, settings, historyToSend, newMessage);

  // Convert internal Message format to generic format
  let messages = historyToSend.map(m => ({
      role: m.role === 'model' ? 'assistant' : 'user', // 'assistant' maps to 'model' in makeLLMRequest for Gemini
      content: m.content
  }));
  
  if (activeSummary && activeSummary.messageCount > 0 && history.length >= activeSummary.messageCount) {
      messages.unshift({ 
          role: 'user', 
          content: `[SISTEM: Berikut adalah ringkasan berlanjut dari ${activeSummary.messageCount} pesan pertama dengan karakter ini, diberikan untuk mempertahankan konteks jangka panjang:]\n\n${activeSummary.content}` 
      });
  }
  
  if (newMessage) {
      messages.push({ role: 'user', content: newMessage });
  } else if (messages.length === 0) {
      messages.push({ role: 'user', content: "Halo" });
  } else if (messages[messages.length - 1].role === 'assistant') {
      messages.push({ role: 'user', content: "Lanjutkan." });
  }

  // Inject Advanced Prompts (In-Chat / Depth based)
  if (settings.promptEntries && settings.promptEntries.length > 0) {
      // Pick prompts that either aren't system, or ARE system but have an explicit depth >= 0
      const inchatPrompts = settings.promptEntries
          .filter(p => p.enabled && (p.role !== 'system' || (p.injectionDepth !== undefined && p.injectionDepth >= 0)))
          .sort((a, b) => (a.injectionPosition || 0) - (b.injectionPosition || 0));

      const grouped = new Map<number, typeof inchatPrompts>();
      inchatPrompts.forEach(p => {
          const depth = Math.max(0, p.injectionDepth || 0);
          if (!grouped.has(depth)) grouped.set(depth, []);
          grouped.get(depth)!.push(p);
      });

      // Splicing from end to start (highest depth to lowest depth) avoids index shifting issues!
      const depthsDesc = Array.from(grouped.keys()).sort((a, b) => b - a);
      
      depthsDesc.forEach(depth => {
          const prompts = grouped.get(depth)!;
          let targetIndex = messages.length - depth;
          if (targetIndex < 0) targetIndex = 0;
          if (targetIndex > messages.length) targetIndex = messages.length;
          
          // Inject each prompt at this depth
          // We reverse them so that evaluating them sequentially inserts them in correct sorted order
          [...prompts].reverse().forEach(p => {
              const content = processPrompt(p.content, character.name, settings.userName);
              messages.splice(targetIndex, 0, {
                  role: p.role,
                  content: content
              });
          });
      });
  }

  // --- INJECT EXTENSION HOOK FOR PROMPT READY ---
  // SillyTavern extensions expect the system instruction to be inside the messages array as role: 'system'.
  let mutableMessages: { role: string; content: string }[] = [];
  
  // Inject default Megumin Macro payload so the extension can automatically swap them if active
  const meguminPayload = "\n\n[[main]]\n[[OOC]]\n[[control]]\n[[COT]]\n[[THINK]]\n[[aiprompt]]\n[[Language]]\n[[pronouns]]\n[[count]]\n[[DNRATIO]]\n[[onomato]]\n";
  
  if (systemInstruction) {
     mutableMessages.push({ role: "system", content: systemInstruction + meguminPayload });
  } else {
     mutableMessages.push({ role: "system", content: meguminPayload });
  }
  mutableMessages.push(...messages);

  // Allow extension to modify mutableMessages in place
  await globalEventBus.emit(EVENT_TYPES.CHAT_COMPLETION_PROMPT_READY, { messages: mutableMessages });

  // Re-extract system instruction after extensions potentially modify it
  let finalSystemInstruction = "";
  let finalMessages: { role: string; content: string }[] = [];
  
  for (const m of mutableMessages) {
     let content = m.content;
     if (content) {
         // Cleanup unused macros (fallback in case Megumin is disabled)
         const macros = ["[[main]]", "[[OOC]]", "[[control]]", "[[COT]]", "[[THINK]]", "[[aiprompt]]", "[[Language]]", "[[pronouns]]", "[[count]]", "[[DNRATIO]]", "[[onomato]]"];
         macros.forEach(tr => {
             const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
             content = content.replace(new RegExp(`^[ \\t]*${escapeRegex(tr)}[ \\t]*\\r?\\n?`, 'gm'), "");
             content = content.replace(new RegExp(escapeRegex(tr), 'g'), ""); 
         });
     }
     if (m.role === 'system' && finalMessages.length === 0) {
         finalSystemInstruction += (finalSystemInstruction ? "\n\n" : "") + content;
     } else {
         m.content = content;
         finalMessages.push(m);
     }
  }

  try {
    const content = await makeLLMRequest(settings, finalMessages, finalSystemInstruction || undefined);
    return { content, activeLoreIds };
  } catch (error: any) {
    console.error("AI Generation Error:", error);
    throw new Error(error.message || "Gagal menghubungi AI Service.");
  }
};

/**
 * Smart Extraction: Menganalisis percakapan untuk menemukan informasi lore baru secara otomatis.
 */
export const extractNewLore = async (
    history: Message[],
    settings: AppSettings,
    character: Character
): Promise<Partial<LorebookEntry>[]> => {
    if (history.length < 2) return [];

    const lastMessages = history.slice(-4).map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join('\n');
    const existingKeys = (character.lorebook || []).flatMap(e => e.keys).join(', ');

    const prompt = `
    Analisis potongan chat berikut antara User dan Karakter (${character.name}).
    Tentukan apakah ada informasi BARU yang permanen atau penting yang muncul (seperti: item baru yang didapat, fakta dunia baru, perubahan hubungan, lokasi baru yang ditemukan).
    
    Chat Terbaru:
    ${lastMessages}

    Kata Kunci Lorebook yang Sudah Ada:
    ${existingKeys}

    Instruksi:
    1. Identifikasi informasi yang belum ada di Lorebook.
    2. Jika ada, buatlah entri Lorebook baru.
    3. Kembalikan dalam format JSON ARRAY berisi objek: { keys: string[], entry: string }.
    4. "keys" harus berisi kata kunci utama untuk memicu lore ini di masa depan (bahasa Inggris & Indonesia).
    5. "entry" adalah penjelasan lore-nya secara singkat dan padat.
    6. JANGAN mengulang lore yang sudah ada. Jika tidak ada yang baru, kembalikan array kosong [].
    7. Kembalikan HANYA JSON array murni.

    Contoh Output:
    [
      { "keys": ["Pedang Naga", "Dragon Sword"], "entry": "Pedang legendaris yang ditemukan User di gua terlarang. Memiliki kekuatan api." }
    ]
    `;

    try {
        const responseText = await makeLLMRequest(
            settings,
            [{ role: 'user', content: prompt }],
            "You are a smart lore extractor. You identify new world building elements from a chat. You output ONLY a JSON array, or empty array [] if nothing new found.",
            true
        );

        let cleanText = responseText.trim();
        if (cleanText.startsWith('```')) {
            cleanText = cleanText.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '');
        }

        const newEntries = JSON.parse(cleanText);
        if (Array.isArray(newEntries)) {
            return newEntries;
        }
        return [];
    } catch (e) {
        console.error("Lore Extraction Failed", e);
        return [];
    }
};

/**
 * Utility: Menerjemahkan keys Lorebook ke Bahasa Indonesia
 * Input: List of keys (e.g., ["Kingdom", "Sword"])
 * Output: Map of Original -> [Original, Translated] (e.g. { "Kingdom": ["Kingdom", "Kerajaan"] })
 */
export const translateLorebookKeys = async (
    entries: LorebookEntry[], 
    settings: AppSettings
): Promise<LorebookEntry[]> => {
    
    // Extract unique keys to save tokens
    const allKeys = Array.from(new Set(entries.flatMap(e => e.keys)));
    
    if (allKeys.length === 0) return entries;

    const prompt = `
    Saya memiliki daftar kata kunci (keywords) untuk Lorebook Roleplay.
    Sebagian besar dalam Bahasa Inggris. Saya ingin kamu menambahkan terjemahan Bahasa Indonesia untuk setiap kata kunci agar lorebook ini bekerja saat saya chatting dalam bahasa Indonesia.
    
    Daftar Kata Kunci:
    ${JSON.stringify(allKeys)}

    Instruksi:
    1. Untuk setiap kata kunci, berikan terjemahan bahasa Indonesianya yang relevan.
    2. Kembalikan dalam format JSON Object murni. Jangan gunakan Markdown formatting.
    3. Key adalah kata kunci asli, Value adalah ARRAY string yang berisi kata kunci asli DAN terjemahannya (dan variasi sinonim umum jika perlu).
    4. JANGAN hapus kata kunci asli.

    Contoh Output JSON:
    {
       "Kingdom": ["Kingdom", "Kerajaan", "Kekaisaran"],
       "Excalibur": ["Excalibur", "Pedang Excalibur"],
       "School": ["School", "Sekolah", "Akademi"]
    }
    `;

    try {
        const responseText = await makeLLMRequest(
            settings, 
            [{ role: 'user', content: prompt }], 
            "You are a helpful translator assistant. You output only valid JSON. No Markdown.",
            true // JSON Mode
        );

        // Sanitize response: Remove Markdown code blocks if model ignores instructions
        let cleanText = responseText.trim();
        if (cleanText.startsWith('```')) {
            cleanText = cleanText.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '');
        }

        const translationMap = JSON.parse(cleanText);
        
        // Map back to entries
        const updatedEntries = entries.map(entry => {
            let newKeys = new Set<string>();
            entry.keys.forEach(k => {
                newKeys.add(k); // Keep original
                if (translationMap[k] && Array.isArray(translationMap[k])) {
                    translationMap[k].forEach((translated: string) => newKeys.add(translated));
                }
            });
            return {
                ...entry,
                keys: Array.from(newKeys)
            };
        });

        return updatedEntries;

    } catch (e) {
        console.error("Translation Failed", e);
        throw new Error("Gagal menerjemahkan keys. Pastikan API Key valid dan model mendukung JSON.");
    }
};
