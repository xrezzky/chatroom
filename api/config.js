// api/config.js — Vercel Serverless Function
// Melayani config dari ENV ke frontend yang terverifikasi

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const allowedOrigins = [
    'https://xrzzky-chatroom.vercel.app',
    'https://xrezzky-chatroom.vercel.app',
    'https://rezzkystoreidn.github.io',
    'https://hatroom-eight.vercel.app',
  ];

  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';

  // Cek origin atau referer dari domain yang diizinkan
  const isAllowed =
    !origin || // request langsung (bukan cross-origin)
    allowedOrigins.includes(origin) ||
    allowedOrigins.some(d => referer.startsWith(d));

  if (!isAllowed) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  // Validasi ENV tersedia
  const { SUPABASE_URL, SUPABASE_ANON_KEY, CLOUDINARY_CLOUD, CLOUDINARY_PRESET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Server config tidak lengkap' });
  }

  return res.status(200).json({
    supabaseUrl:  SUPABASE_URL,
    supabaseKey:  SUPABASE_ANON_KEY,
    cloudName:    CLOUDINARY_CLOUD,
    cloudPreset:  CLOUDINARY_PRESET,
    // Secret TIDAK dikirim
  });
}
