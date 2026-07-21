// api/cloudinary-usage.js — Vercel Serverless Function
// Fetch Cloudinary usage dari server (bypass CORS)
// Hanya bisa diakses dari admin panel

import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const CLOUD  = process.env.CLOUDINARY_CLOUD;
  const KEY    = process.env.CLOUDINARY_KEY;
  const SECRET = process.env.CLOUDINARY_SECRET;

  if (!CLOUD || !KEY || !SECRET) {
    return res.status(500).json({ error: 'Cloudinary ENV tidak dikonfigurasi' });
  }

  try {
    // Cloudinary usage API — GET dengan Basic Auth
    const credentials = Buffer.from(`${KEY}:${SECRET}`).toString('base64');
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD}/usage`,
      { headers: { 'Authorization': `Basic ${credentials}` } }
    );

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();
    res.setHeader('Cache-Control', 'max-age=60'); // cache 1 menit
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
