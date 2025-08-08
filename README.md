# NFT Minter EVM + Auto Accurate Contract Detector

Skrip CLI untuk mint NFT di blockchain EVM (Ethereum, Base, Polygon, dll) dengan fitur:
- **Auto detect contract** dari halaman OpenSea, MagicEden, atau launchpad lain
- **Multi mint modes**: Public mint, Whitelist mint, dll
- **Fast RPC** (support multiple RPC, otomatis pakai yang tercepat)
- **Auto retry** kalau gagal (opsional loop)
- **Support multi-wallet** via `keys.txt`

---

## 🚀 Fitur Utama
- Deteksi alamat kontrak dari URL halaman mint
- Mint cepat dengan RPC tercepat
- Support **single wallet** atau **multi wallet**
- Auto loop sampai transaksi sukses
- Menampilkan **tx hash** di console

---

## 📦 Instalasi

Clone repo ini:
```bash
git clone https://github.com/robynasuro/nft-minter-evm.git
cd nft-minter-evm
```

Install dependencies:
```bash
npm install
```

---

## ⚙️ Konfigurasi
Buat file `.env` berdasarkan `.env.example`:
```bash
cp .env.example .env
```

Edit `.env` sesuai kebutuhan:
```env
RPC_URL=https://rpc.ankr.com/base/YOUR_ANKR_KEY
CHAIN_ID=8453
CONTRACT=0xYourContractAddress
FUNCTION_NAME=mint
AMOUNT=1
PRICE_ETH=0.003
GAS_LIMIT=300000
PRIVATE_KEY=your_private_key_here
```

**Keterangan:**
- **RPC_URL** → Bisa pakai Ankr, Alchemy, Infura, dll  
- **CHAIN_ID** → ID jaringan (Base = 8453, Ethereum = 1, Polygon = 137, dll)  
- **PRIVATE_KEY** → Private key wallet (jangan commit ke GitHub)  

---

## 📜 Cara Pakai

Jalankan CLI:
```bash
node cli.js
```

Pilih aksi yang diinginkan:
- **Detect contract** → Masukkan URL koleksi / halaman mint untuk auto detect alamat kontrak
- **Mint (Single wallet)** → Mint dengan 1 wallet
- **Mint (Multi-wallet)** → Mint dengan daftar private key di `keys.txt`

**Format keys.txt**
```
privatekeywallet1
privatekeywallet2
privatekeywallet3
```

---

## 💡 Tips
- Gunakan **RPC tercepat** (Ankr, Alchemy Premium)
- Aktifkan **auto loop** untuk NFT drop yang cepat habis
- Simpan file `.env` & `keys.txt` dengan aman (jangan upload ke publik)

---

## ⚠️ Disclaimer
Script ini hanya untuk **tujuan edukasi**. Segala resiko penggunaan ditanggung pengguna.  
Gunakan dengan bijak dan pastikan membaca kontrak sebelum mint.

---

## 📄 Lisensi
MIT License
