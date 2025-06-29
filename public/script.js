class YouTubeDownloader {
  constructor() {
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

    this.downloadQueue = [];
    this.currentDownload = null;

    this.initEventListeners();
  }

  initEventListeners() {
    this.previewBtn.addEventListener("click", this.previewVideo.bind(this));
    this.downloadBtn.addEventListener("click", this.addToQueue.bind(this));

    this.videoFormat.addEventListener("change", () => {
      this.videoQuality.style.display = "block";
      this.audioQuality.style.display = "none";
    });

    this.audioFormat.addEventListener("change", () => {
      this.videoQuality.style.display = "none";
      this.audioQuality.style.display = "block";
    });
  }

  async previewVideo() {
    const url = this.urlInput.value.trim();
    if (!url) {
      this.showError("Por favor, ingresa una URL de YouTube válida.");
      return;
    }

    try {
      // Obtener información del video
      const response = await fetch("/get-video-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const videoInfo = await response.json();

      // Mostrar previsualización
      this.videoPreview.innerHTML = `
        <iframe 
          src="https://www.youtube.com/embed/${videoInfo.videoId}" 
          frameborder="0" 
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
          allowfullscreen>
        </iframe>
      `;

      this.videoInfo.innerHTML = `
        <h3>${videoInfo.title}</h3>
        <p><strong>Duración:</strong> ${videoInfo.duration}</p>
        <p><strong>Canal:</strong> ${videoInfo.channel}</p>
        <p><strong>Vistas:</strong> ${videoInfo.views.toLocaleString()}</p>
      `;

      this.previewContainer.style.display = "block";
    } catch (error) {
      this.showError(
        `Error al obtener información del video: ${error.message}`
      );
    }
  }

  addToQueue() {
    const url = this.urlInput.value.trim();
    if (!url) {
      this.showError("Por favor, ingresa una URL de YouTube válida.");
      return;
    }

    const format = document.querySelector('input[name="format"]:checked').value;
    const quality =
      format === "video" ? this.videoQuality.value : this.audioQuality.value;

    // Crear objeto de descarga
    const downloadItem = {
      id: Date.now(),
      url,
      format,
      quality,
      status: "queued",
      title: "Cargando...",
      progress: 0,
    };

    this.downloadQueue.push(downloadItem);
    this.renderQueue();

    // Si no hay descargas en curso, comenzar esta
    if (!this.currentDownload) {
      this.processNextDownload();
    }

    // Obtener título del video para mostrar en la cola
    this.fetchVideoTitle(url, downloadItem.id);
  }

  async fetchVideoTitle(url, id) {
    try {
      const response = await fetch("/get-video-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const { title } = await response.json();

      // Actualizar título en la cola
      const itemIndex = this.downloadQueue.findIndex((item) => item.id === id);
      if (itemIndex !== -1) {
        this.downloadQueue[itemIndex].title = title;
        this.renderQueue();
      }
    } catch (error) {
      console.error("Error fetching video title:", error);
    }
  }

  renderQueue() {
    this.queueList.innerHTML = "";

    this.downloadQueue.forEach((item) => {
      const li = document.createElement("li");

      li.innerHTML = `
        <div class="queue-item-title">${item.title}</div>
        <div class="queue-item-status status-${item.status}">
          ${this.getStatusText(item.status)}
        </div>
        <div class="queue-item-progress">${item.progress}%</div>
      `;

      this.queueList.appendChild(li);
    });
  }

  getStatusText(status) {
    const statusMap = {
      queued: "En cola",
      downloading: "Descargando",
      converting: "Convirtiendo",
      completed: "Completado",
    };

    return statusMap[status] || status;
  }

  async processNextDownload() {
    if (this.downloadQueue.length === 0) {
      this.currentDownload = null;
      return;
    }

    this.currentDownload = this.downloadQueue[0];
    this.currentDownload.status = "downloading";
    this.renderQueue();

    try {
      // Actualizar UI para mostrar progreso actual
      this.updateProgressUI(0);
      this.downloadBtn.disabled = true;

      // Descargar el elemento
      await this.downloadItem(this.currentDownload);

      // Marcar como completado
      this.currentDownload.status = "completed";
      this.currentDownload.progress = 100;
      this.renderQueue();

      // Eliminar de la cola después de un tiempo
      setTimeout(() => {
        this.downloadQueue.shift();
        this.renderQueue();
        this.processNextDownload();
      }, 3000);
    } catch (error) {
      console.error("Download error:", error);
      this.currentDownload.status = "error";
      this.renderQueue();

      // Intentar siguiente descarga
      setTimeout(() => {
        this.downloadQueue.shift();
        this.renderQueue();
        this.processNextDownload();
      }, 5000);
    } finally {
      this.updateProgressUI(0);
      this.downloadBtn.disabled = false;
    }
  }

  async downloadItem(item) {
    return new Promise((resolve, reject) => {
      const endpoint =
        item.format === "video" ? "/download-video" : "/download-audio";

      const xhr = new XMLHttpRequest();
      xhr.open("POST", endpoint, true);
      xhr.setRequestHeader("Content-Type", "application/json");

      xhr.responseType = "blob";

      xhr.onload = () => {
        if (xhr.status === 200) {
          const blob = xhr.response;
          const contentDisposition = xhr.getResponseHeader(
            "Content-Disposition"
          );
          let filename = "descarga";

          if (contentDisposition) {
            const match = contentDisposition.match(/filename="(.+)"/);
            if (match) filename = match[1];
          }

          // Crear enlace de descarga
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          resolve();
        } else {
          // Manejar diferentes códigos de error
          let errorMsg = `Error en la descarga: ${xhr.status}`;
          if (xhr.status === 400) errorMsg = "URL inválida";
          else if (xhr.status === 500) errorMsg = "Error interno del servidor";

          reject(new Error(errorMsg));
        }
      };

      xhr.onerror = () => reject(new Error("Error de red"));

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          item.progress = percent;
          this.updateProgressUI(percent);
          this.renderQueue();
        }
      };

      xhr.send(
        JSON.stringify({
          url: item.url,
          quality: item.quality,
        })
      );
    });
  }

  updateProgressUI(percent) {
    this.progressBar.style.width = `${percent}%`;
    this.progressText.textContent = `${percent}%`;
  }

  showError(message) {
    alert(message);
  }
}

// Inicializar cuando el DOM esté listo
document.addEventListener("DOMContentLoaded", () => {
  new YouTubeDownloader();
});
