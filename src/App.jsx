import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import 'katex/dist/katex.min.css'
import './App.css'

function App() {
  const storageKey = 'saved-study-notes'
  const [notes, setNotes] = useState('')
  const [summary, setSummary] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const recognitionRef = useRef(null)
  const richSummaryRef = useRef(null)
  const [savedNotes, setSavedNotes] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      return raw ? JSON.parse(raw) : []
    } catch (error) {
      return []
    }
  })

  const handleSummarize = async () => {
    if (!notes.trim() || loading) return

    try {
      setLoading(true)
      setSummary('')

      console.log('sending key:', import.meta.env.VITE_ANTHROPIC_KEY)
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          system: `You are a study assistant. The student will give you their raw lecture notes.
Transform them into a clean study guide they can revise from.

Rules:
- Read the notes first and decide what structure makes sense for THIS content
- Use whatever sections and format best fits the material
- Be concise — no waffle, no encouragement, no filler phrases
- Include formulas, distinctions, and examples where relevant
- If the notes mention something without explaining it, flag it at the end
- Never use the same template twice — let the content dictate the structure

Output clean markdown only.`,
          messages: [{ role: 'user', content: notes }]
        })
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(errorBody || 'Failed to summarize notes.')
      }

      const data = await response.json()
      const text =
        data?.content?.find((block) => block.type === 'text')?.text ||
        'No summary returned by the API.'
      setSummary(text)
    } catch (error) {
      setSummary(`Unable to generate summary. ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleCopySummary = async () => {
    if (!summary || !richSummaryRef.current) return
    const html = richSummaryRef.current.innerHTML
    const plainText = richSummaryRef.current.innerText

    try {
      if (window.ClipboardItem && navigator.clipboard?.write) {
        const item = new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plainText], { type: 'text/plain' }),
        })
        await navigator.clipboard.write([item])
      } else {
        const tempDiv = document.createElement('div')
        tempDiv.contentEditable = 'true'
        tempDiv.style.position = 'fixed'
        tempDiv.style.left = '-9999px'
        tempDiv.innerHTML = html
        document.body.appendChild(tempDiv)
        const range = document.createRange()
        range.selectNodeContents(tempDiv)
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        document.execCommand('copy')
        selection.removeAllRanges()
        document.body.removeChild(tempDiv)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      setCopied(false)
    }
  }

  const handleDownloadPdf = () => {
    if (!summary || !richSummaryRef.current) return
    const summaryHtml = richSummaryRef.current.innerHTML
    const printWindow = window.open('', '_blank', 'width=900,height=1000')
    if (!printWindow) return

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>NoteFlow Summary</title>
          <style>
            body {
              margin: 0;
              padding: 40px;
              background: #ffffff;
              color: #000000;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              line-height: 1.6;
            }
            h1, h2, h3 { margin: 0.8em 0 0.4em; }
            ul, ol { padding-left: 1.2rem; }
            table { width: 100%; border-collapse: collapse; margin: 12px 0; }
            th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; }
          </style>
        </head>
        <body>${summaryHtml}</body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  const persistSavedNotes = (updatedNotes) => {
    setSavedNotes(updatedNotes)
    localStorage.setItem(storageKey, JSON.stringify(updatedNotes))
  }

  const handleSaveNote = () => {
    if (!notes.trim() || !summary.trim()) return
    const title = notes
      .trim()
      .split(/\s+/)
      .slice(0, 6)
      .join(' ')
    const newNote = {
      id: Date.now().toString(),
      title,
      notes,
      summary,
      timestamp: new Date().toISOString(),
    }
    persistSavedNotes([newNote, ...savedNotes])
  }

  const handleLoadSavedNote = (note) => {
    setNotes(note.notes)
    setSummary(note.summary)
    setSidebarOpen(false)
  }

  const handleDeleteSavedNote = (id) => {
    const updated = savedNotes.filter((note) => note.id !== id)
    persistSavedNotes(updated)
  }

  const stopRecording = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
    }
    setIsRecording(false)
  }

  const handleToggleRecording = () => {
    if (isRecording) {
      stopRecording()
      return
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('Please use Chrome for voice input')
      return
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event) => {
      let transcriptChunk = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcriptChunk += event.results[i][0].transcript
      }
      if (transcriptChunk.trim()) {
        setNotes((prev) => `${prev}${prev ? ' ' : ''}${transcriptChunk.trim()}`)
      }
    }

    recognition.onend = () => {
      setIsRecording(false)
      recognitionRef.current = null
    }

    recognition.onerror = () => {
      setIsRecording(false)
      recognitionRef.current = null
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsRecording(true)
  }

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
    }
  }, [])

  return (
    <main
      style={{
        minHeight: '100vh',
        backgroundColor: '#0f172a',
        fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        color: '#e2e8f0',
        padding: '36px',
        boxSizing: 'border-box',
        position: 'relative',
      }}
    >
      <div
        style={{
          maxWidth: '1240px',
          margin: '0 auto 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ fontSize: '24px', fontWeight: 800, letterSpacing: '-0.02em', color: '#ffffff' }}>NoteFlow</div>
        <button type="button" onClick={() => setSidebarOpen((open) => !open)} className="btn btn-notes">
          Notes
        </button>
      </div>
      <aside
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '360px',
          height: '100vh',
          backgroundColor: '#1e293b',
          boxShadow: '6px 0 26px rgba(2, 6, 23, 0.35)',
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.25s ease',
          zIndex: 30,
          padding: '20px',
          boxSizing: 'border-box',
          overflowY: 'auto',
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: '14px', fontSize: '20px', color: '#e2e8f0' }}>Saved Notes</h3>
        {savedNotes.length === 0 ? (
          <p style={{ margin: 0, color: '#94a3b8' }}>No saved notes yet.</p>
        ) : (
          savedNotes.map((note) => (
            <div
              key={note.id}
              style={{
                borderRadius: '12px',
                padding: '12px',
                marginBottom: '12px',
                backgroundColor: '#0f172a',
              }}
            >
              <button
                type="button"
                onClick={() => handleLoadSavedNote(note)}
                style={{
                  border: 'none',
                  background: 'none',
                  padding: 0,
                  margin: 0,
                  textAlign: 'left',
                  cursor: 'pointer',
                  width: '100%',
                  color: '#e2e8f0',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: '6px' }}>{note.title || 'Untitled note'}</div>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>
                  {new Date(note.timestamp).toLocaleString()}
                </div>
              </button>
              <button type="button" onClick={() => handleDeleteSavedNote(note.id)} className="btn btn-notes btn-small">
                Delete
              </button>
            </div>
          ))
        )}
      </aside>
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          borderRadius: '18px',
          overflow: 'hidden',
          maxWidth: '1240px',
          margin: '0 auto',
          backgroundColor: '#1e293b',
          boxShadow: '0 20px 45px rgba(2, 6, 23, 0.38)',
        }}
      >
        <div style={{ padding: '28px' }}>
          <label
            htmlFor="notes"
            style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: 700,
              marginBottom: '14px',
              color: '#94a3b8',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            Your Notes
          </label>
          <textarea
            id="notes"
            className="notes-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Type or paste your class notes here..."
            style={{
              width: '100%',
              minHeight: '480px',
              resize: 'vertical',
              border: 'none',
              borderRadius: '12px',
              padding: '14px',
              fontSize: '16px',
              lineHeight: 1.6,
              boxSizing: 'border-box',
              backgroundColor: '#1e293b',
              color: '#ffffff',
            }}
          />
          <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={loading}
              onClick={handleSummarize}
              className="btn btn-primary"
            >
              Summarize →
            </button>
            <button
              type="button"
              onClick={handleToggleRecording}
              className={`btn ${isRecording ? 'btn-mic-active' : 'btn-mic-idle'}`}
            >
              {isRecording ? 'Stop Mic' : 'Mic'}
            </button>
            {isRecording ? <span className="recording-indicator">Recording...</span> : null}
          </div>
        </div>

        <div style={{ borderLeft: '1px solid #334155', padding: '28px' }}>
          <h2
            style={{
              margin: 0,
              fontSize: '13px',
              fontWeight: 700,
              color: '#94a3b8',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            Structured Summary
          </h2>
          <div
            style={{
              marginTop: '14px',
              minHeight: '520px',
              border: 'none',
              borderRadius: '12px',
              padding: '14px',
              backgroundColor: '#1e293b',
              lineHeight: 1.6,
              fontSize: '16px',
              color: '#e2e8f0',
              position: 'relative',
            }}
          >
            {summary ? (
              <div style={{ position: 'absolute', top: '12px', right: '12px', display: 'flex', gap: '8px' }}>
                <button type="button" onClick={handleCopySummary} className="btn btn-notes btn-small">
                  {copied ? 'Copied ✓' : '⎘ Copy'}
                </button>
                <button type="button" onClick={handleDownloadPdf} className="btn btn-notes btn-small">
                  ⭳ PDF
                </button>
              </div>
            ) : null}
            {loading ? (
              <div className="loading-state">
                <span className="loading-dots" aria-hidden="true"></span>
                <span>Generating summary...</span>
              </div>
            ) : summary ? (
              <ReactMarkdown
                className="markdown-content"
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  table: ({ ...props }) => (
                    <table
                      style={{ width: '100%', borderCollapse: 'collapse', margin: '12px 0' }}
                      {...props}
                    />
                  ),
                  th: ({ ...props }) => (
                    <th
                      style={{
                        border: '1px solid #d1d5db',
                        padding: '8px',
                        textAlign: 'left',
                        backgroundColor: '#f9fafb',
                      }}
                      {...props}
                    />
                  ),
                  td: ({ ...props }) => (
                    <td style={{ border: '1px solid #d1d5db', padding: '8px' }} {...props} />
                  ),
                }}
              >
                {summary}
              </ReactMarkdown>
            ) : (
              'Your generated summary will appear here.'
            )}
          </div>
          {summary ? (
            <button
              type="button"
              onClick={handleSaveNote}
              className="btn btn-notes"
              style={{ marginTop: '14px' }}
            >
              Save Note
            </button>
          ) : null}
        </div>
      </section>
      <div
        ref={richSummaryRef}
        style={{
          position: 'fixed',
          left: '-9999px',
          top: '0',
          width: '800px',
          backgroundColor: '#ffffff',
          color: '#000000',
          padding: '32px',
        }}
        aria-hidden="true"
      >
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
          {summary}
        </ReactMarkdown>
      </div>
    </main>
  )
}

export default App
