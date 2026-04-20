/**
 * 本地文档导出引擎
 * Markdown → DOCX / PPTX / HTML 纯前端转换，不依赖 LLM 或外部服务
 */

// docx 和 pptxgenjs 均按需动态加载，避免未使用时增大 bundle

// ─── Markdown 简易解析器 ─────────────────────────────────

/** 行内格式匹配正则（模块级编译一次） */
const INLINE_FORMAT_RE = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|([^*]+))/g

/** 解析行内格式（粗体/斜体），返回 TextRun 数组。TextRun 由调用方传入（支持动态 import） */
function parseInlineFormatting(TextRun, text, baseOpts = {}) {
  const runs = []
  const regex = new RegExp(INLINE_FORMAT_RE.source, INLINE_FORMAT_RE.flags)
  let match
  while ((match = regex.exec(text)) !== null) {
    if (match[2]) {
      runs.push(new TextRun({ text: match[2], bold: true, italics: true, ...baseOpts }))
    } else if (match[3]) {
      runs.push(new TextRun({ text: match[3], bold: true, ...baseOpts }))
    } else if (match[4]) {
      runs.push(new TextRun({ text: match[4], italics: true, ...baseOpts }))
    } else if (match[5]) {
      runs.push(new TextRun({ text: match[5], ...baseOpts }))
    }
  }
  return runs.length ? runs : [new TextRun({ text, ...baseOpts })]
}

/**
 * 将 Markdown 文本解析为结构化的 block 数组
 * @param {string} markdown
 * @returns {Array<{type: string, level?: number, text?: string, items?: string[], rows?: string[][]}>}
 */
/** 检测某行是否是 block 级元素的开始（标题/列表/表格/分隔线/空行） */
function _isBlockStart(line) {
  const trimmed = line.trim()
  return !trimmed
    || /^#{1,4}\s/.test(line)
    || /^\s*[-*]\s+/.test(line)
    || /^\s*\d+[.)]\s+/.test(line)
    || trimmed.startsWith('|')
    || /^---+$/.test(trimmed)
}

export function parseMarkdown(markdown) {
  if (!markdown) return []
  const lines = markdown.split('\n')
  const blocks = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // 空行
    if (!line.trim()) { i++; continue }

    // 标题
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/)
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2].trim() })
      i++; continue
    }

    // 分隔线
    if (/^---+$/.test(line.trim())) {
      blocks.push({ type: 'hr' })
      i++; continue
    }

    // 表格（连续的 | 开头行）
    if (line.trim().startsWith('|')) {
      const tableLines = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const row = lines[i].trim()
        // 跳过分隔行 |---|---|
        if (!/^\|[\s-:|]+\|$/.test(row)) {
          const cells = row.split('|').slice(1, -1).map(c => c.trim())
          tableLines.push(cells)
        }
        i++
      }
      if (tableLines.length) blocks.push({ type: 'table', rows: tableLines })
      continue
    }

    // 无序列表
    if (/^\s*[-*]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, '').trim())
        i++
      }
      blocks.push({ type: 'list', ordered: false, items })
      continue
    }

    // 有序列表
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '').trim())
        i++
      }
      blocks.push({ type: 'list', ordered: true, items })
      continue
    }

    // 普通段落（合并连续非空行）
    let para = ''
    while (i < lines.length && !_isBlockStart(lines[i])) {
      para += (para ? ' ' : '') + lines[i].trim()
      i++
    }
    if (para) blocks.push({ type: 'paragraph', text: para })
  }

  return blocks
}

// ─── DOCX 生成 ───────────────────────────────────────────

// 样式常量
const DOCX_STYLES = {
  titleColor: '1F4E79',
  headingColor: '2E75B6',
  textSize: 22,        // 11pt（单位半点）
  headingSize: [36, 28, 24, 22], // h1-h4
  tableHeaderBg: 'D6E4F0',
  fontFamily: 'Calibri',
  cjkFontFamily: '微软雅黑',
}

/**
 * 将 Markdown 转换为 DOCX Blob
 * @param {string} markdown
 * @param {object} [options]
 * @param {string} [options.title] - 文档标题
 * @param {string} [options.author] - 作者
 * @param {string} [options.headerText] - 页眉文字
 * @returns {Promise<Blob>}
 */
export async function markdownToDocx(markdown, options = {}) {
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel,
    Table, TableRow, TableCell, WidthType, BorderStyle,
    AlignmentType, ShadingType, Header, Footer, PageNumber,
  } = await import('docx')

  const blocks = parseMarkdown(markdown)
  const children = []
  const S = DOCX_STYLES

  const baseFont = { font: S.fontFamily, size: S.textSize }

  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        const levels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4]
        children.push(new Paragraph({
          heading: levels[Math.min(block.level - 1, 3)],
          children: parseInlineFormatting(TextRun, block.text, {
            color: block.level <= 2 ? S.headingColor : undefined,
            size: S.headingSize[Math.min(block.level - 1, 3)],
            font: S.fontFamily,
          }),
          spacing: { before: 240, after: 120 },
        }))
        break
      }

      case 'paragraph':
        children.push(new Paragraph({
          children: parseInlineFormatting(block.text, baseFont),
          spacing: { after: 120 },
        }))
        break

      case 'list':
        for (const item of block.items) {
          children.push(new Paragraph({
            children: parseInlineFormatting(TextRun, item, baseFont),
            bullet: block.ordered ? undefined : { level: 0 },
            numbering: block.ordered ? { reference: 'default-numbering', level: 0 } : undefined,
            spacing: { after: 60 },
          }))
        }
        break

      case 'table': {
        if (!block.rows.length) break
        const colCount = Math.max(...block.rows.map(r => r.length))
        const tableRows = block.rows.map((cells, rowIdx) =>
          new TableRow({
            children: Array.from({ length: colCount }, (_, ci) =>
              new TableCell({
                children: [new Paragraph({
                  children: parseInlineFormatting(TextRun, cells[ci] || '', {
                    ...baseFont,
                    bold: rowIdx === 0,
                  }),
                })],
                shading: rowIdx === 0 ? { type: ShadingType.CLEAR, fill: S.tableHeaderBg } : undefined,
                width: { size: Math.floor(9000 / colCount), type: WidthType.DXA },
              })
            ),
          })
        )
        children.push(new Table({
          rows: tableRows,
          width: { size: 9000, type: WidthType.DXA },
        }))
        children.push(new Paragraph({ text: '', spacing: { after: 120 } }))
        break
      }

      case 'hr':
        children.push(new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' } },
          spacing: { before: 120, after: 120 },
        }))
        break
    }
  }

  // 构建文档
  const sectionOpts = { children }

  // 页眉
  if (options.headerText) {
    sectionOpts.headers = {
      default: new Header({
        children: [new Paragraph({
          children: [new TextRun({ text: options.headerText, size: 18, color: '999999', font: S.fontFamily })],
          alignment: AlignmentType.RIGHT,
        })],
      }),
    }
  }

  // 页脚（页码）
  sectionOpts.footers = {
    default: new Footer({
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '999999' }),
          new TextRun({ text: ' / ', size: 18, color: '999999' }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: '999999' }),
        ],
      })],
    }),
  }

  const doc = new Document({
    creator: options.author || 'Privix',
    title: options.title || '',
    description: '由 Privix 自动生成',
    sections: [sectionOpts],
    numbering: {
      config: [{
        reference: 'default-numbering',
        levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.LEFT }],
      }],
    },
  })

  return Packer.toBlob(doc)
}

// ─── PPTX 生成 ───────────────────────────────────────────

const PPTX_THEME = {
  titleBg: '1F4E79',
  titleColor: 'FFFFFF',
  slideBg: 'FFFFFF',
  headingColor: '1F4E79',
  textColor: '333333',
  bulletColor: '2E75B6',
  tableHeaderBg: '2E75B6',
  tableHeaderColor: 'FFFFFF',
  tableAltBg: 'F2F7FC',
}

/**
 * 将 Markdown 转换为 PPTX Blob
 * @param {string} markdown
 * @param {object} [options]
 * @param {string} [options.title] - 演示文稿标题（首页）
 * @param {string} [options.subtitle] - 副标题
 * @param {string} [options.author] - 作者
 * @returns {Promise<Blob>}
 */
export async function markdownToPptx(markdown, options = {}) {
  // 动态导入（pptxgenjs 较大，按需加载）
  const PptxGenJS = (await import('pptxgenjs')).default
  const pptx = new PptxGenJS()
  const T = PPTX_THEME

  pptx.author = options.author || 'Privix'
  pptx.title = options.title || '研究报告'
  pptx.layout = 'LAYOUT_16x9'

  // 首页：标题页
  const titleSlide = pptx.addSlide()
  titleSlide.background = { color: T.titleBg }
  titleSlide.addText(options.title || '研究报告', {
    x: 0.8, y: 1.5, w: 8.4, h: 1.5,
    fontSize: 32, fontFace: 'Calibri', color: T.titleColor,
    bold: true, align: 'center',
  })
  if (options.subtitle) {
    titleSlide.addText(options.subtitle, {
      x: 0.8, y: 3.2, w: 8.4, h: 0.8,
      fontSize: 18, fontFace: 'Calibri', color: 'B0C4DE', align: 'center',
    })
  }
  titleSlide.addText(options.author || 'Privix', {
    x: 0.8, y: 4.5, w: 8.4, h: 0.5,
    fontSize: 12, fontFace: 'Calibri', color: '8DB4E2', align: 'center',
  })

  // 解析 Markdown 并按 ## 分页
  const blocks = parseMarkdown(markdown)
  let currentSlide = null
  let currentY = 1.2

  function ensureSlide() {
    if (!currentSlide) {
      currentSlide = pptx.addSlide()
      currentY = 1.2
    }
    return currentSlide
  }

  function newSlide(title) {
    currentSlide = pptx.addSlide()
    currentY = 0.15
    if (title) {
      currentSlide.addText(title, {
        x: 0.5, y: currentY, w: 9, h: 0.7,
        fontSize: 24, fontFace: 'Calibri', color: T.headingColor,
        bold: true, valign: 'middle',
      })
      // 标题下划线
      currentSlide.addShape('rect', {
        x: 0.5, y: 0.85, w: 9, h: 0.03, fill: { color: T.bulletColor },
      })
      currentY = 1.1
    }
    return currentSlide
  }

  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        if (block.level <= 2) {
          // ## 以上级别新建幻灯片
          newSlide(block.text)
        } else {
          // ### 以下级别在当前页加子标题
          ensureSlide()
          currentSlide.addText(block.text, {
            x: 0.5, y: currentY, w: 9, h: 0.5,
            fontSize: 18, fontFace: 'Calibri', color: T.headingColor,
            bold: true,
          })
          currentY += 0.55
        }
        break

      case 'paragraph':
        ensureSlide()
        // 溢出检测：超过页底时新建幻灯片
        if (currentY > 4.8) newSlide()
        currentSlide.addText(block.text, {
          x: 0.5, y: currentY, w: 9, h: 0.6,
          fontSize: 14, fontFace: 'Calibri', color: T.textColor,
          valign: 'top', wrap: true, shrinkText: true,
        })
        currentY += 0.65
        break

      case 'list':
        ensureSlide()
        for (const item of block.items) {
          if (currentY > 4.8) newSlide()
          currentSlide.addText(item, {
            x: 0.7, y: currentY, w: 8.6, h: 0.45,
            fontSize: 14, fontFace: 'Calibri', color: T.textColor,
            bullet: { type: 'bullet', style: '●', indent: 12 },
            valign: 'top', wrap: true, shrinkText: true,
          })
          currentY += 0.45
        }
        currentY += 0.1
        break

      case 'table': {
        if (!block.rows.length) break
        ensureSlide()
        if (currentY > 3.5) newSlide()

        const colCount = Math.max(...block.rows.map(r => r.length))
        const colW = 8.5 / colCount
        const tableData = block.rows.map((cells, rowIdx) =>
          Array.from({ length: colCount }, (_, ci) => ({
            text: cells[ci] || '',
            options: {
              fontSize: 11, fontFace: 'Calibri',
              color: rowIdx === 0 ? T.tableHeaderColor : T.textColor,
              fill: { color: rowIdx === 0 ? T.tableHeaderBg : (rowIdx % 2 === 0 ? T.tableAltBg : T.slideBg) },
              bold: rowIdx === 0,
              border: [{ pt: 0.5, color: 'CCCCCC' }],
              valign: 'middle', align: 'left',
            },
          }))
        )
        currentSlide.addTable(tableData, {
          x: 0.5, y: currentY, w: 9,
          colW: Array(colCount).fill(colW),
          rowH: 0.35,
          fontSize: 11,
          autoPage: true,
          autoPageRepeatHeader: true,
        })
        currentY += block.rows.length * 0.35 + 0.2
        break
      }

      case 'hr':
        // 分隔线 → 换页
        currentSlide = null
        break
    }
  }

  // 生成 Blob
  const uint8 = await pptx.write({ outputType: 'uint8array' })
  return new Blob([uint8], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
}

// ─── HTML 生成 ───────────────────────────────────────────

/** HTML 行内格式：***→b+i、**→b、*→i */
function _inlineToHtml(text) {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
}

/** HTML 转义 */
function _escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const HTML_STYLES = `
  body { max-width: 800px; margin: 2rem auto; padding: 0 1.5rem; font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; color: #333; line-height: 1.7; }
  h1 { color: #1F4E79; font-size: 1.8rem; border-bottom: 2px solid #2E75B6; padding-bottom: .3rem; }
  h2 { color: #2E75B6; font-size: 1.4rem; margin-top: 1.8rem; }
  h3 { color: #2E75B6; font-size: 1.15rem; margin-top: 1.4rem; }
  h4 { color: #333; font-size: 1rem; margin-top: 1.2rem; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #D6E4F0; padding: .45rem .6rem; text-align: left; }
  th { background: #D6E4F0; color: #1F4E79; font-weight: 600; }
  tr:nth-child(even) { background: #F2F7FC; }
  hr { border: none; border-top: 1px solid #ccc; margin: 1.5rem 0; }
  ul, ol { padding-left: 1.6rem; }
  li { margin: .2rem 0; }
  .doc-header { text-align: right; color: #999; font-size: .85rem; margin-bottom: 1rem; }
  .doc-footer { text-align: center; color: #999; font-size: .8rem; margin-top: 2rem; border-top: 1px solid #eee; padding-top: .5rem; }
  @media print { body { margin: 0; max-width: 100%; } }
  @media (max-width: 600px) { body { padding: 0 .8rem; } h1 { font-size: 1.4rem; } }
`

/**
 * 将 Markdown 转换为完整 HTML 文档 Blob
 * @param {string} markdown
 * @param {object} [options]
 * @param {string} [options.title] - 文档标题
 * @param {string} [options.author] - 作者
 * @param {string} [options.headerText] - 页眉文字
 * @returns {Promise<Blob>}
 */
export async function markdownToHtml(markdown, options = {}) {
  const blocks = parseMarkdown(markdown)
  const parts = []

  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        const tag = `h${Math.min(block.level, 4)}`
        parts.push(`<${tag}>${_inlineToHtml(_escHtml(block.text))}</${tag}>`)
        break
      }
      case 'paragraph':
        parts.push(`<p>${_inlineToHtml(_escHtml(block.text))}</p>`)
        break
      case 'list': {
        const tag = block.ordered ? 'ol' : 'ul'
        const items = block.items.map(it => `<li>${_inlineToHtml(_escHtml(it))}</li>`).join('\n')
        parts.push(`<${tag}>\n${items}\n</${tag}>`)
        break
      }
      case 'table': {
        if (!block.rows.length) break
        const headerCells = block.rows[0].map(c => `<th>${_inlineToHtml(_escHtml(c))}</th>`).join('')
        const bodyRows = block.rows.slice(1).map(row =>
          '<tr>' + row.map(c => `<td>${_inlineToHtml(_escHtml(c))}</td>`).join('') + '</tr>'
        ).join('\n')
        parts.push(`<table>\n<thead><tr>${headerCells}</tr></thead>\n<tbody>\n${bodyRows}\n</tbody>\n</table>`)
        break
      }
      case 'hr':
        parts.push('<hr>')
        break
    }
  }

  const title = _escHtml(options.title || '报告')
  const header = options.headerText ? `<div class="doc-header">${_escHtml(options.headerText)}</div>` : ''
  const footer = `<div class="doc-footer">由 ${_escHtml(options.author || 'Privix')} 生成 · ${new Date().toLocaleDateString('zh-CN')}</div>`

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>${HTML_STYLES}</style>
</head>
<body>
${header}
${parts.join('\n')}
${footer}
</body>
</html>`

  return new Blob([html], { type: 'text/html;charset=utf-8' })
}

// ─── 文件下载/保存 ──────────────────────────────────────────

/**
 * 触发浏览器下载
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/** 校验路径不含 shell 元字符（防注入） */
function _validatePath(p) {
  if (/[`$\\!;|&(){}[\]<>'"#~]/.test(p)) {
    throw new Error('文件路径包含不安全字符')
  }
}

/**
 * Tauri 模式：将 Blob 写入指定路径（通过 base64 中转）
 * @param {Blob} blob
 * @param {string} filePath - 绝对路径
 */
export async function saveBlobToPath(blob, filePath) {
  _validatePath(filePath)
  const { api } = await import('./tauri-api.js')
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  // 分块转 base64（避免 String.fromCharCode 栈溢出）
  const chunks = []
  for (let i = 0; i < bytes.length; i += 8192) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)))
  }
  const base64 = btoa(chunks.join(''))
  const tmpFile = filePath + '.b64'
  await api.assistantWriteFile(tmpFile, base64)
  // 用 sh -c 和位置参数传递路径，避免路径注入
  await api.assistantExec(`sh -c 'base64 -d "$0" > "$1" && rm "$0"' '${tmpFile}' '${filePath}'`, null)
}

/**
 * 导出文档并显示 toast 通知（封装通用的 try/catch/toast 模式）
 * @param {Function} toastFn - toast(message, type, duration)
 * @param {string} markdown
 * @param {'docx'|'pptx'|'html'} format
 * @param {object} options
 */
export async function exportAndNotify(toastFn, markdown, format, options = {}) {
  try {
    const result = await exportDocument(markdown, format, options)
    if (result.saved) {
      toastFn(`已保存到 ${result.path}`, 'success', 5000)
    } else {
      toastFn(`${result.filename} 下载中`, 'success')
    }
  } catch (err) {
    console.error('[doc-export] 导出失败:', err)
    toastFn(`导出失败: ${err.message}`, 'error')
  }
}

/**
 * 导出文档（自动选择下载或保存到路径）
 * @param {string} markdown - Markdown 内容
 * @param {'docx'|'pptx'|'html'} format
 * @param {object} options - { title, author, savePath, headerText, subtitle }
 */
export async function exportDocument(markdown, format, options = {}) {
  const ts = new Date().toISOString().slice(0, 10)
  const safeTitle = (options.title || '报告').replace(/[/\\?%*:|"<>]/g, '_').slice(0, 50)

  let blob, filename
  if (format === 'pptx') {
    blob = await markdownToPptx(markdown, options)
    filename = `${safeTitle}_${ts}.pptx`
  } else if (format === 'html') {
    blob = await markdownToHtml(markdown, options)
    filename = `${safeTitle}_${ts}.html`
  } else {
    blob = await markdownToDocx(markdown, options)
    filename = `${safeTitle}_${ts}.docx`
  }

  if (options.savePath) {
    const fullPath = `${options.savePath}/${filename}`
    try {
      await saveBlobToPath(blob, fullPath)
      return { saved: true, path: fullPath, filename }
    } catch {
      // 回退到浏览器下载
      downloadBlob(blob, filename)
      return { saved: false, path: null, filename }
    }
  } else {
    downloadBlob(blob, filename)
    return { saved: false, path: null, filename }
  }
}
