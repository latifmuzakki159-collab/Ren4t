import { AppSettings, Character, DEFAULT_SETTINGS, Message } from "../types";
import { db } from "./firebase";
import { collection, doc, getDoc, setDoc, getDocs, deleteDoc, writeBatch } from "firebase/firestore";
import localforage from "localforage";

let activeHouseId: string | null = localStorage.getItem('grh_houseId') || null;

export const setHouseId = (id: string) => {
    activeHouseId = id;
    localStorage.setItem('grh_houseId', id);
};

export const getHouseId = () => activeHouseId;

export const logout = async () => {
    // Clear all keys belonging to this house explicitly
    const keys = await localforage.keys();
    for (const key of keys) {
        if (key.startsWith(`${activeHouseId}_`)) {
            await localforage.removeItem(key);
        }
    }
    activeHouseId = null;
    localStorage.removeItem('grh_houseId');
};

const checkHouse = () => {
    if (!activeHouseId) throw new Error("Tidak ada kunci rumah yang aktif.");
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  console.error('FIREBASE RAW ERROR:', error);
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- LOCAL DB CACHING (Hyper Storage) ---

export const loadSettings = async (): Promise<AppSettings> => {
    checkHouse();
    const data = await localforage.getItem<AppSettings>(`${activeHouseId}_settings`);
    return data ? { ...DEFAULT_SETTINGS, ...data } : DEFAULT_SETTINGS;
};

export const saveSettings = async (settings: AppSettings) => {
    checkHouse();
    await localforage.setItem(`${activeHouseId}_settings`, settings);
};

export const loadCharacters = async (): Promise<Character[]> => {
    checkHouse();
    const data = await localforage.getItem<Character[]>(`${activeHouseId}_characters`);
    return data || [];
};

export const saveCharacters = async (characters: Character[]) => {
    checkHouse();
    await localforage.setItem(`${activeHouseId}_characters`, characters);
};

export const deleteCharacter = async (charId: string) => {
    checkHouse();
    const chars = await loadCharacters();
    const newChars = chars.filter(c => c.id !== charId);
    await saveCharacters(newChars);
    await deleteChat(charId);
};

export const loadChat = async (charId: string): Promise<Message[]> => {
    checkHouse();
    const data = await localforage.getItem<Message[]>(`${activeHouseId}_chat_${charId}`);
    return data || [];
};

export const saveChat = async (charId: string, messages: Message[]) => {
    checkHouse();
    await localforage.setItem(`${activeHouseId}_chat_${charId}`, messages);
};

export const deleteChat = async (charId: string) => {
    checkHouse();
    await localforage.removeItem(`${activeHouseId}_chat_${charId}`);
    await saveChatSummary(charId, null);
};

export const deleteMessage = async (charId: string, msgId: string) => {
    checkHouse();
    const msgs = await loadChat(charId);
    const newMsgs = msgs.filter(m => m.id !== msgId);
    await saveChat(charId, newMsgs);
};

export interface ChatSummary {
    content: string;
    messageCount: number;
}

export const loadChatSummary = async (charId: string): Promise<ChatSummary | null> => {
    checkHouse();
    const data = await localforage.getItem<ChatSummary>(`${activeHouseId}_summary_${charId}`);
    return data;
};

export const saveChatSummary = async (charId: string, summary: ChatSummary | null) => {
    checkHouse();
    if (summary) {
        await localforage.setItem(`${activeHouseId}_summary_${charId}`, summary);
    } else {
        await localforage.removeItem(`${activeHouseId}_summary_${charId}`);
    }
};

import { compressImage } from "./imageUtils";

// --- SYNC TO/FROM CLOUD (FIREBASE) ---

export const syncFromCloud = async (progress?: (msg: string) => void) => {
    checkHouse();
    if (progress) progress("Mengunduh Pengaturan...");
    const settingsDoc = await getDoc(doc(db, 'houses', activeHouseId!, 'settings', 'main'));
    if (settingsDoc.exists()) {
        await saveSettings(settingsDoc.data() as AppSettings);
    }

    if (progress) progress("Mengunduh Karakter...");
    const charSnap = await getDocs(collection(db, 'houses', activeHouseId!, 'characters'));
    const characters = charSnap.docs.map(d => d.data() as Character);
    await saveCharacters(characters);
    
    let chatCount = 0;
    for (const char of characters) {
        if (progress) progress(`Mengunduh Obrolan... (${++chatCount}/${characters.length})`);
        
        // Load summary
        const sumDoc = await getDoc(doc(db, 'houses', activeHouseId!, 'summaries', char.id));
        if (sumDoc.exists()) await saveChatSummary(char.id, sumDoc.data() as ChatSummary);
        
        // Load messages
        const msgSnap = await getDocs(collection(db, 'houses', activeHouseId!, 'chats', char.id, 'messages'));
        const msgs = msgSnap.docs.map(d => d.data() as Message);
        msgs.sort((a, b) => a.timestamp - b.timestamp);
        if (msgs.length > 0) {
            await saveChat(char.id, msgs);
        }
    }
    if (progress) progress("Sinkronisasi Selesai.");
};

export const syncToCloud = async (progress?: (msg: string) => void) => {
    checkHouse();
    
    let batch = writeBatch(db);
    let count = 0;
    const commitBatch = async () => {
        if (count > 0) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
        }
    };
    const addBatch = async (op: (b: any) => void) => {
        op(batch);
        count++;
        if (count >= 400) await commitBatch();
    };

    if (progress) progress("Membersihkan Data Lama di Cloud...");
    
    // Hard Wipe old Characters
    const oldCharsSnap = await getDocs(collection(db, 'houses', activeHouseId!, 'characters'));
    for (const d of oldCharsSnap.docs) {
        await addBatch((b) => b.delete(d.ref));
        // Hard wipe messages
        const msgSnap = await getDocs(collection(db, 'houses', activeHouseId!, 'chats', d.id, 'messages'));
        for (const m of msgSnap.docs) {
            await addBatch((b) => b.delete(m.ref));
        }
        // Wipe summaries
        await addBatch((b) => b.delete(doc(db, 'houses', activeHouseId!, 'summaries', d.id)));
    }
    await commitBatch();

    if (progress) progress("Menyimpan Pengaturan...");
    const settings = await loadSettings();
    await addBatch((b) => b.set(doc(db, 'houses', activeHouseId!, 'settings', 'main'), JSON.parse(JSON.stringify(settings))));
    
    if (progress) progress("Menyimpan Karakter...");
    const characters = await loadCharacters();
    for (const char of characters) {
        const cleanChar = JSON.parse(JSON.stringify(char));
        if (cleanChar.avatarUrl && cleanChar.avatarUrl.length > 300000 && cleanChar.avatarUrl.startsWith('data:image')) {
            // Compress large images before hitting the 1MB limit
            try {
                cleanChar.avatarUrl = await compressImage(cleanChar.avatarUrl, 300, 300);
            } catch(e) {
                console.error("Failed to compress image", e);
            }
        }
        let cleanCharStr = JSON.stringify(cleanChar);
        if (cleanCharStr.length > 900000) {
           cleanChar.avatarUrl = ""; // Force clear if still too large
        }
        await addBatch((b: any) => b.set(doc(db, 'houses', activeHouseId!, 'characters', char.id), cleanChar));
    }
    
    let chatCount = 0;
    for (const char of characters) {
        if (progress) progress(`Menyimpan Obrolan... (${++chatCount}/${characters.length})`);
        
        // Save summary
        const summary = await loadChatSummary(char.id);
        if (summary) {
            await addBatch((b) => b.set(doc(db, 'houses', activeHouseId!, 'summaries', char.id), summary));
        }
        
        // Save messages
        const msgs = await loadChat(char.id);
        for (const msg of msgs) {
            const cleanMsg = JSON.parse(JSON.stringify(msg));
            await addBatch((b) => b.set(doc(db, 'houses', activeHouseId!, 'chats', char.id, 'messages', msg.id), cleanMsg));
        }
    }
    
    await commitBatch();
    if (progress) progress("Sinkronisasi Selesai.");
};


// --- Full Backup/Restore ---
export interface BackupData {
    settings: AppSettings;
    characters: Character[];
    chats: Record<string, Message[]>;
}

export const exportAllData = async (): Promise<string> => {
    const settings = await loadSettings();
    const characters = await loadCharacters();
    const chats: Record<string, Message[]> = {};
    
    for (const char of characters) {
        chats[char.id] = await loadChat(char.id);
    }
    
    const backup: BackupData = { settings, characters, chats };
    return JSON.stringify(backup, null, 2);
};

export const importAllData = async (json: string): Promise<void> => {
    try {
        const data: BackupData = JSON.parse(json);
        
        if (data.settings) await saveSettings(data.settings);
        
        if (data.characters && Array.isArray(data.characters)) {
            await saveCharacters(data.characters);
        }
        
        if (data.chats) {
            for (const [charId, msgs] of Object.entries(data.chats)) {
                await saveChat(charId, msgs);
            }
        }
    } catch (e) {
        throw new Error("Gagal membaca file backup. Format tidak valid.");
    }
};
