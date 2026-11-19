# Hướng dẫn cho người không biết code

Mã nguồn này là một **app luyện thi dùng được cho mọi kỳ thi**. Bạn không phải viết lại app. Bạn chỉ cần làm một
**gói đề** (gọi là *test pack*): một file cấu hình (tên kỳ thi, các phần thi, thời gian, cách tính điểm, màu, logo)
và các câu hỏi. App lo phần còn lại: bản đồ bài học, thi thử có giờ, chấm điểm, ôn câu sai, tài khoản phụ huynh và
học sinh, báo cáo, trang chủ, chạy cả khi mất mạng.

Trong mã có sẵn 2 gói mẫu để bạn xem: `shsat-sample` (SHSAT, 2 phần thi) và `demo-isee` (ISEE, 4 phần thi).

Làm theo thứ tự dưới đây. Mỗi khối lệnh, bạn chép và dán vào cửa sổ dòng lệnh (Terminal trên Mac, PowerShell trên
Windows), rồi bấm Enter.

---

## Bước 1. Cài 2 công cụ (một lần duy nhất)

1. **Node.js** bản 22 trở lên: vào https://nodejs.org, tải bản **LTS**, cài như phần mềm bình thường.
2. **Git**: Mac thường có sẵn. Windows tải ở https://git-scm.com và cài với các lựa chọn mặc định.

Kiểm tra đã cài xong (mở lại cửa sổ dòng lệnh sau khi cài):

```bash
node -v
```

Thấy `v22...` hoặc số lớn hơn là được.

Nên cài thêm **VS Code** (https://code.visualstudio.com) để mở và sửa file cho dễ.

## Bước 2. Tải mã nguồn về máy

```bash
git clone https://github.com/lythetrieu/practice-engine.git
```

```bash
cd practice-engine
```

(Không dùng Git cũng được: trên trang GitHub bấm nút **Code** rồi **Download ZIP**, giải nén, rồi mở cửa sổ dòng lệnh
ở thư mục đó.)

## Bước 3. Cài đặt và chạy thử

```bash
npm install
```

```bash
npm run setup
```

```bash
npm run dev
```

Mở trình duyệt vào **http://localhost:4321/app/**. Đây là app với gói mẫu SHSAT. Lúc chạy trên máy bạn, app cho
vào thẳng không cần đăng nhập. Muốn thử đăng nhập phụ huynh ở http://localhost:4321/account/: mã đăng nhập 6 số được
**in ra trong cửa sổ dòng lệnh** (không gửi email thật).

Muốn tắt app: bấm `Ctrl + C` trong cửa sổ dòng lệnh.

Xem gói mẫu ISEE (khác số phần thi, khác giờ, khác màu):

```bash
npm run dev -- --pack demo-isee
```

## Bước 4. Đổi sang kỳ thi (ngách) của bạn

1. **Chép gói mẫu thành gói của bạn** (đổi `my-exam` thành tên bạn muốn, viết liền không dấu):

   Mac:
   ```bash
   cp -r packs/demo-isee packs/my-exam
   ```
   Windows (PowerShell):
   ```bash
   Copy-Item -Recurse packs/demo-isee packs/my-exam
   ```

2. **Mở thư mục `packs/my-exam` trong VS Code và sửa:**
   - `pack.yaml`: tên app, tên kỳ thi, các phần thi, số câu và số phút của bài thi thử, cách tính điểm, ngày thi,
     màu thương hiệu, nội dung trang chủ, thông tin pháp lý (khối `legal`).
   - `brand/logo.svg`: logo của bạn (một file SVG).
   - `skills.yaml`: danh sách kỹ năng.
   - `curriculum.yaml`: các "thế giới" và bài học trên bản đồ (mỗi thế giới tối đa 5 bài).
   - `questions/*.yaml`: câu hỏi. `passages/*.yaml`: bài đọc.

3. **Kiểm tra gói** (lệnh này chỉ ra đúng file, đúng câu bị sai và sai chỗ nào):

   ```bash
   npm run validate -- --pack my-exam
   ```

4. **Chạy app với gói của bạn:**

   ```bash
   npm run dev -- --pack my-exam
   ```

   Khi app đang chạy, mỗi lần bạn lưu file trong gói, app tự tải lại. Nếu file có lỗi, lỗi hiện ngay trong cửa sổ
   dòng lệnh và trên trình duyệt.

Hướng dẫn đầy đủ từng trường và 13 dạng câu hỏi (kèm ví dụ) nằm ở
[docs/authoring-a-pack.md](docs/authoring-a-pack.md) (tiếng Anh). Mẹo: đưa file đó cho Claude hoặc ChatGPT và nhờ nó
viết câu hỏi đúng định dạng, rồi chạy `npm run validate` để kiểm tra.

**Lỗi hay gặp nhất:** trong `pack.yaml`, một giá trị có dấu phẩy nằm trong `{ ... }` phải đặt trong ngoặc kép. Ví dụ
`note: "ELL, IEP or 504"`. Màu cũng phải có ngoặc kép: `primary: "#2E3F8F"`.

## Bước 5. Đưa lên mạng (Cloudflare, có gói miễn phí)

Cần một tài khoản Cloudflare (https://dash.cloudflare.com, đăng ký miễn phí). Chạy lần lượt:

1. Đăng nhập Cloudflare từ máy (trình duyệt sẽ mở ra để bạn bấm đồng ý):
   ```bash
   npx wrangler login
   ```
2. Tạo cơ sở dữ liệu:
   ```bash
   npx wrangler d1 create practice-engine
   ```
   Lệnh in ra một dòng `database_id = "..."`. Mở file `wrangler.jsonc`, tìm `"database_id"` và dán mã đó vào thay
   cho `00000000-0000-0000-0000-000000000000`.
3. Tạo các bảng dữ liệu trên Cloudflare:
   ```bash
   npm run db:migrate:remote
   ```
4. Đặt mật khẩu bí mật cho máy chủ. Lệnh sẽ hỏi giá trị: gõ một chuỗi dài ngẫu nhiên bất kỳ (khác chuỗi trên máy bạn)
   rồi Enter:
   ```bash
   npx wrangler secret put PASSWORD_PEPPER
   ```
5. Đóng gói app với gói đề của bạn rồi đưa lên:
   ```bash
   npm run build -- --pack my-exam
   ```
   ```bash
   npm run deploy
   ```
   Cuối cùng lệnh in ra địa chỉ dạng `https://practice-engine.<tên-bạn>.workers.dev`. Đó là app của bạn trên mạng.

**Để phụ huynh đăng nhập được trên bản thật**, cần bật gửi email: trong Cloudflare vào *Email Service > Email
Sending*, thêm tên miền của bạn, rồi sửa `MAIL_FROM` trong `wrangler.jsonc` thành một địa chỉ thuộc tên miền đó
(ví dụ `login@tenmiencuaban.com`). Sửa xong chạy lại bước 5. Chưa làm bước này thì trang đăng nhập báo "chưa thiết
lập email" (vì lý do an toàn, bản thật không bao giờ in mã ra).

Mỗi lần sửa gói đề hoặc `wrangler.jsonc`, chạy lại 2 lệnh ở bước 5.

## Thêm (không bắt buộc)

- **Tên miền riêng:** thêm `routes` trong `wrangler.jsonc` (có ví dụ trong file), rồi deploy lại.
- **Quyền quản trị (trang `/admin/`):** điền email phụ huynh của bạn vào `ADMIN_EMAILS` trong `wrangler.jsonc`. Xem
  báo lỗi câu hỏi, lỗi app và thống kê từng câu (câu nào quá dễ, quá khó).
- **Gia sư AI "Pip":** tắt sẵn. Cách bật và chi phí ở [docs/pip.md](docs/pip.md). Đổi tên và hình linh vật trong
  `pack.yaml` (khối `mascot`).

## Quy tắc bắt buộc

- **Tự viết câu hỏi.** Không chép, không sửa lại câu hỏi của đề thi chính thức, sách luyện thi hay trang web khác.
  Đó là tài sản có bản quyền.
- **App cho trẻ em:** học sinh chỉ bấm chọn, không gõ chữ; không hiện giá tiền trên màn hình trẻ thấy. App đã làm
  sẵn như vậy, đừng tắt đi.
- **Trước khi chạy thật:** điền khối `legal` trong `pack.yaml` (tên đơn vị, email liên hệ). Trang `/privacy/` và
  `/terms/` là bản mẫu, nên nhờ người có chuyên môn pháp lý xem lại.

## Gặp lỗi?

| Thông báo | Cách sửa |
|---|---|
| `node: command not found` hoặc `Node ... is too old` | Cài Node.js 22 trở lên (Bước 1), mở lại cửa sổ dòng lệnh. |
| `Run npm install first` | Chạy `npm install` trong thư mục `practice-engine`. |
| `PASSWORD_PEPPER is missing` | Trên máy: chạy `npm run setup`. Trên Cloudflare: làm lại Bước 5 mục 4. |
| `Unrecognized key` khi kiểm tra gói | Một giá trị có dấu phẩy chưa đặt trong ngoặc kép (xem Bước 4). |
| `the full test asks N ... but the pack has only M` | Số câu bài thi thử trong `pack.yaml` lớn hơn số câu bạn có. Thêm câu hoặc giảm số. |
| Cổng 4321 đang bận | Đã có một app đang chạy. Tắt nó (`Ctrl + C`) hoặc chạy `npx astro dev stop`. |

Mã nguồn dùng giấy phép MIT: bạn được dùng, sửa, và làm sản phẩm thương mại, chỉ cần giữ file `LICENSE`.
