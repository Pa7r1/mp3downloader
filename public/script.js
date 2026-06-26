class ImprovedYouTubeDownloader {
  constructor() {
    this.initializeElements();
    this.initializeState();
    this.initEventListeners();
    this.initProgressSystem();
  }

  initializeElements() {
    this.downloadBtn = document.getElementById("download-btn");
    this.previewBtn = document.getElementById("preview-btn");
    this.urlInput = document.getElementById("url");
    this.previewContainer = document.getElementById("preview-container");
    this.videoPreview = document.getElementById("video-preview");
    this.videoInfo = document.getElementById("video-info");
    this.progressBar = document.getElementById("progress-bar");
    this.progressText = document.getElementById("progress-text");
    this.queueList = document.getElementById("queue-list");

    this.videoFormat = document.querySelector(
      'input[name="format"][value="video"]'
    );
    this.audioFormat = document.querySelector(
      'input[name="format"][value="audio"]'
    );
    this.videoQuality = document.getElementById("video-quality");
    this.audioQuality = document.getElementById("audio-quality");
  }

  initializeState() {
    this.downloadQueue = [];
    this.currentDownload = null;
    this.isProcessing = false;
    this.videoInfoCache = new Map();
    this.currentContentType = null; // 'video' o 'playlist'
    this.currentPlaylistData = null;

    this.progressSteps = {
      INITIALIZING: { weight: 5, label: "Iniciando descarga..." },
      FETCHING_INFO: { weight: 10, label: "Obteniendo información..." },
      DOWNLOADING: { weight: 60, label: "Descargando contenido..." },
      PROCESSING: { weight: 20, label: "Procesando archivo..." },
      FINALIZING: { weight: 5, label: "Finalizando..." },
    };

    this.currentStep = null;
    this.stepProgress = 0;
  }

  initProgressSystem() {
    this.progressController = {
      currentStep: null,
      stepProgress: 0,
      totalProgress: 0,

      setStep: (step, progress = 0) => {
        this.currentStep = step;
        this.stepProgress = progress;
        this.calculateTotalProgress();
        this.updateProgressUI();
      },

      updateStepProgress: (progress) => {
        this.stepProgress = Math.min(100, Math.max(0, progress));
        this.calculateTotalProgress();
        this.updateProgressUI();
      },
    };
  }

  calculateTotalProgress() {
    if (!this.currentStep) return 0;

    const steps = Object.keys(this.progressSteps);
    const currentIndex = steps.indexOf(this.currentStep);

    let totalWeight = 0;
    let completedWeight = 0;

    steps.forEach((step, index) => {
      const weight = this.progressSteps[step].weight;
      totalWeight += weight;

      if (index < currentIndex) {
        completedWeight += weight;
      } else if (index === currentIndex) {
        completedWeight += (weight * this.stepProgress) / 100;
      }
    });

    this.totalProgress = Math.round((completedWeight / totalWeight) * 100);
  }

  updateProgressUI() {
    const progressBar = document.getElementById("progress-bar");
    const progressText = document.getElementById("progress-text");
    const progressLabel = document.getElementById("progress-label");

    if (progressBar) {
      progressBar.style.width = `${this.totalProgress}%`;
      progressBar.style.transition = "width 0.3s ease";
    }

    if (progressText) {
      progressText.textContent = `${this.totalProgress}%`;
    }

    if (progressLabel && this.currentStep) {
      progressLabel.textContent = this.progressSteps[this.currentStep].label;
      progressLabel.style.opacity = "1";
    }

    if (this.currentDownload) {
      this.currentDownload.progress = this.totalProgress;
      this.currentDownload.status = this.getStatusFromStep(this.currentStep);
      this.renderQueue();
    }
  }

  getStatusFromStep(step) {
    const statusMap = {
      INITIALIZING: "initializing",
      FETCHING_INFO: "fetching",
      DOWNLOADING: "downloading",
      PROCESSING: "converting",
      FINALIZING: "finalizing",
    };
    return statusMap[step] || "downloading";
  }

  initEventListeners() {
    this.previewBtn.addEventListener(
      "click",
      this.handlePreviewClick.bind(this)
    );
    this.downloadBtn.addEventListener(
      "click",
      this.handleDownloadClick.bind(this)
    );

    this.videoFormat.addEventListener(
      "change",
      this.handleFormatChange.bind(this)
    );
    this.audioFormat.addEventListener(
      "change",
      this.handleFormatChange.bind(this)
    );

    this.urlInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.handlePreviewClick();
    });

    this.urlInput.addEventListener(
      "input",
      this.debounce(() => this.validateURLWithAnimation(), 300)
    );
  }

  validateURLWithAnimation() {
    const url = this.urlInput.value.trim();
    const isValid = url && this.isValidYouTubeURL(url);

    this.urlInput.classList.toggle("invalid", url && !isValid);
    this.urlInput.classList.toggle("valid", isValid);

    this.previewBtn.disabled = !isValid;

    if (isValid) {
      this.previewBtn.style.transform = "scale(1.02)";
      setTimeout(() => (this.previewBtn.style.transform = ""), 150);
    }
  }

  async handlePreviewClick() {
    if (this.isProcessing) return;

    const url = this.getCleanURL();
    if (!url) {
      this.showNotification(
        "Por favor, ingresa una URL de YouTube válida.",
        "error"
      );
      return;
    }

    this.setLoadingState(true);

    try {
      await this.detectAndPreview(url);
    } catch (error) {
      this.showNotification(`Error: ${error.message}`, "error");
    } finally {
      this.setLoadingState(false);
    }
  }

  async detectAndPreview(url) {
    this.previewContainer.style.opacity = "0";
    this.previewContainer.style.display = "block";

    try {
      const response = await fetch("/detect-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Error HTTP: ${response.status}`);
      }

      const result = await response.json();

      if (result.type === "playlist") {
        this.currentContentType = "playlist";
        this.currentPlaylistData = result.data;
        this.renderPlaylistPreview(result.data);
      } else {
        this.currentContentType = "video";
        this.currentPlaylistData = null;
        this.renderVideoPreview(result.data);
        this.videoInfoCache.set(url, result.data);
      }

      this.previewContainer.style.transition = "opacity 0.3s ease";
      this.previewContainer.style.opacity = "1";
    } catch (error) {
      this.previewContainer.style.display = "none";
      throw error;
    }
  }

  renderPlaylistPreview(playlistData) {
    this.videoPreview.innerHTML = `
      <div class="playlist-preview">
        <img src="${playlistData.thumbnail}" alt="${this.escapeHtml(
      playlistData.title
    )}" 
             style="width: 100%; max-height: 300px; object-fit: cover; border-radius: 8px;">
        <div class="playlist-badge">
          <i class="fas fa-list"></i> PLAYLIST
        </div>
      </div>
    `;

    this.videoInfo.innerHTML = `
      <h3><i class="fas fa-list"></i> ${this.escapeHtml(
        playlistData.title
      )}</h3>
      <div class="video-meta">
        <p><i class="fas fa-video"></i> ${playlistData.videoCount} videos</p>
        <p><i class="fas fa-user"></i> ${this.escapeHtml(
          playlistData.channel
        )}</p>
      </div>
      <div class="playlist-actions">
        <button class="btn-playlist-preview" onclick="downloader.showPlaylistVideos()">
          <i class="fas fa-eye"></i> Ver videos
        </button>
        <button class="btn-playlist-download" onclick="downloader.downloadFullPlaylist()">
          <i class="fas fa-download"></i> Descargar todos
        </button>
      </div>
    `;
  }

  showPlaylistVideos() {
    if (!this.currentPlaylistData) return;

    const modalHTML = `
      <div class="modal-overlay" id="playlistModal">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Videos en la Playlist</h3>
            <button class="modal-close" onclick="downloader.closePlaylistModal()">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="modal-body">
            <div class="playlist-videos-list">
              ${this.currentPlaylistData.videos
                .map(
                  (video, index) => `
                <div class="playlist-video-item" data-video-id="${video.id}">
                  <input type="checkbox" id="video-${video.id}" checked>
                  <label for="video-${video.id}">
                    <span class="video-number">${index + 1}</span>
                    <img src="${video.thumbnail}" alt="${this.escapeHtml(
                    video.title
                  )}">
                    <div class="video-details">
                      <p class="video-title">${this.escapeHtml(video.title)}</p>
                      <p class="video-duration">${video.duration}</p>
                    </div>
                  </label>
                </div>
              `
                )
                .join("")}
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-select-all" onclick="downloader.toggleAllVideos()">
              <i class="fas fa-check-double"></i> Seleccionar todos
            </button>
            <button class="btn-download-selected" onclick="downloader.downloadSelectedVideos()">
              <i class="fas fa-download"></i> Descargar seleccionados
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML("beforeend", modalHTML);
  }

  toggleAllVideos() {
    const checkboxes = document.querySelectorAll(
      '#playlistModal input[type="checkbox"]'
    );
    const allChecked = Array.from(checkboxes).every((cb) => cb.checked);
    checkboxes.forEach((cb) => (cb.checked = !allChecked));
  }

  downloadSelectedVideos() {
    const checkedBoxes = document.querySelectorAll(
      '#playlistModal input[type="checkbox"]:checked'
    );
    const selectedIds = Array.from(checkedBoxes).map((cb) =>
      cb.id.replace("video-", "")
    );

    if (selectedIds.length === 0) {
      this.showNotification("No hay videos seleccionados", "warning");
      return;
    }

    this.closePlaylistModal();
    this.addPlaylistToQueue(selectedIds);
  }

  downloadFullPlaylist() {
    if (!this.currentPlaylistData) return;
    this.addPlaylistToQueue();
  }

  addPlaylistToQueue(videoIds = null) {
    const format = document.querySelector('input[name="format"]:checked').value;
    const quality =
      format === "video" ? this.videoQuality.value : this.audioQuality.value;

    const videosToDownload = videoIds
      ? this.currentPlaylistData.videos.filter((v) => videoIds.includes(v.id))
      : this.currentPlaylistData.videos;

    videosToDownload.forEach((video) => {
      const downloadItem = {
        id: Date.now() + Math.random(),
        url: video.url,
        format,
        quality,
        status: "queued",
        title: video.title,
        progress: 0,
        addedAt: new Date(),
        estimatedTime: null,
        isFromPlaylist: true,
      };

      this.downloadQueue.push(downloadItem);
    });

    this.renderQueueWithAnimation();
    this.showNotification(
      `${videosToDownload.length} videos agregados a la cola`,
      "success"
    );

    if (!this.currentDownload) {
      this.processNextDownload();
    }
  }

  closePlaylistModal() {
    const modal = document.getElementById("playlistModal");
    if (modal) {
      modal.style.opacity = "0";
      setTimeout(() => modal.remove(), 300);
    }
  }

  handleDownloadClick() {
    if (this.isProcessing) return;

    const url = this.getCleanURL();
    if (!url) {
      this.showNotification(
        "Por favor, ingresa una URL de YouTube válida.",
        "error"
      );
      return;
    }

    if (this.currentContentType === "playlist") {
      this.downloadFullPlaylist();
    } else {
      this.addToQueue(url);
      this.showNotification("Agregado a la cola de descarga", "success");
    }
  }

  addToQueue(url) {
    const format = document.querySelector('input[name="format"]:checked').value;
    const quality =
      format === "video" ? this.videoQuality.value : this.audioQuality.value;

    const downloadItem = {
      id: Date.now(),
      url,
      format,
      quality,
      status: "queued",
      title: "Obteniendo información...",
      progress: 0,
      addedAt: new Date(),
      estimatedTime: null,
    };

    this.downloadQueue.push(downloadItem);
    this.renderQueueWithAnimation();

    if (!this.currentDownload) {
      this.processNextDownload();
    }

    this.fetchAndUpdateTitle(url, downloadItem.id);
    this.clearInput();
  }

  renderQueueWithAnimation() {
    this.renderQueue();

    const newItems = this.queueList.querySelectorAll(".queue-item:last-child");
    newItems.forEach((item) => {
      item.style.opacity = "0";
      item.style.transform = "translateY(20px)";

      setTimeout(() => {
        item.style.transition = "opacity 0.3s ease, transform 0.3s ease";
        item.style.opacity = "1";
        item.style.transform = "translateY(0)";
      }, 10);
    });
  }

  renderQueue() {
    if (!this.queueList) return;

    this.queueList.innerHTML = "";

    this.downloadQueue.forEach((item, index) => {
      const li = document.createElement("li");
      li.className = `queue-item status-${item.status}`;
      li.dataset.itemId = item.id;

      li.innerHTML = `
        <div class="queue-item-header">
          <div class="queue-item-title" title="${this.escapeHtml(item.title)}">
            <i class="fas ${this.getFormatIcon(item.format)}"></i>
            ${this.escapeHtml(this.truncateText(item.title, 45))}
          </div>
          <div class="queue-item-actions">
            ${
              index === 0 && item.status !== "completed"
                ? '<button class="btn-cancel" onclick="downloader.cancelDownload(' +
                  item.id +
                  ')"><i class="fas fa-times"></i></button>'
                : '<button class="btn-remove" onclick="downloader.removeFromQueue(' +
                  item.id +
                  ')"><i class="fas fa-trash"></i></button>'
            }
          </div>
        </div>
        
        <div class="queue-item-details">
          <span class="format-badge ${
            item.format
          }">${item.format.toUpperCase()}</span>
          <span class="quality-badge">${item.quality}</span>
          <span class="status-text">${this.getStatusText(item.status)}</span>
          ${
            item.estimatedTime
              ? `<span class="eta">ETA: ${item.estimatedTime}</span>`
              : ""
          }
        </div>
        
        <div class="queue-item-progress">
          <div class="progress-bar-small">
            <div class="progress-fill ${this.getProgressClass(item.status)}" 
                 style="width: ${item.progress}%"></div>
          </div>
          <span class="progress-text">${item.progress}%</span>
        </div>
      `;

      this.queueList.appendChild(li);
    });
  }

  getFormatIcon(format) {
    return format === "video" ? "fa-film" : "fa-music";
  }

  getProgressClass(status) {
    const classMap = {
      queued: "progress-queued",
      initializing: "progress-active",
      fetching: "progress-active",
      downloading: "progress-downloading",
      converting: "progress-converting",
      finalizing: "progress-active",
      completed: "progress-completed",
      error: "progress-error",
    };
    return classMap[status] || "progress-default";
  }

  getStatusText(status) {
    const statusMap = {
      queued: "En cola",
      initializing: "Iniciando",
      fetching: "Obteniendo info",
      downloading: "Descargando",
      converting: "Convirtiendo",
      finalizing: "Finalizando",
      completed: "Completado",
      error: "Error",
    };
    return statusMap[status] || status;
  }

  async processNextDownload() {
    if (this.downloadQueue.length === 0) {
      this.currentDownload = null;
      this.isProcessing = false;
      this.resetProgressUI();
      return;
    }

    this.isProcessing = true;
    this.currentDownload = this.downloadQueue[0];
    this.downloadBtn.disabled = true;

    try {
      await this.downloadItemWithDetailedProgress(this.currentDownload);

      this.currentDownload.status = "completed";
      this.currentDownload.progress = 100;
      this.showNotification("Descarga completada", "success");

      setTimeout(() => {
        this.downloadQueue.shift();
        this.renderQueue();
        this.processNextDownload();
      }, 3000);
    } catch (error) {
      console.error("Error en descarga:", error);
      this.currentDownload.status = "error";
      this.showNotification(`Error: ${error.message}`, "error");

      setTimeout(() => {
        this.downloadQueue.shift();
        this.renderQueue();
        this.processNextDownload();
      }, 5000);
    } finally {
      this.downloadBtn.disabled = false;
    }
  }

  async downloadItemWithDetailedProgress(item) {
    this.progressController.setStep("INITIALIZING", 0);
    await this.simulateProgress("INITIALIZING", 1000);

    this.progressController.setStep("FETCHING_INFO", 0);
    await this.simulateProgress("FETCHING_INFO", 500);

    this.progressController.setStep("DOWNLOADING", 0);
    await this.performActualDownload(item);

    if (item.format === "audio") {
      this.progressController.setStep("PROCESSING", 0);
      await this.simulateProgress("PROCESSING", 2000);
    }

    this.progressController.setStep("FINALIZING", 0);
    await this.simulateProgress("FINALIZING", 500);
  }

  async simulateProgress(step, duration) {
    const startTime = Date.now();
    const updateInterval = 50;

    return new Promise((resolve) => {
      const updateProgress = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(100, (elapsed / duration) * 100);

        this.progressController.updateStepProgress(progress);

        if (progress >= 100) {
          resolve();
        } else {
          setTimeout(updateProgress, updateInterval);
        }
      };

      updateProgress();
    });
  }

  performActualDownload(item) {
    return new Promise((resolve, reject) => {
      fetch("/start-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: item.url, format: item.format }),
      })
        .then((r) => r.json())
        .then(({ downloadId, error }) => {
          if (!downloadId)
            throw new Error(error || "No se pudo iniciar la descarga");

          const es = new EventSource(`/progress/${downloadId}`);

          // Progreso real reportado por el servidor (fase DOWNLOADING)
          es.addEventListener("progress", (e) => {
            try {
              const data = JSON.parse(e.data);
              if (typeof data.percent === "number")
                this.progressController.updateStepProgress(data.percent);
            } catch {
              /* ignorar líneas no-JSON */
            }
          });

          // Archivo listo: lo pedimos y disparamos la descarga en el navegador
          es.addEventListener("ready", async (e) => {
            es.close();
            try {
              const { filename } = JSON.parse(e.data);
              const res = await fetch(
                `/file/${downloadId}?filename=${encodeURIComponent(filename)}`
              );
              if (!res.ok) throw new Error(this.getErrorMessage(res.status));
              this.saveBlob(await res.blob(), filename);
              resolve();
            } catch (err) {
              reject(err);
            }
          });

          // Error del servidor (trae data) o caída de conexión (no la trae)
          es.addEventListener("error", (e) => {
            let msg = "Error en la descarga";
            try {
              if (e.data) msg = JSON.parse(e.data).message || msg;
            } catch {
              /* error de conexión, sin payload */
            }
            es.close();
            reject(new Error(msg));
          });
        })
        .catch((err) => reject(err));
    });
  }

  resetProgressUI() {
    this.currentStep = null;
    this.stepProgress = 0;
    this.totalProgress = 0;

    const progressBar = document.getElementById("progress-bar");
    const progressText = document.getElementById("progress-text");
    const progressLabel = document.getElementById("progress-label");

    if (progressBar) progressBar.style.width = "0%";
    if (progressText) progressText.textContent = "0%";
    if (progressLabel) {
      progressLabel.textContent = "";
      progressLabel.style.opacity = "0";
    }
  }

  cancelDownload(id) {
    const itemIndex = this.downloadQueue.findIndex((item) => item.id === id);
    if (itemIndex === 0 && this.currentDownload) {
      this.showNotification("Cancelando descarga...", "info");
    }

    this.downloadQueue.splice(itemIndex, 1);
    this.renderQueue();

    if (itemIndex === 0) {
      this.processNextDownload();
    }
  }

  removeFromQueue(id) {
    const itemIndex = this.downloadQueue.findIndex((item) => item.id === id);
    if (itemIndex !== -1) {
      this.downloadQueue.splice(itemIndex, 1);
      this.renderQueueWithAnimation();
      this.showNotification("Eliminado de la cola", "info");
    }
  }

  clearInput() {
    this.urlInput.value = "";
    this.previewContainer.style.display = "none";
    this.urlInput.classList.remove("valid", "invalid");
    this.currentContentType = null;
    this.currentPlaylistData = null;
  }

  showNotification(message, type = "info") {
    const notification = document.createElement("div");
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
      <i class="fas ${this.getNotificationIcon(type)}"></i>
      <span>${message}</span>
    `;

    document.body.appendChild(notification);
    setTimeout(() => notification.classList.add("show"), 10);

    setTimeout(() => {
      notification.classList.remove("show");
      setTimeout(() => document.body.removeChild(notification), 300);
    }, 3000);
  }

  getNotificationIcon(type) {
    const icons = {
      success: "fa-check-circle",
      error: "fa-exclamation-triangle",
      info: "fa-info-circle",
      warning: "fa-exclamation-circle",
    };
    return icons[type] || "fa-info-circle";
  }

  isValidYouTubeURL(url) {
    try {
      const urlObj = new URL(url);
      return (
        urlObj.hostname.includes("youtube.com") ||
        urlObj.hostname.includes("youtu.be")
      );
    } catch {
      return false;
    }
  }

  getCleanURL() {
    const url = this.urlInput.value.trim();
    return this.isValidYouTubeURL(url) ? url : null;
  }

  handleFormatChange() {
    const isVideoFormat = this.videoFormat.checked;
    this.videoQuality.style.display = isVideoFormat ? "block" : "none";
    this.audioQuality.style.display = isVideoFormat ? "none" : "block";
  }

  renderVideoPreview(videoInfo) {
    this.videoPreview.innerHTML = `
      <iframe 
        src="https://www.youtube.com/embed/${videoInfo.videoId}" 
        frameborder="0" 
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
        allowfullscreen
        loading="lazy">
      </iframe>
    `;

    this.videoInfo.innerHTML = `
      <h3>${this.escapeHtml(videoInfo.title)}</h3>
      <div class="video-meta">
        <p><i class="fas fa-clock"></i> ${videoInfo.duration}</p>
        <p><i class="fas fa-user"></i> ${this.escapeHtml(videoInfo.channel)}</p>
        <p><i class="fas fa-eye"></i> ${videoInfo.views.toLocaleString()}</p>
      </div>
    `;
  }

  async fetchAndUpdateTitle(url, id) {
    try {
      let title;
      const cachedInfo = this.videoInfoCache.get(url);

      if (cachedInfo) {
        title = cachedInfo.title;
      } else {
        const response = await fetch("/get-video-title", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });

        if (response.ok) {
          const data = await response.json();
          title = data.title;
        }
      }

      const itemIndex = this.downloadQueue.findIndex((item) => item.id === id);
      if (itemIndex !== -1 && title) {
        this.downloadQueue[itemIndex].title = title;
        this.renderQueue();
      }
    } catch (error) {
      console.error("Error obteniendo título:", error);
    }
  }

  saveBlob(blob, filename = "descarga") {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  getErrorMessage(status) {
    const errorMap = {
      400: "URL inválida o formato no soportado",
      404: "Video no encontrado",
      429: "Demasiadas solicitudes, intenta más tarde",
      500: "Error interno del servidor",
    };
    return errorMap[status] || `Error HTTP: ${status}`;
  }

  setLoadingState(loading) {
    this.isProcessing = loading;
    this.previewBtn.disabled = loading;
    this.previewBtn.innerHTML = loading
      ? '<i class="fas fa-spinner fa-spin"></i> Cargando...'
      : '<i class="fas fa-search"></i> Previsualizar';
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  truncateText(text, maxLength) {
    return text.length > maxLength
      ? text.substring(0, maxLength) + "..."
      : text;
  }

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func.apply(this, args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
}

let downloader;

document.addEventListener("DOMContentLoaded", () => {
  try {
    downloader = new ImprovedYouTubeDownloader();
    console.log("YouTube Downloader mejorado inicializado correctamente");
  } catch (error) {
    console.error("Error inicializando YouTube Downloader:", error);
    alert("Error inicializando la aplicación. Recarga la página.");
  }
});
