// AI Auto-Suggest Extension for GeminiRP

export function activate() {
  console.log("[Extension] Auto-Suggest activated!");
  const { eventSource, event_types, chat, callLLM } = window.MyApp.getContext();

  // Listen to MESSAGE_RECEIVED event
  eventSource.on(event_types.MESSAGE_RECEIVED, async (msg) => {
    // We only process if the message is from character
    if (msg.role !== 'model') return;

    const extensionZone = document.getElementById("chat-extension-zone");
    if (!extensionZone) return;

    // Render loading indicator inside zone
    extensionZone.innerHTML = `
      <div class="autosuggest-wrapper">
        <div class="autosuggest-title">
          <i class="fas fa-robot animate-pulse"></i> Mengolah opsi alur selanjutnya...
        </div>
      </div>
    `;

    try {
      const prompt = `Berikut adalah pesan terbaru dari karakter "${chat.character?.name || 'Karakter'}" dalam sesi roleplay:
"${msg.content}"

Pertimbangkan deskripsi karakter:
"${chat.character?.description || ''}"

Tugas Anda adalah merumuskan 3 opsi tindakan atau dialog ringkas yang paling menarik dan logis yang dapat dilakukan oleh pengguna ("${window.MyApp.getContext().settings?.userName || 'User'}") selanjutnya untuk melanjutkan petualangan roleplay ini.

Kombinasikan aksi (dalam tanda bintang *...*) dan percakapan. Pastikan bahasanya natural, mendalam, dan sesuai dengan situasi terakhir.

Kembalikan jawaban HANYA berupa JSON Array murni berisi 3 string, tanpa penjelasan markup atau markdown blok kode \`\`\`json.
Contoh format keluaran:
[
  "*Membantah perkataannya dengan tegas* Jauhkan tanganmu dari barang ini!",
  "*Menatapnya dengan bingung dan tersenyum tipis* Kamu sungguh yakin dengan rencanamu ini?",
  "*Mengambil gelas tehnya lalu menyesapnya perlahan* Baiklah, mari kita dengarkan penawaranmu."
]`;

      const response = await callLLM(prompt, "You are a roleplay creative engine. Always return a raw JSON array of 3 realistic response options.");
      
      // Attempt to clean JSON response from code block wrappers
      let cleanedJson = response.trim();
      if (cleanedJson.startsWith("```")) {
        cleanedJson = cleanedJson.replace(/^```(json)?/, "").replace(/```$/, "").trim();
      }

      let options = [];
      try {
        options = JSON.parse(cleanedJson);
      } catch (e) {
        // Fallback parser using regex if model returns invalid JSON syntax
        console.warn("JSON parse failed, trying regex extraction", cleanedJson);
        const matches = cleanedJson.match(/"([^"\\]*(?:\\.[^"\\]*)*)"/g);
        if (matches && matches.length >= 3) {
          options = matches.slice(0, 3).map(m => m.replace(/^"|"$/g, '').replace(/\\"/g, '"'));
        } else {
          options = [
            "*Melanjutkan percakapan dengan santai*",
            "*Menanyakan lebih rinci tentang maksudnya*",
            "*Mengalihkan pembicaraan ke topik lain*"
          ];
        }
      }

      if (!Array.isArray(options) || options.length < 3) {
        options = [
          "*Merasa ragu-ragu* Bolehkah kau ceritakan lebih banyak?",
          "*Mengangguk setuju* Baiklah, aku mengerti maksudmu.",
          "*Mengganti topik pembicaraan dengan halus* Ngomong-ngomong, bagaimana kabar yang lain?"
        ];
      }

      // Render suggestions in the zone
      extensionZone.innerHTML = `
        <div class="autosuggest-wrapper">
          <div class="autosuggest-title">
            <i class="fas fa-magic"></i> Rekomendasi Alur Tindakan (AI Auto-Suggest)
          </div>
          <div class="autosuggest-container">
            ${options.slice(0, 3).map((opt, idx) => `
              <button class="autosuggest-btn" id="sug-btn-${idx}">
                ${opt}
              </button>
            `).join('')}
          </div>
        </div>
      `;

      // Assign click handlers
      options.slice(0, 3).forEach((opt, idx) => {
        const btn = document.getElementById(`sug-btn-${idx}`);
        if (btn) {
          btn.addEventListener('click', () => {
            const chatInput = document.getElementById("chat-input-textarea");
            if (chatInput) {
              // Set input value and dispatch input event to update React state
              chatInput.value = opt;
              chatInput.dispatchEvent(new Event('input', { bubbles: true }));
              chatInput.focus();
              
              // Clear suggestion zone after pick
              extensionZone.innerHTML = '';
            }
          });
        }
      });

    } catch (err) {
      console.error("Auto suggest extension error:", err);
      extensionZone.innerHTML = ''; // Clear zon on error
    }
  });

  // Also clear suggestion zone on character change
  eventSource.on(event_types.CHARACTER_CHANGED, () => {
    const extensionZone = document.getElementById("chat-extension-zone");
    if (extensionZone) {
      extensionZone.innerHTML = '';
    }
  });
}
