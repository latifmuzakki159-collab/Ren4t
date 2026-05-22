// RP Style Booster Extension for GeminiRP

export function activate() {
  console.log("[Extension] RP Style Booster activated!");
  const { eventSource, event_types } = window.MyApp.getContext();

  let activeStyle = "default";

  // Function to inject style picker UI
  function renderUI() {
    const bar = document.getElementById("chat-extension-bar");
    if (!bar) return;

    // Check if selector exists already
    if (document.getElementById("booster-container")) return;

    const container = document.createElement("div");
    container.id = "booster-container";
    container.className = "booster-panel";
    container.innerHTML = `
      <div class="booster-label">
        <i class="fas fa-feather-alt text-violet-400"></i> Style Booster:
      </div>
      <select id="booster-select-control" class="booster-select">
        <option value="default">Default (Sesuai Karakter)</option>
        <option value="sastra">Sastra (Novel Puitis, Diksi Indah)</option>
        <option value="dramatis">Dramatis (Mencekam, Emosional, Deskriptif)</option>
        <option value="modern">Kasual Modern (Santai, Gaul/Gaya Jakarta)</option>
        <option value="sensual">Sensual Melankolis (Romantis, Detail Sensus)</option>
      </select>
      <span class="booster-badge text-xs">READY</span>
    `;

    bar.appendChild(container);

    const select = document.getElementById("booster-select-control");
    if (select) {
      select.value = activeStyle;
      select.addEventListener("change", (e) => {
        activeStyle = e.target.value;
        console.log(`[Extension] Booster style changed to: ${activeStyle}`);
      });
    }
  }

  // Inject UI when application/chat mounts
  renderUI();

  // Retry injecting on interval in case ChatPage re-renders or changes routes
  const interval = setInterval(renderUI, 1500);

  // Hook into the sending pipeline
  eventSource.on(event_types.MESSAGE_SENDING, (message) => {
    if (activeStyle === "default") return message;

    console.log(`[Extension] RP Style Booster modifying prompt context based on: ${activeStyle}`);

    // Create a style-specific system instruction to append to the message
    let styleInstruction = "";
    switch (activeStyle) {
      case "sastra":
        styleInstruction = "\n\n[GAYA PENULISAN: Gunakan gaya bahasa Sastra klasik layaknya novel berkualitas tinggi. Perbanyak kata kiasan puitis, diksi indah, deskripsi suasana mendalam, and lambatkan tempo aksi agar puitis.]";
        break;
      case "dramatis":
        styleInstruction = "\n\n[GAYA PENULISAN: Buat suasana menjadi sangat dramatis, emosional, menegangkan, dan sarat konflik batin. Deskripsikan napas, detak jantung, keringat dingin, dan getaran suara secara mendalam.]";
        break;
      case "modern":
        styleInstruction = "\n\n[GAYA PENULISAN: Gunakan gaya bercakap kasual modern Indonesia metropolitan (santai, luwes, sesekali gunakan 'lo/gue' atau bahasa sehari-hari Jakarta jika sesuai dengan karakter, hindari kekakuan bahasa baku).]";
        break;
      case "sensual":
        styleInstruction = "\n\n[GAYA PENULISAN: Tekankan aspek ketertarikan romantis yang intim, tatapan sensual, sentuhan fisik yang lambat, dan getaran romansa melankolis yang intens.]";
        break;
    }

    if (styleInstruction) {
      return {
        ...message,
        content: message.content + styleInstruction
      };
    }

    return message;
  });

  // Clean up references when character shifts
  eventSource.on(event_types.CHARACTER_CHANGED, () => {
    activeStyle = "default";
    const select = document.getElementById("booster-select-control");
    if (select) {
      select.value = "default";
    }
  });

  // Clean up loop on destruction (if any, though extensions stay active in memory)
  return () => {
    clearInterval(interval);
  };
}
