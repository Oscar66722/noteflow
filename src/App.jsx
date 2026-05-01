import { useEffect, useRef, useState, useCallback } from 'react'
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
    'General', 'Science & Maths', 'History & Humanities',
    'Law', 'Literature', 'Computer Science', 'Economics & Business',
  ]
  const summaryLengths = ['Brief', 'Balanced', 'Detailed']
  const languages = ['English', 'Spanish', 'French', 'German', 'Dutch', 'Italian', 'Portuguese']

  const [notes, setNotes] = useState('')
  const [summary, setSummary] = useState('')
  const [editedSummary, setEditedSummary] = useState('')
  const [noteTitle, setNoteTitle] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [saveLabel, setSaveLabel] = useState('Save Note')
  const [autoSaveLabel, setAutoSaveLabel] = useState(null) // "Auto-saved" flash
  const [loading, setLoading] = useState(false)
  const [fileLoading, setFileLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [uploadedFiles, setUploadedFiles] = useState([])

  const recognitionRef = useRef(null)
  const richSummaryRef = useRef(null)
  const examplesInputRef = useRef(null)
  const fileInputRef = useRef(null)
  const currentNoteIdRef = useRef(null)
  const autoSaveTimerRef = useRef(null)

  const [preferences, setPreferences] = useState(() => {
    try {
      const raw = localStorage.getItem(preferencesKey)
      return raw ? { ...defaultPreferences, ...JSON.parse(raw) } : defaultPreferences
    } catch { return defaultPreferences }
  })

  const [savedNotes, setSavedNotes] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  })

  // ── Word / char counter ──────────────────────────────────────────────────────
  const wordCount = notes.trim() ? notes.trim().split(/\s+/).length : 0
  const charCount = notes.length
  const isLong = wordCount > 800 // warn when notes are getting long

  // ── Auto-save every 30 seconds when there's unsaved content ─────────────────
  const doAutoSave = useCallback(() => {
    if (!editedSummary.trim() || !isDirty) return
    const title = noteTitle.trim() || autoTitle(notes)
    const updatedNotes = [...savedNotes]

    if (currentNoteIdRef.current) {
      const idx = updatedNotes.findIndex((n) => n.id === currentNoteIdRef.current)
      if (idx !== -1) {
        updatedNotes[idx] = { ...updatedNotes[idx], title, notes, summary: editedSummary, timestamp: new Date().toISOString() }
      }
    } else {
      const newNote = { id: Date.now().toString(), title, notes, summary: editedSummary, timestamp: new Date().toISOString() }
      currentNoteIdRef.current = newNote.id
      updatedNotes.unshift(newNote)
    }

    setSavedNotes(updatedNotes)
    localStorage.setItem(storageKey, JSON.stringify(updatedNotes))
    setIsDirty(false)
    setAutoSaveLabel('Auto-saved')
    setTimeout(() => setAutoSaveLabel(null), 2000)
  }, [editedSummary, isDirty, noteTitle, notes, savedNotes])

  useEffect(() => {
    if (!isDirty || !editedSummary.trim()) return
    autoSaveTimerRef.current = setTimeout(doAutoSave, 30000)
    return () => clearTimeout(autoSaveTimerRef.current)
  }, [isDirty, editedSummary, doAutoSave])

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (editedSummary.trim()) handleSaveNote()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        if (notes.trim() && !loading) handleSummarize()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editedSummary, notes, noteTitle, loading])

  const autoTitle = (text) =>
    text.trim().split(/\s+/).slice(0, 6).join(' ') || 'Untitled Note'

  // ── New note ─────────────────────────────────────────────────────────────────
  const handleNewNote = () => {
    if (isDirty && editedSummary.trim()) {
      if (!window.confirm('You have unsaved changes. Start a new note anyway?')) return
    }
    setNotes('')
    setSummary('')
    setEditedSummary('')
    setNoteTitle('')
    setIsDirty(false)
    setUploadedFiles([])
    currentNoteIdRef.current = null
    setSaveLabel('Save Note')
  }

  // ── PDF.js ───────────────────────────────────────────────────────────────────
  const loadPdfJs = () =>
    new Promise((resolve, reject) => {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.js'
        resolve(window.pdfjsLib)
        return
      }
      const script = document.createElement('script')
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.js'
      script.async = true
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.js'
        resolve(window.pdfjsLib)
      }
      script.onerror = () => reject(new Error('Failed to load PDF.js'))
      document.body.appendChild(script)
    })

  const readPdfFile = async (file) => {
    const pdfjs = await loadPdfJs()
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise
    const pages = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      pages.push(content.items.map((item) => item.str).join(' '))
    }
    return pages.join('\n\n')
  }

  // ── JSZip / PPTX ─────────────────────────────────────────────────────────────
  const loadJSZip = () =>
    new Promise((resolve, reject) => {
      if (window.JSZip) { resolve(window.JSZip); return }
      const script = document.createElement('script')
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
      script.async = true
      script.onload = () => resolve(window.JSZip)
      script.onerror = () => reject(new Error('Failed to load JSZip'))
      document.body.appendChild(script)
    })

  const readPptxFile = async (file) => {
    const JSZip = await loadJSZip()
    const arrayBuffer = await file.arrayBuffer()
    const zip = await JSZip.loadAsync(arrayBuffer)
    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => parseInt(a.match(/\d+/)?.[0] || '0') - parseInt(b.match(/\d+/)?.[0] || '0'))
    if (slideFiles.length === 0) throw new Error('No slides found in this PowerPoint file.')
    const extractText = (xml) =>
      (xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [])
        .map((m) => m.replace(/<[^>]+>/g, '').trim())
        .filter(Boolean)
        .join(' ')
    const slideTexts = []
    for (let i = 0; i < slideFiles.length; i++) {
      const slideNum = i + 1
      const slideXml = await zip.files[slideFiles[i]].async('text')
      const slideText = extractText(slideXml)
      const notesPath = `ppt/notesSlides/notesSlide${slideNum}.xml`
      let notesText = ''
      if (zip.files[notesPath]) {
        const notesXml = await zip.files[notesPath].async('text')
        notesText = extractText(notesXml)
      }
      const parts = []
      if (slideText.trim()) parts.push(`Slide content: ${slideText.trim()}`)
      if (notesText.trim()) parts.push(`Speaker notes: ${notesText.trim()}`)
      if (parts.length) slideTexts.push(`[Slide ${slideNum}]\n${parts.join('\n')}`)
    }
    return slideTexts.join('\n\n')
  }

  // ── File upload ───────────────────────────────────────────────────────────────
  const appendFileToNotes = async (files) => {
    setFileLoading(true)
    try {
      for (const file of files) {
        const name = file.name
        const lower = name.toLowerCase()
        let text = ''
        if (lower.endsWith('.pdf')) text = await readPdfFile(file)
        else if (lower.endsWith('.pptx') || lower.endsWith('.ppt')) text = await readPptxFile(file)
        if (text.trim()) {
          setNotes((prev) =>
            prev.trim()
              ? `${prev}\n\n--- Uploaded: ${name} ---\n\n${text.trim()}`
              : `--- Uploaded: ${name} ---\n\n${text.trim()}`
          )
          setUploadedFiles((prev) => [...prev, name])
        } else {
          alert(`No readable text found in ${name}. The file may be image-based or empty.`)
        }
      }
    } catch (err) {
      alert(`Could not read file: ${err.message}`)
    } finally {
      setFileLoading(false)
    }
  }

  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files || [])
    if (!files.length) return
    await appendFileToNotes(files)
    event.target.value = ''
  }

  const handleDrop = async (e) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files).filter((f) => {
      const lower = f.name.toLowerCase()
      return lower.endsWith('.pdf') || lower.endsWith('.pptx') || lower.endsWith('.ppt')
    })
    if (!files.length) return
    await appendFileToNotes(files)
  }

  // ── Summarize ───────────────────────────────────────────────────────────────
  const handleSummarize = async () => {
    if (!notes.trim() || loading) return
    try {
      setLoading(true)
      setSummary('')
      setEditedSummary('')
      setIsDirty(false)
      setNoteTitle(autoTitle(notes))
      currentNoteIdRef.current = null

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
          ? `\nThe student has provided examples of summaries they like. Match that style closely.\n\nExamples:\n---\n${preferences.styleExamples.map((e) => e.text).join('\n---\n')}\n---\n`
          : ''

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          stream: true,
          system: `You are a study assistant. Transform raw lecture notes into a clean study guide.

Rules:
- Read the notes first and decide what structure makes sense for THIS content
- Use whatever sections and format best fits the material
- Be concise — no waffle, no encouragement, no filler phrases
- Include formulas, distinctions, and examples where relevant
- If the notes mention something without explaining it, flag it at the end
- Never use the same template twice — let the content dictate the structure
- Silently correct spelling mistakes and typos
- Consolidate repeated concepts into one place
- Infer meaning from messy or unclear notes
- Never say "the notes mention..." or "you wrote..." — present content as fact
- If the notes contain text from uploaded files (marked with "--- Uploaded: filename ---"), treat it as source material and integrate it naturally. For PowerPoint slides marked [Slide N], treat each as a separate topic or section.

Preferences:
- Subject mode: ${preferences.subjectMode} — ${subjectInstructions[preferences.subjectMode]}
- Summary length: ${preferences.summaryLength} — ${lengthInstructions[preferences.summaryLength]}
- Language: ${preferences.language} — write the entire summary in ${preferences.language}
${styleExamplesSection}
Output clean markdown only.`,
          messages: [{ role: 'user', content: notes }],
        }),
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(errorBody || 'Failed to summarize notes.')
      }
      if (!response.body) throw new Error('No stream returned by the API.')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let done = false
      let buffer = ''
      let receivedFirstChunk = false
      let accumulated = ''

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
            if (parsed.type === 'message_stop') { done = true; break }
            const deltaText = parsed?.delta?.text
            if (deltaText) {
              if (!receivedFirstChunk) { setLoading(false); receivedFirstChunk = true }
              accumulated += deltaText
              setSummary(accumulated)
              setEditedSummary(accumulated)
            }
          }
          if (done) break
        }
      }

      if (!receivedFirstChunk) {
        setSummary('No summary returned by the API.')
        setEditedSummary('No summary returned by the API.')
      }
      setIsDirty(true)
    } catch (error) {
      setSummary(`Unable to generate summary. ${error.message}`)
      setEditedSummary(`Unable to generate summary. ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSaveNote = () => {
    if (!editedSummary.trim()) return
    const title = noteTitle.trim() || autoTitle(notes)
    const updatedNotes = [...savedNotes]

    if (currentNoteIdRef.current) {
      const idx = updatedNotes.findIndex((n) => n.id === currentNoteIdRef.current)
      if (idx !== -1) {
        updatedNotes[idx] = { ...updatedNotes[idx], title, notes, summary: editedSummary, timestamp: new Date().toISOString() }
      }
    } else {
      const newNote = { id: Date.now().toString(), title, notes, summary: editedSummary, timestamp: new Date().toISOString() }
      currentNoteIdRef.current = newNote.id
      updatedNotes.unshift(newNote)
    }

    setSavedNotes(updatedNotes)
    localStorage.setItem(storageKey, JSON.stringify(updatedNotes))
    setIsDirty(false)
    setSaveLabel('Saved ✓')
    setTimeout(() => setSaveLabel('Save Note'), 2000)
  }

  const handleLoadSavedNote = (note) => {
    setNotes(note.notes)
    setSummary(note.summary)
    setEditedSummary(note.summary)
    setNoteTitle(note.title)
    setIsDirty(false)
    currentNoteIdRef.current = note.id
    setSidebarOpen(false)
    setUploadedFiles([])
  }

  const handleDeleteSavedNote = (id) => {
    const updated = savedNotes.filter((n) => n.id !== id)
    setSavedNotes(updated)
    localStorage.setItem(storageKey, JSON.stringify(updated))
    if (currentNoteIdRef.current === id) currentNoteIdRef.current = null
  }

  const handleRenameNote = (id) => {
    const updated = savedNotes.map((n) => n.id === id ? { ...n, title: renameValue.trim() || n.title } : n)
    setSavedNotes(updated)
    localStorage.setItem(storageKey, JSON.stringify(updated))
    setRenamingId(null)
  }

  // ── Copy & PDF export ───────────────────────────────────────────────────────
  const handleCopySummary = async () => {
    if (!richSummaryRef.current) return
    const clone = richSummaryRef.current.cloneNode(true)
    clone.querySelectorAll('table').forEach((t) => { t.style.borderCollapse = 'collapse'; t.style.width = '100%' })
    clone.querySelectorAll('th').forEach((th) => { th.style.border = '1px solid black'; th.style.padding = '6px 12px'; th.style.backgroundColor = '#f3f4f6'; th.style.textAlign = 'left' })
    clone.querySelectorAll('td').forEach((td) => { td.style.border = '1px solid black'; td.style.padding = '6px 12px' })
    const html = clone.innerHTML
    const plainText = richSummaryRef.current.innerText
    try {
      if (window.ClipboardItem && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plainText], { type: 'text/plain' }),
        })])
      } else {
        const tempDiv = document.createElement('div')
        tempDiv.contentEditable = 'true'
        tempDiv.style.cssText = 'position:fixed;left:-9999px'
        tempDiv.innerHTML = html
        document.body.appendChild(tempDiv)
        const range = document.createRange()
        range.selectNodeContents(tempDiv)
        const sel = window.getSelection()
        sel.removeAllRanges()
        sel.addRange(range)
        document.execCommand('copy')
        sel.removeAllRanges()
        document.body.removeChild(tempDiv)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  const handleDownloadPdf = () => {
    if (!richSummaryRef.current) return
    const printWindow = window.open('', '_blank', 'width=900,height=1000')
    if (!printWindow) return
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>${noteTitle || 'NoteFlow Summary'}</title><style>body{margin:0;padding:40px;background:#fff;color:#000;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;line-height:1.6}h1,h2,h3{margin:.8em 0 .4em}ul,ol{padding-left:1.2rem}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{border:1px solid #d1d5db;padding:8px;text-align:left}</style></head><body>${richSummaryRef.current.innerHTML}</body></html>`)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  // ── Voice ───────────────────────────────────────────────────────────────────
  const handleToggleRecording = () => {
    if (isRecording) { recognitionRef.current?.stop(); setIsRecording(false); return }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { alert('Please use Chrome for voice input'); return }
    const recognition = new SR()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognition.onresult = (event) => {
      let chunk = ''
      for (let i = event.resultIndex; i < event.results.length; i++) chunk += event.results[i][0].transcript
      if (chunk.trim()) setNotes((prev) => `${prev}${prev ? ' ' : ''}${chunk.trim()}`)
    }
    recognition.onend = () => { setIsRecording(false); recognitionRef.current = null }
    recognition.onerror = () => { setIsRecording(false); recognitionRef.current = null }
    recognitionRef.current = recognition
    recognition.start()
    setIsRecording(true)
  }

  // ── Style examples ──────────────────────────────────────────────────────────
  const readTextFile = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error(`Unable to read ${file.name}`))
      reader.readAsText(file)
    })

  const handleUploadExamples = async (event) => {
    const files = Array.from(event.target.files || []).slice(0, 3 - preferences.styleExamples.length)
    try {
      const parsed = []
      for (const file of files) {
        const lower = file.name.toLowerCase()
        let text = ''
        if (lower.endsWith('.pdf')) text = await readPdfFile(file)
        else if (lower.endsWith('.pptx') || lower.endsWith('.ppt')) text = await readPptxFile(file)
        else text = await readTextFile(file)
        if (text.trim()) parsed.push({ id: `${Date.now()}-${file.name}`, name: file.name, text: text.trim() })
      }
      if (parsed.length) setPreferences((prev) => ({ ...prev, styleExamples: [...prev.styleExamples, ...parsed].slice(0, 3) }))
    } catch (err) {
      alert(`Could not upload example: ${err.message}`)
    } finally {
      event.target.value = ''
    }
  }

  useEffect(() => { return () => recognitionRef.current?.stop() }, [])
  useEffect(() => { localStorage.setItem(preferencesKey, JSON.stringify(preferences)) }, [preferences])

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <h1 className="logo">NoteFlow</h1>
          <div className="topbar-actions">
            <button type="button" onClick={handleNewNote} className="btn btn-ghost">+ New</button>
            <button type="button" onClick={() => setPreferencesOpen(true)} className="btn btn-ghost">Preferences</button>
            <button type="button" onClick={() => setSidebarOpen((o) => !o)} className="btn btn-ghost">Notes</button>
          </div>
        </div>
      </header>

      {/* Saved notes sidebar */}
      <aside className={`saved-sidebar ${sidebarOpen ? 'is-open' : ''}`}>
        <h3 className="sidebar-title">Saved Notes</h3>
        {savedNotes.length === 0 ? (
          <p className="muted-copy">No saved notes yet.</p>
        ) : savedNotes.map((note) => (
          <div key={note.id} className="saved-note-card">
            {renamingId === note.id ? (
              <div className="rename-row">
                <input
                  className="rename-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleRenameNote(note.id); if (e.key === 'Escape') setRenamingId(null) }}
                  autoFocus
                />
                <button type="button" className="btn btn-subtle btn-small" onClick={() => handleRenameNote(note.id)}>Done</button>
              </div>
            ) : (
              <button type="button" onClick={() => handleLoadSavedNote(note)} className="saved-note-main">
                <div className="saved-note-title">{note.title || 'Untitled Note'}</div>
                <div className="saved-note-date">{new Date(note.timestamp).toLocaleString()}</div>
              </button>
            )}
            <div className="note-card-actions">
              <button type="button" className="icon-btn" title="Rename" onClick={() => { setRenamingId(note.id); setRenameValue(note.title) }}>✏️</button>
              <button type="button" className="icon-btn" title="Delete" onClick={() => handleDeleteSavedNote(note.id)}>🗑</button>
            </div>
          </div>
        ))}
      </aside>

      <section className="workspace-card">

        {/* LEFT — notes + file upload */}
        <div className="panel notes-panel">
          <div className="panel-label-row">
            <label htmlFor="notes" className="section-label">Your Notes</label>
            {/* Word counter */}
            {notes.trim() && (
              <span className={`word-counter ${isLong ? 'is-long' : ''}`}>
                {wordCount} words · {charCount} chars
                {isLong && <span className="counter-warning"> · ⚠ long</span>}
              </span>
            )}
          </div>

          <div
            className="pdf-dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            {fileLoading ? (
              <span className="muted-copy">Reading file...</span>
            ) : (
              <>
                <span className="dropzone-icon">📎</span>
                <span className="muted-copy">Drop a <strong>PDF</strong> or <strong>PowerPoint</strong> here, or <u>click to upload</u></span>
              </>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept=".pdf,.pptx,.ppt" multiple style={{ display: 'none' }} onChange={handleFileUpload} />

          {uploadedFiles.length > 0 && (
            <div className="example-pills" style={{ marginBottom: 8 }}>
              {uploadedFiles.map((name, i) => (
                <span key={i} className="example-pill">
                  {name.toLowerCase().endsWith('.pdf') ? '📄' : '📊'} {name}
                  <button type="button" className="pill-remove" onClick={() => setUploadedFiles((prev) => prev.filter((_, j) => j !== i))}>✕</button>
                </span>
              ))}
            </div>
          )}

          <textarea
            id="notes"
            className="notes-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Type or paste notes here, or drop a PDF / PowerPoint above...&#10;&#10;Cmd+Enter to summarize"
          />
          <div className="panel-actions">
            <button type="button" disabled={loading} onClick={handleSummarize} className="btn btn-summarize">Summarize</button>
            <button type="button" onClick={handleToggleRecording} className={`btn btn-mic ${isRecording ? 'is-recording' : ''}`}>
              {isRecording ? 'Stop Mic' : 'Mic'}
            </button>
            {isRecording && <span className="recording-indicator">Recording...</span>}
          </div>
        </div>

        {/* RIGHT — rendered summary */}
        <div className="panel summary-panel">
          <div className="summary-header-row">
            <input
              className="note-title-input"
              value={noteTitle}
              onChange={(e) => { setNoteTitle(e.target.value); setIsDirty(true) }}
              placeholder="Note title..."
            />
            {editedSummary ? (
              <div className="summary-toolbar">
                {autoSaveLabel && <span className="autosave-label">{autoSaveLabel}</span>}
                <button type="button" onClick={handleCopySummary} className={`btn btn-subtle btn-small ${copied ? 'is-copied' : ''}`}>
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
                <button type="button" onClick={handleDownloadPdf} className="btn btn-subtle btn-small">PDF</button>
                <button type="button" onClick={handleSaveNote} className={`btn btn-subtle btn-small save-btn ${isDirty ? 'is-dirty' : ''}`}>
                  {isDirty && <span className="dirty-dot" />}
                  {saveLabel}
                </button>
              </div>
            ) : null}
          </div>

          <div className={`summary-surface ${editedSummary ? 'has-content' : ''}`}>
            {loading ? (
              <div className="shimmer-wrap">
                <div className="shimmer-line" />
                <div className="shimmer-line short" />
                <div className="shimmer-line" />
                <div className="shimmer-line medium" />
                <div className="shimmer-line" />
              </div>
            ) : editedSummary ? (
              <ReactMarkdown
                className="markdown-content"
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  table: ({ ...props }) => <table style={{ width: '100%', borderCollapse: 'collapse', margin: '12px 0' }} {...props} />,
                  th: ({ ...props }) => <th style={{ border: '1px solid #d1d5db', padding: '8px', textAlign: 'left', backgroundColor: '#f9fafb' }} {...props} />,
                  td: ({ ...props }) => <td style={{ border: '1px solid #d1d5db', padding: '8px' }} {...props} />,
                }}
              >
                {editedSummary}
              </ReactMarkdown>
            ) : (
              /* Better empty state */
              <div className="empty-state">
                <div className="empty-state-icon">✦</div>
                <p className="empty-state-title">Ready when you are</p>
                <p className="empty-state-body">
                  Paste your notes or upload a PDF / PowerPoint on the left,<br />
                  then hit <kbd>Summarize</kbd> or press <kbd>⌘ Enter</kbd>.
                </p>
                <div className="empty-state-hints">
                  <span>📄 PDF upload</span>
                  <span>📊 PowerPoint</span>
                  <span>🎤 Voice dictation</span>
                  <span>🌍 7 languages</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Preferences modal */}
      {preferencesOpen && (
        <div className="modal-backdrop">
          <div className="preferences-modal">
            <div className="modal-header">
              <h3>Preferences</h3>
              <button type="button" className="btn btn-subtle btn-small" onClick={() => setPreferencesOpen(false)}>Close</button>
            </div>
            <div className="pref-section">
              <p className="section-label">Subject Mode</p>
              <div className="pill-group">
                {subjectModes.map((mode) => (
                  <button key={mode} type="button" className={`btn btn-pill ${preferences.subjectMode === mode ? 'is-active' : ''}`} onClick={() => setPreferences((p) => ({ ...p, subjectMode: mode }))}>{mode}</button>
                ))}
              </div>
            </div>
            <div className="pref-section">
              <p className="section-label">Summary Length</p>
              <div className="pill-group">
                {summaryLengths.map((l) => (
                  <button key={l} type="button" className={`btn btn-pill ${preferences.summaryLength === l ? 'is-active' : ''}`} onClick={() => setPreferences((p) => ({ ...p, summaryLength: l }))}>{l}</button>
                ))}
              </div>
            </div>
            <div className="pref-section">
              <p className="section-label">Language</p>
              <select value={preferences.language} onChange={(e) => setPreferences((p) => ({ ...p, language: e.target.value }))} className="language-select">
                {languages.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="pref-section">
              <p className="section-label">Style Examples</p>
              <button type="button" className="btn btn-subtle btn-small" onClick={() => examplesInputRef.current?.click()} disabled={preferences.styleExamples.length >= 3}>
                Upload Example Summary
              </button>
              <input ref={examplesInputRef} type="file" accept=".txt,.md,.pdf,.pptx,.ppt" multiple style={{ display: 'none' }} onChange={handleUploadExamples} />
              <div className="example-pills">
                {preferences.styleExamples.map((ex) => (
                  <span key={ex.id} className="example-pill">
                    {ex.name}
                    <button type="button" onClick={() => setPreferences((p) => ({ ...p, styleExamples: p.styleExamples.filter((e) => e.id !== ex.id) }))} className="pill-remove">✕</button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hidden rich text ref for copy/PDF export */}
      <div
        ref={richSummaryRef}
        style={{ position: 'fixed', left: '-9999px', top: 0, width: 800, backgroundColor: '#fff', color: '#000', padding: 32 }}
        aria-hidden="true"
      >
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{editedSummary}</ReactMarkdown>
      </div>
    </main>
  )
}

export default App
