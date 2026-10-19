# Spesifikasi Proyek: Aplikasi Manajemen Agen Emas Perhiasan

- Versi: 0.2 (draf, siap dipakai sebagai konteks pengembangan)
- Tanggal: 19 Oktober 2026
- Bahasa dokumen: Indonesia. Nama kode, tabel, kolom, dan nilai status memakai bahasa Inggris.

---

## 0. Cara memakai dokumen ini (untuk AI agent)

Dokumen ini adalah sumber kebenaran untuk merancang dan membangun aplikasi. Baca seluruhnya sebelum menulis kode, lalu ikuti aturan berikut.

1. **Kerjakan per rilis**, bukan sekaligus. Mulai dari Rilis 1 (MVP) di bagian 14. Jangan membangun fitur Rilis 2 sampai 4 sebelum Rilis 1 selesai dan lolos kriteria selesai.
2. **Kebutuhan fungsional memakai ID** (`FR-xx`). Sebut ID itu di pesan commit, komentar, dan nama test supaya mudah ditelusuri.
3. **Aturan di bagian 9 (Aturan Bisnis dan Invarian) bersifat wajib**. Jika sebuah perubahan melanggarnya, hentikan dan tanyakan.
4. **Skema database di bagian 12 adalah acuan**. Perubahan skema dilakukan lewat migrasi Prisma, bukan dengan mengedit database langsung. Jika skema perlu berubah, jelaskan alasannya dan perbarui dokumen ini.
5. **Bagian bertanda (Asumsi) atau ada di bagian 16** belum dikonfirmasi pemilik toko. Gunakan nilai bawaan yang tertulis, buat mudah diubah (konfigurasi, bukan hardcode), dan catat sebagai keputusan terbuka.
6. **Jangan menambah fitur di luar cakupan**. Fitur yang ditunda (bagian 14.3) tidak boleh dibangun tanpa permintaan eksplisit.
7. Pengguna aplikasi bukan orang teknis. Prioritaskan kesederhanaan antarmuka, pesan galat yang jelas dalam bahasa Indonesia, dan keamanan data di atas fitur tambahan.

---

## 1. Ringkasan Produk

Aplikasi membantu sebuah toko/agen suplier emas perhiasan mengelola stok, penjualan di toko, penjualan keliling, dan pesanan khusus dari toko lain. Aplikasi berbentuk PWA (Progressive Web App) yang bisa dipakai di HP dan laptop dan **tetap berfungsi tanpa internet**. Pengguna hanya dua orang: pemilik dan satu anggota keluarga yang membantu.

## 2. Konteks Bisnis dan Masalah

Agen memiliki toko sendiri, menjual langsung ke pembeli, berkeliling menjual ke tempat lain, dan menerima permintaan pesanan dari toko lain (misalnya toko A meminta cincin model tertentu, lalu agen memesankannya ke pemasok).

Masalah yang diselesaikan:

- Stok sulit dilacak karena barang bisa berada di toko, dibawa keliling, atau sedang dipesan.
- Risiko selisih dan kehilangan pada penjualan keliling karena nilai barang tinggi dan tidak ada rekonsiliasi.
- Pesanan khusus mudah terlupa: status pemesanan, uang muka, dan kabar ke toko pemesan tidak tercatat.
- Harga emas berubah tiap hari sehingga perhitungan manual rawan salah.
- Koneksi internet tidak selalu tersedia, terutama saat keliling.

## 3. Tujuan dan Metrik Keberhasilan

| Tujuan | Metrik | Target (Asumsi) |
|---|---|---|
| Stok akurat | Selisih stok fisik vs sistem saat stok opname | di bawah 1% |
| Penjualan keliling terkontrol | Selisih rekonsiliasi per perjalanan | 0 item tanpa penjelasan |
| Transaksi cepat | Waktu membuat satu nota di kasir | di bawah 1 menit |
| Pesanan khusus tertib | Pesanan yang statusnya tercatat lengkap | 100% |
| Tahan offline | Transaksi offline tersinkron tanpa duplikat | 100% |

## 4. Pengguna dan Peran

Hanya dua pengguna: pemilik yang menjalankan toko, dan satu anggota keluarga yang membantu.

| Peran (`User.role`) | Deskripsi | Akses utama |
|---|---|---|
| `OWNER` (Pemilik) | Menjalankan toko | Seluruh fitur: harga emas, ongkos, pembatalan transaksi, laporan, pengaturan, audit, backup |
| `ASSISTANT` (Asisten) | Anggota keluarga yang membantu | Kasir, nota, lihat stok, pencatatan penjualan keliling. **Tidak dapat** mengubah harga emas atau ongkos. Pembatalan transaksi memerlukan PIN pemilik |

## 5. Ruang Lingkup

**Termasuk (seluruh versi 1):** master data (item, kadar, pelanggan, pemasok), harga emas harian, kasir dan nota, pesanan khusus, penjualan keliling dan rekonsiliasi, piutang dan pembayaran, laporan dasar, mode offline dan sinkronisasi, hak akses dan log audit.

**Tidak termasuk (versi 1):**

- Integrasi pembayaran digital otomatis
- Katalog online publik untuk toko pelanggan
- Pengambilan harga emas otomatis dari sumber eksternal (harga diinput manual)
- Aplikasi native Android/iOS terpisah
- Akuntansi lengkap (jurnal, pajak)

## 6. Alur Bisnis Utama

### 6.1 Penjualan di toko

1. Kasir mencari item atau scan barcode.
2. Sistem menghitung harga: berat × harga emas harian sesuai kadar + ongkos.
3. Kasir memilih pembayaran (tunai, transfer, atau campuran).
4. Nota dicetak atau dibuat PDF. Status item menjadi `SOLD`.

### 6.2 Penjualan keliling (Rilis 3)

1. Pembawa dan item yang dibawa dicatat (scan). Status item menjadi `ON_TRIP` dan terkunci untuk kasir toko.
2. Di lokasi, penjualan dicatat lewat HP, termasuk saat offline.
3. Setelah kembali, rekonsiliasi: item dibawa = item terjual + item dikembalikan.
4. Selisih ditandai dan harus dijelaskan sebelum perjalanan ditutup.

### 6.3 Pesanan khusus (Rilis 2)

1. Toko pemesan meminta barang (foto referensi, kadar, berat/ukuran, target tanggal). Status `REQUESTED`.
2. Admin memesan ke pemasok. Status `ORDERED`.
3. Barang tiba dan dicek. Status `ARRIVED`.
4. Pemesan dihubungi. Status `DONE`, atau `CANCELLED` sesuai aturan DP.

## 7. Kebutuhan Fungsional

Prioritas: **P0** wajib di rilis penuh, **P1** penting, **P2** bisa menyusul. Kolom **Rilis** menunjukkan kapan dikerjakan (lihat bagian 14); tanda "-" berarti ditunda sampai setelah Rilis 4.

| ID | Kebutuhan | Prioritas | Rilis |
|---|---|---|---|
| FR-01 | Login dengan dua akun: Pemilik dan Asisten | P0 | 1 |
| FR-02 | Pembatasan fitur sesuai peran; Asisten tidak dapat mengubah harga emas atau ongkos; pembatalan transaksi memerlukan PIN pemilik | P0 | 1 |
| FR-03 | PIN cepat di perangkat untuk membuka aplikasi | P0 | 1 |
| FR-04 | CRUD item: kode unik, jenis, kadar, berat, ongkos, foto, model | P0 | 1 |
| FR-05 | Pembuatan dan pencetakan label barcode item | P0 | 1 |
| FR-06 | Status item (`IN_STORE`, `ON_TRIP`, `ORDERED`, `SOLD`); satu item hanya satu status pada satu waktu | P0 | 1 |
| FR-07 | Log pergerakan stok untuk setiap perubahan | P0 | 1 |
| FR-08 | Stok opname dengan scan barcode | P1 | 4 |
| FR-09 | CRUD pelanggan/toko langganan dan pemasok | P1 | 4 |
| FR-10 | Input harga emas harian per kadar, dengan riwayat | P0 | 1 |
| FR-11 | Perhitungan harga jual otomatis | P0 | 1 |
| FR-12 | Nota menyimpan harga emas saat transaksi (snapshot) | P0 | 1 |
| FR-13 | Margin/ongkos berbeda per kategori pelanggan | P1 | - |
| FR-14 | Transaksi penjualan dengan banyak item | P0 | 1 |
| FR-15 | Pembayaran tunai, transfer, dan campuran | P0 | 1 |
| FR-16 | Cetak nota (printer thermal atau PDF) | P0 | 1 |
| FR-17 | Retur dan tukar barang | P1 | 4 |
| FR-18 | Tukar tambah/beli kembali emas lama dengan form taksir | P1 | 4 |
| FR-19 | Pembuatan pesanan khusus: foto referensi, spesifikasi, target tanggal | P0 | 2 |
| FR-20 | Alur status pesanan: `REQUESTED`, `ORDERED`, `ARRIVED`, `DONE`, `CANCELLED` | P0 | 2 |
| FR-21 | Pencatatan uang muka (DP) dan pelunasan | P0 | 2 |
| FR-22 | Keterkaitan pesanan dengan pemasok, harga beli, estimasi waktu | P1 | 2 |
| FR-23 | Tautan WhatsApp untuk mengabari pemesan | P1 | - |
| FR-24 | Pembuatan perjalanan: pembawa, tanggal, item dibawa lewat scan | P0 | 3 |
| FR-25 | Pencatatan penjualan selama perjalanan dari HP, termasuk offline | P0 | 3 |
| FR-26 | Rekonsiliasi saat perjalanan ditutup, dengan penandaan selisih | P0 | 3 |
| FR-27 | Pencatatan tujuan dan analisis rute terlaris | P1 | - |
| FR-28 | Piutang per toko, jatuh tempo, batas kredit | P1 | 4 |
| FR-29 | Pembayaran cicilan dan pengingat jatuh tempo | P1 | 4 |
| FR-30 | Saldo dalam gram untuk pembayaran dengan emas (Asumsi) | P2 | - |
| FR-31 | Laporan penjualan harian dan bulanan | P1 | 4 |
| FR-32 | Nilai total stok berdasarkan harga emas terkini | P1 | 4 |
| FR-33 | Produk terlaris dan toko dengan transaksi terbesar | P1 | 4 |
| FR-34 | Ekspor Excel/PDF | P2 | - |
| FR-35 | PWA dapat diinstal di HP dan laptop dan terbuka tanpa internet | P0 | 1 |
| FR-36 | Data yang dibutuhkan (item, harga, kadar, pelanggan) tersimpan lokal di perangkat | P0 | 1 |
| FR-37 | Transaksi saat offline masuk antrean lokal dan terkirim otomatis saat koneksi tersedia | P0 | 1 |
| FR-38 | Pengiriman ganda tidak menghasilkan transaksi ganda (ID unik dari perangkat) | P0 | 1 |
| FR-39 | Aturan konflik: item berstatus `ON_TRIP` tidak dapat dijual dari perangkat lain | P0 | 1 |
| FR-40 | Indikator status sinkronisasi dan daftar transaksi yang belum terkirim | P1 | 2 |
| FR-41 | Log aktivitas: siapa mengubah apa dan kapan (stok, harga, transaksi) | P0 | 1 |
| FR-42 | Transaksi final tidak dihapus, hanya dibatalkan dengan alasan | P0 | 1 |

## 8. Kebutuhan Non-Fungsional

| Aspek | Kebutuhan |
|---|---|
| Offline | Kasir dan penjualan keliling berjalan penuh tanpa internet |
| Performa | Pencarian item di bawah 1 detik pada 5.000 item (Asumsi); daftar panjang lancar di HP kelas menengah (gunakan virtualisasi daftar) |
| Keamanan | PIN di-hash (bukan disimpan polos), HTTPS bila lewat internet, data lokal di HP dibatasi, sesi dapat dicabut |
| Keandalan | Backup database otomatis harian ke penyimpanan eksternal, dan ke cloud bila ada internet |
| Integritas data | Transaksi database atomik: stok dan penjualan tidak boleh selisih |
| Kompatibilitas | Chrome/Edge terbaru di laptop; Chrome di Android; Safari iOS dengan keterbatasan PWA |
| Kemudahan | Antarmuka responsif, tombol besar untuk kasir, bahasa Indonesia |

## 9. Aturan Bisnis dan Invarian (WAJIB)

### 9.1 Tipe data

- Uang: `BigInt`, satuan rupiah. Dilarang memakai float. Total transaksi dapat melebihi 2,1 miliar sehingga `Int` 32-bit tidak cukup.
- Berat: `Int`, satuan miligram. Tampilkan ke pengguna dalam gram (bagi 1000).
- ID entitas yang dibuat di perangkat: UUID dari perangkat.
- Nilai `BigInt` tidak bisa langsung diserialisasi ke JSON. Sediakan satu fungsi konversi terpusat (misalnya ke string) di API dan klien.

### 9.2 Rumus harga

```
lineTotal = round(weightMg * pricePerGram / 1000) + laborCost
```

- `pricePerGram` diambil dari baris `GoldPrice` terbaru untuk kadar item pada saat transaksi. Harga diinput per kadar, sehingga tidak perlu faktor kemurnian terpisah (Asumsi: perlu dikonfirmasi).
- Pembulatan ke rupiah terdekat, setengah ke atas (Asumsi: perlu dikonfirmasi).
- Hitung dengan aritmetika bilangan bulat (`BigInt`), bukan float.
- `Sale.total = subtotal - discount`; `subtotal` = jumlah `lineTotal`.
- Jumlah `Payment.amount` pada satu `Sale` harus sama dengan `Sale.total` untuk transaksi lunas (kredit menyusul di Rilis 4).

### 9.3 Snapshot nota

`SaleItem` menyalin kode, nama, kadar, berat, `pricePerGram`, dan `laborCost` saat transaksi. Nota lama tidak boleh berubah ketika harga emas atau data item berubah.

### 9.4 Status item dan transisi yang diizinkan

| Dari | Ke | Pemicu | Syarat |
|---|---|---|---|
| (baru) | `IN_STORE` | Item didaftarkan | - |
| `IN_STORE` | `SOLD` | Penjualan di toko | Sale berhasil |
| `IN_STORE` | `ON_TRIP` | Perjalanan dimulai | Item masuk daftar perjalanan |
| `ON_TRIP` | `SOLD` | Penjualan saat keliling | Item ada di perjalanan yang sama |
| `ON_TRIP` | `IN_STORE` | Dikembalikan saat rekonsiliasi | Perjalanan sedang rekonsiliasi |
| `SOLD` | `IN_STORE` | Pembatalan (void) penjualan | Hanya dengan PIN pemilik |

Setiap transisi wajib menulis satu baris `StockMovement` dan satu baris `AuditLog`. Transisi di luar tabel ini ditolak. Satu item tidak boleh dijual dua kali.

Catatan: status `ORDERED` dicadangkan. Pelacakan pesanan khusus memakai `SpecialOrder.status`; item baru dibuat saat barang tiba (lihat bagian 16).

### 9.5 Pembuatan penjualan harus atomik

Satu penjualan diproses dalam **satu transaksi database**:

1. Periksa `ProcessedOp` untuk `opId` ini. Jika sudah ada, kembalikan hasil sebelumnya tanpa memproses ulang.
2. Pastikan semua item dapat dijual (status sesuai tabel 9.4). Jika ada yang tidak tersedia, tolak seluruh transaksi dengan alasan yang jelas.
3. Buat `Sale`, `SaleItem`, dan `Payment`.
4. Ubah status item, tulis `StockMovement`.
5. Tulis `AuditLog` dan `ProcessedOp`.

Jika salah satu langkah gagal, tidak ada yang tersimpan.

### 9.5.1 Nomor nota

Format `<User.code>-<YYYYMMDD>-<urut 3 digit>`, misalnya `A-20261019-003`. Urutan dihitung per akun per hari sehingga dua perangkat offline tidak menghasilkan nomor yang sama.

### 9.6 Pembatalan transaksi

- Transaksi final tidak pernah dihapus. Pembatalan mengubah `Sale.status` menjadi `VOIDED`, mengisi `voidReason`, `voidedAt`, `voidedById`.
- Hanya dengan PIN pemilik. Item kembali ke `IN_STORE`.

### 9.7 Hak akses

- `ASSISTANT` tidak dapat membuat `GoldPrice`, mengubah `Item.laborCost`, atau membatalkan penjualan tanpa PIN pemilik.
- Pemeriksaan hak akses dilakukan **di server**, bukan hanya di antarmuka.

### 9.8 Riwayat harga emas

`GoldPrice` hanya bertambah (append-only). Harga berlaku = baris terbaru per kadar menurut `effectiveAt`. Saat offline, aplikasi memakai harga terakhir yang tersimpan di perangkat dan menandai jika harga sudah lebih dari satu hari.

### 9.9 Pesanan khusus yang batal

Aturan DP saat batal (dikembalikan sebagian, hangus, atau dialihkan) belum diputuskan (Asumsi). Simpan keputusan di `SpecialOrder.cancelNote` dan jangan otomatiskan.

## 10. Arsitektur dan Tech Stack

| Bagian | Teknologi |
|---|---|
| Bahasa | TypeScript di seluruh proyek |
| Frontend | React + Vite, Tailwind CSS |
| PWA | vite-plugin-pwa (Workbox) |
| Penyimpanan offline di perangkat | Dexie.js (IndexedDB) |
| State | TanStack Query (data server), Zustand (state ringan) |
| Daftar panjang | TanStack Virtual |
| Backend | Node.js + Fastify |
| Database | SQLite (cukup untuk dua pengguna; backup = salin file) |
| ORM | Prisma (dapat dipindah ke PostgreSQL bila pengguna bertambah) |
| Validasi | Zod, dibagi lewat paket `shared` |
| Scan barcode | html5-qrcode atau BarcodeDetector API |
| Cetak/PDF | Cetak dari browser, atau pdf-lib (dibuat di klien agar jalan offline) |
| Monorepo | pnpm workspaces |

Penerapan:

- **Server lokal di toko**: satu laptop/PC kecil yang selalu menyala menjalankan API dan database. Perangkat lain mengakses lewat Wi-Fi toko.
- **Klien**: PWA di HP dan laptop. Data referensi disalin ke IndexedDB. Transaksi baru masuk antrean (outbox) lalu dikirim ke server.
- **Opsional (tahap lanjut)**: akses jarak jauh atau server cloud agar pemilik dapat memantau dari luar toko.

## 11. Struktur Proyek

```
emas-app/
├─ apps/
│  ├─ web/          # React + Vite + PWA + Dexie
│  └─ api/          # Fastify + Prisma (+ schema.prisma, migrasi, seed)
├─ packages/
│  └─ shared/       # tipe TypeScript, skema Zod, konstanta status, fungsi hitung harga
├─ docs/
│  └─ gold-app-spec.md   # dokumen ini
└─ package.json     # pnpm workspaces
```

Fungsi perhitungan harga (bagian 9.2) ditulis **sekali** di `packages/shared` dan dipakai di klien dan server, lengkap dengan unit test.

## 12. Model Data (Skema Prisma)

Skema berikut adalah acuan. Cakupannya: tabel MVP, ditambah tabel pesanan khusus dan penjualan keliling yang sudah disiapkan tetapi belum dipakai antarmuka sebelum rilisnya. Tabel piutang (Rilis 4) belum dibuat. Konfigurasi datasource berubah antar versi mayor Prisma, jadi sesuaikan dengan dokumentasi versi yang dipakai.

```prisma
// ============================================================
// Skema database: Aplikasi Manajemen Agen Emas Perhiasan
// Draf 0.1, mengacu ke PRD (SQLite + Prisma)
//
// Konvensi:
// - Uang  : BigInt, satuan rupiah (total transaksi bisa > 2,1 miliar,
//           melebihi batas Int 32-bit)
// - Berat : Int, satuan miligram (5,250 g = 5250 mg), tanpa desimal
// - ID    : String UUID. Data yang dibuat saat offline (Sale, Payment,
//           dst.) memakai UUID dari perangkat agar aman disinkronkan
// - Kolom status ditulis sebagai String dan divalidasi dengan Zod di
//   packages/shared. Nilai yang diizinkan ada di komentar tiap kolom
// - Tidak ada penghapusan data transaksi: pembatalan memakai status
// ============================================================

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

// ------------------------------------------------------------
// AKSES
// ------------------------------------------------------------

model User {
  id        String   @id @default(uuid())
  code      String   @unique // awalan nomor nota, mis. "A" atau "B"
  name      String
  role      String // OWNER | ASSISTANT
  pinHash   String
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  salesAsCashier  Sale[]          @relation("SaleCashier")
  salesVoided     Sale[]          @relation("SaleVoidedBy")
  goldPrices      GoldPrice[]
  stockMovements  StockMovement[]
  trips           Trip[]
  specialOrders   SpecialOrder[]
  auditLogs       AuditLog[]
  processedOps    ProcessedOp[]
}

// ------------------------------------------------------------
// MASTER DATA
// ------------------------------------------------------------

model Karat {
  id        String @id @default(uuid())
  label     String @unique // "24K", "22K", "18K", "17K", dst.
  sortOrder Int    @default(0)

  items         Item[]
  goldPrices    GoldPrice[]
  specialOrders SpecialOrder[]
}

// Riwayat harga emas (hanya bertambah, tidak diubah).
// Harga berlaku = baris terbaru per kadar berdasarkan effectiveAt.
model GoldPrice {
  id           String   @id @default(uuid())
  karatId      String
  pricePerGram BigInt // rupiah per gram
  effectiveAt  DateTime @default(now())
  createdById  String
  createdAt    DateTime @default(now())

  karat     Karat @relation(fields: [karatId], references: [id])
  createdBy User  @relation(fields: [createdById], references: [id])

  @@index([karatId, effectiveAt])
}

model Customer {
  id          String   @id @default(uuid())
  name        String
  phone       String?
  address     String?
  creditLimit BigInt   @default(0) // dipakai mulai Rilis 4 (piutang)
  note        String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  sales         Sale[]
  specialOrders SpecialOrder[]
}

model Supplier {
  id        String   @id @default(uuid())
  name      String
  phone     String?
  note      String?
  createdAt DateTime @default(now())

  specialOrders SpecialOrder[]
}

// ------------------------------------------------------------
// STOK
// ------------------------------------------------------------

model Item {
  id        String   @id @default(uuid())
  code      String   @unique // isi barcode/label
  category  String // jenis: CINCIN | KALUNG | GELANG | ANTING | LIONTIN | LAINNYA
  name      String // nama atau model
  karatId   String
  weightMg  Int
  laborCost BigInt   @default(0) // ongkos pembuatan
  photoPath String?
  status    String   @default("IN_STORE") // IN_STORE | ON_TRIP | ORDERED | SOLD
  note      String?
  version   Int      @default(1) // naik tiap perubahan, untuk deteksi konflik sinkronisasi
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  karat          Karat           @relation(fields: [karatId], references: [id])
  movements      StockMovement[]
  saleItems      SaleItem[]
  tripItems      TripItem[]
  specialOrder   SpecialOrder?

  @@index([status])
  @@index([category])
}

// Log setiap perubahan status/stok (hanya bertambah).
model StockMovement {
  id         String   @id @default(uuid())
  itemId     String
  type       String // RECEIVED | SOLD | SALE_VOIDED | TRIP_OUT | TRIP_IN | ADJUSTMENT
  fromStatus String?
  toStatus   String
  refType    String? // SALE | TRIP | ORDER | MANUAL
  refId      String?
  userId     String
  note       String?
  createdAt  DateTime @default(now())

  item Item @relation(fields: [itemId], references: [id])
  user User @relation(fields: [userId], references: [id])

  @@index([itemId, createdAt])
}

// ------------------------------------------------------------
// PENJUALAN (KASIR)
// ------------------------------------------------------------

model Sale {
  id          String    @id @default(uuid()) // UUID dari perangkat
  receiptNo   String    @unique // format: <kode user>-<YYYYMMDD>-<urut>, mis. A-20261019-003
  customerId  String? // kosong untuk pembeli umum
  cashierId   String
  tripId      String? // terisi bila penjualan terjadi saat keliling (Rilis 3)
  subtotal    BigInt
  discount    BigInt    @default(0)
  total       BigInt
  status      String    @default("COMPLETED") // COMPLETED | VOIDED
  voidReason  String?
  voidedAt    DateTime?
  voidedById  String?
  note        String?
  soldAt      DateTime // waktu transaksi menurut perangkat
  createdAt   DateTime  @default(now()) // waktu diterima server

  customer Customer? @relation(fields: [customerId], references: [id])
  cashier  User      @relation("SaleCashier", fields: [cashierId], references: [id])
  voidedBy User?     @relation("SaleVoidedBy", fields: [voidedById], references: [id])
  trip     Trip?     @relation(fields: [tripId], references: [id])
  items    SaleItem[]
  payments Payment[]

  @@index([soldAt])
  @@index([customerId])
}

// Baris nota. Data penting disalin (snapshot) supaya nota lama
// tidak berubah ketika harga emas atau data item berubah.
model SaleItem {
  id           String @id @default(uuid())
  saleId       String
  itemId       String
  itemCode     String // snapshot
  itemName     String // snapshot
  karatLabel   String // snapshot
  weightMg     Int // snapshot
  pricePerGram BigInt // harga emas saat transaksi
  laborCost    BigInt // ongkos saat transaksi
  lineTotal    BigInt // berat x harga per gram + ongkos

  sale Sale @relation(fields: [saleId], references: [id])
  item Item @relation(fields: [itemId], references: [id])

  @@unique([saleId, itemId])
  @@index([itemId])
}

model Payment {
  id        String   @id @default(uuid())
  saleId    String
  method    String // CASH | TRANSFER (CREDIT menyusul di Rilis 4)
  amount    BigInt
  reference String? // mis. catatan transfer
  paidAt    DateTime

  sale Sale @relation(fields: [saleId], references: [id])

  @@index([saleId])
}

// ------------------------------------------------------------
// PENJUALAN KELILING (Rilis 3)
// ------------------------------------------------------------

model Trip {
  id          String    @id @default(uuid())
  carrierId   String // pembawa barang (akun yang login)
  destination String?
  status      String    @default("OPEN") // OPEN | RECONCILING | CLOSED
  startedAt   DateTime  @default(now())
  closedAt    DateTime?
  note        String?

  carrier User       @relation(fields: [carrierId], references: [id])
  items   TripItem[]
  sales   Sale[]
}

model TripItem {
  id      String  @id @default(uuid())
  tripId  String
  itemId  String
  outcome String  @default("CARRIED") // CARRIED | SOLD | RETURNED | MISSING
  saleId  String? // terisi bila outcome = SOLD
  note    String?

  trip Trip @relation(fields: [tripId], references: [id])
  item Item @relation(fields: [itemId], references: [id])

  @@unique([tripId, itemId])
}

// ------------------------------------------------------------
// PESANAN KHUSUS (Rilis 2)
// ------------------------------------------------------------

model SpecialOrder {
  id                 String    @id @default(uuid())
  customerId         String // toko/pelanggan pemesan
  supplierId         String? // terisi saat dipesan ke pemasok
  description        String // mis. cincin model XYZ
  referencePhotoPath String?
  karatId            String?
  targetWeightMg     Int?
  sizeNote           String?
  targetDate         DateTime?
  status             String    @default("REQUESTED") // REQUESTED | ORDERED | ARRIVED | DONE | CANCELLED
  depositAmount      BigInt    @default(0) // uang muka (DP)
  purchasePrice      BigInt? // harga beli dari pemasok
  itemId             String?   @unique // item yang dibuat saat barang tiba
  cancelNote         String? // keputusan soal DP bila batal
  createdById        String
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  customer  Customer  @relation(fields: [customerId], references: [id])
  supplier  Supplier? @relation(fields: [supplierId], references: [id])
  karat     Karat?    @relation(fields: [karatId], references: [id])
  item      Item?     @relation(fields: [itemId], references: [id])
  createdBy User      @relation(fields: [createdById], references: [id])

  @@index([status])
}

// ------------------------------------------------------------
// AUDIT DAN SINKRONISASI
// ------------------------------------------------------------

model AuditLog {
  id        String   @id @default(uuid())
  userId    String
  action    String // mis. PRICE_SET, SALE_CREATE, SALE_VOID, ITEM_UPDATE
  entity    String // nama entitas, mis. Sale
  entityId  String?
  detail    String? // JSON (nilai sebelum dan sesudah) disimpan sebagai teks
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id])

  @@index([entity, entityId])
  @@index([createdAt])
}

// Catatan operasi dari perangkat yang sudah diproses server.
// Bila operasi yang sama terkirim dua kali (mis. koneksi putus), server
// melihat opId sudah ada dan tidak memprosesnya lagi (idempotent).
model ProcessedOp {
  id         String   @id // opId dari antrean outbox di perangkat
  userId     String
  type       String // mis. CREATE_SALE
  receivedAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id])
}

// ------------------------------------------------------------
// MENYUSUL (Rilis 4): Receivable (piutang) dan pembayaran cicilan.
// Tabel belum dibuat agar skema MVP tetap ringkas; Customer.creditLimit
// dan Payment.method sudah disiapkan untuk itu.
// ------------------------------------------------------------
```

Ringkasan relasi:

- `Sale` 1—N `SaleItem`, `Sale` 1—N `Payment`
- `Item` 1—N `StockMovement`, `Item` 1—N `SaleItem`
- `Karat` 1—N `Item`, `Karat` 1—N `GoldPrice`
- `Trip` 1—N `TripItem`, `Trip` 1—N `Sale`
- `SpecialOrder` N—1 `Customer`, N—1 `Supplier` (opsional), 0..1—1 `Item`
- `User` menjadi pelaku di `Sale`, `GoldPrice`, `StockMovement`, `Trip`, `SpecialOrder`, `AuditLog`, `ProcessedOp`

## 13. Rancangan Sinkronisasi Offline (usulan, belum final)

Bagian ini usulan awal untuk dipertajam saat Rilis 1 dikerjakan.

**Di perangkat (Dexie):**

- Tabel referensi (salinan dari server): `items`, `karats`, `goldPrices`, `customers`.
- Tabel `outbox`: `{ opId (UUID), type, payload, createdAt, status }`, dengan `status` `PENDING | SENT | REJECTED`.

**Operasi (`type`):** `CREATE_SALE`, `VOID_SALE` (butuh PIN pemilik), `SET_GOLD_PRICE` (pemilik), serta operasi master data. Rilis berikutnya menambah operasi pesanan khusus dan perjalanan.

**Endpoint yang diusulkan:**

- `POST /api/sync/push`: menerima daftar operasi. Respons per operasi: `APPLIED`, `DUPLICATE` (opId sudah diproses), atau `REJECTED` dengan alasan (misalnya `ITEM_NOT_AVAILABLE`).
- `GET /api/sync/pull?since=<kursor>`: mengembalikan perubahan item, kadar, harga, dan pelanggan sejak kursor.

**Aturan:**

- Server adalah penentu akhir status item. Operasi yang ditolak tidak dihilangkan diam-diam: tampil di daftar "perlu ditinjau" untuk pemilik (FR-40).
- Pengiriman diulang otomatis dengan jeda bertahap saat koneksi tersedia. Idempotensi dijamin oleh `ProcessedOp` (bagian 9.5).
- Perangkat yang sedang membawa item keliling hanya boleh menjual item yang ada di perjalanannya.

## 14. Cakupan MVP dan Rilis Bertahap

MVP mencakup stok, harga emas, kasir dan nota, serta fondasi offline. Pesanan khusus, penjualan keliling, dan piutang menyusul. Alasan: bagian paling berisiko (offline dan sinkronisasi) harus teruji lebih awal dengan risiko kecil, dan kasir langsung bisa menggantikan pencatatan manual.

### 14.1 Cakupan MVP (Rilis 1)

| Modul | Fitur MVP | Referensi |
|---|---|---|
| Akses | Login dua akun (Pemilik dan Asisten), PIN cepat, pembatasan hak akses Asisten | FR-01 sampai FR-03 |
| Stok | CRUD item, label barcode, status item, log pergerakan stok | FR-04 sampai FR-07 |
| Harga emas | Input harian per kadar, kalkulator harga, harga tersimpan di nota | FR-10 sampai FR-12 |
| Kasir dan nota | Transaksi multi-item, bayar tunai/transfer/campuran, cetak nota atau PDF | FR-14 sampai FR-16 |
| Offline | PWA, data lokal, antrean transaksi, ID unik anti-duplikat, penguncian status item | FR-35 sampai FR-39 |
| Audit dan data | Log aktivitas, pembatalan (bukan hapus), backup harian | FR-41, FR-42 |

Skema database dibuat lengkap sejak awal, tetapi antarmuka MVP baru memakai status `IN_STORE` dan `SOLD`.

### 14.2 Rilis bertahap

| Rilis | Isi | Referensi | Alasan urutan |
|---|---|---|---|
| 1. MVP | Stok, harga emas, kasir, nota, offline | bagian 14.1 | Menguji sinkronisasi dengan risiko kecil; langsung menggantikan pencatatan manual |
| 2. Pesanan khusus | Pencatatan pesanan, alur status, DP, bukti DP, indikator sinkronisasi | FR-19 sampai FR-22, FR-40 | Logika sederhana, manfaat terasa cepat |
| 3. Penjualan keliling | Perjalanan (pembawa dari akun yang login), penjualan dari HP, rekonsiliasi, surat jalan | FR-24 sampai FR-26 | Paling kompleks: offline + penguncian item + rekonsiliasi |
| 4. Pendukung | Piutang dan invoice formal, laporan, stok opname, retur, tukar tambah, data pelanggan dan pemasok lengkap | FR-08, FR-09, FR-17, FR-18, FR-28, FR-29, FR-31 sampai FR-33 | Bernilai setelah transaksi nyata berjalan |

Dokumen pendukung ikut rilis fiturnya: nota penjualan (Rilis 1), bukti DP (Rilis 2), surat jalan (Rilis 3), invoice formal (Rilis 4). Gunakan satu modul pencetakan dengan beberapa template.

### 14.3 Ditunda sampai setelah Rilis 4 (jangan dibangun tanpa diminta)

- Margin per kategori pelanggan (FR-13)
- Tautan WhatsApp (FR-23) dan analisis rute keliling (FR-27)
- Ekspor Excel/PDF (FR-34) dan saldo emas dalam gram (FR-30)
- Katalog online untuk toko pelanggan

### 14.4 Urutan implementasi Rilis 1 (disarankan)

1. Setup monorepo (pnpm), TypeScript, ESLint, Vitest; paket `shared`.
2. Skema Prisma, migrasi pertama, dan seed: satu `OWNER`, satu `ASSISTANT`, kadar (24K, 22K, 18K, 17K), beberapa item contoh.
3. API: autentikasi PIN, pemeriksaan peran, `AuditLog`.
4. Harga emas: input harian dan riwayat; fungsi hitung harga di `shared` dengan unit test.
5. Item: CRUD, label barcode, status, `StockMovement`.
6. Kasir: pembuatan penjualan atomik (bagian 9.5), pembayaran, nota, pembatalan.
7. PWA dan offline: service worker, Dexie, outbox, sinkronisasi `push`/`pull`, indikator sederhana.
8. Backup harian dan uji lapangan.

### 14.5 Kriteria selesai Rilis 1

- Semua FR Rilis 1 berfungsi di Chrome desktop dan Chrome Android.
- Kasir dapat membuat dan mencetak nota **tanpa internet**, dan transaksi tersinkron tanpa duplikat setelah koneksi kembali (diuji dengan pengiriman ulang yang sama dua kali).
- Item yang sama tidak dapat terjual dua kali, termasuk saat dua perangkat offline mencoba menjualnya (operasi kedua ditolak dan tampil untuk ditinjau).
- Nota lama tidak berubah setelah harga emas diperbarui.
- Asisten tidak dapat mengubah harga emas atau membatalkan transaksi tanpa PIN pemilik; diuji di sisi server.
- Unit test untuk fungsi hitung harga dan transisi status; test integrasi untuk pembuatan penjualan atomik.
- Backup harian terbukti dapat dipulihkan.

## 15. Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Konflik data saat dua perangkat offline | Penjualan ganda | Penguncian status item, ID unik, server sebagai penentu akhir |
| HP hilang atau dicuri | Kebocoran data | PIN, pencabutan sesi, data sensitif minimal di perangkat |
| Browser iOS membatasi penyimpanan PWA | Data lokal terhapus | Sinkronisasi sering, peringatan, uji khusus di iOS |
| Server toko rusak | Data hilang | Backup harian berlapis dan prosedur pemulihan |
| Pengguna sulit beralih dari pencatatan manual | Aplikasi tidak dipakai | Antarmuka sederhana, pelatihan singkat, uji coba paralel |
| Lingkup terlalu besar | Proyek tidak selesai | Pegang prioritas dan rilis bertahap |

## 16. Asumsi dan Pertanyaan Terbuka

Gunakan nilai bawaan yang disebut, dan jangan di-hardcode.

1. Apakah penjualan keliling selalu dilakukan satu orang sementara yang lain menjaga toko? (Bawaan: ya.)
2. Apakah pemilik perlu memantau dari luar toko lewat internet? (Bawaan: tidak di Rilis 1.)
3. Apakah ada pembayaran dengan emas (saldo gram)? (Bawaan: tidak; FR-30 ditunda.)
4. Rumus harga per kadar dan ongkos yang dipakai saat ini? (Bawaan: bagian 9.2.)
5. Aturan DP jika pesanan khusus dibatalkan? (Bawaan: dicatat manual di `cancelNote`.)
6. Perangkat yang tersedia: merek HP, laptop, dan printer? (Bawaan: printer thermal atau PDF.)
7. Perkiraan jumlah item dan transaksi per hari? (Bawaan: hingga 5.000 item.)
8. Apakah perlu impor stok awal dari Excel? (Bawaan: tidak di Rilis 1.)
9. Status `ORDERED` pada item: apakah item dibuat sejak pesanan dibuat, atau saat barang tiba? (Bawaan: dibuat saat barang tiba; `ORDERED` dicadangkan.)
10. Banyak toko langganan membeli dengan tempo? Jika ya, naikkan piutang dan invoice formal ke Rilis 2.

## 17. Glosarium

| Istilah | Arti |
|---|---|
| Kadar | Tingkat kemurnian emas, misalnya 24K, 22K, 18K, 17K |
| Ongkos | Biaya pembuatan perhiasan yang ditambahkan ke harga emas |
| Nota | Bukti transaksi penjualan yang dicetak atau disimpan sebagai PDF |
| Invoice | Dokumen tagihan formal untuk penjualan dengan tempo |
| DP | Uang muka pada pesanan khusus |
| Keliling | Membawa barang keluar toko untuk dijual ke tempat lain |
| Rekonsiliasi | Mencocokkan item yang dibawa dengan item terjual dan dikembalikan |
| Pesanan khusus | Permintaan barang dari toko lain yang dipesankan ke pemasok |
| Outbox | Antrean transaksi offline di perangkat yang menunggu dikirim ke server |
| Idempotent | Operasi yang diulang tidak mengubah hasil akhir (tidak tercatat ganda) |
