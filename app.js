
(function () {
  "use strict";

  var API = "https://api.github.com";
  var token = "";
  var username = "";
  var repositories = [];
  var currentRepo = null;
  var currentPath = "";
  var currentFile = null;
  var currentBranch = "";
  var currentItems = [];
  var busy = false;

  function $(id) {
    return document.getElementById(id);
  }

  function status(message) {
    $("status").textContent = message || "";
  }

  function headers(extra) {
    var result = {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28"
    };

    Object.keys(extra || {}).forEach(function (key) {
      result[key] = extra[key];
    });

    return result;
  }

  function request(url, options) {
    options = options || {};
    options.headers = headers(options.headers);

    return fetch(API + url, options).then(function (response) {
      if (response.status === 204) return null;

      return response.text().then(function (text) {
        var data = {};

        try {
          data = text ? JSON.parse(text) : {};
        } catch (_) {}

        if (!response.ok) {
          throw new Error(
            data.message || ("Error HTTP " + response.status)
          );
        }

        return data;
      });
    });
  }

  function encodePath(path) {
    return path.split("/").map(function (part) {
      return encodeURIComponent(part);
    }).join("/");
  }

  function repoUrl(suffix) {
    return "/repos/" +
      encodeURIComponent(currentRepo.owner.login) + "/" +
      encodeURIComponent(currentRepo.name) + (suffix || "");
  }

  function base64FromBytes(bytes) {
    var binary = "";
    var chunkSize = 8192;

    for (var i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(
        null,
        bytes.subarray(i, i + chunkSize)
      );
    }

    return btoa(binary);
  }

  function textToBase64(text) {
    return base64FromBytes(new TextEncoder().encode(text));
  }

  function base64ToText(base64) {
    var binary = atob(base64.replace(/\s/g, ""));
    var bytes = new Uint8Array(binary.length);

    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }

  function setBusy(value) {
    busy = value;
    $("loginBtn").disabled = value;
    $("refreshBtn").disabled = value;
  }

  function showWorkspace() {
    $("loginView").hidden = true;
    $("workspace").hidden = false;
    $("userLabel").textContent = "@" + username;
  }

  function showLogin() {
    token = "";
    username = "";
    repositories = [];
    currentRepo = null;
    currentFile = null;
    currentPath = "";
    currentBranch = "";
    currentItems = [];

    $("loginView").hidden = false;
    $("workspace").hidden = true;
    $("userLabel").textContent = "Sin sesión";
    $("token").value = "";
    $("repoList").replaceChildren();
    $("fileList").replaceChildren();
    $("editor").hidden = true;
    $("repoTitle").textContent = "Selecciona un repositorio";
    $("pathLabel").textContent = "Archivos y carpetas";
    $("repoSearch").value = "";
    $("upBtn").disabled = true;
    $("newBtn").disabled = true;
    $("uploadBtn").disabled = true;
    status("");
  }

  function login() {
    if (busy) return;

    token = $("token").value.trim();

    if (!token) {
      status("Pega tu token antes de iniciar sesión.");
      return;
    }

    setBusy(true);
    status("Verificando token…");

    request("/user").then(function (user) {
      username = user.login;
      showWorkspace();
      return loadRepositories();
    }).then(function () {
      status("Sesión iniciada correctamente.");
    }).catch(function (error) {
      token = "";
      username = "";
      $("loginView").hidden = false;
      $("workspace").hidden = true;
      status("No se pudo iniciar sesión: " + error.message);
    }).finally(function () {
      setBusy(false);
      $("token").value = "";
    });
  }

  function loadRepositories() {
    status("Cargando repositorios…");

    var page = 1;
    var all = [];

    function nextPage() {
      return request(
        "/user/repos?affiliation=owner,collaborator,organization" +
        "&sort=updated&per_page=100&page=" + page
      ).then(function (items) {
        all = all.concat(items);

        if (items.length === 100 && page < 10) {
          page++;
          return nextPage();
        }
      });
    }

    return nextPage().then(function () {
      repositories = all;
      renderRepositories();
      status(repositories.length + " repositorios cargados.");
    });
  }

  function renderRepositories() {
    var query = $("repoSearch").value.trim().toLowerCase();
    var list = $("repoList");

    list.replaceChildren();

    repositories.filter(function (repo) {
      return (repo.full_name + " " + (repo.description || ""))
        .toLowerCase().indexOf(query) !== -1;
    }).forEach(function (repo) {
      var item = document.createElement("div");
      item.className = "repo-item";

      var title = document.createElement("strong");
      title.textContent = repo.full_name;

      var description = document.createElement("small");
      description.textContent = repo.description || "Sin descripción";

      item.append(title, description);

      item.addEventListener("click", function () {
        selectRepository(repo);
      });

      list.appendChild(item);
    });

    if (!list.children.length) {
      list.textContent = "No se encontraron repositorios.";
    }
  }

  function selectRepository(repo) {
    currentRepo = repo;
    currentPath = "";
    currentFile = null;
    currentItems = [];

    $("repoTitle").textContent = repo.full_name;
    $("upBtn").disabled = false;
    $("newBtn").disabled = false;
    $("uploadBtn").disabled = false;
    $("editor").hidden = true;

    request(repoUrl("/branches/" + encodeURIComponent(repo.default_branch)))
      .then(function (branch) {
        currentBranch = branch.name;
        return browse("");
      })
      .catch(function (error) {
        status("No se pudo abrir el repositorio: " + error.message);
      });
  }

  function browse(path) {
    currentPath = path || "";
    currentFile = null;
    $("pathLabel").textContent = "/" + currentPath;
    $("fileList").replaceChildren();
    $("fileList").textContent = "Cargando…";
    $("editor").hidden = true;

    var suffix = "/contents" +
      (currentPath ? "/" + encodePath(currentPath) : "") +
      "?ref=" + encodeURIComponent(currentBranch);

    return request(repoUrl(suffix)).then(function (items) {
      currentItems = Array.isArray(items) ? items : [items];
      renderFiles();
    }).catch(function (error) {
      $("fileList").replaceChildren();
      status("No se pudieron cargar los archivos: " + error.message);
    });
  }

  function formatSize(size) {
    if (size == null) return "Archivo";
    if (size < 1024) return size + " B";
    if (size < 1048576) return (size / 1024).toFixed(1) + " KB";
    return (size / 1048576).toFixed(1) + " MB";
  }

  function renderFiles() {
    var list = $("fileList");
    list.replaceChildren();

    if (currentPath) {
      var parent = document.createElement("button");
      parent.className = "secondary";
      parent.textContent = "↑ Carpeta superior";
      parent.addEventListener("click", goUp);
      list.appendChild(parent);
    }

    currentItems.sort(function (a, b) {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    }).forEach(function (file) {
      var item = document.createElement("div");
      item.className = "file-item";

      var label = document.createElement("span");
      label.textContent =
        (file.type === "dir" ? "📁 " : "📄 ") + file.name;

      var kind = document.createElement("span");
      kind.className = "kind";
      kind.textContent = file.type === "dir"
        ? "Carpeta"
        : formatSize(file.size);

      item.append(label, kind);

      item.addEventListener("click", function () {
        if (file.type === "dir") {
          browse(file.path);
        } else {
          openFile(file);
        }
      });

      list.appendChild(item);
    });

    if (!currentItems.length) {
      var empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Carpeta vacía.";
      list.appendChild(empty);
    }
  }

  function goUp() {
    if (!currentPath) return;

    var parts = currentPath.split("/");
    parts.pop();
    browse(parts.join("/"));
  }

  function openFile(file) {
    currentFile = file;
    status("Abriendo " + file.name + "…");

    request(repoUrl(
      "/contents/" + encodePath(file.path) +
      "?ref=" + encodeURIComponent(currentBranch)
    )).then(function (data) {
      if (data.encoding !== "base64" || !data.content) {
        throw new Error(
          "GitHub no devolvió contenido editable para este archivo."
        );
      }

      var text = base64ToText(data.content);

      $("editorPath").textContent = data.path;
      $("fileContent").value = text;
      $("commitMessage").value = "Actualizar " + file.name;
      $("editor").hidden = false;
      $("deleteBtn").hidden = false;
      $("saveBtn").disabled = false;

      status("Archivo abierto.");
    }).catch(function (error) {
      currentFile = null;
      status(
        "No se pudo editar el archivo: " + error.message +
        ". Los archivos binarios no se pueden editar como texto."
      );
    });
  }

  function createFile() {
    if (!currentRepo) return;

    var name = prompt(
      "Nombre del archivo. También puedes indicar carpeta/archivo.ext:"
    );

    if (!name) return;

    name = name.trim().replace(/^\/+/, "");

    if (!name || name.split("/").some(function (part) {
      return !part || part === "." || part === "..";
    })) {
      status("Nombre de archivo no válido.");
      return;
    }

    var path = currentPath ? currentPath + "/" + name : name;

    currentFile = { path: path, sha: null };

    $("editorPath").textContent = path;
    $("fileContent").value = "";
    $("commitMessage").value = "Crear " + name.split("/").pop();
    $("editor").hidden = false;
    $("deleteBtn").hidden = true;
    $("saveBtn").disabled = false;
    $("fileContent").focus();
  }

  function saveFile() {
    if (!currentRepo || !currentFile) return;

    var content = textToBase64($("fileContent").value);
    var message = $("commitMessage").value.trim();

    if (!message) {
      status("Escribe un mensaje para el commit.");
      return;
    }

    var file = currentFile;
    var path = file.path;

    $("saveBtn").disabled = true;
    status("Guardando cambios…");

    var payload = {
      message: message,
      content: content,
      branch: currentBranch
    };

    if (file.sha) payload.sha = file.sha;

    request(repoUrl("/contents/" + encodePath(path)), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function () {
      status("Commit guardado correctamente.");
      currentFile = null;
      $("editor").hidden = true;
      return browse(currentPath);
    }).catch(function (error) {
      status("No se pudo guardar: " + error.message);
    }).finally(function () {
      $("saveBtn").disabled = false;
    });
  }

  function deleteFile() {
    if (!currentRepo || !currentFile || !currentFile.sha) return;

    var file = currentFile;

    if (!confirm(
      "¿Eliminar " + file.path +
      " del repositorio? Se creará un commit."
    )) return;

    $("deleteBtn").disabled = true;
    status("Eliminando archivo…");

    request(repoUrl("/contents/" + encodePath(file.path)), {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Eliminar " + file.path,
        sha: file.sha,
        branch: currentBranch
      })
    }).then(function () {
      status("Archivo eliminado.");
      currentFile = null;
      $("editor").hidden = true;
      return browse(currentPath);
    }).catch(function (error) {
      status("No se pudo eliminar: " + error.message);
    }).finally(function () {
      $("deleteBtn").disabled = false;
    });
  }

  function uploadFiles(fileList) {
    if (!currentRepo || !fileList.length) return;

    var files = Array.prototype.slice.call(fileList);
    var index = 0;
    var uploaded = 0;

    function uploadNext() {
      if (index >= files.length) {
        status("Subida completada: " + uploaded + " archivo(s).");
        return browse(currentPath);
      }

      var file = files[index++];
      var path = currentPath ? currentPath + "/" + file.name : file.name;

      status("Subiendo " + index + "/" + files.length + ": " + file.name);

      return file.arrayBuffer().then(function (buffer) {
        var content = base64FromBytes(new Uint8Array(buffer));

        return request(repoUrl("/contents/" + encodePath(path)), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "Subir " + file.name,
            content: content,
            branch: currentBranch
          })
        });
      }).then(function () {
        uploaded++;
        return uploadNext();
      }).catch(function (error) {
        status(
          "Error al subir " + file.name + ": " + error.message +
          ". Se subieron " + uploaded + " de " + files.length +
          " archivos; revisa el repositorio antes de reintentar."
        );
      });
    }

    uploadNext();
  }

  $("loginBtn").addEventListener("click", login);

  $("token").addEventListener("keydown", function (event) {
    if (event.key === "Enter") login();
  });

  $("repoSearch").addEventListener("input", renderRepositories);

  $("refreshBtn").addEventListener("click", function () {
    loadRepositories().catch(function (error) {
      status("Error al actualizar: " + error.message);
    });

    if (currentRepo) browse(currentPath);
  });

  $("logoutBtn").addEventListener("click", showLogin);
  $("upBtn").addEventListener("click", goUp);
  $("newBtn").addEventListener("click", createFile);

  $("uploadBtn").addEventListener("click", function () {
    $("filePicker").click();
  });

  $("filePicker").addEventListener("change", function () {
    uploadFiles($("filePicker").files);
    $("filePicker").value = "";
  });

  $("saveBtn").addEventListener("click", saveFile);
  $("deleteBtn").addEventListener("click", deleteFile);

  $("closeEditorBtn").addEventListener("click", function () {
    currentFile = null;
    $("editor").hidden = true;
  });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js").catch(function () {});
    });
  }
})();
