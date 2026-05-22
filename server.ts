import express from "express";
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3000;

app.use(express.json());

const USER_EXT_DIR = path.join(process.cwd(), 'public', 'extensions', 'third-party');

// Ensure directories exist
if (!fs.existsSync(USER_EXT_DIR)) {
  fs.mkdirSync(USER_EXT_DIR, { recursive: true });
}

// Serve third-party extensions statically
app.use('/extensions/third-party', express.static(USER_EXT_DIR));
app.use('/scripts/extensions/third-party', express.static(USER_EXT_DIR));

// 1. Endpoint lists extensions
app.get("/api/extensions/list", (req, res) => {
  try {
    if (!fs.existsSync(USER_EXT_DIR)) {
      return res.json([]);
    }

    const folders = fs.readdirSync(USER_EXT_DIR);
    const list = [];

    for (const folder of folders) {
      const folderPath = path.join(USER_EXT_DIR, folder);
      if (fs.statSync(folderPath).isDirectory()) {
        const manifestPath = path.join(folderPath, "manifest.json");
        if (fs.existsSync(manifestPath)) {
          try {
            const manifestStr = fs.readFileSync(manifestPath, "utf-8");
            const cleanStr = manifestStr.replace(/^\uFEFF/, '');
            const manifest = JSON.parse(cleanStr);
            
            // Leniency fallback just for listing display
            if (!manifest.name) manifest.name = manifest.displayName || manifest.title || folder;
            if (!manifest.version) manifest.version = "1.0.0";
            if (!manifest.description) manifest.description = "SillyTavern Extension.";
            if (!manifest.author) manifest.author = "Unknown";
            if (!manifest.js) manifest.js = "index.js";

            list.push({
              name: folder,
              manifest,
              active: true // frontend can toggle
            });
          } catch (e) {
            console.error(`Invalid manifest in ${folder}:`, e);
          }
        }
      }
    }

    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Helper functions for validating Git URLs and manifests
const isValidGitUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && (parsed.hostname === "github.com" || parsed.hostname === "gitlab.com" || parsed.hostname.endsWith(".git"));
  } catch (e) {
    return false;
  }
};

const validateManifest = (manifest: any): void => {
  if (!manifest.name) {
    throw new Error("Manifest must include a name!");
  }
  if (!manifest.js) {
    throw new Error("Manifest must specify a main 'js' file!");
  }
};

// 2. Endpoint installs extension via git clone
app.post("/api/extensions/install", async (req, res) => {
  const { repoUrl, branch = "main" } = req.body;

  if (!repoUrl) {
    return res.status(400).json({ error: "Repository URL is required" });
  }

  if (!isValidGitUrl(repoUrl)) {
    return res.status(400).json({ error: "Invalid repository URL. Only HTTPS URLs for GitHub or GitLab are allowed." });
  }

  // Parse and clean URL
  let cleanUrl = repoUrl;
  try {
    const parsed = new URL(repoUrl);
    parsed.hash = '';
    parsed.search = '';
    cleanUrl = parsed.toString();
  } catch (e) {
    // Should be caught by isValidGitUrl
  }

  // Extract folder name
  let extName = path.basename(cleanUrl, ".git");
  if (!extName || extName === "/") {
    extName = `ext-${Date.now()}`;
  }
  
  // Sanitize extension name to avoid invalid characters for directory names
  extName = extName.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/^-+|-+$/g, '');

  const targetDir = path.join(USER_EXT_DIR, extName);

  if (fs.existsSync(targetDir)) {
    // Overwrite / clean up existing folder
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
    } catch (_) {}
  }

  // Sanitize branch to prevent command injection
  const safeBranch = branch.replace(/[^a-zA-Z0-9-_\.]/g, '');

  // Execute git clone with clean URL and safe branch
  exec(`git clone "${cleanUrl}" "${targetDir}" --branch "${safeBranch}" --depth 1`, (err, stdout, stderr) => {
    if (err) {
      console.warn("Git clone command failed, executing HTTP fallback...", stderr);
      
      // Fallback: Try downloading zip from GitHub directly if it is a github repo
      const githubMatch = cleanUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
      if (githubMatch) {
        const owner = githubMatch[1];
        const repo = githubMatch[2].replace(/\.git$/, '');
        const zipUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/${safeBranch}.zip`;
        
        return res.status(500).json({ 
          error: `Gagal melakukan git clone dari ${cleanUrl}. Pesan error: ${err.message}. Anda bisa mencoba mendownload zip langsung: ${zipUrl}`,
          details: stderr
        });
      }

      return res.status(500).json({ error: `Gagal mengklon repositori: ${err.message}`, details: stderr });
    }

    // Verify manifest
    const manifestPath = path.join(targetDir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      // Clean up invalid extension
      fs.rmSync(targetDir, { recursive: true, force: true });
      return res.status(400).json({ error: "Instalasi gagal: File 'manifest.json' tidak ditemukan di repositori ini." });
    }

    try {
      const manifestStr = fs.readFileSync(manifestPath, "utf-8");
      // Hilangkan BOM jika ada
      const cleanStr = manifestStr.replace(/^\uFEFF/, '');
      let manifest;
      try {
        manifest = JSON.parse(cleanStr);
      } catch (parseErr: any) {
        throw new Error(`Format JSON manifest.json tidak valid: ${parseErr.message}`);
      }

      if (typeof manifest !== 'object' || manifest === null) {
        throw new Error("Manifest harus berupa objek JSON.");
      }

      // Auto-fallback property yang kurang
      if (!manifest.name) manifest.name = manifest.displayName || manifest.title || extName;
      if (!manifest.js) {
        if (fs.existsSync(path.join(targetDir, "index.js"))) {
          manifest.js = "index.js";
        } else if (fs.existsSync(path.join(targetDir, "main.js"))) {
          manifest.js = "main.js";
        } else if (fs.existsSync(path.join(targetDir, "script.js"))) {
          manifest.js = "script.js";
        } else {
          throw new Error("Manifest tidak mendefinisikan file 'js', dan file JS utama tidak dapat ditemukan secara otomatis.");
        }
      }

      // Simpan kembali manifest yang sudah diperbaiki jika perlu
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      res.json({ success: true, name: extName, manifest });
    } catch (e: any) {
      fs.rmSync(targetDir, { recursive: true, force: true });
      res.status(400).json({ error: `Manifest tidak valid: ${e.message}. Periksa repo yang Anda klon.` });
    }
  });
});

// 3. Endpoint creates a custom extension
app.post("/api/extensions/create", (req, res) => {
  const { name, displayName, description, author, version = "1.0.0", code, cssCode } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Nama folder ekstensi wajib diisi" });
  }

  const cleanFolderName = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  const targetDir = path.join(USER_EXT_DIR, cleanFolderName);

  try {
    if (fs.existsSync(targetDir)) {
      return res.status(400).json({ error: `Ekstensi dengan folder bernama '${cleanFolderName}' sudah ada` });
    }

    fs.mkdirSync(targetDir, { recursive: true });

    const manifest = {
      name: displayName || name,
      version,
      description: description || "Custom user-generated extension",
      author: author || "You",
      js: "index.js",
      css: cssCode ? "style.css" : undefined,
      loading_order: 10
    };

    const defaultCode = code || `// Custom Extension: ${displayName || name}
const { eventSource, event_types } = window.MyApp.getContext();

export function activate() {
  console.log("${displayName || name} activated!");
  
  eventSource.on(event_types.MESSAGE_RECEIVED, (msg) => {
    console.log("Custom extension received response:", msg);
  });
}
`;

    fs.writeFileSync(path.join(targetDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(targetDir, "index.js"), defaultCode);
    if (cssCode) {
      fs.writeFileSync(path.join(targetDir, "style.css"), cssCode);
    }

    res.json({ success: true, name: cleanFolderName, manifest });
  } catch (error: any) {
    res.status(500).json({ error: `Gagal membuat ekstensi: ${error.message}` });
  }
});

// 4. Endpoint deletes an extension
app.delete("/api/extensions/delete/:name", (req, res) => {
  const { name } = req.params;
  const targetDir = path.join(USER_EXT_DIR, name);

  if (!fs.existsSync(targetDir)) {
    return res.status(404).json({ error: "Ekstensi tidak ditemukan" });
  }

  try {
    fs.rmSync(targetDir, { recursive: true, force: true });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: `Gagal menghapus ekstensi: ${error.message}` });
  }
});

async function startServer() {
  // Vite dev middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
