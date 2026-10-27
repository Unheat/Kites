# Cotrans Default Region Renderer Specification

## 1. Overview & Purpose

The **Cotrans Default Region Renderer** is the final visual composition stage of the translation pipeline. It takes translated lines produced by one of the three typesetting strategies (Route 1, Route 2, or Route 3) and draws them directly onto the image canvas.

It is a 1:1 port of the Cotrans 2023 DEFAULT renderer (`rendering/__init__.py` and `text_render.py` from `cotrans.touhou.ai`), rewritten in TypeScript to execute native HTML5 Canvas 2D vector drawing.

* **High-Level Coordinator**: [`src/offscreen/utils/cotransDefaultRenderer.ts`](file:///Users/dangtruongan/study/Kites/src/offscreen/utils/cotransDefaultRenderer.ts) (261 lines)
* **Syllable Line Breaker**: [`src/offscreen/utils/renderer/cotransLineBreaker.ts`](file:///Users/dangtruongan/study/Kites/src/offscreen/utils/renderer/cotransLineBreaker.ts) (284 lines)
* **Text Rasterization & Inset Crop**: [`src/offscreen/utils/renderer/cotransTextRasterizer.ts`](file:///Users/dangtruongan/study/Kites/src/offscreen/utils/renderer/cotransTextRasterizer.ts) (207 lines)
* **Quad Geometry & Affine Math**: [`src/offscreen/utils/renderer/regionGeometry.ts`](file:///Users/dangtruongan/study/Kites/src/offscreen/utils/renderer/regionGeometry.ts) (139 lines)

---

## 2. Rigid 2D Affine Transformation Matrix

### 2.1 Why Vector Affine Transform Instead of OpenCV Homography?
Upstream Cotrans (Python) renders text onto a flat raster image and calls `cv2.findHomography` followed by `cv2.warpPerspective` to warp the bitmap onto the page.
In a browser extension, bitmap resampling causes severe bilinear blur and fuzzy text edges.

Because manga speech bubbles undergo **rigid Euclidean rotation and scaling** without perspective shear ($z$-axis tilt), Kites maps the destination quad using a native **2D Affine Transformation Matrix** directly on vector glyphs (`ctx.setTransform(a, b, c, d, e, f)`). This preserves native sub-pixel vector font anti-aliasing.

### 2.2 Mathematical Matrix Derivation
Given the 4 destination quad corners in order:
* Top-Left: $\mathbf{tl} = (x_{tl}, y_{tl})$
* Top-Right: $\mathbf{tr} = (x_{tr}, y_{tr})$
* Bottom-Right: $\mathbf{br} = (x_{br}, y_{br})$
* Bottom-Left: $\mathbf{bl} = (x_{bl}, y_{bl})$

The normalized edge lengths are computed across opposite edge midpoints:

$$\text{normH} = \left\| \frac{\mathbf{tl} + \mathbf{bl}}{2} - \frac{\mathbf{tr} + \mathbf{br}}{2} \right\|$$

$$\text{normV} = \left\| \frac{\mathbf{tl} + \mathbf{tr}}{2} - \frac{\mathbf{bl} + \mathbf{br}}{2} \right\|$$

The unit basis vectors along the horizontal top edge and vertical left edge form the transform matrix $\mathbf{M}$:

$$a = \frac{x_{tr} - x_{tl}}{\text{normH}}, \quad b = \frac{y_{tr} - y_{tl}}{\text{normH}}$$

$$c = \frac{x_{bl} - x_{tl}}{\text{normV}}, \quad d = \frac{y_{bl} - y_{tl}}{\text{normV}}$$

$$\mathbf{M} = \begin{bmatrix} a & c & x_{tl} \\ b & d & y_{tl} \\ 0 & 0 & 1 \end{bmatrix}$$

Calling `ctx.setTransform(a, b, c, d, x_{tl}, y_{tl})` aligns the coordinate system so local coordinates $(0, 0) \rightarrow (\text{normH}, \text{normV})$ map 1:1 onto the quad on the page.

---

## 3. Positioned Line Scanlines vs. Bounding Box Centering

### 3.1 The Waist-Pulling Problem in Multi-Lobe Balloons
In standard Cotrans 2023, the text block was vertically centered inside the container's outer bounding box:

$$y_{\text{start}} = \frac{\text{normV} - \text{totalBlockHeight}}{2}$$

In a figure-8 or hourglass bubble, this midpoint falls directly in the narrow constriction neck (20px width), pulling text 40–60px upward away from the bulb.

### 3.2 Koharu Positioned Line Scanlines
When the typesetter provides `PositionedLine[]`, each line is drawn at its exact computed scanline baseline:

$$y_i = \begin{cases} \text{positionedLine}[i].y & \text{if positionedLines present} \\ y_{\text{start}} + i \cdot \text{lineStep} & \text{otherwise} \end{cases}$$

$$x_i = \begin{cases} \text{positionedLine}[i].x + \frac{\text{positionedLine}[i].\text{width} - W_i}{2} & \text{if positionedLines present} \\ \frac{\text{normH} - W_{\text{max}}}{2} + \frac{W_{\text{max}} - W_i}{2} & \text{otherwise} \end{cases}$$

This ensures dialogue text sits comfortably in the wide belly of the bubble lobe.

---

## 4. Stroke Outline & Background Adaptivity

### 4.1 Stroke Geometry & Line Spacing
* **Stroke Outline Width**:
  $$\text{strokeWidth} = \max(1, \lfloor \text{fontSize} \times 0.07 \rfloor \times 2)$$
* **Inter-line Spacing**:
  $$\text{spacingY} = \lfloor \text{fontSize} \times 0.01 \rfloor$$
* **Drawing Order**: `ctx.strokeText()` is drawn first with `lineJoin = 'round'` and `miterLimit = 2`, followed by `ctx.fillText()`. This guarantees the outline never eats into the interior of thin letter glyphs.

### 4.2 Left-Edge Bleed Shield
To prevent text strokes from clipping off the left edge of the page canvas on dialogue hugging the margin:

$$\text{if } (x_{tl} + x_i < 4) \implies x_i = 4 - x_{tl}$$

---

## 5. Screen-Space Coordinate Point Rotation

When unrotating regions to measure bounding dimensions and rotating back:

$$\begin{bmatrix} x' \\ y' \end{bmatrix} = \begin{bmatrix} x_c \\ y_c \end{bmatrix} + \begin{bmatrix} \cos\theta & \sin\theta \\ -\sin\theta & \cos\theta \end{bmatrix} \begin{bmatrix} x - x_c \\ y - y_c \end{bmatrix}$$
