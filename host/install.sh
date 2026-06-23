# configura la extensión YDL en Chrome/Chromium
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_SCRIPT="$SCRIPT_DIR/ydl-host.js"
MANIFEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
MANIFEST_CHROMIUM="$HOME/.config/chromium/NativeMessagingHosts"
HOST_NAME="com.pa7r1.ydl"

echo ""
echo "╔═══════════════════════════════════╗"
echo "║   YDL Extension — Instalador      ║"
echo "╚═══════════════════════════════════╝"
echo ""

# Hacer ejecutable el host
chmod +x "$HOST_SCRIPT"
echo " Host script listo: $HOST_SCRIPT"

# Obtener el ID de la extensión
echo ""
echo "  Necesitás el ID de la extensión de Chrome."
echo "   Pasos:"
echo "   1. Abrí chrome://extensions"
echo "   2. Activá 'Modo desarrollador'"
echo "   3. Hacé clic en 'Cargar extensión sin empaquetar'"
echo "   4. Seleccioná la carpeta: $SCRIPT_DIR/extension"
echo "   5. Copiá el ID que aparece (ej: abcdefghijklmnopqrstuvwxyz012345)"
echo ""
read -rp "   Pegá el ID de la extensión: " EXT_ID

if [[ -z "$EXT_ID" ]]; then
  echo "❌ ID vacío, abortando"
  exit 1
fi

# Generar el manifest de Native Messaging
HOST_PATH="$HOST_SCRIPT"
MANIFEST_JSON=$(cat <<EOF
{
  "name": "$HOST_NAME",
  "description": "YDL Native Host",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ]
}
EOF
)

# 4. Instalar para Chrome y Chromium
for DIR in "$MANIFEST_DIR" "$MANIFEST_CHROMIUM"; do
  mkdir -p "$DIR"
  echo "$MANIFEST_JSON" > "$DIR/$HOST_NAME.json"
  echo "Manifest instalado en: $DIR/$HOST_NAME.json"
done

echo ""
echo "═══════════════════════════════════════"
echo "  ¡Instalación completa!"
echo ""
echo "   Ahora recargá la extensión en chrome://extensions"
echo "   y abrí cualquier video de YouTube."
echo ""
echo "   Si el servidor no arranca automáticamente,"
echo "   corrés manualmente: cd $SCRIPT_DIR && npm run dev"
echo "═══════════════════════════════════════"
echo ""