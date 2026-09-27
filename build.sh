#!/usr/bin/env bash
# Полная сборка ролика: звук → кадры → MP4.
#   ./build.sh            — всё с нуля (60 к/с, 4 потока)
#   WORKERS=8 ./build.sh  — больше параллельных вкладок браузера
set -euo pipefail
cd "$(dirname "$0")"

FFMPEG="${FFMPEG:-$(command -v ffmpeg || python3 -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')}"
WORKERS="${WORKERS:-4}"
FPS="${FPS:-60}"
OUT="out/jjk_hierarchy_power_potential.mp4"

echo "== 1/3 саундтрек"
python3 audio/soundtrack.py

echo "== 2/3 кадры (${FPS} к/с, ${WORKERS} потоков)"
rm -rf build/frames
node render/render.cjs frames "$WORKERS" "$FPS"

echo "== 3/3 кодирование"
mkdir -p out
"$FFMPEG" -y -hide_banner -loglevel warning \
  -framerate "$FPS" -i build/frames/f_%05d.jpg -i build/soundtrack.wav \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -profile:v high -tune animation \
  -c:a aac -b:a 256k -movflags +faststart -shortest "$OUT"
"$FFMPEG" -y -hide_banner -loglevel warning -i build/soundtrack.wav -c:a aac -b:a 192k out/soundtrack.m4a
cp build/frames/f_00510.jpg out/poster.jpg
echo "готово → $OUT"
