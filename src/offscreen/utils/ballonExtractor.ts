import { getCv } from './opencv';

function getCvInstance(): any {
  const cv = getCv();
  if (!cv) return null;
  if (typeof cv.Mat === 'function') return cv;
  if (cv.cv && typeof cv.cv.Mat === 'function') return cv.cv;
  return cv;
}

export interface GrayImage {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface BallonRegionResult {
  /** Balloon mask, 255 = balloon interior, 0 = outside. */
  mask: GrayImage;
  /** Crop window [x1, y1, x2, y2] in full-image coordinates. */
  xyxy: [number, number, number, number];
}

export function enlargeWindow(
  rect: [number, number, number, number],
  imW: number,
  imH: number,
  ratio = 2.5,
  aspectRatio = 1.0
): [number, number, number, number] {
  const [x1, y1, x2, y2] = rect;
  const w = x2 - x1;
  const h = y2 - y1;

  if (w <= 0 || h <= 0) return [0, 0, 0, 0];

  const a = aspectRatio;
  const b = w + h * aspectRatio;
  const c = (1 - ratio) * w * h;
  const discriminant = b * b - 4 * a * c;
  const root = a !== 0
    ? (-b + Math.sqrt(Math.max(0, discriminant))) / (2 * a)
    : -c / b;

  const delta = Math.round(root / 2);
  let deltaW = Math.trunc(delta * aspectRatio);
  deltaW = Math.min(x1, imW - x2, deltaW);
  const deltaH = Math.min(y1, imH - y2, delta);

  const out: [number, number, number, number] = [
    Math.round(x1 - deltaW), Math.round(y1 - deltaH),
    Math.round(x2 + deltaW), Math.round(y2 + deltaH)
  ];
  out[0] = Math.max(0, Math.min(out[0], imW - 1));
  out[2] = Math.max(0, Math.min(out[2], imW - 1));
  out[1] = Math.max(0, Math.min(out[1], imH - 1));
  out[3] = Math.max(0, Math.min(out[3], imH - 1));
  return out;
}

/**
 * 1:1 port of Cotrans `extract_ballon_region` using @techstark/opencv-js.
 */
export function extractBallonRegion(
  pageData: Uint8ClampedArray | Uint8Array,
  pageWidth: number,
  pageHeight: number,
  ballonRect: [number, number, number, number],
  enlargeRatio = 1
): BallonRegionResult {
  const cv = getCvInstance();

  let x1 = ballonRect[0];
  let y1 = ballonRect[1];
  let x2 = ballonRect[2] + ballonRect[0];
  let y2 = ballonRect[3] + ballonRect[1];
  if (enlargeRatio > 1) {
    const enlarged = enlargeWindow(
      [x1, y1, x2, y2], pageWidth, pageHeight, enlargeRatio,
      ballonRect[2] !== 0 ? ballonRect[3] / ballonRect[2] : 1
    );
    x1 = enlarged[0];
    y1 = enlarged[1];
    x2 = enlarged[2];
    y2 = enlarged[3];
  }
  x1 = Math.max(0, Math.min(Math.round(x1), pageWidth - 1));
  x2 = Math.max(x1 + 1, Math.min(Math.round(x2), pageWidth));
  y1 = Math.max(0, Math.min(Math.round(y1), pageHeight - 1));
  y2 = Math.max(y1 + 1, Math.min(Math.round(y2), pageHeight));

  const oriW = x2 - x1;
  const oriH = y2 - y1;

  let pageMat = new cv.Mat(pageHeight, pageWidth, cv.CV_8UC4);
  pageMat.data.set(pageData);
  let rect = new cv.Rect(x1, y1, oriW, oriH);
  let img = pageMat.roi(rect);
  
  let imgRGB = new cv.Mat();
  cv.cvtColor(img, imgRGB, cv.COLOR_RGBA2RGB);

  let scaleR = 1;
  if (oriH > 300 && oriW > 300) {
    scaleR = 0.6;
  } else if (oriH < 120 || oriW < 120) {
    scaleR = 1.4;
  }

  let resizedImg = imgRGB;
  if (scaleR !== 1) {
    resizedImg = new cv.Mat();
    cv.resize(imgRGB, resizedImg, new cv.Size(Math.trunc(oriW * scaleR), Math.trunc(oriH * scaleR)), 0, 0, cv.INTER_AREA);
  }
  
  let h = resizedImg.rows;
  let w = resizedImg.cols;
  let img_area = h * w;

  let cpimg = new cv.Mat();
  cv.GaussianBlur(resizedImg, cpimg, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
  
  let detected_edges = new cv.Mat();
  cv.Canny(cpimg, detected_edges, 70, 140, 3, true);
  
  cv.rectangle(detected_edges, new cv.Point(0, 0), new cv.Point(w - 1, h - 1), new cv.Scalar(255), 1, cv.LINE_8);
  
  let cons = new cv.MatVector();
  let hiers = new cv.Mat();
  cv.findContours(detected_edges, cons, hiers, cv.RETR_CCOMP, cv.CHAIN_APPROX_NONE);
  
  cv.rectangle(detected_edges, new cv.Point(0, 0), new cv.Point(w - 1, h - 1), new cv.Scalar(0), 1, cv.LINE_8);

  let ballon_mask = cv.Mat.zeros(h, w, cv.CV_8U);
  let min_retval = Infinity;
  let mask = cv.Mat.zeros(h, w, cv.CV_8U);
  let difres = 10;
  let seedpnt = new cv.Point(Math.trunc(w / 2), Math.trunc(h / 2));

  for (let i = 0; i < cons.size(); i++) {
    let contour = cons.get(i);
    let brect = cv.boundingRect(contour);
    if (brect.width * brect.height < img_area * 0.4) {
      contour.delete();
      continue;
    }

    cv.drawContours(mask, cons, i, new cv.Scalar(255), 2);
    let cpmask = mask.clone();
    cv.rectangle(mask, new cv.Point(0, 0), new cv.Point(w - 1, h - 1), new cv.Scalar(255), 1, cv.LINE_8);
    
    let rectVal = new cv.Rect();
    let retval = cv.floodFill(cpmask, new cv.Mat(), seedpnt, new cv.Scalar(127), rectVal, new cv.Scalar(difres, difres, difres), new cv.Scalar(difres, difres, difres), 4);
    
    if (retval <= img_area * 0.3) {
      cv.drawContours(mask, cons, i, new cv.Scalar(0), 2);
    }
    if (retval < min_retval && retval > img_area * 0.3) {
      min_retval = retval;
      ballon_mask.delete();
      ballon_mask = cpmask.clone();
    }
    cpmask.delete();
    contour.delete();
  }

  let tmp = new cv.Mat();
  let scalar127 = new cv.Mat(h, w, cv.CV_8U, new cv.Scalar(127));
  cv.subtract(scalar127, ballon_mask, tmp);
  ballon_mask.delete();
  ballon_mask = tmp;

  let kernelDilate = cv.Mat.ones(3, 3, cv.CV_8U);
  let tmp2 = new cv.Mat();
  cv.dilate(ballon_mask, tmp2, kernelDilate, new cv.Point(-1, -1), 1);
  ballon_mask.delete();
  ballon_mask = tmp2;

  let rectVal2 = new cv.Rect();
  let ballon_area = cv.floodFill(ballon_mask, new cv.Mat(), seedpnt, new cv.Scalar(30), rectVal2, new cv.Scalar(difres, difres, difres), new cv.Scalar(difres, difres, difres), 4);
  
  let scalar30 = new cv.Mat(h, w, cv.CV_8U, new cv.Scalar(30));
  tmp2 = new cv.Mat();
  cv.subtract(scalar30, ballon_mask, tmp2);
  ballon_mask.delete();
  ballon_mask = tmp2;

  cv.threshold(ballon_mask, ballon_mask, 1, 255, cv.THRESH_BINARY);
  cv.bitwise_not(ballon_mask, ballon_mask);

  let box_kernel = Math.trunc(Math.sqrt(ballon_area) / 30);
  if (box_kernel > 1) {
    let bKernel = cv.Mat.ones(box_kernel, box_kernel, cv.CV_8U);
    cv.dilate(ballon_mask, ballon_mask, bKernel, new cv.Point(-1, -1), 1);
    cv.erode(ballon_mask, ballon_mask, bKernel, new cv.Point(-1, -1), 1);
    bKernel.delete();
  }

  if (scaleR !== 1) {
    let finalMask = new cv.Mat();
    cv.resize(ballon_mask, finalMask, new cv.Size(oriW, oriH));
    ballon_mask.delete();
    ballon_mask = finalMask;
  }

  let maskData = new Uint8Array(oriW * oriH);
  maskData.set(ballon_mask.data);

  const result: BallonRegionResult = {
    mask: { data: maskData, width: oriW, height: oriH },
    xyxy: [x1, y1, x2, y2]
  };

  pageMat.delete();
  img.delete();
  imgRGB.delete();
  if (scaleR !== 1) resizedImg.delete();
  cpimg.delete();
  detected_edges.delete();
  cons.delete();
  hiers.delete();
  mask.delete();
  scalar127.delete();
  kernelDilate.delete();
  scalar30.delete();
  ballon_mask.delete();

  return result;
}

export function maskCentroid(img: GrayImage): { x: number; y: number } {
  const cv = getCvInstance();
  let mat = new cv.Mat(img.height, img.width, cv.CV_8UC1);
  mat.data.set(img.data);
  let moments = cv.moments(mat);
  mat.delete();
  if (moments.m00 === 0) return { x: Math.floor(img.width / 2), y: Math.floor(img.height / 2) };
  return { x: Math.trunc(moments.m10 / moments.m00), y: Math.trunc(moments.m01 / moments.m00) };
}

export function maskBoundingRect(img: GrayImage): { x: number; y: number; w: number; h: number } {
  let minX = img.width, minY = img.height, maxX = 0, maxY = 0;
  let found = false;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[y * img.width + x] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        found = true;
      }
    }
  }
  if (!found) {
    return { x: 0, y: 0, w: img.width, h: img.height };
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function rotateMaskExpand(img: GrayImage, angleDeg: number): GrayImage {
  const cv = getCvInstance();
  let mat = new cv.Mat(img.height, img.width, cv.CV_8UC1);
  mat.data.set(img.data);
  
  let center = new cv.Point(img.width / 2, img.height / 2);
  let M = cv.getRotationMatrix2D(center, angleDeg, 1.0);
  
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const newW = Math.ceil(img.width * cos + img.height * sin);
  const newH = Math.ceil(img.width * sin + img.height * cos);
  
  M.data64F[2] += (newW / 2) - center.x;
  M.data64F[5] += (newH / 2) - center.y;
  
  let dst = new cv.Mat();
  cv.warpAffine(mat, dst, M, new cv.Size(newW, newH), cv.INTER_NEAREST, cv.BORDER_CONSTANT, new cv.Scalar(0));
  
  let outData = new Uint8Array(newW * newH);
  outData.set(dst.data);
  
  mat.delete();
  M.delete();
  dst.delete();
  
  return { data: outData, width: newW, height: newH };
}
