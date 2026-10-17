<div align="center">

[English](README.md) | [简体中文](README.zh-CN.md) | [Tiếng Việt](README.vi.md) | [日本語](README.ja.md)

# 🪁 Kites

### Đọc Mọi Bộ Manga Bằng Ngôn Ngữ Của Bạn. Trực Tiếp Trên Trình Duyệt.
**Không Cần Python • Không Cần Máy Chủ • Dịch Truyện AI 100% Cục Bộ & Bảo Mật Ngay Trong Tiện Ích Mở Rộng**

[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Free_Install-4285F4.svg?style=flat-square&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/pcaokchkdgnmfgjkljfpghlfohbdjcmj?utm_source=item-share-cb)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg?style=flat-square)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-success.svg?style=flat-square&logo=googlechrome&logoColor=white)](manifest.json)
[![WebGPU](https://img.shields.io/badge/Hardware-WebGPU%20Accelerated-orange.svg?style=flat-square&logo=webgpu&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)
[![Vite](https://img.shields.io/badge/Built%20with-React%2019%20%2B%20Vite-646CFF.svg?style=flat-square&logo=vite&logoColor=white)](package.json)

<br/>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/pcaokchkdgnmfgjkljfpghlfohbdjcmj?utm_source=item-share-cb">
    <img src="https://img.shields.io/badge/Available_in_the-Chrome_Web_Store-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Available in the Chrome Web Store" height="42" />
  </a>
  &nbsp;&nbsp;
  <a href="https://github.com/Unheat/Kites/releases/latest">
    <img src="https://img.shields.io/badge/GitHub_Releases-Download_.zip-24292e?style=for-the-badge&logo=github&logoColor=white" alt="Download Release .zip" height="42" />
  </a>
</p>

<br/>

[![Kites Hero Banner](./README_images/Gemini_Generated_Image_f7lh52f7lh52f7lh.jpeg)](./README_images/Gemini_Generated_Image_f7lh52f7lh52f7lh.jpeg)

</div>

---

## 💡 Tại sao lại chọn Kites?

Các công cụ dịch manga truyền thống thường đòi hỏi cài đặt môi trường Python phức tạp, hàng gigabyte gói CUDA nặng nề, hoặc bắt buộc phải tải toàn bộ lịch sử đọc truyện riêng tư của bạn lên máy chủ đám mây của bên thứ ba.

**Kites thay đổi hoàn toàn điều đó.** Đây là một tiện ích mở rộng (extension) Chrome siêu nhẹ, vận hành các mô hình thị giác và ngôn ngữ AI tiên tiến nhất **trực tiếp trên card đồ họa của bạn thông qua WebGPU**.

- ⚡ **Không cần cài đặt phức tạp:** Cài đặt chỉ với 1 cú click từ [Chrome Web Store](https://chromewebstore.google.com/detail/pcaokchkdgnmfgjkljfpghlfohbdjcmj?utm_source=item-share-cb) và bắt đầu đọc ngay lập tức. Không dòng lệnh terminal, không Python, không phụ thuộc môi trường ngoài.
- 🔒 **100% Cục bộ & Bảo mật:** Nhận diện ký tự quang học (OCR) và xóa thoại/cleaner nền diễn ra hoàn toàn trên thiết bị của bạn. Hình ảnh của bạn không bao giờ rời khỏi trình duyệt.
- 🎨 **Tẩy trắng & Khôi phục nền thông minh:** Công nghệ AI inpainting xóa sạch chữ gốc nhưng giữ trọn từng nét vẽ, hiệu ứng chuyển màu và lớp lưới screentone đặc trưng của manga.
- ✍️ **Typeset & Canh chỉnh tự nhiên:** Tự động đo kích thước khung thoại, cân bằng ngắt dòng hợp lý, tự co giãn cỡ chữ (font size) và chọn màu chữ/viền tương phản tối ưu.
- 🗨️ **Tự động mở rộng theo khung thoại (Smart Bubble Fit):** Sử dụng thuật toán nhận diện bóng thoại thông minh (Heuristic & Neural YOLO) để mở rộng các cột chữ hẹp CJK thành khung bong bóng tròn rộng rãi, loại bỏ hoàn toàn tình trạng chữ bị bóp nghẹt li ti.
- 📜 **Hỗ trợ trọn vẹn truyện tranh Webtoon dài tập:** Xử lý mượt mà các dải webtoon cuộn dọc cực dài ($>14.000\text{ px}$) nhờ thuật toán phân mảnh 1D trên bộ nhớ canvas ở độ phân giải gốc.
- 🛠️ **Tích hợp Kites Studio:** Dễ dàng sửa lại câu từ chưa ưng ý, kéo giãn khung thoại hoặc tinh chỉnh typography trực tiếp ngay tức thì.

---

## 🖼️ Trải nghiệm thực tế

### Tiếng Nhật → Tiếng Anh (Japanese → English)
> *Tác phẩm: 佐藤さんは知っていた của [@09ra_19ra](https://x.com/09ra_19ra)*

<div align="center">
<table>
  <tr>
    <th width="50%" align="center">Bản gốc tiếng Nhật (Original Japanese)</th>
    <th width="50%" align="center">Kites đã dịch (Kites Translated)</th>
  </tr>
  <tr>
    <td align="center">
      <img src="./README_images/input/demo2.jpeg" alt="Original Japanese Manga" width="100%" />
    </td>
    <td align="center">
      <img src="./README_images/result/demo2_result.png" alt="Kites English Translation" width="100%" />
    </td>
  </tr>
</table>
</div>

### Tiếng Nhật → Tiếng Việt (Japanese → Vietnamese)
> *Nguồn: [Pixiv Artwork #145272482](https://www.pixiv.net/en/artworks/145272482)*

<div align="center">
<table>
  <tr>
    <th width="50%" align="center">Bản gốc tiếng Nhật (Original Japanese)</th>
    <th width="50%" align="center">Kites đã dịch (Kites Translated)</th>
  </tr>
  <tr>
    <td align="center">
      <img src="./README_images/input/demo7.jpg" alt="Original Japanese Manga" width="100%" />
    </td>
    <td align="center">
      <img src="./README_images/result/demo7_result.png" alt="Kites Vietnamese Translation" width="100%" />
    </td>
  </tr>
</table>
</div>

---

## 🖱️ Dịch tại chỗ tức thì

Rê chuột qua bất kỳ khung tranh nào trên Twitter/X, Pixiv hoặc các trang đọc truyện. Nút dịch nổi gọn gàng sẽ xuất hiện thông qua CSS Anchor Positioning — chỉ cần nhấp để dịch ngay lời thoại trực tiếp trên trang truyện mà không cần copy-paste.

<div align="center">
  <img src="./README_images/UI-feature/hover-inplace-preview.png" alt="Kites In-Page Hover Translation Button" width="620px" />
</div>

- 🖱️ **Rê chuột (Hover):** Dịch tức thì bằng cách rê chuột lên khung truyện.
- 📌 **Ghim cố định (Persistent):** Giữ huy hiệu dịch luôn hiển thị trên tất cả hình ảnh truyện.
- 🚀 **Tự động dịch (Auto-Translate):** Tự động phát hiện và dịch các khung tranh mới khi bạn cuộn trang xuống.
- ✂️ **Chụp vùng chọn màn hình (Screen Crop):** Dịch các phần tử canvas được bảo vệ, web game WebGL hoặc vùng chọn tùy ý qua menu chuột phải hoặc phím tắt `Ctrl/Alt + Shift + X`.
- ⚡ **Phím tắt tiện lợi:** Nhấn `F` để xem nhanh ảnh gốc (raw), nhấn `Ctrl/Alt + Shift + Z` để dịch khung ảnh đang rê chuột, và `Ctrl/Alt + Shift + M` để mở trình đọc chương.
- 🎯 **Chuột phải:** Dịch bất kỳ hình ảnh nào trên web thông qua menu ngữ cảnh của trình duyệt.

---

## 📖 Trình đọc chương & Quét nhanh

Đọc trọn vẹn cả chương manga hoặc webtoon trong một giao diện tập trung, không phân tâm với tính năng tự động quét hàng loạt, chế độ cuộn dọc webtoon liền mạch, dịch nhiều trang song song và xuất file ZIP offline:

[![Kites Chapter Reader](./README_images/UI-feature/reader.jpg)](./README_images/UI-feature/reader.png)

- **Quét nhanh (Fast Scan):** Tự động cuộn trang và thu thập toàn bộ các khung truyện được tải trễ (lazy-loaded) trong chương vào hàng đợi dịch.
- **Đa dạng chế độ đọc:** Chuyển đổi linh hoạt giữa chế độ Webtoon cuộn dọc liên tục, Trang đơn (Single page), và Trang đôi (Double spread).
- **Dịch cả chương hàng loạt:** Dịch toàn bộ chương chỉ với một cú nhấp, kèm thanh tiến trình trực quan và cơ chế lưu trữ offline.
- **Xuất ZIP cả chương 1-click:** Đóng gói tất cả các trang đã dịch thành file lưu trữ ZIP đánh số ngăn nắp để đọc offline và lưu trữ, hoàn toàn không cần tải ảnh lên máy chủ.

---

## 🛠️ Trình biên tập Kites Studio tích hợp

Cần trau chuốt lại bản dịch hoặc chỉnh lại font chữ? Mở ngay **Kites Studio** toàn màn hình trực tiếp từ tiện ích mở rộng.

[![Kites Studio](./README_images/UI-feature/kite_studio_editing.jpg)](./README_images/UI-feature/studio-editor.png)

- **Chỉnh sửa trực tiếp tại chỗ:** Nhấp đúp vào bất kỳ bong bóng thoại nào để sửa lời thoại trực tiếp, hỗ trợ căn giữa dọc subpixel và tự động dàn trang (reflow) tức thì.
- **Canvas tương tác linh hoạt:** Kéo thả và thay đổi kích thước khung thoại với 8 điểm neo điều khiển.
- **Cọ xóa AI cục bộ (Inpaint Brush):** Tẩy xóa khuyết điểm, bóng thoại hoặc hiệu ứng âm thanh (SFX) chưa dịch với độ chính xác cao theo nét cọ.
- **So sánh trực quan song song:** So sánh giữa bản gốc, ảnh đã xóa chữ (cleaned) và ảnh đã typeset chỉ với 1 cú click.
- **Kiểm soát typography:** Tuỳ chỉnh kích thước font chữ, màu sắc, căn lề và độ giãn dòng trực tiếp.
- **Xuất ảnh 1-click:** Tải về trang truyện đã dịch sạch sẽ ở đúng độ phân giải gốc.

---

## 🎛️ Tuỳ chỉnh & Cài đặt tiện ích

Tuỳ biến ngôn ngữ đích, mô hình AI OCR và thuật toán xóa chữ từ popup giao diện trực quan:

<div align="center">
<table>
  <tr>
    <th width="33%" align="center">Bảng điều khiển nhanh (Quick Control)</th>
    <th width="33%" align="center">Trình đọc chương &amp; Quét (Reader)</th>
    <th width="34%" align="center">Cài đặt động cơ &amp; Mô hình (Settings)</th>
  </tr>
  <tr>
    <td align="center">
      <img src="./README_images/UI-feature/main-panel.jpg" alt="Kites Main Popup" width="95%" />
    </td>
    <td align="center">
      <img src="./README_images/UI-feature/reader-panel.jpg" alt="Kites Chapter Reader and Scanner Panel" width="95%" />
    </td>
    <td align="center">
      <img src="./README_images/UI-feature/setting-panel.jpg" alt="Kites Settings Panel" width="95%" />
    </td>
  </tr>
</table>
</div>

- **Bảng thuật ngữ tùy chỉnh (Custom Glossary):** Định nghĩa tên nhân vật, đại từ xưng hô và thuật ngữ riêng để hướng dẫn kết quả dịch của mô hình LLM.
- **Quy tắc theo tên miền:** Bật, tắt hoặc gán bộ chọn CSS tùy chỉnh cho từng trang web cụ thể.

---

## 🧠 Vận hành bởi AI hiện đại

| Thành phần | Tuỳ chọn | Mô tả chi tiết |
| :--- | :--- | :--- |
| **Dịch thuật (Translation)** | **WebLLM** *(WebGPU cục bộ)*<br/>**Cloud Shared Pool** *(100 lượt/ngày free)*<br/>**Google Translate** *(Miễn phí không giới hạn)*<br/>**Custom API** *(OpenAI, Claude, Gemini)* | Chạy không giới hạn LLM cục bộ trên trình duyệt (Qwen 3.5, Qwen 3, Gemma 3, Llama 3.2), dịch Google Translate không giới hạn, dùng cụm cloud cộng đồng (100 lượt/ngày miễn phí), hoặc kết nối API key riêng. |
| **Xóa thoại & Khôi phục nền (Inpainting)** | **LaMa Manga** *(Neural)*<br/>**AOT-GAN** *(Fast Neural)*<br/>**Telea Diffusion** *(Tức thì)*<br/>**Simple Fill** | Xóa chữ chuẩn xác trong ranh giới ký tự để bảo toàn tối đa nét vẽ gốc của truyện. |
| **Nhận diện chữ (OCR)** | **PaddleOCR v3 – v6** | Tiêu chuẩn công nghiệp trong nhận diện văn bản đa ngôn ngữ, hỗ trợ cắt ghép 1D mượt mà cho truyện dài tập. |
| **Khớp bóng thoại (Bubble Fit)** | **Neural YOLO** *(WebGPU)*<br/>**Heuristic** *(Tức thì)*<br/>**Classic MST** | Cắt bỏ đuôi thoại và mở rộng khoảng trống bong bóng tự nhiên, loại bỏ hoàn toàn chữ bị ép nhỏ. |

---

## 🚀 Bắt đầu nhanh & Cài đặt

### Cách 1: Chrome Web Store (Khuyên dùng • Cài đặt 1-Click)

Cách chính thức và thuận tiện nhất để cài đặt Kites. Tự động cập nhật phiên bản mới và đã qua kiểm duyệt bảo mật của Google:

<div align="left">
  <a href="https://chromewebstore.google.com/detail/pcaokchkdgnmfgjkljfpghlfohbdjcmj?utm_source=item-share-cb">
    <img src="https://img.shields.io/badge/Add_to_Chrome-Free_Install-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Add to Chrome" height="38" />
  </a>
</div>

1. Mở trang **[Kites trên Chrome Web Store](https://chromewebstore.google.com/detail/pcaokchkdgnmfgjkljfpghlfohbdjcmj?utm_source=item-share-cb)**.
2. Nhấp **Thêm vào Chrome** và xác nhận quyền cài đặt.
3. Ghim **Kites** lên thanh công cụ trình duyệt để dễ dàng sử dụng.
4. Lướt bất kỳ trang truyện manga hoặc minh họa nào (trên Twitter/X, Pixiv, MangaDex, v.v.) và rê chuột vào khung tranh để dịch!

---

### Cách 2: Tải file Zip dựng sẵn (Cài đặt thủ công — Không cần dùng terminal)

Phù hợp cho môi trường offline, thử nghiệm tính năng mới hoặc dùng các bản dựng cụ thể:

1. Tải về file **[`kites.zip`](https://github.com/Unheat/Kites/releases/latest)** từ bản phát hành GitHub Release mới nhất.
2. Giải nén file `.zip` vừa tải vào một thư mục trên máy tính của bạn.
3. Trong trình duyệt Chrome, mở đường dẫn `chrome://extensions/`.
4. Bật chế độ **Chế độ dành cho nhà phát triển (Developer mode)** ở góc trên bên phải.
5. Nhấp nút **Tải tiện ích đã giải nén (Load unpacked)** ở góc trên bên trái và chọn thư mục vừa giải nén.
6. Ghim **Kites** lên thanh công cụ trình duyệt và bắt đầu thưởng thức truyện tranh ngay!

---

### Cách 3: Biên dịch từ mã nguồn (Dành cho lập trình viên)

```bash
# 1. Clone repository
git clone https://github.com/Unheat/Kites.git
cd Kites

# 2. Cài đặt thư viện phụ thuộc và build tiện ích
npm ci
npm run build
```

1. Trong Chrome, mở đường dẫn `chrome://extensions/`.
2. Bật công tắc **Chế độ dành cho nhà phát triển (Developer mode)**.
3. Nhấp **Tải tiện ích đã giải nén (Load unpacked)** và chọn thư mục `dist/` vừa được tạo ra.
4. Ghim **Kites** lên thanh công cụ và bắt đầu trải nghiệm!

---

## 🤝 Đóng góp & Tài liệu phát triển

Chúng tôi rất hoan nghênh sự đóng góp từ các lập trình viên, dịch giả và những người đam mê truyện tranh!

- 📖 **[Trung tâm tài liệu](docs/README.md)** — Sơ đồ kiến trúc, đặc tả pipeline và các ràng buộc hệ thống.
- 📐 **[Bản đồ pipeline tương tác](docs/workflow.html)** — Mô phỏng trực quan thuật toán phát hiện, xóa chữ và dàn trang của Kites.
- 🛠️ **[Hướng dẫn đóng góp](CONTRIBUTING.md)** — Cách thiết lập môi trường phát triển, chạy kiểm thử và gửi PR.

---

## 📜 Giấy phép & Lời cảm ơn

Kites được phát hành theo giấy phép **[GNU General Public License v3.0](LICENSE)**.

Gửi lời cảm ơn chân thành đến các dự án mã nguồn mở tuyệt vời đã đặt nền tảng cho Kites:
- **[manga-image-translator (Cotrans)](https://github.com/zyddnys/manga-image-translator):** Thuật toán mang tính đột phá về phân nhóm không gian văn bản và dàn trang.
- **[xianscan-rust](https://github.com/ArbenApura/xianscan-rust):** Kiến trúc inpainting chia mảng động và bộ lọc nhiễu OCR.
- **[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR):** Mô hình mạng nơ-ron nhận diện văn bản đa ngôn ngữ hiệu suất cao.
- **[@mlc-ai/web-llm](https://github.com/mlc-ai/web-llm):** Runtime chạy mô hình ngôn ngữ lớn (LLM) trên WebGPU ngay trong trình duyệt.

---

<div align="center">
  <sub>Được phát triển với ❤️ dành cho cộng đồng yêu thích truyện tranh. Hãy tặng Kites một ⭐ Star trên GitHub nếu bạn thấy tiện ích này hữu ích!</sub>
</div>
