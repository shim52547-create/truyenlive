# TruyệnFull AI Voice 🎧

Tool web đọc truyện từ **truyenfull.live** thành giọng nói bằng **giọng AI Google (tiếng Việt)** — tự động đọc hết chương rồi chuyển sang chương kế tiếp cho đến khi bạn nhấn **Dừng**.

## Tính năng

- 📖 Dán link truyện TruyenFull → tự tải thông tin truyện + toàn bộ danh sách chương
- ▶️ **Chọn chương để phát**: click chương nào nghe ngay chương đó (kể cả khi đang dừng)
- 🔍 **Tìm kiếm chương** theo số hoặc tên (tiện với truyện 500+ chương)
- 🔄 Tự động đọc hết chương → chuyển chương tiếp theo liên tục (bật/tắt được)
- ⏸️ Phát / Tạm dừng / Dừng / Tua tới-lui 10 giây / kéo thanh tiến trình
- 🎚️ Điều chỉnh tốc độ đọc (0.5x – 2x), âm lượng
- 👀 Hiển thị nội dung chương đang đọc, highlight chương hiện tại trong danh sách
- 🚫 Tùy chọn bỏ qua quảng cáo / thông báo trong chương
- 💾 Cache giọng đọc trên máy → nghe lại chương đã đọc tức thì, khỏi tải lại

## Yêu cầu máy tính

- Cài **Node.js 20+** (tải tại https://nodejs.org) hoặc **Bun** (https://bun.sh)
- Có kết nối internet (để lấy nội dung truyện + tạo giọng đọc)

## Cách chạy (3 bước)

Mở Terminal (hoặc CMD/PowerShell) tại thư mục đã giải nén, chạy lần lượt:

```bash
# Bước 1: Cài thư viện
npm install

# Bước 2: Khởi tạo database (chạy 1 lần duy nhất)
npm run db:push

# Bước 3: Chạy tool
npm run dev
```

Sau đó mở trình duyệt vào địa chỉ: **http://localhost:3000**

> Nếu dùng Bun thì thay `npm install` bằng `bun install` và chạy `bun run dev`.

## Cách sử dụng

1. **Bước 1** — Dán link truyện (ví dụ `https://truyenfull.live/dan-dao-tong-su-chi-thi-tieu-ha-me/`) → nhấn **Lấy thông tin truyện**
2. **Bước 2** — Cài giọng đọc: chọn giọng Google tiếng Việt, chỉnh tốc độ, âm lượng
3. **Bước 3** — Tùy chọn: bật/tắt tự động chuyển chương, đọc toàn bộ chương, bỏ quảng cáo
4. **Bước 4** — Nhấn **Bắt đầu** để đọc từ chương hiện tại, **hoặc click thẳng vào 1 chương bất kỳ trong danh sách để phát ngay từ chương đó**. Muốn dừng hẳn thì nhấn **Dừng**.

## Cấu trúc chính (dành cho ai muốn sửa code)

| File | Chức năng |
|------|-----------|
| `src/app/page.tsx` | Giao diện web toàn bộ tool |
| `src/components/reader/engine.ts` | Máy phát audio: chia đoạn, tải giọng đọc, phát tuần tự, tự chuyển chương |
| `src/lib/scraper.ts` | Lấy nội dung truyện/chương từ truyenfull.live |
| `src/lib/tts.ts` | Gọi giọng đọc Google tiếng Việt, chống giới hạn tần suất |
| `src/lib/text-utils.ts` | Chia nhỏ đoạn văn cho TTS, ước tính thời lượng |
| `src/lib/cache.ts` | Cache giọng đọc trên đĩa (thư mục `.cache/`) |
| `src/app/api/` | Các API: `/api/story`, `/api/chapters`, `/api/chapter`, `/api/tts`, `/api/image`, `/api/cache` |

## Lưu ý

- Giọng đọc là **Google Translate TTS (vi-VN)** chạy qua máy chủ của tool — cần internet khi đọc chương mới; chương đã nghe rồi sẽ phát lại từ cache cực nhanh.
- Nếu truyện quá dài, danh sách chương tải về theo từng đợt (mỗi đợt 8 trang) — vẫn chọn được chương ngay khi đang tải.
- Trình duyệt có thể chặn tự phát audio lần đầu → tool sẽ hiện thông báo, bạn chỉ cần nhấn nút **Phát** là tiếp tục.
- Nút icon ⚙️ ở góc phải trên: xem dung lượng cache và xóa cache khi cần.
- Vui lòng sử dụng hợp lý, tôn trọng bản quyền tác giả truyện.
