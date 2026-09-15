export function initials(name) {
  return (
    String(name || '?')
      .trim()
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => [...part][0])
      .join('')
      .toUpperCase() || '?'
  );
}

// These are the existing app avatars. Never attach a session token or fetch
// arbitrary profile URLs into a canvas; only the configured avatar bucket.
export function participantPhotoUrl(
  value,
  base = import.meta.env?.VITE_SUPABASE_URL,
) {
  if (!value || !base) return null;
  try {
    const url = new URL(value);
    const origin = new URL(base).origin;
    return url.protocol === 'https:' &&
      url.origin === origin &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith('/storage/v1/object/public/avatars/')
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function participantPortrait(person) {
  const element = document.createElement('span');
  element.className = 'ops-portrait';
  element.textContent = initials(person.name);
  element.setAttribute('aria-label', `${person.name} profile`);
  const url = participantPhotoUrl(person.avatar_url);
  if (url) {
    const image = document.createElement('img');
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    image.src = url;
    image.addEventListener('error', () => image.remove(), { once: true });
    element.append(image);
  }
  return element;
}

function drawPin(person, css, photo) {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 116;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0b1519';
  ctx.beginPath();
  ctx.moveTo(34, 83);
  ctx.lineTo(48, 112);
  ctx.lineTo(62, 83);
  ctx.fill();
  ctx.fillStyle = css;
  ctx.beginPath();
  ctx.moveTo(39, 84);
  ctx.lineTo(48, 104);
  ctx.lineTo(57, 84);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(48, 46, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#0b1519';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.arc(48, 46, 36, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#132b30';
  ctx.fillRect(10, 8, 76, 76);
  if (photo) {
    const side = Math.min(photo.naturalWidth, photo.naturalHeight);
    ctx.drawImage(
      photo,
      (photo.naturalWidth - side) / 2,
      (photo.naturalHeight - side) / 2,
      side,
      side,
      12,
      10,
      72,
      72,
    );
  } else {
    ctx.fillStyle = '#eff7f3';
    ctx.font = '600 29px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials(person.name), 48, 47);
  }
  ctx.restore();
  // Role stays legible even when the outer ring shows an aged location.
  ctx.fillStyle = '#0b1519';
  ctx.fillRect(62, 68, 27, 22);
  ctx.fillStyle = '#eff7f3';
  ctx.font = 'bold 17px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(person.role === 'chaperone' ? 'C' : 'T', 75, 84);
  return canvas;
}

export function createParticipantPinCache() {
  const entries = new Map();
  const dots = new Map();
  let disposed = false;
  const release = (entry) => {
    if (entry.photo) {
      entry.photo.onload = entry.photo.onerror = null;
      entry.photo.src = '';
    }
    entry.listeners.clear();
  };
  return {
    dot(css) {
      if (!dots.has(css)) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = css;
        ctx.strokeStyle = '#0b1519';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(16, 16, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        dots.set(css, canvas);
      }
      return dots.get(css);
    },
    get(person, css, ready) {
      const url = participantPhotoUrl(person.avatar_url);
      const key = JSON.stringify([person.name, person.role, css, url]);
      let entry = entries.get(key);
      if (entry) {
        entries.delete(key);
        entries.set(key, entry);
        if (entry.pending) entry.listeners.add(ready);
        return entry.canvas;
      }
      entry = {
        canvas: drawPin(person, css),
        pending: !!url,
        listeners: new Set([ready]),
      };
      entries.set(key, entry);
      while (entries.size > 256) {
        const oldest = entries.keys().next().value;
        release(entries.get(oldest));
        entries.delete(oldest);
      }
      if (url) {
        const photo = new Image();
        entry.photo = photo;
        photo.crossOrigin = 'anonymous';
        photo.referrerPolicy = 'no-referrer';
        photo.onload = () => {
          if (disposed) return;
          try {
            entry.canvas = drawPin(person, css, photo);
          } catch {
            /* Keep initials on inaccessible images. */
          }
          entry.pending = false;
          for (const listener of entry.listeners) listener(entry.canvas);
          entry.listeners.clear();
        };
        photo.onerror = () => {
          entry.pending = false;
          entry.listeners.clear();
        };
        photo.src = url;
      } else entry.listeners.clear();
      return entry.canvas;
    },
    clear() {
      for (const entry of entries.values()) release(entry);
      entries.clear();
      dots.clear();
    },
    dispose() {
      disposed = true;
      this.clear();
    },
  };
}
