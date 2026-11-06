// Prepares an attachment: compresses photos (which also strips EXIF/GPS data) and makes a
// small thumbnail that travels inside the message itself, so chats render instantly.

const FULL_MAX = 2560;
const THUMB_MAX = 360;

function canvasBlob(canvas, type, q) {
  return new Promise((res) => canvas.toBlob(res, type, q));
}

async function encode(bmp, max, quality) {
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  let blob = await canvasBlob(canvas, 'image/webp', quality);
  if (!blob || blob.type !== 'image/webp') blob = await canvasBlob(canvas, 'image/jpeg', quality);
  return blob;
}

const toDataURL = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

async function videoThumb(file) {
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.src = url;
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; setTimeout(rej, 5000); });
    v.currentTime = Math.min(1, (v.duration || 2) / 2);
    await new Promise((res) => { v.onseeked = res; setTimeout(res, 2000); });
    const blob = await encode(v.videoWidth ? Object.assign(v, { width: v.videoWidth, height: v.videoHeight }) : v, THUMB_MAX, 0.7);
    return { thumb: await toDataURL(blob), w: v.videoWidth, h: v.videoHeight };
  } catch { return {}; }
  finally { URL.revokeObjectURL(url); }
}

export async function processFile(file, compress = true) {
  const original = new Uint8Array(await file.arrayBuffer());
  const base = { name: file.name || 'file', mime: file.type || 'application/octet-stream' };

  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') {
    let bmp = null;
    try { bmp = await createImageBitmap(file); } catch {}
    if (bmp) {
      const thumb = await toDataURL(await encode(bmp, THUMB_MAX, 0.7));
      let bytes = original, mime = base.mime, name = base.name;
      if (compress && file.type !== 'image/gif') {
        const blob = await encode(bmp, FULL_MAX, 0.85);
        bytes = new Uint8Array(await blob.arrayBuffer());
        mime = blob.type;
        name = name.replace(/\.[^.]+$/, '') + (mime === 'image/webp' ? '.webp' : '.jpg');
      }
      const out = { kind: 'image', bytes, mime, name, w: bmp.width, h: bmp.height, thumb };
      bmp.close?.();
      return out;
    }
  }
  if (file.type.startsWith('video/')) {
    return { kind: 'file', bytes: original, ...base, ...(await videoThumb(file)) };
  }
  return { kind: 'file', bytes: original, ...base };
}
