# XREZZKY Chat

Chat app berbasis Supabase + Cloudinary. Dibangun sebagai single-page app (SPA) dengan struktur modular.

## Struktur Project

```
XREZZKY_Chat/
├── index.html          ← Main HTML shell
├── admin.html          ← Admin panel (owner/admin only)
├── sw.js               ← Service Worker (push notification)
├── manifest.json       ← PWA manifest
├── css/                ← Stylesheets terpisah per modul
├── js/                 ← JavaScript terpisah per modul
└── sql/                ← SQL scripts berurutan
```

## Setup

### 1. Supabase
Jalankan SQL di folder `sql/` secara berurutan:
- `01-tables.sql` — buat semua tabel
- `02-indexes.sql` — buat indexes
- `03-realtime.sql` — enable realtime
- `04-rls.sql` — Row Level Security
- `05-functions.sql` — functions & triggers
- `06-cron.sql` — cron jobs & set owner

### 2. Deploy ke GitHub Pages / Vercel
Upload semua file dan folder ke GitHub repo.

### 3. SMTP (opsional)
Setup custom SMTP di Supabase untuk fitur reset password.
Rekomendasi: [Resend.com](https://resend.com) — gratis 3000 email/bulan.

## Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS (no framework)
- **Backend**: Supabase (PostgreSQL + Realtime + Auth)
- **Media**: Cloudinary
- **Hosting**: GitHub Pages / Vercel
- **PWA**: Service Worker + Web Push

## Fitur
- Chat 1v1 + Grup
- Voice Call WebRTC
- Media upload (foto/video) dengan kompresi
- Push Notification
- Admin Panel lengkap
- Stealth mode
- Rate limit reset password
