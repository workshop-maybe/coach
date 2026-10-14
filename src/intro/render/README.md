# Trailer source

This folder renders the first-run intro (`../Intro.tsx`) to a video file. It is the trailer source: the same scenes that play in the app, with the same sound.

```bash
npm run intro:render   # writes out/intro/intro.mp4 (gitignored)
```

The first run downloads a headless browser.

The finished trailer film would be cut in product-video-kit, which can import the composition from a coach-desktop checkout. That is a follow-up.
