import { createCanvas, loadImage } from 'canvas';
import { discoverHeuristicRegion } from '../../offscreen/engines/bubble/heuristicRegionSearch';

async function main() {
  const im = await loadImage('src/test/test-img/image6.jpg');
  const c = createCanvas(im.width, im.height);
  const x = c.getContext('2d') as any;
  x.drawImage(im, 0, 0);
  const d = x.getImageData(0, 0, im.width, im.height);

  // Simulate Studio OCR: crop just the top-left area (stepped balloon)
  const cropW = 280, cropH = 220;
  const cropData = new Uint8ClampedArray(cropW * cropH * 4);
  for (let y = 0; y < cropH; y++) for (let px = 0; px < cropW; px++) {
    const src = (y * im.width + px) * 4, dst = (y * cropW + px) * 4;
    cropData[dst] = d.data[src]; cropData[dst + 1] = d.data[src + 1];
    cropData[dst + 2] = d.data[src + 2]; cropData[dst + 3] = 255;
  }
  const crop = { width: cropW, height: cropH, data: cropData };
  const box = { x: 108, y: 20, w: 53, h: 138 };

  const cropResult = discoverHeuristicRegion(crop, box, { threshold: 200, dark: false });
  console.log('Studio crop:', cropResult.status, cropResult.status === 'rejected' ? cropResult.reason : '');

  const fullResult = discoverHeuristicRegion(d, box, { threshold: 200, dark: false });
  console.log('Full page:  ', fullResult.status, fullResult.status === 'rejected' ? fullResult.reason : '');
}
main().catch(console.error);
