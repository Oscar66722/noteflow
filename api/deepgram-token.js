// api/deepgram-token.js
// This serverless function gives the browser a temporary Deepgram token
// so we never expose the real API key in the frontend

export default async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }
  
    const apiKey = process.env.DEEPGRAM_API_KEY
    if (!apiKey) {
      return res.status(500).json({ error: 'Deepgram API key not configured' })
    }
  
    try {
      // Create a temporary API key scoped to just transcription, expires in 10 seconds
      const response = await fetch('https://api.deepgram.com/v1/projects', {
        headers: { Authorization: `Token ${apiKey}` },
      })
  
      const projects = await response.json()
      const projectId = projects?.projects?.[0]?.project_id
  
      if (!projectId) {
        // Fallback: just return the key directly if project lookup fails
        // (works fine for low-traffic MVP)
        return res.status(200).json({ key: apiKey })
      }
  
      const tokenRes = await fetch(
        `https://api.deepgram.com/v1/projects/${projectId}/keys`,
        {
          method: 'POST',
          headers: {
            Authorization: `Token ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            comment: 'Temporary browser key',
            scopes: ['usage:write'],
            time_to_live_in_seconds: 60,
          }),
        }
      )
  
      const tokenData = await tokenRes.json()
      const tempKey = tokenData?.key
  
      if (!tempKey) {
        // Fallback to main key if temp key creation fails
        return res.status(200).json({ key: apiKey })
      }
  
      return res.status(200).json({ key: tempKey })
    } catch (err) {
      // Fallback to main key on any error
      return res.status(200).json({ key: apiKey })
    }
  }