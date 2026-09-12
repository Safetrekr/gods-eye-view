import Hls from 'hls.js';

/** One owned player; closing it stops downloads, timers and media decoding. */
export function createCameraPlayer() {
  const dialog = document.createElement('dialog');
  dialog.className = 'ops-camera-player';
  dialog.setAttribute('aria-labelledby', 'ops-camera-player-title');
  dialog.innerHTML = `<header><div><p class="ops-eyebrow">PUBLIC CAMERA</p><h2 id="ops-camera-player-title"></h2><p class="ops-camera-credit"></p></div><button type="button" aria-label="Close camera">Close ×</button></header>
    <div class="ops-camera-stage"></div><div class="ops-camera-toolbar"><span class="ops-camera-status" role="status"></span><button type="button" class="ops-camera-refresh">Reload feed</button><button type="button" class="ops-camera-fullscreen">Fullscreen</button></div><p class="ops-camera-explanation"></p>`;
  document.body.append(dialog);
  const stage = dialog.querySelector('.ops-camera-stage');
  const status = dialog.querySelector('.ops-camera-status');
  const explanation = dialog.querySelector('.ops-camera-explanation');
  let controller, hls, timer, video, blobUrl, current, focusBefore;
  let generation = 0;
  const releaseMedia = () => {
    generation++;
    controller?.abort();
    clearInterval(timer);
    hls?.destroy();
    hls = null;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video = null;
    }
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = null;
    stage.replaceChildren();
  };
  const showSnapshot = (info, failedVideo = false) => {
    releaseMedia();
    controller = new AbortController();
    const epoch = generation;
    const img = new Image();
    img.alt = `${current.name} — latest available camera image`;
    stage.append(img);
    explanation.textContent = failedVideo
      ? 'Video is unavailable from this provider right now. Showing its latest snapshot; use Reload feed to retry video.'
      : 'This camera publishes still images. We request the latest image every 15 seconds; the provider may update less often.';
    let loading = false;
    const refresh = async () => {
      if (loading || document.hidden || !dialog.open) return;
      loading = true;
      try {
        const response = await fetch(`${info.frameUrl}?t=${Date.now()}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('unavailable');
        const fallback = response.headers.get('X-CCTV-Source') || '';
        const image = await response.blob();
        if (epoch !== generation) return;
        const old = blobUrl;
        blobUrl = URL.createObjectURL(image);
        img.src = blobUrl;
        if (old) URL.revokeObjectURL(old);
        status.textContent = /street|seed|fallback|synthetic/i.test(fallback)
          ? 'Camera unavailable · reference image only'
          : `Snapshot fetched ${new Date().toLocaleTimeString()}`;
      } catch {
        if (epoch === generation)
          status.textContent = 'Snapshot unavailable · retrying';
      } finally {
        loading = false;
      }
    };
    refresh();
    timer = setInterval(refresh, 15000);
  };
  const load = async () => {
    releaseMedia();
    controller = new AbortController();
    const epoch = generation;
    status.textContent = 'Connecting to camera…';
    explanation.textContent = '';
    try {
      const response = await fetch(
        `/api/cctv/stream/${encodeURIComponent(current.id)}`,
        { signal: controller.signal, cache: 'no-store' },
      );
      if (!response.ok) throw new Error('Camera unavailable');
      const info = await response.json();
      if (epoch !== generation) return;
      dialog.querySelector('.ops-camera-credit').textContent = [
        current.city,
        info.provider || current.provider,
        info.license,
      ]
        .filter(Boolean)
        .join(' · ');
      if (!info.mediaUrl) {
        showSnapshot(info);
        return;
      }
      video = document.createElement('video');
      video.controls = true;
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.setAttribute('aria-label', `${current.name} video`);
      stage.append(video);
      const isLive = info.playbackKind === 'live';
      explanation.textContent = isLive
        ? 'Live stream supplied by the camera operator. Availability and delay vary by source.'
        : 'Recent video clip supplied by the camera operator. This is not a continuous live stream. After playback, the latest available clip is loaded.';
      const fail = () => {
        if (epoch === generation) showSnapshot(info, true);
      };
      video.addEventListener('error', fail, { once: true });
      video.addEventListener('playing', () => {
        status.textContent = isLive ? 'Live video' : 'Recent video clip';
      });
      video.addEventListener('waiting', () => {
        status.textContent = 'Buffering video…';
      });
      if (!isLive)
        video.addEventListener('ended', () => {
          if (!document.hidden && epoch === generation) {
            video.src = `${info.mediaUrl}?t=${Date.now()}`;
            video.play().catch(() => {
              status.textContent = 'Press Play to continue';
            });
          }
        });
      if (
        info.feedType === 'hls' &&
        !video.canPlayType('application/vnd.apple.mpegurl')
      ) {
        if (!Hls.isSupported()) {
          fail();
          return;
        }
        hls = new Hls({
          maxBufferLength: 20,
          backBufferLength: 15,
          manifestLoadingMaxRetry: 1,
          levelLoadingMaxRetry: 1,
        });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) fail();
        });
        hls.loadSource(info.mediaUrl);
        hls.attachMedia(video);
      } else video.src = `${info.mediaUrl}?t=${Date.now()}`;
      video.play().catch(() => {
        if (epoch === generation)
          status.textContent = 'Press Play to start video';
      });
    } catch {
      if (epoch === generation)
        status.textContent = 'Camera unavailable. Use Reload feed to retry.';
    }
  };
  dialog.querySelector('header button').onclick = () => dialog.close();
  dialog.querySelector('.ops-camera-refresh').onclick = load;
  dialog.querySelector('.ops-camera-fullscreen').onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (stage.requestFullscreen) await stage.requestFullscreen();
      else video?.webkitEnterFullscreen?.();
    } catch {
      status.textContent = 'Fullscreen is unavailable in this browser';
    }
  };
  dialog.addEventListener('close', () => {
    releaseMedia();
    current = null;
    if (focusBefore?.isConnected) focusBefore.focus();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      dialog.close();
  });
  return {
    open(camera) {
      current = camera;
      dialog.querySelector('h2').textContent = camera.name;
      if (!dialog.open) {
        focusBefore = document.activeElement;
        dialog.showModal();
      }
      load();
    },
    dispose() {
      releaseMedia();
      dialog.remove();
    },
  };
}
