import { isPng } from './png';
import { bytesToDataUrl, dataUrlToBytes, readBytes } from './util';

const MAX_SIDE = 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = src;
  });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(async (b) => {
      if (!b) return reject(new Error('canvas'));
      resolve(new Uint8Array(await b.arrayBuffer()));
    }, 'image/png'),
  );
}

async function redraw(src: string, maxSide = MAX_SIDE) {
  const img = await loadImage(src);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvasToPng(canvas);
}

/** Uploaded image → PNG data URL (keeps small PNGs as they are). */
export async function avatarFromFile(file: File): Promise<string> {
  const bytes = await readBytes(file);
  if (isPng(bytes) && bytes.length < 2_500_000) return bytesToDataUrl(bytes, 'image/png');
  const src = URL.createObjectURL(file);
  try {
    return bytesToDataUrl(await redraw(src), 'image/png');
  } finally {
    URL.revokeObjectURL(src);
  }
}

/** PNG bytes of an avatar, or a generated placeholder with the initial. */
export async function avatarPng(avatar: string | undefined, name: string): Promise<Uint8Array> {
  if (avatar) {
    const bytes = dataUrlToBytes(avatar);
    if (isPng(bytes)) return bytes;
    return redraw(avatar);
  }
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 600;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#1b1a1a';
  g.fillRect(0, 0, 400, 600);
  g.fillStyle = '#f2ede6';
  g.beginPath();
  g.moveTo(40, 560);
  g.lineTo(40, 200);
  g.arc(200, 200, 160, Math.PI, 0);
  g.lineTo(360, 560);
  g.closePath();
  g.fill();
  g.strokeStyle = '#d58a9a';
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = '#1b1a1a';
  g.font = '180px Prata, Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText((name.trim()[0] ?? '?').toUpperCase(), 200, 340);
  return canvasToPng(canvas);
}
