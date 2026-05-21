# Read Aloud — Bilingual Fork

Extension đọc truyện online với chế độ song ngữ Việt–Anh, fork từ [Read Aloud](https://github.com/ken107/read-aloud) với các tính năng tùy chỉnh cho việc đọc tiểu thuyết web tiếng Việt.

---

## Tính năng

### Chế độ đọc

| Nút | Mode | Hành vi |
|-----|------|---------|
| **Gốc+EN** | Bilingual | Đọc từng câu VN → dịch và đọc EN → câu tiếp theo |
| **Gốc** | Original | Chỉ đọc bản gốc, highlight từng câu, không dịch |

### Bilingual (Gốc+EN)
- Mỗi câu được split và đọc riêng (VN trước, EN sau)
- Dịch tự động qua Google Translate / Gemini API
- Prefetch dịch 8 chunk trước để không bị delay
- Ô dịch EN hiện ngay bên dưới highlight

### Original (Gốc)
- Highlight từng câu theo từng paragraph như UI web
- Không gọi API dịch, không hiển thị frame EN
- Nhanh hơn, phù hợp khi đã quen nội dung

### Tự động chuyển chương
Bật nút **⏭** trong toolbar: khi đọc xong chương, extension tự navigate sang chương tiếp theo và đọc luôn mà không cần nhấn Play lại.

### Giao diện
- Dark mode toggle
- Tăng/giảm font size và window size
- Highlight đoạn đang đọc với word-level marking

---

## Hỗ trợ webnovel.vn

Handler riêng `js/content/webnovel-vn.js` xử lý hai cấu trúc HTML của trang:

**Chương miễn phí** (`<br><br>` based)
- Walk DOM thủ công, skip ad divs (`ins.adsbygoogle`)
- Check CSS visibility để bỏ qua hidden elements

**Chương trả phí / unlocked** (`<P display:flex>` + `<SPAN>` con)
- Phát hiện tự động qua số lượng `<p>` element
- Mỗi `<p>` = 1 đoạn văn riêng
- Sort SPAN con theo CSS `order` value rồi theo vị trí visual (`getBoundingClientRect`) để undo CSS flex-order scrambling của site

**Auto-next chapter**: đọc `a[rel="next"]` để lấy URL chương sau.

---

## Cài đặt (Load unpacked)

1. Clone repo hoặc download ZIP
2. Mở `chrome://extensions`
3. Bật **Developer mode**
4. Chọn **Load unpacked** → trỏ vào thư mục này

---

## Cấu trúc project

```
js/
├── content.js              # Content script entry, route sites → handlers
├── document.js             # Doc/Tab source, bilingual + original chunk logic
├── speech.js               # TTS engine wrapper, chunk playlist
├── player.js               # Playback control (play/pause/stop/forward/rewind)
├── popup.js                # Popup UI, highlighting, translate popup
├── tts-engines.js          # TTS engine adapters (browser, Google, AWS, Azure...)
└── content/
    ├── webnovel-vn.js      # webnovel.vn — VN novel site handler
    ├── tiemtruyenchu.js    # tiemtruyenchu.com handler
    ├── html-doc.js         # Generic HTML fallback
    └── ...                 # Other site-specific handlers
```

---

## Phím tắt

| Phím | Hành động |
|------|-----------|
| `Alt+P` | Play / Pause |
| `Alt+O` | Play / Stop |
| `Alt+,` | Rewind |
| `Alt+.` | Forward |

---

## Thêm handler cho site mới

1. Tạo `js/content/your-site.js`:

```javascript
var readAloudDoc = new function() {
  this.getCurrentIndex = function() { return 0 }

  this.getTexts = function(index) {
    if (index == 0) return parse()
    return null
  }

  // Optional: để auto-next chapter hoạt động
  this.getNextPageUrl = function() {
    var next = document.querySelector('a[rel="next"]')
    return next ? next.href : null
  }

  function parse() {
    var container = document.querySelector('#your-content-selector')
    if (!container) return null
    // trả về array các đoạn văn string
  }
}
```

2. Đăng ký trong `js/content.js`:

```javascript
else if (location.hostname == "your-site.com") return ["js/content/your-site.js"];
```

---

## Upstream

Fork từ [ken107/read-aloud](https://github.com/ken107/read-aloud) — MIT License.
