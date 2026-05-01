import { useEffect, useRef, useState, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import 'katex/dist/katex.min.css'
import './App.css'

// ── Markdown → HTML converter ────────────────────────────────────────────────
// Converts the AI's markdown output into HTML for Tiptap to render

const formatInline = (text) =>
  text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')

const markdownToHtml = (md) => {
  if (!md) return ''
  const lines = md.split('\n')
  let html = ''
  let inUl = false
  let inOl = false
  let olIndex = 0

  const closeList = () => {
    if (inUl) { html += '</ul>'; inUl = false }
    if (inOl) { html += '</ol>'; inOl = false; olIndex = 0 }
  }

  for (const line of lines) {
    if (line.startsWith('# ')) {
      closeList()
      html += `<h1>${formatInline(line.slice(2))}</h1>`
    } else if (line.startsWith('## ')) {
      closeList()
      html += `<h2>${formatInline(line.slice(3))}</h2>`
    } else if (line.startsWith('### ')) {
      closeList()
      html += `<h3>${formatInline(line.slice(4))}</h3>`
    } else if (/^[-*] /.test(line)) {
      if (inOl) closeList()
      if (!inUl) { html += '<ul>'; inUl = true }
      html += `<li><p>${formatInline(line.slice(2))}</p></li>`
    } else if (/^\d+\. /.test(line)) {
      if (inUl) closeList()
      if (!inOl) { html += '<ol>'; inOl = true }
      html += `<li><p>${formatInline(line.replace(/^\d+\. /, ''))}</p></li>`
    } else if (line.trim() === '' || line.trim() === '---') {
      closeList()
    } else {
      closeList()
      html += `<p>${formatInline(line)}</p>`
    }
  }
  closeList()
  return html
}

// ── Toolbar button ────────────────────────────────────────────────────────────

function ToolbarBtn({ onClick, active, title, children }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      className={`toolbar-btn ${active ? 'is-active' : ''}`}
    >
      {children}
    </button>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────

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
  const [summaryMarkdown, setSummaryMarkdown] = useState('')
  const [noteTitle, setNoteTitle] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [saveLabel, setSaveLabel] = useState('Save Note')
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [fileLoading, setFileLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [uploadedFiles, setUploadedFiles] = useState([])

  const recognitionRef = useRef(null)
  const examplesInputRef = useRef(null)
  const fileInputRef = useRef(null)
  const currentNoteIdRef = useRef(null)
  const editorContainerRef = useRef(null)

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

  // ── Tiptap editor ────────────────────────────────────────────────────────────

  const editor = useEditor({
    extensions: [StarterKit],
    content: '',
    editorProps: {
      attributes: { class: 'tiptap-editor' },
    },
    onUpdate: () => setIsDirty(true),
  })

  // When streaming finishes, convert markdown → HTML and load into Tiptap
  useEffect(() => {
    if (!streaming && summaryMarkdown && editor) {
      const html = markdownToHtml(summaryMarkdown)
      editor.commands.setContent(html)
      setIsDirty(true)
    }
  }, [streaming, summaryMarkdown, editor])

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (editor && !editor.isEmpty) handleSaveNote()
      }
      // Cmd+Enter to summarize
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        if (notes.trim() && !loading) handleSummarize()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [notes, loading, editor, noteTitle])

  const autoTitle = (text) =>
    text.trim().split(/\s+/).slice(0, 6).join(' ') || 'Untitled Note'

  // ── PDF.js ────────────────────────────────────────────────────────────────────

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

  // ── JSZip / PPTX ──────────────────────────────────────────────────────────────

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

  // ── Summarize ─────────────────────────────────────────────────────────────────

  const handleSummarize = async () => {
    if (!notes.trim() || loading) return
    try {
      setLoading(true)
      setStreaming(true)
      setSummaryMarkdown('')
      setIsDirty(false)
      setNoteTitle(autoTitle(notes))
      currentNoteIdRef.current = null
      if (editor) editor.commands.clearContent()

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
              setSummaryMarkdown(accumulated)
            }
          }
          if (done) break
        }
      }

      if (!receivedFirstChunk) setSummaryMarkdown('No summary returned by the API.')
    } catch (error) {
      setSummaryMarkdown(`Unable to generate summary. ${error.message}`)
    } finally {
      setLoading(false)
      setStreaming(false)
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────────

  const handleSaveNote = () => {
    if (!editor || editor.isEmpty) return
    const html = editor.getHTML()
    const title = noteTitle.trim() || autoTitle(notes)
    const updatedNotes = [...savedNotes]

    if (currentNoteIdRef.current) {
      const idx = updatedNotes.findIndex((n) => n.id === currentNoteIdRef.current)
      if (idx !== -1) {
        updatedNotes[idx] = { ...updatedNotes[idx], title, notes, summary: html, summaryMarkdown, timestamp: new Date().toISOString() }
      }
    } else {
      const newNote = { id: Date.now().toString(), title, notes, summary: html, summaryMarkdown, timestamp: new Date().toISOString() }
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
    setNoteTitle(note.title)
    setIsDirty(false)
    currentNoteIdRef.current = note.id
    setSidebarOpen(false)
    if (editor) {
      // Load HTML if available, otherwise convert markdown
      if (note.summary && note.summary.startsWith('<')) {
        editor.commands.setContent(note.summary)
      } else if (note.summaryMarkdown) {
        editor.commands.setContent(markdownToHtml(note.summaryMarkdown))
      } else if (note.summary) {
        editor.commands.setContent(markdownToHtml(note.summary))
      }
    }
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

  // ── Copy & PDF ────────────────────────────────────────────────────────────────

  const handleCopySummary = async () => {
    if (!editor) return
    const html = editor.getHTML()
    const plainText = editor.getText()
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
    if (!editor) return
    const html = editor.getHTML()
    const printWindow = window.open('', '_blank', 'width=900,height=1000')
    if (!printWindow) return
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>${noteTitle || 'NoteFlow Summary'}</title><style>body{margin:0;padding:40px;background:#fff;color:#000;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;line-height:1.7}h1,h2,h3{margin:.8em 0 .4em;font-weight:700}ul,ol{padding-left:1.4rem}li{margin-bottom:4px}p{margin:0 0 .8em}strong{font-weight:700}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{border:1px solid #d1d5db;padding:8px;text-align:left}</style></head><body>${html}</body></html>`)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  // ── Voice ─────────────────────────────────────────────────────────────────────

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

  // ── Style examples ────────────────────────────────────────────────────────────

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

  const hasSummary = editor && !editor.isEmpty

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <h1 className="logo">NoteFlow</h1>
          <div className="topbar-actions">
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
          <label htmlFor="notes" className="section-label">Your Notes</label>
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
            placeholder="Type or paste notes here, or drop a PDF / PowerPoint above... (Cmd+Enter to summarize)"
          />
          <div className="panel-actions">
            <button type="button" disabled={loading} onClick={handleSummarize} className="btn btn-summarize">
              Summarize
            </button>
            <button type="button" onClick={handleToggleRecording} className={`btn btn-mic ${isRecording ? 'is-recording' : ''}`}>
              {isRecording ? 'Stop Mic' : 'Mic'}
            </button>
            {isRecording && <span className="recording-indicator">Recording...</span>}
          </div>
        </div>

        {/* RIGHT — rich text summary */}
        <div className="panel summary-panel">
          <div className="summary-header-row">
            <input
              className="note-title-input"
              value={noteTitle}
              onChange={(e) => { setNoteTitle(e.target.value); setIsDirty(true) }}
              placeholder="Note title..."
            />
            {hasSummary && (
              <div className="summary-toolbar">
                <button type="button" onClick={handleCopySummary} className={`btn btn-subtle btn-small ${copied ? 'is-copied' : ''}`}>
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
                <button type="button" onClick={handleDownloadPdf} className="btn btn-subtle btn-small">PDF</button>
                <button type="button" onClick={handleSaveNote} className={`btn btn-subtle btn-small save-btn ${isDirty ? 'is-dirty' : ''}`}>
                  {isDirty && <span className="dirty-dot" />}
                  {saveLabel}
                </button>
              </div>
            )}
          </div>

          {/* Formatting toolbar — only shown when there's content */}
          {hasSummary && !loading && (
            <div className="editor-toolbar">
              <ToolbarBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold (Cmd+B)"><strong>B</strong></ToolbarBtn>
              <ToolbarBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic (Cmd+I)"><em>I</em></ToolbarBtn>
              <span className="toolbar-divider" />
              <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2">H2</ToolbarBtn>
              <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3">H3</ToolbarBtn>
              <span className="toolbar-divider" />
              <ToolbarBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">• List</ToolbarBtn>
              <ToolbarBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">1. List</ToolbarBtn>
              <span className="toolbar-divider" />
              <ToolbarBtn onClick={() => editor.chain().focus().undo().run()} title="Undo">↩</ToolbarBtn>
              <ToolbarBtn onClick={() => editor.chain().focus().redo().run()} title="Redo">↪</ToolbarBtn>
            </div>
          )}

          <div className={`summary-surface ${hasSummary ? 'has-content' : ''}`}>
            {loading ? (
              <div className="shimmer-wrap">
                <div className="shimmer-line" />
                <div className="shimmer-line short" />
                <div className="shimmer-line" />
                <div className="shimmer-line medium" />
                <div className="shimmer-line" />
              </div>
            ) : (
              <>
                {/* Tiptap editor — always mounted, hidden when empty */}
                <div style={{ display: hasSummary ? 'block' : 'none', height: '100%' }}>
                  <EditorContent editor={editor} />
                </div>
                {!hasSummary && (
                  <p className="muted-copy">Your generated summary will appear here.<br />Edit it, format it, then save.</p>
                )}
              </>
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
    </main>
  )
}

export default App
