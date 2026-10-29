import { createCanvas, loadImage } from 'canvas';
import f from '../fixtures/image6_ocr_v6_medium.json';
import { HeuristicBubbleEngine } from '../../offscreen/engines/bubble/HeuristicBubbleEngine';
import { resolveBubbleLayoutsDetailed } from '../../offscreen/services/BubbleLayoutService';

async function main() {
  const im = await loadImage('src/test/test-img/image6.jpg');
  const c = createCanvas(im.width, im.height);
  const x = c.getContext('2d') as any;
  x.drawImage(im, 0, 0);
  const g = HeuristicBubbleEngine.buildGeometry(x.getImageData(0, 0, im.width, im.height), f.boxes);

  console.log('=== ENGINE OUTPUT ===');
  for (const i of [3, 4, 9, 12, 13]) {
    const s = g.shapes[i] as any;
    console.log(`box ${i}: shared=${g.shapes[3] === g.shapes[4]} validated=${s?.validatedComponent} ` +
      `interior=${!!s?.interior?.some(Boolean)} reconstructed=${!!s?.reconstructed?.some(Boolean)} ` +
      `curvature=${JSON.stringify(g.curvatures?.[i])} contourLen=${g.contours?.[i]?.length ?? 'UNDEF'}`);
  }

  console.log('\n=== RESOLVER OUTPUT ===');
  const l = resolveBubbleLayoutsDetailed({
    ...g, boxes: f.boxes, directions: f.directions, angles: f.angles,
    pageWidth: im.width, pageHeight: im.height, accept: () => true,
  });
  for (const i of [3, 4, 9, 12, 13]) {
    console.log(`box ${i}: typesetBox=${JSON.stringify(l.typesetBoxes[i])} ` +
      `contourLen=${l.contourPoints[i]?.length ?? 'UNDEF'} skipped=${l.skipped?.[i]}`);
  }

  // Simulate PipelineOrchestrator DB save logic
  console.log('\n=== DB SAVE SIMULATION (typesetMode) ===');
  for (const i of [3, 4, 9, 12, 13]) {
    const contour = l.contourPoints[i];
    const hasContour = Boolean(contour && contour.length >= 3);
    const hasBubble = Boolean(g.proposals?.[i] || g.carriers?.[i]);
    const curvature = g.curvatures?.[i];
    const isContour = hasContour || Boolean(curvature?.isRounded);
    const typesetMode = hasBubble ? (isContour ? 'contour' : 'simple') : 'balloon';
    console.log(`box ${i}: hasContour=${hasContour} hasBubble=${hasBubble} isContour=${isContour} typesetMode=${typesetMode}`);
  }
}
main().catch(console.error);
