import React, { useState, useEffect } from "react";
import ConfirmModal from "./ConfirmModal";

interface Extension {
  name: string;
  manifest: {
    name: string;
    version: string;
    description: string;
    author: string;
    js: string;
    css?: string;
    loading_order?: number;
  };
  active?: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_EXT_CODE = `// Ekstensi Kustom Baru
const { eventSource, event_types, chat } = window.MyApp.getContext();

export function activate() {
  console.log("Ekstensi Kustom Aktif!");
  
  // Hook ke pesan masuk
  eventSource.on(event_types.MESSAGE_RECEIVED, async (msg) => {
    console.log("Pesan masuk terdeteksi:", msg.content);
  });
}
`;

const ExtensionsModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<"list" | "install" | "create" | "settings">("list");
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [enabledStates, setEnabledStates] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(false);

  // Install Form
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");

  // Create Form
  const [createForm, setCreateForm] = useState({
    name: "",
    displayName: "",
    description: "",
    author: "",
    version: "1.0.0",
    code: DEFAULT_EXT_CODE,
    cssCode: "",
  });

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [extensionToDelete, setExtensionToDelete] = useState<string | null>(null);

  // Load Extensions from Express Backend
  const loadExtensionsList = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/extensions/list");
      if (res.ok) {
        const data = await res.json();
        setExtensions(data);

        // Load active states from LocalStorage
        const savedStates = JSON.parse(localStorage.getItem("grh_enabled_extensions") || "{}");
        setEnabledStates(savedStates);
      }
    } catch (err) {
      console.error("Gagal memuat daftar ekstensi backend:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadExtensionsList();
      setErrorMessage(null);
      setSuccessMessage(null);
    }
  }, [isOpen]);

  // Handle Enable/Disable Toggle
  const handleToggleExtension = (name: string, currentVal: boolean) => {
    const updated = { ...enabledStates, [name]: !currentVal };
    setEnabledStates(updated);
    localStorage.setItem("grh_enabled_extensions", JSON.stringify(updated));

    setSuccessMessage("Status ekstensi diperbarui. Muat ulang halaman obrolan untuk menerapkan perubahan.");
    setTimeout(() => setSuccessMessage(null), 5000);
  };

  // Handle Git Install Submit
  const handleInstallExtension = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl.trim()) return;

    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch("/api/extensions/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: repoUrl.trim(), branch }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Gagal menginstal ekstensi.");
      }

      setSuccessMessage(`Berhasil menginstal ekstensi "${data.manifest.name}"!`);
      setRepoUrl("");
      setBranch("main");
      setActiveTab("list");
      await loadExtensionsList();
    } catch (err: any) {
      setErrorMessage(err.message || "Gagal terkoneksi ke server backend.");
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Custom Create Submit
  const handleCreateExtension = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name.trim() || !createForm.displayName.trim()) {
      setErrorMessage("Nama folder dan nama tampilan wajib diisi.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch("/api/extensions/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Gagal membuat ekstensi.");
      }

      setSuccessMessage(`Berhasil membuat ekstensi "${data.manifest.name}"!`);
      setCreateForm({
        name: "",
        displayName: "",
        description: "",
        author: "",
        version: "1.0.0",
        code: DEFAULT_EXT_CODE,
        cssCode: "",
      });
      setActiveTab("list");
      await loadExtensionsList();
    } catch (err: any) {
      setErrorMessage(err.message || "Gagal membuat ekstensi kustom.");
    } finally {
      setIsLoading(false);
    }
  };

  // Delete Extension
  const promptDeleteExtension = (name: string) => {
    setExtensionToDelete(name);
  };

  const confirmDeleteExtension = async () => {
    if (!extensionToDelete) return;

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/extensions/delete/${extensionToDelete}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setSuccessMessage(`Ekstensi ${extensionToDelete} berhasil dihapus.`);
        setExtensionToDelete(null);
        await loadExtensionsList();
      } else {
        const data = await res.json();
        setErrorMessage(data.error || "Gagal menghapus.");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Kesalahan jaringan.");
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in text-gray-200">
      <div className="bg-gray-900 border border-gray-800 rounded-3xl w-full max-w-4xl max-h-[85vh] shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-8 py-5 border-b border-gray-800 flex justify-between items-center bg-gray-950/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-600/10 flex items-center justify-center text-primary-500 text-lg">
              <i className="fas fa-plug"></i>
            </div>
            <div>
              <h3 className="font-bold text-lg text-white">Ekstensi & Plugin</h3>
              <p className="text-xs text-gray-400">Hubungkan ekstensi SillyTavern-style untuk memodifikasi performa GeminiRP.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition p-2 hover:bg-gray-800 rounded-xl"
          >
            <i className="fas fa-times text-lg"></i>
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex px-8 py-2 border-b border-gray-800 bg-gray-950/20 gap-1">
          <button
            onClick={() => setActiveTab("list")}
            className={`px-5 py-3 font-semibold text-sm transition border-b-2 ${
              activeTab === "list"
                ? "border-primary-500 text-primary-400 font-bold"
                : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            <i className="fas fa-list-ul mr-2"></i> Ekstensi Terpasang
          </button>
          <button
            onClick={() => setActiveTab("install")}
            className={`px-5 py-3 font-semibold text-sm transition border-b-2 ${
              activeTab === "install"
                ? "border-primary-500 text-primary-400 font-bold"
                : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            <i className="fas fa-download mr-2"></i> Pasang dari Git
          </button>
          <button
            onClick={() => setActiveTab("create")}
            className={`px-5 py-3 font-semibold text-sm transition border-b-2 ${
              activeTab === "create"
                ? "border-primary-500 text-primary-400 font-bold"
                : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            <i className="fas fa-plus mr-2"></i> Buat Kustom
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className={`px-5 py-3 font-semibold text-sm transition border-b-2 ${
              activeTab === "settings"
                ? "border-primary-500 text-primary-400 font-bold"
                : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            <i className="fas fa-cogs mr-2"></i> Pengaturan
          </button>
        </div>

        {/* Body content */}
        <div className="flex-1 overflow-y-auto p-8">
          {/* Notifications */}
          {errorMessage && (
            <div className="mb-6 p-4 bg-red-950/50 border border-red-500/30 rounded-2xl text-red-400 text-sm flex items-center gap-3">
              <i className="fas fa-exclamation-triangle"></i>
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="mb-6 p-4 bg-emerald-950/50 border border-emerald-500/30 rounded-2xl text-emerald-400 text-sm flex items-center gap-3">
              <i className="fas fa-check-circle"></i>
              <span>{successMessage}</span>
            </div>
          )}

          {/* TAB 1: LIST INSTALLED */}
          {activeTab === "list" && (
            <div className="space-y-4">
              {isLoading && extensions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <div className="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-gray-400">Menghubungi server...</p>
                </div>
              ) : extensions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed border-gray-800 rounded-3xl">
                  <i className="fas fa-boxes text-4xl text-gray-600 mb-3"></i>
                  <h4 className="font-bold text-gray-300">Belum ada ekstensi terpasang</h4>
                  <p className="text-xs text-gray-500 max-w-sm mt-1">
                    Silakan pasang ekstensi dari GitHub/GitLab atau buat kode ekstensi kustom baru secara langsung.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {extensions.map((ext) => {
                    const isActive = enabledStates[ext.name] !== false;
                    return (
                      <div
                        key={ext.name}
                        className={`bg-gray-950 border rounded-2xl p-5 hover:border-gray-700 transition flex flex-col justify-between ${
                          isActive ? "border-violet-500/20" : "border-gray-850 opacity-70"
                        }`}
                      >
                        <div>
                          <div className="flex justify-between items-start gap-2 mb-2">
                            <h4 className="font-bold text-white tracking-tight flex items-center gap-2">
                              {ext.manifest.name}
                              <span className="text-[10px] bg-gray-800 text-gray-400 font-mono px-2 py-0.5 rounded-full">
                                v{ext.manifest.version}
                              </span>
                            </h4>
                            <div className="flex items-center">
                              {/* Toggle switch Button */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleExtension(ext.name, isActive);
                                }}
                                className={`w-10 h-6 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${
                                  isActive ? "bg-primary-600" : "bg-gray-800"
                                }`}
                              >
                                <div
                                  className={`bg-white w-5 h-5 rounded-full shadow-md transform transition-transform ${
                                    isActive ? "translate-x-4" : "translate-x-0"
                                  }`}
                                />
                              </button>
                            </div>
                          </div>
                          
                          <p className="text-xs text-gray-450 leading-relaxed mb-4">
                            {ext.manifest.description}
                          </p>
                        </div>

                        <div className="flex justify-between items-center text-[11px] text-gray-500 border-t border-gray-900 pt-3">
                          <span className="truncate max-w-[150px]">
                            <i className="fas fa-user-edit mr-1"></i> {ext.manifest.author}
                          </span>
                          <button
                            onClick={(e) => {
                                e.stopPropagation();
                                promptDeleteExtension(ext.name);
                            }}
                            className="bg-red-950/50 hover:bg-red-900/60 text-red-400 px-3 py-1 rounded-lg hover:text-white transition flex items-center gap-1.5"
                          >
                            <i className="fas fa-trash-alt text-[10px]"></i> Hapus
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: INSTALL VIA GIT */}
          {activeTab === "install" && (
            <div className="max-w-xl mx-auto py-4">
              <form onSubmit={handleInstallExtension} className="space-y-6">
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-white">Repository Git URL (HTTPS)</label>
                  <input
                    type="url"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    placeholder="https://github.com/username/ext-name.git"
                    required
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-white focus:ring-2 focus:ring-primary-500 outline-none"
                  />
                  <p className="text-xs text-gray-500 leading-normal">
                    Masukkan URL repositori HTTPS yang memiliki berkas <code className="bg-gray-800 px-1 py-0.5 rounded text-violet-400 font-mono">manifest.json</code> dengan struktur SillyTavern.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-white">Branch Utama (Default: main)</label>
                  <input
                    type="text"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="main"
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-white focus:ring-2 focus:ring-primary-500 outline-none font-mono"
                  />
                </div>

                <div className="pt-4">
                  <button
                    type="submit"
                    disabled={isLoading || !repoUrl.trim()}
                    className="w-full bg-primary-600 hover:bg-primary-500 disabled:bg-gray-800 disabled:cursor-not-allowed font-bold text-white p-3 rounded-xl transition shadow-lg shadow-primary-500/10 flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Mencari & Mengklon Repositori...
                      </>
                    ) : (
                      <>
                        <i className="fas fa-download"></i> Klon & Pasang Ekstensi
                      </>
                    )}
                  </button>
                </div>
              </form>

              {/* Developer Tip */}
              <div className="mt-8 p-5 bg-gray-950 border border-gray-800 rounded-2xl">
                <h5 className="font-bold text-xs text-violet-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                  <i className="fas fa-info-circle"></i> Info Sandboxing
                </h5>
                <p className="text-xs text-gray-400 leading-normal">
                  Sama halnya dengan SillyTavern, ekstensi di GeminiRP memiliki akses bebas ke seluruh event loop, API backend Anda, dan browser DOM. Pastikan untuk memasang ekstensi hanya dari **pengembang tepercaya**.
                </p>
              </div>
            </div>
          )}

          {/* TAB 3: CREATE CUSTOM EXTENSION */}
          {activeTab === "create" && (
            <form onSubmit={handleCreateExtension} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Nama Folder Ekstensi (Unik)</label>
                  <input
                    type="text"
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    placeholder="my-cool-extension"
                    required
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-white focus:ring-2 focus:ring-primary-500 outline-none"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Nama Tampilan (UI)</label>
                  <input
                    type="text"
                    value={createForm.displayName}
                    onChange={(e) => setCreateForm({ ...createForm, displayName: e.target.value })}
                    placeholder="RP Helper Pro"
                    required
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-white focus:ring-2 focus:ring-primary-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2 col-span-2">
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Deskripsi Singkat</label>
                  <input
                    type="text"
                    value={createForm.description}
                    onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                    placeholder="Ekstensi kustom untuk memperindah roleplay saya."
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-white focus:ring-2 focus:ring-primary-500 outline-none"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Author</label>
                  <input
                    type="text"
                    value={createForm.author}
                    onChange={(e) => setCreateForm({ ...createForm, author: e.target.value })}
                    placeholder="Nama Anda"
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-white focus:ring-2 focus:ring-primary-500 outline-none"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Kode JavaScript Ekstensi (index.js)</label>
                <textarea
                  value={createForm.code}
                  onChange={(e) => setCreateForm({ ...createForm, code: e.target.value })}
                  rows={8}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl p-4 text-emerald-400 focus:ring-2 focus:ring-primary-500 outline-none font-mono text-xs leading-normal"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Kode CSS Kustom (style.css - Opsional)</label>
                <textarea
                  value={createForm.cssCode}
                  onChange={(e) => setCreateForm({ ...createForm, cssCode: e.target.value })}
                  rows={3}
                  placeholder=".my-class { border: 1px solid violet; }"
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-violet-400 focus:ring-2 focus:ring-primary-500 outline-none font-mono text-xs"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isLoading || !createForm.name || !createForm.displayName}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 disabled:cursor-not-allowed font-bold text-white p-3 rounded-xl transition shadow-lg shadow-emerald-500/10 flex items-center justify-center gap-2"
                >
                  <i className="fas fa-plus-circle"></i> Buat Ekstensi Baru
                </button>
              </div>
            </form>
          )}

          {/* TAB 4: EXTENSIONS SETTINGS ZONE (FOR SILLYTAVERN PLUGINS) */}
          {activeTab === "settings" && (
            <div className="space-y-4">
              <div className="mb-4 p-4 bg-gray-950 border border-violet-500/30 rounded-2xl flex items-start gap-4">
                <i className="fas fa-info-circle text-violet-400 mt-1"></i>
                <p className="text-sm text-gray-300 leading-relaxed">
                  Pengaturan dari ekstensi yang mendukung UI SillyTavern akan di-render di bawah ini.
                  Jika ekstensi menambahkan menu konfigurasi, panelnya akan muncul di dalam kotak kosong ini.
                </p>
              </div>

              {/* DOM hook id="extensions_settings" that ST extensions inject HTML into */}
              <div id="extensions_settings" className="w-full flex justify-center empty:hidden"></div>

              <style>{`
                /* Some basic styling specifically to keep ST settings from breaking the nice UI */
                #extensions_settings > div {
                    background-color: rgba(15, 23, 42, 0.4);
                    border: 1px solid rgba(51, 65, 85, 0.5);
                    border-radius: 0.75rem;
                    padding: 1rem;
                    margin-bottom: 1rem;
                    width: 100%;
                }
              `}</style>
            </div>
          )}
        </div>
      </div>
      
      <ConfirmModal
        isOpen={!!extensionToDelete}
        title="Hapus Ekstensi"
        message={`Apakah Anda yakin ingin menghapus ekstensi "${extensionToDelete}" secara permanen?`}
        confirmLabel="Hapus"
        cancelLabel="Batal"
        onConfirm={confirmDeleteExtension}
        onCancel={() => setExtensionToDelete(null)}
        isDestructive={true}
      />
    </div>
  );
};

export default ExtensionsModal;
