import { useEffect, useRef, useState, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import TextAlign from '@tiptap/extension-text-align'
import Link from '@tiptap/extension-link'
import Color from '@tiptap/extension-color'
import TextStyle from '@tiptap/extension-text-style'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import 'katex/dist/katex.min.css'
import './App.css'

// ── Markdown → HTML ───────────────────────────────────────────────────────────
const inlineMd = (text) =>
  text
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')

const isTableRow = (line) => /^\|.+\|$/.test(line.trim())
const isSeparatorRow = (line) => /^\|[-| :]+\|$/.test(line.trim())

const markdownToHtml = (md) => {
  if (!md.trim()) return '<p></p>'
  const lines = md.split('\n')
  let html = '', inUl = false, inOl = false, tableBuffer = []

  const closeList = () => {
    if (inUl) { html += '</ul>'; inUl = false }
    if (inOl) { html += '</ol>'; inOl = false }
  }

  const flushTable = () => {
    if (!tableBuffer.length) return
    const dataRows = tableBuffer.filter((r) => !isSeparatorRow(r))
    if (!dataRows.length) { tableBuffer = []; return }
    const parsed = dataRows.map((row) =>
      row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
    )
    const [headerRow, ...bodyRows] = parsed
    html += '<table style="width:100%;border-collapse:collapse;margin:12px 0">'
    html += '<thead><tr>'
    headerRow.forEach((cell) => { html += `<th style="border:1px solid #d1d5db;padding:8px;text-align:left;background:#f9fafb">${inlineMd(cell)}</th>` })
    html += '</tr></thead>'
    if (bodyRows.length) {
      html += '<tbody>'
      bodyRows.forEach((row) => {
        html += '<tr>'
        row.forEach((cell) => { html += `<td style="border:1px solid #d1d5db;padding:8px">${inlineMd(cell)}</td>` })
        html += '</tr>'
      })
      html += '</tbody>'
    }
    html += '</table>'
    tableBuffer = []
  }

  for (const line of lines) {
    if (isTableRow(line)) { closeList(); tableBuffer.push(line); continue }
    flushTable()
    if (line.startsWith('# '))        { closeList(); html += `<h1>${inlineMd(line.slice(2).trim())}</h1>` }
    else if (line.startsWith('## '))  { closeList(); html += `<h2>${inlineMd(line.slice(3).trim())}</h2>` }
    else if (line.startsWith('### ')) { closeList(); html += `<h3>${inlineMd(line.slice(4).trim())}</h3>` }
    else if (/^[-*+] /.test(line))   { if (inOl) closeList(); if (!inUl) { html += '<ul>'; inUl = true } html += `<li><p>${inlineMd(line.replace(/^[-*+] /, '').trim())}</p></li>` }
    else if (/^\d+\. /.test(line))   { if (inUl) closeList(); if (!inOl) { html += '<ol>'; inOl = true } html += `<li><p>${inlineMd(line.replace(/^\d+\. /, '').trim())}</p></li>` }
    else if (line.trim() === '' || line.trim() === '---') { closeList() }
    else if (line.trim())             { closeList(); html += `<p>${inlineMd(line.trim())}</p>` }
  }
  flushTable(); closeList()
  return html || '<p></p>'
}

// ── Toolbar components ────────────────────────────────────────────────────────
function ToolbarBtn({ onClick, active, title, children }) {
  return (
    <button type="button" title={title} onMouseDown={(e) => { e.preventDefault(); onClick() }} className={`toolbar-btn ${active ? 'is-active' : ''}`}>
      {children}
    </button>
  )
}

function ToolbarSep() { return <div className="toolbar-sep" /> }

// ── App ───────────────────────────────────────────────────────────────────────
function App() {
  const storageKey = 'saved-study-notes'
  const preferencesKey = 'noteflow-preferences'
  const defaultPreferences = {
    subjectMode: '', noteType: 'Lecture notes', summaryLength: 'Balanced',
    language: 'English', styleExamples: [],
  }
  const noteTypes = ['Lecture notes', 'Meeting notes', 'Research notes', 'Book notes', 'Interview notes', 'Personal notes']
  const summaryLengths = ['Brief', 'Balanced', 'Detailed']
  const languages = ['English', 'Spanish', 'French', 'German', 'Dutch', 'Italian', 'Portuguese']

  const [notes, setNotes] = useState('')
  const [streamBuffer, setStreamBuffer] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [viewMarkdown, setViewMarkdown] = useState('')
  const [noteTitle, setNoteTitle] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [saveLabel, setSaveLabel] = useState('Save')
  const [autoSaveLabel, setAutoSaveLabel] = useState(null)
  const [loading, setLoading] = useState(false)
  const [fileLoading, setFileLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [editMode, setEditMode] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [showLinkInput, setShowLinkInput] = useState(false)

  const recognitionRef = useRef(null)
  const richSummaryRef = useRef(null)
  const examplesInputRef = useRef(null)
  const fileInputRef = useRef(null)
  const currentNoteIdRef = useRef(null)
  const autoSaveTimerRef = useRef(null)
  const linkInputRef = useRef(null)

  const [preferences, setPreferences] = useState(() => {
    try { const raw = localStorage.getItem(preferencesKey); return raw ? { ...defaultPreferences, ...JSON.parse(raw) } : defaultPreferences }
    catch { return defaultPreferences }
  })

  const [savedNotes, setSavedNotes] = useState(() => {
    try { const raw = localStorage.getItem(storageKey); return raw ? JSON.parse(raw) : [] }
    catch { return [] }
  })

  const wordCount = notes.trim() ? notes.trim().split(/\s+/).length : 0
  const isLong = wordCount > 800
  const hasSummary = viewMarkdown.trim().length > 0
  const isHtmlContent = viewMarkdown.trim().startsWith('<')
  const autoTitle = (text) => text.trim().split(/\s+/).slice(0, 6).join(' ') || 'Untitled Note'

  // ── Tiptap ───────────────────────────────────────────────────────────────────
  const editor = useEditor({
    extensions: [
      StarterKit,
      Table.configure({ resizable: false }),
      TableRow, TableHeader, TableCell,
      Underline,
      Highlight.configure({ multicolor: true }),
      Subscript,
      Superscript,
      TextStyle,
      Color,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: 'tiptap-link' } }),
    ],
    content: '',
    editorProps: { attributes: { class: 'tiptap-body' } },
    onUpdate: () => setIsDirty(true),
  })

  useEffect(() => {
    if (!streaming && streamBuffer) {
      setViewMarkdown(streamBuffer)
      if (editor) editor.commands.setContent(markdownToHtml(streamBuffer), false)
      setIsDirty(true)
    }
  }, [streaming])

  useEffect(() => {
    if (editMode && editor && viewMarkdown) {
      const html = isHtmlContent ? viewMarkdown : markdownToHtml(viewMarkdown)
      editor.commands.setContent(html, false)
    }
  }, [editMode])

  // ── Link handler ──────────────────────────────────────────────────────────────
  const handleSetLink = () => {
    if (!editor) return
    if (!linkUrl.trim()) { editor.chain().focus().unsetLink().run(); setShowLinkInput(false); return }
    const url = linkUrl.startsWith('http') ? linkUrl : `https://${linkUrl}`
    editor.chain().focus().setLink({ href: url }).run()
    setShowLinkInput(false)
    setLinkUrl('')
  }

  const handleLinkBtn = () => {
    if (!editor) return
    if (editor.isActive('link')) { editor.chain().focus().unsetLink().run(); return }
    setLinkUrl(editor.getAttributes('link').href || '')
    setShowLinkInput((s) => !s)
    setTimeout(() => linkInputRef.current?.focus(), 50)
  }

  // ── Auto-save ─────────────────────────────────────────────────────────────────
  const doAutoSave = useCallback(() => {
    if (!hasSummary || !isDirty) return
    const summary = editMode && editor ? editor.getHTML() : viewMarkdown
    const title = noteTitle.trim() || autoTitle(notes)
    const updatedNotes = [...savedNotes]
    if (currentNoteIdRef.current) {
      const idx = updatedNotes.findIndex((n) => n.id === currentNoteIdRef.current)
      if (idx !== -1) updatedNotes[idx] = { ...updatedNotes[idx], title, notes, summary, timestamp: new Date().toISOString() }
    } else {
      const newNote = { id: Date.now().toString(), title, notes, summary, timestamp: new Date().toISOString() }
      currentNoteIdRef.current = newNote.id; updatedNotes.unshift(newNote)
    }
    setSavedNotes(updatedNotes); localStorage.setItem(storageKey, JSON.stringify(updatedNotes))
    setIsDirty(false); setAutoSaveLabel('Auto-saved'); setTimeout(() => setAutoSaveLabel(null), 2000)
  }, [hasSummary, isDirty, editMode, editor, viewMarkdown, noteTitle, notes, savedNotes])

  useEffect(() => {
    if (!isDirty || !hasSummary) return
    autoSaveTimerRef.current = setTimeout(doAutoSave, 30000)
    return () => clearTimeout(autoSaveTimerRef.current)
  }, [isDirty, hasSummary, doAutoSave])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (hasSummary) handleSaveNote() }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); if (notes.trim() && !loading) handleSummarize() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [notes, loading, hasSummary, noteTitle, editMode])

  // ── New note ──────────────────────────────────────────────────────────────────
  const handleNewNote = () => {
    if (isDirty && hasSummary && !window.confirm('You have unsaved changes. Start a new note anyway?')) return
    setNotes(''); setStreamBuffer(''); setViewMarkdown(''); setNoteTitle('')
    setIsDirty(false); setUploadedFiles([]); setEditMode(false)
    currentNoteIdRef.current = null; setSaveLabel('Save')
    if (editor) editor.commands.clearContent()
  }

  // ── PDF.js ────────────────────────────────────────────────────────────────────
  const loadPdfJs = () => new Promise((resolve, reject) => {
    if (window.pdfjsLib) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.js'; resolve(window.pdfjsLib); return }
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.js'; s.async = true
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.js'; resolve(window.pdfjsLib) }
    s.onerror = () => reject(new Error('Failed to load PDF.js')); document.body.appendChild(s)
  })

  const readPdfFile = async (file) => {
    const pdfjs = await loadPdfJs()
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
    const pages = []
    for (let i = 1; i <= pdf.numPages; i++) { const page = await pdf.getPage(i); const c = await page.getTextContent(); pages.push(c.items.map((item) => item.str).join(' ')) }
    return pages.join('\n\n')
  }

  // ── JSZip / PPTX ──────────────────────────────────────────────────────────────
  const loadJSZip = () => new Promise((resolve, reject) => {
    if (window.JSZip) { resolve(window.JSZip); return }
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'; s.async = true
    s.onload = () => resolve(window.JSZip); s.onerror = () => reject(new Error('Failed to load JSZip')); document.body.appendChild(s)
  })

  const readPptxFile = async (file) => {
    const JSZip = await loadJSZip()
    const zip = await JSZip.loadAsync(await file.arrayBuffer())
    const slideFiles = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)?.[0] || '0') - parseInt(b.match(/\d+/)?.[0] || '0'))
    if (!slideFiles.length) throw new Error('No slides found.')
    const extractText = (xml) => (xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || []).map((m) => m.replace(/<[^>]+>/g, '').trim()).filter(Boolean).join(' ')
    const slideTexts = []
    for (let i = 0; i < slideFiles.length; i++) {
      const slideNum = i + 1; const slideText = extractText(await zip.files[slideFiles[i]].async('text')); let notesText = ''
      const notesPath = `ppt/notesSlides/notesSlide${slideNum}.xml`
      if (zip.files[notesPath]) notesText = extractText(await zip.files[notesPath].async('text'))
      const parts = []; if (slideText.trim()) parts.push(`Slide content: ${slideText.trim()}`); if (notesText.trim()) parts.push(`Speaker notes: ${notesText.trim()}`)
      if (parts.length) slideTexts.push(`[Slide ${slideNum}]\n${parts.join('\n')}`)
    }
    return slideTexts.join('\n\n')
  }

  // ── File upload ───────────────────────────────────────────────────────────────
  const appendFileToNotes = async (files) => {
    setFileLoading(true)
    try {
      for (const file of files) {
        const lower = file.name.toLowerCase(); let text = ''
        if (lower.endsWith('.pdf')) text = await readPdfFile(file)
        else if (lower.endsWith('.pptx') || lower.endsWith('.ppt')) text = await readPptxFile(file)
        if (text.trim()) { setNotes((p) => p.trim() ? `${p}\n\n--- Uploaded: ${file.name} ---\n\n${text.trim()}` : `--- Uploaded: ${file.name} ---\n\n${text.trim()}`); setUploadedFiles((p) => [...p, file.name]) }
        else alert(`No readable text found in ${file.name}.`)
      }
    } catch (err) { alert(`Could not read file: ${err.message}`) }
    finally { setFileLoading(false) }
  }

  const handleFileUpload = async (e) => { const files = Array.from(e.target.files || []); if (files.length) await appendFileToNotes(files); e.target.value = '' }
  const handleDrop = async (e) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files).filter((f) => { const l = f.name.toLowerCase(); return l.endsWith('.pdf') || l.endsWith('.pptx') || l.endsWith('.ppt') })
    if (files.length) await appendFileToNotes(files)
  }

  // ── Summarize ─────────────────────────────────────────────────────────────────
  const handleSummarize = async () => {
    if (!notes.trim() || loading) return
    try {
      setLoading(true); setStreaming(true); setStreamBuffer(''); setViewMarkdown('')
      setIsDirty(false); setEditMode(false); setNoteTitle(autoTitle(notes))
      currentNoteIdRef.current = null; if (editor) editor.commands.clearContent()

      const lengthInstructions = { Brief: 'Bullet points only, very concise.', Balanced: 'Concise but useful detail.', Detailed: 'Include explanations, examples, and context.' }
      const noteTypeInstructions = {
        'Lecture notes': 'Structure as a study guide with key concepts, definitions, and important details.',
        'Meeting notes': 'Structure with decisions made, action items, and key discussion points.',
        'Research notes': 'Structure with findings, methodology notes, and open questions.',
        'Book notes': 'Structure with main arguments, key ideas, and takeaways.',
        'Interview notes': 'Structure with key themes and notable insights.',
        'Personal notes': 'Structure naturally based on the content.',
      }
      const styleExamplesSection = preferences.styleExamples.length > 0 ? `\nMatch the style of these examples:\n---\n${preferences.styleExamples.map((e) => e.text).join('\n---\n')}\n---\n` : ''

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': import.meta.env.VITE_ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', max_tokens: 1024, stream: true,
          system: `You are a study assistant. Transform raw notes into a clean, structured summary.
Rules:
- Decide what structure fits THIS content — never use the same template twice
- Be concise — no waffle, encouragement, or filler
- Include formulas, distinctions, and examples where relevant
- Flag anything mentioned but not explained
- Silently correct spelling and typos
- Consolidate repeated concepts
- Never say "the notes mention..." — present content as fact
- For uploaded files marked "--- Uploaded: filename ---", integrate naturally
- For PowerPoint slides marked [Slide N], treat each as a separate topic

Preferences:
- Note type: ${preferences.noteType} — ${noteTypeInstructions[preferences.noteType] || ''}
- Subject: ${preferences.subjectMode || 'not specified'}
- Length: ${preferences.summaryLength} — ${lengthInstructions[preferences.summaryLength]}
- Language: ${preferences.language}
${styleExamplesSection}
Output clean markdown only. Use ## for section headings, **bold** for key terms, - for bullets, and | table | syntax for comparisons.`,
          messages: [{ role: 'user', content: notes }],
        }),
      })

      if (!response.ok) throw new Error((await response.text()) || 'Failed to summarize.')
      if (!response.body) throw new Error('No stream returned.')

      const reader = response.body.getReader(); const decoder = new TextDecoder()
      let done = false, buffer = '', accumulated = '', receivedFirstChunk = false

      while (!done) {
        const { value, done: rd } = await reader.read(); done = rd
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
        const parts = buffer.split('\n\n'); buffer = parts.pop() || ''
        for (const part of parts) {
          if (!part.includes('data: ')) continue
          for (const dataChunk of part.split('data: ').slice(1)) {
            const payload = dataChunk.trim(); if (!payload || payload === '[DONE]') continue
            const parsed = JSON.parse(payload); if (parsed.type === 'message_stop') { done = true; break }
            const dt = parsed?.delta?.text
            if (dt) { if (!receivedFirstChunk) { setLoading(false); receivedFirstChunk = true } accumulated += dt; setStreamBuffer(accumulated) }
          }
          if (done) break
        }
      }
      if (!receivedFirstChunk) setStreamBuffer('No summary returned.')
    } catch (error) { setStreamBuffer(`Unable to generate summary. ${error.message}`) }
    finally { setLoading(false); setStreaming(false) }
  }

  // ── Save ──────────────────────────────────────────────────────────────────────
  const handleSaveNote = () => {
    if (!hasSummary) return
    const summary = editMode && editor ? editor.getHTML() : viewMarkdown
    const title = noteTitle.trim() || autoTitle(notes)
    const updatedNotes = [...savedNotes]
    if (currentNoteIdRef.current) {
      const idx = updatedNotes.findIndex((n) => n.id === currentNoteIdRef.current)
      if (idx !== -1) updatedNotes[idx] = { ...updatedNotes[idx], title, notes, summary, timestamp: new Date().toISOString() }
    } else {
      const newNote = { id: Date.now().toString(), title, notes, summary, timestamp: new Date().toISOString() }
      currentNoteIdRef.current = newNote.id; updatedNotes.unshift(newNote)
    }
    setSavedNotes(updatedNotes); localStorage.setItem(storageKey, JSON.stringify(updatedNotes))
    setIsDirty(false); setSaveLabel('Saved'); setTimeout(() => setSaveLabel('Save'), 2000)
  }

  const handleLoadSavedNote = (note) => {
    setNotes(note.notes); setNoteTitle(note.title); setIsDirty(false); setEditMode(false)
    currentNoteIdRef.current = note.id; setSidebarOpen(false); setUploadedFiles([])
    const summary = note.summary || ''; setViewMarkdown(summary); setStreamBuffer(summary)
    if (editor) { const html = summary.trim().startsWith('<') ? summary : markdownToHtml(summary); editor.commands.setContent(html, false) }
  }

  const handleDeleteSavedNote = (id) => {
    const updated = savedNotes.filter((n) => n.id !== id); setSavedNotes(updated)
    localStorage.setItem(storageKey, JSON.stringify(updated))
    if (currentNoteIdRef.current === id) currentNoteIdRef.current = null
  }

  const handleRenameNote = (id) => {
    const updated = savedNotes.map((n) => n.id === id ? { ...n, title: renameValue.trim() || n.title } : n)
    setSavedNotes(updated); localStorage.setItem(storageKey, JSON.stringify(updated)); setRenamingId(null)
  }

  const handleToggleEditMode = () => {
    if (editMode && editor) setViewMarkdown(editor.getHTML())
    setEditMode((m) => !m)
    setShowLinkInput(false)
  }

  // ── Copy & PDF ────────────────────────────────────────────────────────────────
  const handleCopySummary = async () => {
    if (!richSummaryRef.current) return
    const clone = richSummaryRef.current.cloneNode(true)
    clone.querySelectorAll('table').forEach((t) => { t.style.borderCollapse = 'collapse'; t.style.width = '100%' })
    clone.querySelectorAll('th').forEach((th) => { th.style.border = '1px solid black'; th.style.padding = '6px 12px'; th.style.backgroundColor = '#f3f4f6'; th.style.textAlign = 'left' })
    clone.querySelectorAll('td').forEach((td) => { td.style.border = '1px solid black'; td.style.padding = '6px 12px' })
    try {
      if (window.ClipboardItem && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([clone.innerHTML], { type: 'text/html' }), 'text/plain': new Blob([richSummaryRef.current.innerText], { type: 'text/plain' }) })])
      } else {
        const d = document.createElement('div'); d.contentEditable = 'true'; d.style.cssText = 'position:fixed;left:-9999px'; d.innerHTML = clone.innerHTML; document.body.appendChild(d)
        const r = document.createRange(); r.selectNodeContents(d); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand('copy'); s.removeAllRanges(); document.body.removeChild(d)
      }
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  const handleDownloadPdf = () => {
    if (!richSummaryRef.current) return
    const w = window.open('', '_blank', 'width=900,height=1000'); if (!w) return
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>${noteTitle || 'NoteFlow'}</title><style>body{margin:0;padding:40px;background:#fff;color:#000;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;line-height:1.7}h1,h2,h3{margin:.8em 0 .4em;font-weight:700}ul,ol{padding-left:1.4rem}p{margin:0 0 .7em}strong{font-weight:700}mark{background:#fef08a}u{text-decoration:underline}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{border:1px solid #d1d5db;padding:8px;text-align:left}a{color:#2563eb}</style></head><body>${richSummaryRef.current.innerHTML}</body></html>`)
    w.document.close(); w.focus(); w.print()
  }

  // ── Voice ─────────────────────────────────────────────────────────────────────
  const handleToggleRecording = () => {
    if (isRecording) { recognitionRef.current?.stop(); setIsRecording(false); return }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { alert('Please use Chrome for voice input'); return }
    const rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US'
    rec.onresult = (e) => { let chunk = ''; for (let i = e.resultIndex; i < e.results.length; i++) chunk += e.results[i][0].transcript; if (chunk.trim()) setNotes((p) => `${p}${p ? ' ' : ''}${chunk.trim()}`) }
    rec.onend = () => { setIsRecording(false); recognitionRef.current = null }
    rec.onerror = () => { setIsRecording(false); recognitionRef.current = null }
    recognitionRef.current = rec; rec.start(); setIsRecording(true)
  }

  // ── Style examples ────────────────────────────────────────────────────────────
  const readTextFile = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result || '')); r.onerror = () => rej(new Error(`Unable to read ${file.name}`)); r.readAsText(file) })

  const handleUploadExamples = async (event) => {
    const files = Array.from(event.target.files || []).slice(0, 3 - preferences.styleExamples.length)
    try {
      const parsed = []
      for (const file of files) {
        const lower = file.name.toLowerCase()
        let text = lower.endsWith('.pdf') ? await readPdfFile(file) : (lower.endsWith('.pptx') || lower.endsWith('.ppt')) ? await readPptxFile(file) : await readTextFile(file)
        if (text.trim()) parsed.push({ id: `${Date.now()}-${file.name}`, name: file.name, text: text.trim() })
      }
      if (parsed.length) setPreferences((p) => ({ ...p, styleExamples: [...p.styleExamples, ...parsed].slice(0, 3) }))
    } catch (err) { alert(`Could not upload: ${err.message}`) }
    finally { event.target.value = '' }
  }

  useEffect(() => { return () => recognitionRef.current?.stop() }, [])
  useEffect(() => { localStorage.setItem(preferencesKey, JSON.stringify(preferences)) }, [preferences])

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <h1 className="logo">NoteFlow</h1>
          <div className="topbar-actions">
            <button type="button" onClick={handleNewNote} className="btn btn-ghost">New note</button>
            <button type="button" onClick={() => setPreferencesOpen(true)} className="btn btn-ghost">Preferences</button>
            <button type="button" onClick={() => setSidebarOpen((o) => !o)} className="btn btn-ghost">Saved notes</button>
          </div>
        </div>
      </header>

      <aside className={`saved-sidebar ${sidebarOpen ? 'is-open' : ''}`}>
        <h3 className="sidebar-title">Saved Notes</h3>
        {savedNotes.length === 0 ? <p className="muted-copy">No saved notes yet.</p> : savedNotes.map((note) => (
          <div key={note.id} className="saved-note-card">
            {renamingId === note.id ? (
              <div className="rename-row">
                <input className="rename-input" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleRenameNote(note.id); if (e.key === 'Escape') setRenamingId(null) }} autoFocus />
                <button type="button" className="btn btn-subtle btn-small" onClick={() => handleRenameNote(note.id)}>Done</button>
              </div>
            ) : (
              <button type="button" onClick={() => handleLoadSavedNote(note)} className="saved-note-main">
                <div className="saved-note-title">{note.title || 'Untitled Note'}</div>
                <div className="saved-note-date">{new Date(note.timestamp).toLocaleString()}</div>
              </button>
            )}
            <div className="note-card-actions">
              <button type="button" className="icon-btn" onClick={() => { setRenamingId(note.id); setRenameValue(note.title) }}>Rename</button>
              <button type="button" className="icon-btn icon-btn-delete" onClick={() => handleDeleteSavedNote(note.id)}>Delete</button>
            </div>
          </div>
        ))}
      </aside>

      <section className="workspace-card">
        {/* LEFT */}
        <div className="panel notes-panel">
          <div className="panel-label-row">
            <label htmlFor="notes" className="section-label">Notes</label>
            {notes.trim() && <span className={`word-counter ${isLong ? 'is-long' : ''}`}>{wordCount} words{isLong && <span className="counter-warning"> — getting long</span>}</span>}
          </div>
          <div className="pdf-dropzone" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop} onClick={() => fileInputRef.current?.click()}>
            {fileLoading ? <span className="muted-copy">Reading file...</span> : <span className="muted-copy">Upload <strong>PDF</strong> or <strong>PowerPoint</strong> — drag here or click</span>}
          </div>
          <input ref={fileInputRef} type="file" accept=".pdf,.pptx,.ppt" multiple style={{ display: 'none' }} onChange={handleFileUpload} />
          {uploadedFiles.length > 0 && (
            <div className="example-pills" style={{ marginBottom: 8 }}>
              {uploadedFiles.map((name, i) => (
                <span key={i} className="example-pill">{name}<button type="button" className="pill-remove" onClick={() => setUploadedFiles((p) => p.filter((_, j) => j !== i))}>Remove</button></span>
              ))}
            </div>
          )}
          <textarea id="notes" className="notes-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={"Type or paste notes here, or upload a file above.\n\nCmd+Enter to summarize."} />
          <div className="panel-actions">
            <button type="button" disabled={loading} onClick={handleSummarize} className="btn btn-summarize">Summarize</button>
            <button type="button" onClick={handleToggleRecording} className={`btn btn-mic ${isRecording ? 'is-recording' : ''}`}>{isRecording ? 'Stop recording' : 'Dictate'}</button>
            {isRecording && <span className="recording-indicator">Recording</span>}
          </div>
        </div>

        {/* RIGHT */}
        <div className="panel summary-panel">
          <div className="summary-title-row">
            <input className="note-title-input" value={noteTitle} onChange={(e) => { setNoteTitle(e.target.value); setIsDirty(true) }} placeholder="Untitled note" />
            {hasSummary && (
              <div className="summary-actions">
                {autoSaveLabel && <span className="autosave-label">{autoSaveLabel}</span>}
                <button type="button" onClick={handleToggleEditMode} className={`btn btn-subtle btn-small ${editMode ? 'btn-edit-active' : ''}`}>{editMode ? 'Done' : 'Edit'}</button>
                <button type="button" onClick={handleCopySummary} className={`btn btn-subtle btn-small ${copied ? 'is-copied' : ''}`}>{copied ? 'Copied' : 'Copy'}</button>
                <button type="button" onClick={handleDownloadPdf} className="btn btn-subtle btn-small">Export PDF</button>
                <button type="button" onClick={handleSaveNote} className={`btn btn-subtle btn-small save-btn ${isDirty ? 'is-dirty' : ''}`}>{isDirty && <span className="dirty-dot" />}{saveLabel}</button>
              </div>
            )}
          </div>

          {/* Toolbar — edit mode only */}
          {editMode && hasSummary && editor && (
            <div className="editor-toolbar-wrap">
              <div className="editor-toolbar">
                {/* Text style */}
                <ToolbarBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold (Cmd+B)"><strong>B</strong></ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic (Cmd+I)"><em>I</em></ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline (Cmd+U)"><u>U</u></ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough"><s>S</s></ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().toggleSubscript().run()} active={editor.isActive('subscript')} title="Subscript">x₂</ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().toggleSuperscript().run()} active={editor.isActive('superscript')} title="Superscript">x²</ToolbarBtn>

                <ToolbarSep />

                {/* Highlight */}
                <ToolbarBtn onClick={() => editor.chain().focus().toggleHighlight({ color: '#fef08a' }).run()} active={editor.isActive('highlight', { color: '#fef08a' })} title="Highlight yellow">
                  <span style={{ background: '#fef08a', padding: '0 3px', borderRadius: 2 }}>H</span>
                </ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().toggleHighlight({ color: '#bbf7d0' }).run()} active={editor.isActive('highlight', { color: '#bbf7d0' })} title="Highlight green">
                  <span style={{ background: '#bbf7d0', padding: '0 3px', borderRadius: 2 }}>H</span>
                </ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().toggleHighlight({ color: '#bfdbfe' }).run()} active={editor.isActive('highlight', { color: '#bfdbfe' })} title="Highlight blue">
                  <span style={{ background: '#bfdbfe', padding: '0 3px', borderRadius: 2 }}>H</span>
                </ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().unsetHighlight().run()} active={false} title="Remove highlight">
                  <span style={{ textDecoration: 'line-through', fontSize: 11 }}>H</span>
                </ToolbarBtn>

                <ToolbarSep />

                {/* Headings */}
                <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Heading 1">H1</ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2">H2</ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3">H3</ToolbarBtn>

                <ToolbarSep />

                {/* Lists & structure */}
                <ToolbarBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">• List</ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">1. List</ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Blockquote">" "</ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} active={false} title="Divider">—</ToolbarBtn>

                <ToolbarSep />

                {/* Alignment */}
                <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align left">≡L</ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Align center">≡C</ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align right">≡R</ToolbarBtn>

                <ToolbarSep />

                {/* Link */}
                <ToolbarBtn onClick={handleLinkBtn} active={editor.isActive('link')} title="Add link">🔗</ToolbarBtn>

                <ToolbarSep />

                {/* History */}
                <ToolbarBtn onClick={() => editor.chain().focus().undo().run()} active={false} title="Undo">↩</ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().redo().run()} active={false} title="Redo">↪</ToolbarBtn>
              </div>

              {/* Link input row */}
              {showLinkInput && (
                <div className="link-input-row">
                  <input
                    ref={linkInputRef}
                    type="text"
                    className="link-input"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSetLink(); if (e.key === 'Escape') setShowLinkInput(false) }}
                    placeholder="https://..."
                  />
                  <button type="button" className="btn btn-subtle btn-small" onClick={handleSetLink}>Apply</button>
                  <button type="button" className="btn btn-subtle btn-small" onClick={() => setShowLinkInput(false)}>Cancel</button>
                </div>
              )}
            </div>
          )}

          {/* Content */}
          <div className={`summary-surface ${hasSummary ? 'has-content' : ''}`}>
            {loading ? (
              <div className="shimmer-wrap">
                <div className="shimmer-line" /><div className="shimmer-line short" />
                <div className="shimmer-line" /><div className="shimmer-line medium" /><div className="shimmer-line" />
              </div>
            ) : hasSummary ? (
              editMode ? (
                <EditorContent editor={editor} />
              ) : (
                isHtmlContent ? (
                  <div className="markdown-content" dangerouslySetInnerHTML={{ __html: viewMarkdown }} />
                ) : (
                  <ReactMarkdown className="markdown-content" remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}
                    components={{
                      table: ({ ...props }) => <table style={{ width: '100%', borderCollapse: 'collapse', margin: '12px 0' }} {...props} />,
                      th: ({ ...props }) => <th style={{ border: '1px solid #d1d5db', padding: '8px', textAlign: 'left', backgroundColor: '#f9fafb' }} {...props} />,
                      td: ({ ...props }) => <td style={{ border: '1px solid #d1d5db', padding: '8px' }} {...props} />,
                    }}
                  >{viewMarkdown}</ReactMarkdown>
                )
              )
            ) : (
              <div className="empty-state">
                <p className="empty-state-title">Your summary will appear here</p>
                <p className="empty-state-body">Paste notes or upload a file on the left,<br />then press <kbd>Summarize</kbd> or <kbd>Cmd Enter</kbd>.</p>
                <div className="empty-state-hints"><span>PDF upload</span><span>PowerPoint</span><span>Voice dictation</span><span>7 languages</span></div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Hidden ref for copy/PDF */}
      <div ref={richSummaryRef} style={{ position: 'fixed', left: '-9999px', top: 0, width: 800, backgroundColor: '#fff', color: '#000', padding: 32 }} aria-hidden="true">
        {isHtmlContent ? <div dangerouslySetInnerHTML={{ __html: viewMarkdown }} /> : <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{viewMarkdown}</ReactMarkdown>}
      </div>

      {/* Preferences */}
      {preferencesOpen && (
        <div className="modal-backdrop">
          <div className="preferences-modal">
            <div className="modal-header"><h3>Preferences</h3><button type="button" className="btn btn-subtle btn-small" onClick={() => setPreferencesOpen(false)}>Close</button></div>
            <div className="pref-section">
              <p className="section-label">Note Type</p>
              <div className="pill-group">{noteTypes.map((type) => <button key={type} type="button" className={`btn btn-pill ${preferences.noteType === type ? 'is-active' : ''}`} onClick={() => setPreferences((p) => ({ ...p, noteType: type }))}>{type}</button>)}</div>
            </div>
            <div className="pref-section">
              <p className="section-label">Subject</p>
              <p className="pref-description">Enter your subject so the AI structures the summary accordingly.</p>
              <input type="text" className="pref-text-input" value={preferences.subjectMode} onChange={(e) => setPreferences((p) => ({ ...p, subjectMode: e.target.value }))} placeholder="e.g. Thermodynamics, Contract Law, Macroeconomics..." />
            </div>
            <div className="pref-section">
              <p className="section-label">Summary Length</p>
              <div className="pill-group">{summaryLengths.map((l) => <button key={l} type="button" className={`btn btn-pill ${preferences.summaryLength === l ? 'is-active' : ''}`} onClick={() => setPreferences((p) => ({ ...p, summaryLength: l }))}>{l}</button>)}</div>
            </div>
            <div className="pref-section">
              <p className="section-label">Language</p>
              <select value={preferences.language} onChange={(e) => setPreferences((p) => ({ ...p, language: e.target.value }))} className="language-select">
                {languages.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="pref-section">
              <p className="section-label">Style Examples</p>
              <p className="pref-description">Upload up to 3 example summaries. The AI will match their style.</p>
              <button type="button" className="btn btn-subtle btn-small" onClick={() => examplesInputRef.current?.click()} disabled={preferences.styleExamples.length >= 3}>Upload example</button>
              <input ref={examplesInputRef} type="file" accept=".txt,.md,.pdf,.pptx,.ppt" multiple style={{ display: 'none' }} onChange={handleUploadExamples} />
              <div className="example-pills">
                {preferences.styleExamples.map((ex) => (
                  <span key={ex.id} className="example-pill">{ex.name}<button type="button" onClick={() => setPreferences((p) => ({ ...p, styleExamples: p.styleExamples.filter((e) => e.id !== ex.id) }))} className="pill-remove">Remove</button></span>
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
