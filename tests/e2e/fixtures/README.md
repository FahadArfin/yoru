# Synthetic video fixture

`sync.webm` is an eight-second silent test pattern generated specifically for Yoru's browser tests. It has duration and seeking metadata, allowing the test to verify actual video play, pause, and seek synchronization between two browsers. It contains no third-party media.

Regenerate it with an installed FFmpeg:

```sh
ffmpeg -f lavfi -i 'testsrc2=size=96x64:rate=12:duration=8' -c:v libvpx -b:v 24k -g 12 -an sync.webm
```

FFmpeg is not needed to run the tests. Playwright intercepts the fixture's synthetic HTTPS address and fulfills it with this local file; no media service is contacted.
