import type { jsPDF } from 'jspdf';
import rttrackLogoUrl from './assets/rttrack-logo.png';

let logoDataUrlPromise: Promise<string> | null = null;

function logoAsDataUrl(): Promise<string> {
  if (!logoDataUrlPromise) {
    logoDataUrlPromise = fetch(rttrackLogoUrl)
      .then(response => {
        if (!response.ok) throw new Error('Could not load RTTRACK logo.');
        return response.blob();
      })
      .then(blob => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string'
          ? resolve(reader.result)
          : reject(new Error('Could not encode RTTRACK logo.'));
        reader.onerror = () => reject(reader.error ?? new Error('Could not read RTTRACK logo.'));
        reader.readAsDataURL(blob);
      }));
  }
  return logoDataUrlPromise;
}

export async function addRttrackLogoToPdf(
  doc: jsPDF,
  x = 40,
  y = 28,
  width = 112,
) {
  const logoDataUrl = await logoAsDataUrl();
  const aspectRatio = 247 / 1200;
  doc.addImage(logoDataUrl, 'PNG', x, y, width, width * aspectRatio, undefined, 'FAST');
}
