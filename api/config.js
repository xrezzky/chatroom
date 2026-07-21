// api/config.js — Vercel Serverless Function
// Melayani config dari Environment Variables ke frontend
// Environment Variables TIDAK pernah expose ke client secara langsung

export default function handler(req, res) {
  // Hanya izinkan GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Cek origin — hanya izinkan domain sendiri
  const allowedOrigins = [
    'https://xrzzky-chatroom.vercel.app',
    'https://xrezzky-chatroom.vercel.app',
    'https://rezzkystoreidn.github.io',
    'http://localhost:3000',
    'http://localhost:5500',
  ];

  const origin = req.headers.origin || '';
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    // Request langsung dari browser (bukan cross-origin) — izinkan
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else {
    return res.status(403).json({ error: 'Origin tidak diizinkan' });
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'no-store'); // jangan cache

  // Kirim config dari ENV — TANPA secret key Cloudinary
  return res.status(200).json({
    supabaseUrl:  process.env.SUPABASE_URL,
    supabaseKey:  process.env.SUPABASE_ANON_KEY,
    cloudName:    process.env.CLOUDINARY_CLOUD,
    cloudPreset:  process.env.CLOUDINARY_PRESET,
    // cloudSecret TIDAK dikirim ke frontend — hanya dipakai di API route admin
  });
}
