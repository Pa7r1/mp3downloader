(function () {
  "use strict";

  const BUTTON_ID = "ydl-quick-btn";
  let lastUrl = "";

  function isVideoPage() {
    return (
      location.pathname === "/watch" &&
      new URLSearchParams(location.search).has("v")
    );
  }

  function removeButton() {
    document.getElementById(BUTTON_ID)?.remove();
  }

  function injectButton() {
    if (!isVideoPage() || document.getElementById(BUTTON_ID)) return;

    const actionsRow = document.querySelector(
      "#actions-inner #menu, ytd-menu-renderer.ytd-watch-metadata",
    );
    if (!actionsRow) return;

    const btn = document.createElement("div");
    btn.id = BUTTON_ID;
    btn.innerHTML = `
      <button id="ydl-btn-inner" title="Descargar con YDL">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 4v-2h14v2H5z"/>
        </svg>
        <span>Descargar</span>
      </button>
      <div id="ydl-mini-menu" class="hidden">
        <button data-format="audio" data-quality="0">🎵 MP3</button>
        <button data-format="video" data-quality="highest">🎬 MP4</button>
      </div>
    `;

    const style = document.createElement("style");
    style.textContent = `
      #ydl-quick-btn { position: relative; display: inline-flex; align-items: center; margin-left: 8px; }
      #ydl-btn-inner {
        display: inline-flex; align-items: center; gap: 6px;
        background: #ff0000; color: #fff; border: none; border-radius: 18px;
        padding: 6px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
        font-family: "YouTube Sans", Roboto, sans-serif; transition: background 0.15s;
      }
      #ydl-btn-inner:hover { background: #cc0000; }
      #ydl-btn-inner.loading { background: #555; cursor: wait; }
      #ydl-mini-menu {
        position: absolute; top: calc(100% + 6px); left: 0;
        background: #212121; border: 1px solid #333; border-radius: 10px;
        overflow: hidden; z-index: 9999; min-width: 130px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      }
      #ydl-mini-menu.hidden { display: none; }
      #ydl-mini-menu button {
        display: block; width: 100%; background: none; border: none; color: #fff;
        padding: 10px 16px; text-align: left; font-size: 13px; cursor: pointer;
        font-family: "YouTube Sans", Roboto, sans-serif;
      }
      #ydl-mini-menu button:hover { background: #333; }
    `;
    document.head.appendChild(style);
    actionsRow.prepend(btn);

    const inner = btn.querySelector("#ydl-btn-inner");
    const menu = btn.querySelector("#ydl-mini-menu");

    inner.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.toggle("hidden");
    });

    document.addEventListener("click", () => menu.classList.add("hidden"));

    menu.querySelectorAll("button").forEach((opt) => {
      opt.addEventListener("click", (e) => {
        e.stopPropagation();
        menu.classList.add("hidden");
        inner.classList.add("loading");
        inner.querySelector("span").textContent = "Descargando...";

        // Verificar que el runtime sigue disponible
        if (!chrome?.runtime?.sendMessage) {
          inner.querySelector("span").textContent = "Recargá la página";
          inner.classList.remove("loading");
          return;
        }

        try {
          chrome.runtime.sendMessage(
            {
              action: "download",
              url: location.href,
              format: opt.dataset.format,
              quality: opt.dataset.quality,
            },
            (res) => {
              // Leer lastError para evitar que Chrome lo tire como excepción
              void chrome.runtime.lastError;
              if (res?.ok) {
                inner.querySelector("span").textContent = "¡Listo!";
                setTimeout(() => {
                  inner.classList.remove("loading");
                  inner.querySelector("span").textContent = "Descargar";
                }, 3000);
              } else {
                inner.querySelector("span").textContent = res?.error || "Error";
                inner.classList.remove("loading");
                setTimeout(
                  () => (inner.querySelector("span").textContent = "Descargar"),
                  4000,
                );
              }
            },
          );
        } catch (err) {
          console.warn("[YDL]", err.message);
          inner.querySelector("span").textContent = "Recargá la página";
          inner.classList.remove("loading");
        }
      });
    });
  }

  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      removeButton();
      setTimeout(injectButton, 1500);
    }
    if (isVideoPage() && !document.getElementById(BUTTON_ID)) {
      setTimeout(injectButton, 800);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(injectButton, 2000);
})();
