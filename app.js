
(function () {
  "use strict";

  const API = "https://api.github.com";
  const $ = id => document.getElementById(id);

  let token = sessionStorage.getItem("mugh_token") || "";
  let user = null;
  let currentRepo = null;
  let currentBranch = "";
  let currentPath = "";
  let selectedFiles = [];
  let editingFile = null;
  let busy = false;

  const elements = {
    login: $("loginSection"),
    main: $("mainSection"),
    token: $("tokenInput"),
    connect: $("connectBtn"),
    username: $("username"),
    repos: $("repoSelect"),
    branches: $("branchSelect"),
    open: $("openRepoBtn"),
    explorer: $("explorerSection"),
    files: $("fileList"),
    breadcrumb: $("breadcrumb"),
    fileInput: $("fileInput"),
    selected: $("selectedFiles"),
    upload: $("uploadBtn"),
    status: $("status"),
    editor: $("editorSection"),
    editorContent: $("editorContent")
  };

  async function request(url, options) {
    const response = await fetch(API + url, {
      ...options,
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options && options.headers || {})
      }
    });

    const data = response.status === 204
      ? null
      : await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(
        data && data.message
          ? data.message
          : "Error HTTP " + response.status
      );
    }

    return data;
  }

  function notify(message, type) {
    elements.status.textContent = message;
    elements.status.className = "status show " +
      (type || "");

    elements.status.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
  }

  function clearNotify() {
    elements.status.textContent = "";
    elements.status.className = "status";
  }

  function setBusy(value) {
    busy = value;
    elements.upload.disabled = value || !selectedFiles.length;
    elements.connect.disabled = value;
    elements.createFolderBtn.disabled = value;
  }

  function encodePath(path) {
    return path.split("/").map(encodeURIComponent).join("/");
  }

  function repoBase() {
    if (!currentRepo) {
      throw new Error("Selecciona un repositorio.");
    }

    return "/repos/" + encodeURIComponent(currentRepo.owner.login) +
      "/" + encodeURIComponent(currentRepo.name);
  }

  function contentsUrl(path) {
    return repoBase() + "/contents/" +
      (path ? encodePath(path) : "");
  }

  async function connect() {
    const value = elements.token.value.trim();

    if (!value) {
      notify("Introduce tu token de GitHub.", "error");
      return;
    }

    token = value;
    sessionStorage.setItem("mugh_token", token);

    try {
      setBusy(true);

      const data = await request("/user");

      user = data;
      elements.username.textContent = data.login;

      elements.login.hidden = true;
      elements.main.hidden = false;

      await loadRepositories();

      notify("Conexión establecida correctamente.", "success-message");

    } catch (error) {
      token = "";
      sessionStorage.removeItem("mugh_token");
      notify("No se pudo conectar: " + error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function loadRepositories() {
    elements.repos.innerHTML =
      '<option value="">Seleccionar repositorio</option>';

    let page = 1;
    let repositories = [];

    while (page <= 10) {
      const batch = await request(
        "/user/repos?per_page=100&sort=updated&page=" + page
      );

      repositories = repositories.concat(batch);

      if (batch.length < 100) break;
      page++;
    }

    repositories.forEach(repo => {
      const option = document.createElement("option");

      option.value = repo.id;
      option.textContent =
        repo.full_name + (repo.private ? " 🔒" : "");

      option.dataset.owner = repo.owner.login;
      option.dataset.name = repo.name;
      option.dataset.branch = repo.default_branch;

      elements.repos.appendChild(option);
    });

    notify(repositories.length + " repositorios encontrados.",
      "success-message");
  }

  async function selectRepository() {
    const option = elements.repos.selectedOptions[0];

    if (!option || !option.value) {
      currentRepo = null;
      elements.branches.disabled = true;
      elements.open.disabled = true;
      return;
    }

    currentRepo = {
      id: option.value,
      owner: { login: option.dataset.owner },
      name: option.dataset.name,
      default_branch: option.dataset.branch
    };

    elements.branches.disabled = true;
    elements.open.disabled = true;
    elements.branches.innerHTML = "";

    try {
      const branches = await request(
        repoBase() + "/branches?per_page=100"
      );

      branches.forEach(branch => {
        const opt = document.createElement("option");
        opt.value = branch.name;
        opt.textContent = branch.name;
        elements.branches.appendChild(opt);
      });

      elements.branches.value = currentRepo.default_branch;
      elements.branches.disabled = false;
      elements.open.disabled = false;

    } catch (error) {
      notify("Error cargando ramas: " + error.message, "error");
    }
  }

  async function openRepository() {
    currentBranch = elements.branches.value;

    if (!currentBranch) return;

    currentPath = "";
    elements.explorer.hidden = false;
    elements.editor.hidden = true;

    await loadFiles();
  }

  function updateBreadcrumb() {
    elements.breadcrumb.replaceChildren();

    const root = document.createElement("button");
    root.textContent = "⌂ " + currentRepo.name;
    root.onclick = () => navigateTo("");
    elements.breadcrumb.appendChild(root);

    let accumulated = "";

    currentPath.split("/").filter(Boolean).forEach(part => {
      accumulated = accumulated
        ? accumulated + "/" + part
        : part;

      const path = accumulated;
      const button = document.createElement("button");

      button.textContent = " / " + part;
      button.onclick = () => navigateTo(path);

      elements.breadcrumb.appendChild(button);
    });
  }

  async function navigateTo(path) {
    currentPath = path;
    await loadFiles();
  }

  async function loadFiles() {
    clearNotify();
    elements.files.innerHTML =
      '<div class="empty">Cargando archivos...</div>';

    updateBreadcrumb();

    try {
      let files = await request(
        contentsUrl(currentPath) +
        "?ref=" + encodeURIComponent(currentBranch)
      );

      if (!Array.isArray(files)) files = [files];

      files.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === "dir" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      elements.files.replaceChildren();

      if (currentPath) {
        const back = document.createElement("div");
        back.className = "file-item";

        const backButton = document.createElement("button");
        backButton.textContent = "⬆ Volver";
        backButton.className = "secondary";
        backButton.onclick = () => {
          const parts = currentPath.split("/");
          parts.pop();
          navigateTo(parts.join("/"));
        };

        back.appendChild(backButton);
        elements.files.appendChild(back);
      }

      if (!files.length) {
        elements.files.innerHTML =
          '<div class="empty">Esta carpeta está vacía.</div>';
        return;
      }

      files.forEach(file => {
        const item = document.createElement("div");
        item.className = "file-item";

        const name = document.createElement("div");
        name.className = "file-name";

        const title = document.createElement("strong");
        title.textContent =
          (file.type === "dir" ? "📁 " : "📄 ") + file.name;

        const detail = document.createElement("small");
        detail.textContent = file.type === "dir"
          ? "Carpeta"
          : formatSize(file.size);

        name.append(title, detail);

        const actions = document.createElement("div");
        actions.className = "file-actions";

        if (file.type === "dir") {
          const enter = document.createElement("button");
          enter.textContent = "Abrir";
          enter.onclick = () =>
            navigateTo(currentPath
              ? currentPath + "/" + file.name
              : file.name);
          actions.appendChild(enter);
        } else {
          const download = document.createElement("button");
          download.textContent = "↓";
          download.title = "Descargar";
          download.onclick = () => downloadFile(file);

          const edit = document.createElement("button");
          edit.textContent = "✎";
          edit.title = "Editar texto";
          edit.onclick = () => editFile(file);

          actions.append(download, edit);
        }

        const remove = document.createElement("button");
        remove.textContent = "🗑";
        remove.title = "Eliminar";
        remove.onclick = () => deleteFile(file);

        actions.appendChild(remove);
        item.append(name, actions);
        elements.files.appendChild(item);
      });

    } catch (error) {
      elements.files.innerHTML =
        '<div class="empty">No se pudieron cargar los archivos.</div>';

      notify("Error: " + error.message, "error");
    }
  }

  function formatSize(bytes) {
    if (!bytes) return "0 bytes";

    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(
      Math.floor(Math.log(bytes) / Math.log(1024)),
      3
    );

    return (bytes / Math.pow(1024, index)).toFixed(2) +
      " " + units[index];
  }

  function readAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        const result = reader.result;
        resolve(result.split(",")[1]);
      };

      reader.onerror = () =>
        reject(new Error("No se pudo leer " + file.name));

      reader.readAsDataURL(file);
    });
  }

  async function getExistingFile(path) {
    try {
      const result = await request(
        contentsUrl(path) +
        "?ref=" + encodeURIComponent(currentBranch)
      );

      return result.sha;

    } catch (error) {
      if (error.message.includes("404") ||
          error.message.toLowerCase().includes("not found")) {
        return null;
      }
      throw error;
    }
  }

  async function saveFile(path, content, sha, message) {
    const body = {
      message: message,
      content: content,
      branch: currentBranch
    };

    if (sha) body.sha = sha;

    return request(contentsUrl(path), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
  }

  function displaySelectedFiles() {
    elements.selected.replaceChildren();

    selectedFiles.forEach((file, index) => {
      const item = document.createElement("div");
      item.className = "selected-item";

      const text = document.createElement("span");
      text.textContent = file.name + " · " + formatSize(file.size);

      const remove = document.createElement("button");
      remove.textContent = " ✕";
      remove.className = "danger-outline";
      remove.onclick = () => {
        selectedFiles.splice(index, 1);
        displaySelectedFiles();
      };

      item.append(text, remove);
      elements.selected.appendChild(item);
    });

    elements.upload.disabled = !selectedFiles.length || busy;
  }

  async function uploadFiles() {
    if (!selectedFiles.length || busy) return;

    const files = selectedFiles.slice();
    const overwrite = new Map();

    try {
      setBusy(true);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (file.size > 25 * 1024 * 1024) {
          throw new Error(
            file.name + " supera el límite recomendado de 25 MB."
          );
        }

        const path = currentPath
          ? currentPath + "/" + file.name
          : file.name;

        const existingSha = await getExistingFile(path);

        if (existingSha) {
          if (!overwrite.has(path)) {
            const accepted = confirm(
              "El archivo " + file.name +
              " ya existe. ¿Quieres sobrescribirlo?"
            );

            if (!accepted) {
              notify("Se omitió " + file.name, "error");
              continue;
            }

            overwrite.set(path, true);
          }
        }

        notify(
          "Subiendo " + (i + 1) + " de " + files.length +
          ": " + file.name
        );

        const base64 = await readAsBase64(file);

        await saveFile(
          path,
          base64,
          existingSha,
          (existingSha ? "Actualizar " : "Subir ") + file.name
        );
      }

      selectedFiles = [];
      displaySelectedFiles();
      elements.fileInput.value = "";

      await loadFiles();

      notify("Proceso de subida finalizado.", "success-message");

    } catch (error) {
      notify("Error al subir: " + error.message, "error");
    } finally {
      setBusy(false);
      displaySelectedFiles();
    }
  }

  async function createFolder() {
    const name = $("folderName").value.trim();

    if (!name || name.includes("/") ||
        name === "." || name === "..") {
      notify("Introduce un nombre de carpeta válido.", "error");
      return;
    }

    const path = currentPath
      ? currentPath + "/" + name + "/.gitkeep"
      : name + "/.gitkeep";

    try {
      const existing = await getExistingFile(path);

      if (existing) {
        notify("La carpeta ya existe.", "error");
        return;
      }

      await saveFile(
        path,
        "Cg==",
        null,
        "Crear carpeta " + name
      );

      $("folderName").value = "";
      await loadFiles();

      notify("Carpeta creada correctamente.", "success-message");

    } catch (error) {
      notify("Error creando carpeta: " + error.message, "error");
    }
  }

  async function downloadFile(file) {
    try {
      const data = await request(
        contentsUrl(file.path) +
        "?ref=" + encodeURIComponent(currentBranch)
      );

      if (data.download_url) {
        const link = document.createElement("a");
        link.href = data.download_url;
        link.download = file.name;
        link.target = "_blank";
        link.rel = "noopener";
        link.click();
        return;
      }

      throw new Error("No hay enlace de descarga disponible.");

    } catch (error) {
      notify("Error descargando: " + error.message, "error");
    }
  }

  async function deleteFile(file) {
    if (!confirm("¿Eliminar definitivamente " + file.name + "?")) {
      return;
    }

    try {
      await request(contentsUrl(file.path), {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: "Eliminar " + file.name,
          sha: file.sha,
          branch: currentBranch
        })
      });

      await loadFiles();
      notify("Archivo eliminado.", "success-message");

    } catch (error) {
      notify("Error eliminando: " + error.message, "error");
    }
  }

  async function editFile(file) {
    try {
      const data = await request(
        contentsUrl(file.path) +
        "?ref=" + encodeURIComponent(currentBranch)
      );

      if (data.encoding !== "base64" || !data.content) {
        throw new Error("Formato de archivo no compatible con el editor.");
      }

      const binary = atob(data.content.replace(/\s/g, ""));
      const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      const content = new TextDecoder("utf-8", {
        fatal: true
      }).decode(bytes);

      if (content.includes("\u0000")) {
        throw new Error("Este archivo parece ser binario.");
      }

      editingFile = {
        path: file.path,
        sha: data.sha
      };

      $("editorFilename").textContent = file.path;
      elements.editorContent.value = content;
      elements.editor.hidden = false;

      elements.editor.scrollIntoView({
        behavior: "smooth"
      });

    } catch (error) {
      notify("No se puede editar: " + error.message, "error");
    }
  }

  async function saveEditor() {
    if (!editingFile) return;

    try {
      const bytes = new TextEncoder().encode(
        elements.editorContent.value
      );

      let binary = "";
      const chunkSize = 8192;

      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(
          ...bytes.subarray(i, i + chunkSize)
        );
      }

      const base64 = btoa(binary);

      await saveFile(
        editingFile.path,
        base64,
        editingFile.sha,
        "Editar " + editingFile.path.split("/").pop()
      );

      elements.editor.hidden = true;
      editingFile = null;

      await loadFiles();

      notify("Cambios guardados correctamente.", "success-message");

    } catch (error) {
      notify("Error guardando: " + error.message, "error");
    }
  }

  function logout() {
    if (!confirm("¿Desconectar MUGH de GitHub?")) return;

    token = "";
    user = null;
    currentRepo = null;

    sessionStorage.removeItem("mugh_token");

    location.reload();
  }

  // Eventos

  elements.connect.addEventListener("click", connect);

  $("logoutBtn").addEventListener("click", logout);

  $("refreshReposBtn").addEventListener("click", async () => {
    try {
      await loadRepositories();
    } catch (error) {
      notify(error.message, "error");
    }
  });

  elements.repos.addEventListener("change", selectRepository);
  elements.open.addEventListener("click", openRepository);

  $("refreshFilesBtn").addEventListener("click", loadFiles);

  $("selectFilesBtn").addEventListener("click", () => {
    elements.fileInput.click();
  });

  elements.fileInput.addEventListener("change", event => {
    const incoming = Array.from(event.target.files || []);

    incoming.forEach(file => {
      if (!selectedFiles.some(item =>
        item.name === file.name &&
        item.size === file.size &&
        item.lastModified === file.lastModified
      )) {
        selectedFiles.push(file);
      }
    });

    displaySelectedFiles();
  });

  elements.upload.addEventListener("click", uploadFiles);

  $("createFolderBtn").addEventListener("click", createFolder);

  $("saveEditorBtn").addEventListener("click", saveEditor);

  $("closeEditorBtn").addEventListener("click", () => {
    elements.editor.hidden = true;
    editingFile = null;
  });

  $("settingsBtn").addEventListener("click", () => {
    alert(
      "MUGH\n\n" +
      "GitHub Mobile Manager\n" +
      "Versión 1.0\n\n" +
      "La conexión utiliza la API oficial de GitHub."
    );
  });

  // Recuperar sesión activa

  if (token) {
    elements.token.value = token;
    connect();
  }

})();
      
