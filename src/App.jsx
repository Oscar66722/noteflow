import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import 'katex/dist/katex.min.css'
import './App.css'

function App() {
  const storageKey = 'saved-study-notes'
  const preferencesKey = 'noteflow-preferences'
  const defaultPreferences = {
    subjectMode: 'General',
    summaryLength: 'Balanced',
    language: 'English',
    styleExamples: [],
  }
  const subjectModes = [
    'General',
    'Science & Maths',
    'History & Humanities',
    'Law',
    'Literature',
    'Computer Science',
    'Economics & Business',
  ]
  const summaryLengths = ['Brief', 'Balanced', 'Detailed']
  const languages = ['English', 'Spanish', 'French', 'German', 'Dutch', 'Italian', 'Portuguese']

  const [notes, setNotes] = useState('')
  const [summary, setSummary] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const recognitionRef = useRef(null)
  const richSummaryRef = useRef(null)
  const examplesInputRef = useRef(null)
  const [preferences, setPreferences] = useState(() => {
    try {
      const raw = localStorage.getItem(preferencesKey)
      return raw ? { ...defaultPreferences, ...JSON.parse(raw) } : defaultPreferences
    } catch (error) {
      return defaultPreferences
    }
  })
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

      const subjectInstructions = {
        General: 'Use whatever structure best fits the content.',
        'Science & Maths': 'Highlight formulas, constants, derivations, and step-by-step reasoning.',
        'History & Humanities': 'Highlight dates, key figures, causes, and consequences.',
        Law: 'Highlight cases, statutes, legal tests, and precedents.',
        Literature: 'Highlight themes, characters, quotes, and literary techniques.',
        'Computer Science': 'Highlight algorithms, complexity, and code concepts.',
        'Economics & Business': 'Highlight models, graphs, key theorems, and real-world examples.',
      }
      const lengthInstructions = {
        Brief: 'Bullet points only, no elaboration, very concise.',
        Balanced: 'Current default behaviour with concise but useful detail.',
        Detailed: 'Include explanations, examples, and context for each point.',
      }
      const styleExamplesSection =
        preferences.styleExamples.length > 0
          ? `
The student has provided examples of summaries they like.
Study the structure, tone, formatting choices, and level of detail
in these examples and match that style closely in your output.

Examples:
---
${preferences.styleExamples.map((example) => example.text).join('\n---\n')}
---

Use these as your style guide. The content will be different
but the style, structure and tone should closely match.
`
          : ''

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
          stream: true,
          system: `You are a study assistant. The student will give you their raw lecture notes.
Transform them into a clean study guide they can revise from.

Rules:
- Read the notes first and decide what structure makes sense for THIS content
- Use whatever sections and format best fits the material
- Be concise — no waffle, no encouragement, no filler phrases
- Include formulas, distinctions, and examples where relevant
- If the notes mention something without explaining it, flag it at the end
- Never use the same template twice — let the content dictate the structure
- Silently correct any spelling mistakes or typos in the notes — never mention them, just use the correct version
- If the same concept, fact, or idea appears multiple times in the notes, consolidate it into one place — never repeat the same point twice
- If the notes are messy or hard to follow, infer what the student meant based on context
- Never say things like "the notes mention..." or "you wrote..." — just present the content cleanly as fact

Preferences:
- Subject mode: ${preferences.subjectMode}
- Subject mode instruction: ${subjectInstructions[preferences.subjectMode]}
- Summary length: ${preferences.summaryLength}
- Summary length instruction: ${lengthInstructions[preferences.summaryLength]}
- Language: ${preferences.language}
- Write the entire summary in ${preferences.language}
${styleExamplesSection}

Output clean markdown only.`,
          messages: [{ role: 'user', content: notes }]
        })
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(errorBody || 'Failed to summarize notes.')
      }

      if (!response.body) {
        throw new Error('No stream returned by the API.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let done = false
      let buffer = ''
      let receivedFirstChunk = false

      while (!done) {
        const { value, done: readerDone } = await reader.read()
        done = readerDone
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done })

        const parts = buffer.split('\n\n')
        buffer = parts.pop() || ''

        for (const part of parts) {
          if (!part.includes('data: ')) continue
          const dataChunks = part.split('data: ').slice(1)

          for (const dataChunk of dataChunks) {
            const payload = dataChunk.trim()
            if (!payload || payload === '[DONE]') continue

            const parsed = JSON.parse(payload)
            if (parsed.type === 'message_stop') {
              done = true
              break
            }

            const deltaText = parsed?.delta?.text
            if (deltaText) {
              if (!receivedFirstChunk) {
                setLoading(false)
                receivedFirstChunk = true
              }
              setSummary((prev) => prev + deltaText)
            }
          }

          if (done) break
        }
      }

      if (!receivedFirstChunk && !summary) {
        setSummary('No summary returned by the API.')
      }
    } catch (error) {
      setSummary(`Unable to generate summary. ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleCopySummary = async () => {
    if (!summary || !richSummaryRef.current) return
    const getStyledSummaryHtml = () => {
      const clone = richSummaryRef.current.cloneNode(true)
      clone.querySelectorAll('table').forEach((table) => {
        table.style.borderCollapse = 'collapse'
        table.style.width = '100%'
      })
      clone.querySelectorAll('th').forEach((th) => {
        th.style.border = '1px solid black'
        th.style.padding = '6px 12px'
        th.style.backgroundColor = '#f3f4f6'
        th.style.textAlign = 'left'
      })
      clone.querySelectorAll('td').forEach((td) => {
        td.style.border = '1px solid black'
        td.style.padding = '6px 12px'
      })
      return clone.innerHTML
    }

    const html = getStyledSummaryHtml()
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

  const loadPdfJs = () =>
    new Promise((resolve, reject) => {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.js'
        resolve(window.pdfjsLib)
        return
      }

      const existing = document.querySelector('script[data-pdfjs="true"]')
      if (existing) {
        existing.addEventListener('load', () => resolve(window.pdfjsLib))
        existing.addEventListener('error', () => reject(new Error('Failed to load PDF.js')))
        return
      }

      const script = document.createElement('script')
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.js'
      script.async = true
      script.dataset.pdfjs = 'true'
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.js'
        resolve(window.pdfjsLib)
      }
      script.onerror = () => reject(new Error('Failed to load PDF.js'))
      document.body.appendChild(script)
    })

  const readTextFile = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error(`Unable to read ${file.name}`))
      reader.readAsText(file)
    })

  const readPdfFile = async (file) => {
    const pdfjs = await loadPdfJs()
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise
    const pages = []

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = content.items.map((item) => item.str).join(' ')
      pages.push(text)
    }

    return pages.join('\n\n')
  }

  const handleUploadExamples = async (event) => {
    const incomingFiles = Array.from(event.target.files || [])
    if (incomingFiles.length === 0) return

    const remainingSlots = 3 - preferences.styleExamples.length
    const files = incomingFiles.slice(0, remainingSlots)

    try {
      const parsedExamples = []
      for (const file of files) {
        const name = file.name || 'Example'
        const lowerName = name.toLowerCase()
        let text = ''

        if (lowerName.endsWith('.txt') || lowerName.endsWith('.md')) {
          text = await readTextFile(file)
        } else if (lowerName.endsWith('.pdf')) {
          text = await readPdfFile(file)
        }

        if (text.trim()) {
          parsedExamples.push({ id: `${Date.now()}-${name}`, name, text: text.trim() })
        }
      }

      if (parsedExamples.length > 0) {
        setPreferences((prev) => ({
          ...prev,
          styleExamples: [...prev.styleExamples, ...parsedExamples].slice(0, 3),
        }))
      }
    } catch (error) {
      alert(`Could not upload example: ${error.message}`)
    } finally {
      event.target.value = ''
    }
  }

  const handleRemoveExample = (id) => {
    setPreferences((prev) => ({
      ...prev,
      styleExamples: prev.styleExamples.filter((example) => example.id !== id),
    }))
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

  useEffect(() => {
    localStorage.setItem(preferencesKey, JSON.stringify(preferences))
  }, [preferences])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <h1 className="logo">NoteFlow</h1>
          <div className="topbar-actions">
            <button type="button" onClick={() => setPreferencesOpen(true)} className="btn btn-ghost">
              Preferences
            </button>
            <button type="button" onClick={() => setSidebarOpen((open) => !open)} className="btn btn-ghost">
              Notes
            </button>
          </div>
        </div>
      </header>

      <aside className={`saved-sidebar ${sidebarOpen ? 'is-open' : ''}`}>
        <h3 className="sidebar-title">Saved Notes</h3>
        {savedNotes.length === 0 ? (
          <p className="muted-copy">No saved notes yet.</p>
        ) : (
          savedNotes.map((note) => (
            <div key={note.id} className="saved-note-card">
              <button type="button" onClick={() => handleLoadSavedNote(note)} className="saved-note-main">
                <div className="saved-note-title">{note.title || 'Untitled note'}</div>
                <div className="saved-note-date">{new Date(note.timestamp).toLocaleString()}</div>
              </button>
              <button type="button" onClick={() => handleDeleteSavedNote(note.id)} className="delete-note-btn">
                Delete
              </button>
            </div>
          ))
        )}
      </aside>

      <section className="workspace-card">
        <div className="panel notes-panel">
          <label htmlFor="notes" className="section-label">
            Your Notes
          </label>
          <textarea
            id="notes"
            className="notes-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Type or paste your class notes here..."
          />
          <div className="panel-actions">
            <button type="button" disabled={loading} onClick={handleSummarize} className="btn btn-summarize">
              Summarize
            </button>
            <button
              type="button"
              onClick={handleToggleRecording}
              className={`btn btn-mic ${isRecording ? 'is-recording' : ''}`}
            >
              {isRecording ? 'Stop Mic' : 'Mic'}
            </button>
            {isRecording ? <span className="recording-indicator">Recording...</span> : null}
          </div>
        </div>

        <div className="panel summary-panel">
          <h2 className="section-label">Structured Summary</h2>
          <div className={`summary-surface ${summary ? 'has-content' : ''}`}>
            {summary ? (
              <div className="summary-toolbar">
                <button type="button" onClick={handleCopySummary} className={`btn btn-subtle btn-small ${copied ? 'is-copied' : ''}`}>
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
                <button type="button" onClick={handleDownloadPdf} className="btn btn-subtle btn-small">
                  PDF
                </button>
              </div>
            ) : null}

            {loading ? (
              <div className="shimmer-wrap">
                <div className="shimmer-line"></div>
                <div className="shimmer-line short"></div>
                <div className="shimmer-line"></div>
                <div className="shimmer-line medium"></div>
                <div className="shimmer-line"></div>
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
              <p className="muted-copy">Your generated summary will appear here.</p>
            )}
          </div>
          {summary ? (
            <button type="button" onClick={handleSaveNote} className="btn btn-subtle save-note-btn">
              Save Note
            </button>
          ) : null}
        </div>
      </section>

      {preferencesOpen ? (
        <div className="modal-backdrop">
          <div className="preferences-modal">
            <div className="modal-header">
              <h3>Preferences</h3>
              <button type="button" className="btn btn-subtle btn-small" onClick={() => setPreferencesOpen(false)}>
                Close
              </button>
            </div>

            <div className="pref-section">
              <p className="section-label">Subject Mode</p>
              <div className="pill-group">
                {subjectModes.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`btn btn-pill ${preferences.subjectMode === mode ? 'is-active' : ''}`}
                    onClick={() => setPreferences((prev) => ({ ...prev, subjectMode: mode }))}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            <div className="pref-section">
              <p className="section-label">Summary Length</p>
              <div className="pill-group">
                {summaryLengths.map((length) => (
                  <button
                    key={length}
                    type="button"
                    className={`btn btn-pill ${preferences.summaryLength === length ? 'is-active' : ''}`}
                    onClick={() => setPreferences((prev) => ({ ...prev, summaryLength: length }))}
                  >
                    {length}
                  </button>
                ))}
              </div>
            </div>

            <div className="pref-section">
              <p className="section-label">Language</p>
              <select
                value={preferences.language}
                onChange={(e) => setPreferences((prev) => ({ ...prev, language: e.target.value }))}
                className="language-select"
              >
                {languages.map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
              </select>
            </div>

            <div className="pref-section">
              <p className="section-label">Style Examples</p>
              <button
                type="button"
                className="btn btn-subtle btn-small"
                onClick={() => examplesInputRef.current?.click()}
                disabled={preferences.styleExamples.length >= 3}
              >
                Upload Example Summary
              </button>
              <input
                ref={examplesInputRef}
                type="file"
                accept=".txt,.md,.pdf"
                multiple
                style={{ display: 'none' }}
                onChange={handleUploadExamples}
              />
              <div className="example-pills">
                {preferences.styleExamples.map((example) => (
                  <span key={example.id} className="example-pill">
                    {example.name}
                    <button type="button" onClick={() => handleRemoveExample(example.id)} className="pill-remove">
                      X
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

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
