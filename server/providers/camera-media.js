/** Only official public video URLs advertised by the camera catalog. */
export function officialCameraVideo(value, provider) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (
      provider === 'caltrans' &&
      url.hostname === 'wzmedia.dot.ca.gov' &&
      /^\/D\d+\/.+\.m3u8$/.test(url.pathname)
    )
      return { url: url.href, feedType: 'hls', playbackKind: 'live' };
    if (
      provider === 'tfl' &&
      url.href.startsWith(
        'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/',
      ) &&
      url.pathname.endsWith('.mp4')
    )
      return { url: url.href, feedType: 'mp4', playbackKind: 'clip' };
  } catch {
    /* A malformed upstream record stays a snapshot. */
  }
  return null;
}

/** HLS children must remain in this registered camera's directory and origin. */
export function resolveCameraMedia(sourceUrl, asset) {
  const source = new URL(sourceUrl);
  const target = asset ? new URL(asset, source) : source;
  const directory = source.pathname.slice(
    0,
    source.pathname.lastIndexOf('/') + 1,
  );
  if (
    target.origin !== source.origin ||
    target.username ||
    target.password ||
    !target.pathname.startsWith(directory) ||
    /%|\\/.test(target.pathname) ||
    target.hash
  )
    throw new Error('Camera media asset outside its registered source');
  return target;
}

/** Rewrite variant playlists, segments and encryption/map URI attributes. */
export function rewriteCameraPlaylist(text, currentUrl, sourceUrl, cameraId) {
  const proxy = (value) => {
    const target = resolveCameraMedia(
      sourceUrl,
      new URL(value, currentUrl).href,
    );
    return `/api/cctv/media/${encodeURIComponent(cameraId)}?asset=${encodeURIComponent(target.href)}`;
  };
  if (!text.trimStart().startsWith('#EXTM3U'))
    throw new Error('Invalid HLS playlist');
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return line;
      if (line.startsWith('#'))
        return line.replace(
          /URI="([^"]+)"/g,
          (_, uri) => `URI="${proxy(uri)}"`,
        );
      return proxy(line.trim());
    })
    .join('\n');
}
