# Trailer source

This folder renders the first-run intro (`../Intro.tsx`) to a video file. It is the trailer source: the same scenes that play in the app, with the same sound.

```bash
npm run intro:render   # writes out/intro/intro.mp4 (gitignored)
```

`scripts/intro-render.mjs` serves `index.html` here through Vite, opens it in headless Chromium at 1920×1080, and captures every frame through `window.__introFrame`. ffmpeg then mixes the timeline's sounds (`SOUND_PLAYS` in `../timeline.ts`) onto the frames and encodes H.264 with stereo AAC. It needs ffmpeg on the PATH (`brew install ffmpeg`). A render takes about a minute and a half.

The finished trailer would be cut in product-video-kit from this file. That is a follow-up.
