export default async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }
  
    const apiKey = process.env.DEEPGRAM_API_KEY?.trim()
    if (!apiKey) {
      return res.status(500).json({ error: 'Deepgram API key not configured' })
    }
  
    return res.status(200).json({ key: apiKey })
  }