# Intro sound

The intro's score and cue sounds. The files here are generated placeholders. Replace any of them with a file of the same name and format, and nothing else needs to change: `index.ts` imports each by name.

| File | Plays | Length |
|---|---|---|
| `bed.mp3` | The score, from the first frame to the last | 40 s, the whole film |
| `line.wav` | As each line of text starts to rise | 0.6 s or less |
| `reply.wav` | Each reply record leaving the setup in the first scene | 0.13 s or less |
| `pull.wav` | The camera starting to pull back in the last scene | 0.5 s or less |
| `seat.wav` | The cartridge seating into the slot in the third scene | 0.3 s or less |
| `check.wav` | The first pass checked in the fourth scene | 0.6 s or less |

When each cue plays is set in `../timeline.ts` (`SOUND_CUES`). How long each kind stays mounted is `CUE_FRAMES` there, at 30 frames a second. A file longer than its window is cut off when the window ends, so a longer sound needs a longer window. The timeline test keeps the sounds playing at once within `SHARED_AUDIO_TAGS`.

## Format

- **Cues: WAV, 16-bit PCM, mono.** Plays in WKWebView (Mac), WebKitGTK (Linux) and Chromium (the trailer render), with no decoder to depend on.
- **Score: MP3.** Small enough to ship for a 40-second bed. WebKitGTK decodes MP3 through GStreamer's plugins-good, which most Linux desktops have. AAC needs gst-libav there, and Ogg doesn't play in WKWebView. Make the bed run the full length rather than loop: MP3 adds silence at a loop seam.

Mix the files soft. `BED_VOLUME` and `CUE_VOLUME` in `index.ts` set the default level on top of that, and the viewer's mute silences everything.
