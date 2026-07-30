import * as pdfjsLib from "./vendor/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  fileInput: $("#fileInput"),
  addFilesButton: $("#addFilesButton"),
  uploadZone: $("#uploadZone"),
  emptyUploadButton: $("#emptyUploadButton"),
  documentList: $("#documentList"),
  pageTitle: $("#pageTitle"),
  pageCounter: $("#pageCounter"),
  prevPageButton: $("#prevPageButton"),
  nextPageButton: $("#nextPageButton"),
  viewerEmpty: $("#viewerEmpty"),
  viewerStage: $("#viewerStage"),
  canvasWrap: $("#canvasWrap"),
  pdfCanvas: $("#pdfCanvas"),
  selectionLayer: $("#selectionLayer"),
  selectionBox: $("#selectionBox"),
  selectionSize: $("#selectionSize"),
  selectionAction: $("#selectionAction"),
  selectionMeta: $("#selectionMeta"),
  addQuestionButton: $("#addQuestionButton"),
  cancelSelectionButton: $("#cancelSelectionButton"),
  toolHint: $("#toolHint"),
  zoomOutButton: $("#zoomOutButton"),
  zoomInButton: $("#zoomInButton"),
  zoomLabel: $("#zoomLabel"),
  questionList: $("#questionList"),
  questionCount: $("#questionCount"),
  previewButton: $("#previewButton"),
  exportButton: $("#exportButton"),
  clearAllButton: $("#clearAllButton"),
  settingsToggle: $("#settingsToggle"),
  settingsBody: $("#settingsBody"),
  paperTitle: $("#paperTitle"),
  paperSize: $("#paperSize"),
  columns: $("#columns"),
  pageMargin: $("#pageMargin"),
  marginOutput: $("#marginOutput"),
  questionGap: $("#questionGap"),
  gapOutput: $("#gapOutput"),
  showNumbers: $("#showNumbers"),
  showSources: $("#showSources"),
  previewModal: $("#previewModal"),
  previewPages: $("#previewPages"),
  previewSummary: $("#previewSummary"),
  closeModalButton: $("#closeModalButton"),
  modalExportButton: $("#modalExportButton"),
  toastRegion: $("#toastRegion"),
  saveStatus: $("#saveStatus"),
};

const state = {
  documents: [],
  activeDocumentId: null,
  activePage: 1,
  zoom: 1,
  questions: [],
  selection: null,
  pointer: null,
  previewCanvases: [],
  renderToken: 0,
};

const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function toast(message, type = "success") {
  const item = document.createElement("div");
  item.className = `toast ${type === "error" ? "error" : ""}`;
  item.textContent = message;
  elements.toastRegion.append(item);
  window.setTimeout(() => item.remove(), 3200);
}

function setSaveStatus(text, busy = false) {
  elements.saveStatus.lastChild.textContent = ` ${text}`;
  elements.saveStatus.querySelector("i").style.background = busy ? "#f0b857" : "#54c88a";
}

function getActiveDocument() {
  return state.documents.find((document) => document.id === state.activeDocumentId);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function handleFiles(files) {
  const pdfFiles = [...files].filter(
    (file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"),
  );

  if (!pdfFiles.length) {
    toast("请选择 PDF 文件。", "error");
    return;
  }

  setSaveStatus("正在读取 PDF", true);
  for (const file of pdfFiles) {
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      state.documents.push({
        id: uid(),
        name: file.name,
        size: file.size,
        pdf,
        pages: pdf.numPages,
        thumbnailsRendered: false,
      });
    } catch (error) {
      console.error(error);
      toast(`无法读取「${file.name}」，文件可能已加密或损坏。`, "error");
    }
  }

  if (!state.activeDocumentId && state.documents.length) {
    state.activeDocumentId = state.documents[0].id;
    state.activePage = 1;
  }

  renderDocumentList();
  await renderActivePage();
  setSaveStatus("仅在本机处理");
  if (pdfFiles.length > 1) toast(`已加入 ${pdfFiles.length} 份试卷。`);
}

function renderDocumentList() {
  if (!state.documents.length) {
    elements.documentList.innerHTML = `
      <div class="empty-note">
        <span>还没有试卷</span>
        上传后会在这里按文档和页码整理
      </div>`;
    return;
  }

  elements.documentList.innerHTML = state.documents
    .map(
      (document) => `
        <div class="document-item ${document.id === state.activeDocumentId ? "active" : ""}" data-document-id="${document.id}">
          <button class="document-button" type="button" data-open-document="${document.id}">
            <span class="pdf-icon">PDF</span>
            <span class="document-name">
              <strong title="${escapeHtml(document.name)}">${escapeHtml(document.name)}</strong>
              <small>${document.pages} 页 · ${formatFileSize(document.size)}</small>
            </span>
            <span class="document-remove" role="button" tabindex="0" data-remove-document="${document.id}" title="移除">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
            </span>
          </button>
          ${
            document.id === state.activeDocumentId
              ? `<div class="page-strip">${Array.from({ length: document.pages }, (_, index) => {
                  const page = index + 1;
                  return `<button class="page-thumb ${page === state.activePage ? "active" : ""}" type="button" data-page="${page}" title="第 ${page} 页">
                    <canvas data-thumb-page="${page}"></canvas><span>${page}</span>
                  </button>`;
                }).join("")}</div>`
              : ""
          }
        </div>`,
    )
    .join("");

  renderVisibleThumbnails();
}

async function renderVisibleThumbnails() {
  const document = getActiveDocument();
  if (!document) return;
  const canvases = $$("[data-thumb-page]");
  const limited = canvases.slice(0, 24);
  await Promise.all(
    limited.map(async (canvas) => {
      const pageNumber = Number(canvas.dataset.thumbPage);
      try {
        const page = await document.pdf.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 76 / base.width });
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.ceil(viewport.width * ratio);
        canvas.height = Math.ceil(viewport.height * ratio);
        const context = canvas.getContext("2d");
        await page.render({
          canvasContext: context,
          viewport,
          transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0],
        }).promise;
      } catch (error) {
        console.warn("Thumbnail render failed", error);
      }
    }),
  );
}

async function renderActivePage() {
  const document = getActiveDocument();
  const token = ++state.renderToken;
  clearSelection();

  if (!document) {
    elements.viewerEmpty.hidden = false;
    elements.canvasWrap.hidden = true;
    elements.pageTitle.textContent = "从页面中框选题目";
    elements.pageCounter.textContent = "— / —";
    elements.toolHint.textContent = "上传 PDF 后，拖动鼠标框出一道题";
    updatePageControls();
    return;
  }

  elements.viewerEmpty.hidden = true;
  elements.canvasWrap.hidden = false;
  elements.pageTitle.textContent = document.name;
  elements.pageCounter.textContent = `${state.activePage} / ${document.pages}`;
  elements.toolHint.textContent = "按住鼠标拖动，框出一道完整题目";
  updatePageControls();

  try {
    const page = await document.pdf.getPage(state.activePage);
    if (token !== state.renderToken) return;
    const baseViewport = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(420, elements.viewerStage.clientWidth - 56);
    const fitScale = availableWidth / baseViewport.width;
    const viewport = page.getViewport({ scale: fitScale * state.zoom });
    const canvas = elements.pdfCanvas;
    const context = canvas.getContext("2d", { alpha: false });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.ceil(viewport.width * ratio);
    canvas.height = Math.ceil(viewport.height * ratio);
    canvas.style.width = `${Math.ceil(viewport.width)}px`;
    canvas.style.height = `${Math.ceil(viewport.height)}px`;

    await page.render({
      canvasContext: context,
      viewport,
      transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0],
    }).promise;
    if (token !== state.renderToken) return;

    elements.selectionLayer.style.width = canvas.style.width;
    elements.selectionLayer.style.height = canvas.style.height;
  } catch (error) {
    console.error(error);
    toast("这一页暂时无法显示，请换一页重试。", "error");
  }
}

function updatePageControls() {
  const document = getActiveDocument();
  const disabled = !document;
  elements.prevPageButton.disabled = disabled || state.activePage <= 1;
  elements.nextPageButton.disabled = disabled || state.activePage >= document.pages;
  elements.zoomOutButton.disabled = disabled || state.zoom <= 0.7;
  elements.zoomInButton.disabled = disabled || state.zoom >= 1.5;
  elements.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
}

function clearSelection() {
  state.selection = null;
  state.pointer = null;
  elements.selectionBox.hidden = true;
  elements.selectionAction.hidden = true;
}

function pointFromEvent(event) {
  const rect = elements.selectionLayer.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(event.clientX - rect.left, rect.width)),
    y: Math.max(0, Math.min(event.clientY - rect.top, rect.height)),
  };
}

function normalizeRect(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function updateSelectionBox(rect) {
  elements.selectionBox.hidden = false;
  Object.assign(elements.selectionBox.style, {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  elements.selectionSize.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
}

function finalizeSelection(rect) {
  if (rect.width < 35 || rect.height < 25) {
    clearSelection();
    return;
  }
  state.selection = rect;
  elements.selectionAction.hidden = false;
  const ratio = rect.width / rect.height;
  elements.selectionMeta.textContent =
    ratio > 2.8 ? "横向题目 · 建议使用整栏宽度" : "拖动空白处可重新框选";
}

async function addSelectedQuestion() {
  const document = getActiveDocument();
  const rect = state.selection;
  if (!document || !rect) return;

  const displayWidth = elements.pdfCanvas.clientWidth;
  const displayHeight = elements.pdfCanvas.clientHeight;
  const sourceScaleX = elements.pdfCanvas.width / displayWidth;
  const sourceScaleY = elements.pdfCanvas.height / displayHeight;
  const sx = Math.max(0, Math.round(rect.x * sourceScaleX));
  const sy = Math.max(0, Math.round(rect.y * sourceScaleY));
  const sw = Math.min(elements.pdfCanvas.width - sx, Math.round(rect.width * sourceScaleX));
  const sh = Math.min(elements.pdfCanvas.height - sy, Math.round(rect.height * sourceScaleY));

  const cropCanvas = window.document.createElement("canvas");
  const maxDimension = 2200;
  const shrink = Math.min(1, maxDimension / Math.max(sw, sh));
  cropCanvas.width = Math.max(1, Math.round(sw * shrink));
  cropCanvas.height = Math.max(1, Math.round(sh * shrink));
  const cropContext = cropCanvas.getContext("2d", { alpha: false });
  cropContext.fillStyle = "#ffffff";
  cropContext.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
  cropContext.drawImage(
    elements.pdfCanvas,
    sx,
    sy,
    sw,
    sh,
    0,
    0,
    cropCanvas.width,
    cropCanvas.height,
  );

  const dataUrl = cropCanvas.toDataURL("image/jpeg", 0.95);
  state.questions.push({
    id: uid(),
    image: dataUrl,
    width: cropCanvas.width,
    height: cropCanvas.height,
    sourceName: document.name,
    sourcePage: state.activePage,
    size: "standard",
  });

  clearSelection();
  renderQuestions();
  setSaveStatus("仅在本机处理");
  toast(`第 ${state.questions.length} 题已加入练习。`);
}

function renderQuestions() {
  elements.questionCount.textContent = state.questions.length;
  elements.previewButton.disabled = !state.questions.length;
  elements.exportButton.disabled = !state.questions.length;

  if (!state.questions.length) {
    elements.questionList.innerHTML = `
      <div class="question-empty">
        <span>+</span>
        <strong>框选的题目会出现在这里</strong>
        <p>可以拖动排序，也能单独调整题目宽度。</p>
      </div>`;
    return;
  }

  elements.questionList.innerHTML = state.questions
    .map(
      (question, index) => `
        <article class="question-card" draggable="true" data-question-id="${question.id}">
          <span class="drag-handle" title="拖动排序"></span>
          <div class="question-main">
            <div class="question-preview">
              <img src="${question.image}" alt="第 ${index + 1} 题预览" />
            </div>
            <div class="question-meta">
              <span class="question-source" title="${escapeHtml(question.sourceName)}">第 ${index + 1} 题 · ${escapeHtml(question.sourceName)} P${question.sourcePage}</span>
              <span class="question-actions">
                <button type="button" data-move-up="${question.id}" title="上移" aria-label="上移">↑</button>
                <button type="button" data-move-down="${question.id}" title="下移" aria-label="下移">↓</button>
                <button type="button" data-duplicate="${question.id}" title="复制" aria-label="复制">
                  <svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="1"/><path d="M16 8V5H5v11h3"/></svg>
                </button>
                <button class="remove" type="button" data-remove-question="${question.id}" title="删除" aria-label="删除">
                  <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg>
                </button>
              </span>
            </div>
            <label class="width-choice">
              题目宽度
              <select data-question-size="${question.id}">
                <option value="compact" ${question.size === "compact" ? "selected" : ""}>紧凑</option>
                <option value="standard" ${question.size === "standard" ? "selected" : ""}>标准</option>
                <option value="full" ${question.size === "full" ? "selected" : ""}>通栏</option>
              </select>
            </label>
          </div>
        </article>`,
    )
    .join("");

  bindQuestionDragging();
}

function moveQuestion(id, direction) {
  const index = state.questions.findIndex((question) => question.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= state.questions.length) return;
  [state.questions[index], state.questions[target]] = [state.questions[target], state.questions[index]];
  renderQuestions();
}

function bindQuestionDragging() {
  let draggedId = null;
  $$(".question-card").forEach((card) => {
    card.addEventListener("dragstart", (event) => {
      draggedId = card.dataset.questionId;
      card.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      draggedId = null;
    });
    card.addEventListener("dragover", (event) => {
      event.preventDefault();
      const targetId = card.dataset.questionId;
      if (!draggedId || draggedId === targetId) return;
      const from = state.questions.findIndex((question) => question.id === draggedId);
      const to = state.questions.findIndex((question) => question.id === targetId);
      const [item] = state.questions.splice(from, 1);
      state.questions.splice(to, 0, item);
      renderQuestions();
    });
  });
}

function getLayoutConfig() {
  const landscape = elements.paperSize.value === "a4-landscape";
  return {
    widthMm: landscape ? 297 : 210,
    heightMm: landscape ? 210 : 297,
    marginMm: Number(elements.pageMargin.value),
    gapMm: Number(elements.questionGap.value),
    columns: Number(elements.columns.value),
    title: elements.paperTitle.value.trim() || "数学专题练习",
    showNumbers: elements.showNumbers.checked,
    showSources: elements.showSources.checked,
  };
}

function imageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

async function buildPaperCanvases(scale = 2) {
  const config = getLayoutConfig();
  const pxPerMm = (96 / 25.4) * scale;
  const pageWidth = Math.round(config.widthMm * pxPerMm);
  const pageHeight = Math.round(config.heightMm * pxPerMm);
  const margin = config.marginMm * pxPerMm;
  const gap = config.gapMm * pxPerMm;
  const innerWidth = pageWidth - margin * 2;
  const columnGap = config.columns === 2 ? 8 * pxPerMm : 0;
  const columnWidth = (innerWidth - columnGap * (config.columns - 1)) / config.columns;
  const titleHeight = 26 * pxPerMm;
  const contentTop = margin + titleHeight;
  const bottomLimit = pageHeight - margin;
  const canvases = [];
  const images = await Promise.all(state.questions.map((question) => imageFromUrl(question.image)));

  let canvas;
  let context;
  let positions;

  const newPage = () => {
    canvas = document.createElement("canvas");
    canvas.width = pageWidth;
    canvas.height = pageHeight;
    context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, pageWidth, pageHeight);

    context.fillStyle = "#17243a";
    context.font = `700 ${Math.round(7.2 * pxPerMm)}px "Noto Sans SC", "Microsoft YaHei", sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillText(config.title, pageWidth / 2, margin);

    context.strokeStyle = "#dce3ea";
    context.lineWidth = Math.max(1, 0.25 * pxPerMm);
    context.beginPath();
    context.moveTo(margin, margin + 13 * pxPerMm);
    context.lineTo(pageWidth - margin, margin + 13 * pxPerMm);
    context.stroke();

    context.fillStyle = "#7b8798";
    context.font = `${Math.round(3.4 * pxPerMm)}px "Noto Sans SC", "Microsoft YaHei", sans-serif`;
    context.textAlign = "left";
    context.fillText("姓名：________________    日期：________________", margin, margin + 17 * pxPerMm);

    positions = Array.from({ length: config.columns }, (_, column) => ({
      x: margin + column * (columnWidth + columnGap),
      y: contentTop,
    }));
    canvases.push(canvas);
  };

  newPage();

  for (let index = 0; index < state.questions.length; index += 1) {
    const question = state.questions[index];
    const image = images[index];
    const numberWidth = config.showNumbers ? 10 * pxPerMm : 0;
    const sizeFactor = question.size === "compact" ? 0.78 : question.size === "full" ? 1 : 0.9;
    const requiredColumns = question.size === "full" && config.columns === 2 ? 2 : 1;
    const availableWidth =
      requiredColumns === 2 ? innerWidth : Math.min(columnWidth, columnWidth * sizeFactor);
    let imageWidth = availableWidth - numberWidth;
    let imageHeight = imageWidth * (image.height / image.width);
    const sourceHeight = config.showSources ? 5 * pxPerMm : 0;
    const maxImageHeight = bottomLimit - contentTop - sourceHeight - gap;
    if (imageHeight > maxImageHeight) {
      const fit = maxImageHeight / imageHeight;
      imageWidth *= fit;
      imageHeight *= fit;
    }
    const blockHeight = imageHeight + sourceHeight + gap;

    let columnIndex = positions[0].y <= positions[positions.length - 1].y ? 0 : positions.length - 1;
    if (config.columns === 2 && requiredColumns === 1) {
      columnIndex = positions[0].y <= positions[1].y ? 0 : 1;
    }

    if (requiredColumns === 2) {
      const startY = Math.max(positions[0].y, positions[1].y);
      if (startY + blockHeight > bottomLimit) newPage();
      const y = Math.max(positions[0].y, positions[1].y);
      drawQuestion(context, question, image, index, margin, y, imageWidth, imageHeight, numberWidth, config, pxPerMm);
      positions[0].y = y + blockHeight;
      positions[1].y = y + blockHeight;
    } else {
      if (positions[columnIndex].y + blockHeight > bottomLimit) {
        const other = config.columns === 2 ? 1 - columnIndex : -1;
        if (other >= 0 && positions[other].y + blockHeight <= bottomLimit) {
          columnIndex = other;
        } else {
          newPage();
          columnIndex = 0;
        }
      }
      const x = positions[columnIndex].x;
      const y = positions[columnIndex].y;
      drawQuestion(context, question, image, index, x, y, imageWidth, imageHeight, numberWidth, config, pxPerMm);
      positions[columnIndex].y += blockHeight;
    }
  }

  canvases.forEach((pageCanvas, index) => {
    const pageContext = pageCanvas.getContext("2d");
    pageContext.fillStyle = "#9aa4b2";
    pageContext.font = `${Math.round(3.2 * pxPerMm)}px "Noto Sans SC", "Microsoft YaHei", sans-serif`;
    pageContext.textAlign = "center";
    pageContext.fillText(`${index + 1} / ${canvases.length}`, pageWidth / 2, pageHeight - margin / 2);
  });

  return canvases;
}

function drawQuestion(
  context,
  question,
  image,
  index,
  x,
  y,
  imageWidth,
  imageHeight,
  numberWidth,
  config,
  pxPerMm,
) {
  if (config.showNumbers) {
    context.fillStyle = "#2878f0";
    context.font = `700 ${Math.round(5 * pxPerMm)}px "Noto Sans SC", "Microsoft YaHei", sans-serif`;
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillText(`${index + 1}.`, x, y + 0.5 * pxPerMm);
  }

  context.drawImage(image, x + numberWidth, y, imageWidth, imageHeight);

  if (config.showSources) {
    context.fillStyle = "#9aa4b2";
    context.font = `${Math.round(2.8 * pxPerMm)}px "Noto Sans SC", "Microsoft YaHei", sans-serif`;
    context.textAlign = "right";
    context.textBaseline = "top";
    const compactSource =
      question.sourceName.length > 24 ? `${question.sourceName.slice(0, 22)}…` : question.sourceName;
    context.fillText(
      `来源：${compactSource} · 第 ${question.sourcePage} 页`,
      x + numberWidth + imageWidth,
      y + imageHeight + 1.2 * pxPerMm,
    );
  }
}

async function openPreview() {
  if (!state.questions.length) {
    toast("请先框选至少一道题。", "error");
    return;
  }

  elements.previewModal.hidden = false;
  elements.previewPages.innerHTML = `<div class="empty-note">正在生成清晰预览…</div>`;
  document.body.style.overflow = "hidden";

  try {
    state.previewCanvases = await buildPaperCanvases(1.3);
    const config = getLayoutConfig();
    elements.previewPages.innerHTML = "";
    state.previewCanvases.forEach((canvas) => {
      const page = document.createElement("div");
      page.className = "preview-page";
      const displayWidth = config.widthMm / config.heightMm > 1 ? 760 : 560;
      page.style.width = `${displayWidth}px`;
      page.style.aspectRatio = `${config.widthMm} / ${config.heightMm}`;
      page.append(canvas);
      elements.previewPages.append(page);
    });
    elements.previewSummary.textContent = `${state.questions.length} 道题 · ${state.previewCanvases.length} 页 · ${config.columns === 1 ? "单栏" : "双栏"} A4`;
  } catch (error) {
    console.error(error);
    elements.previewPages.innerHTML = `<div class="empty-note">预览生成失败，请重试。</div>`;
  }
}

function closePreview() {
  elements.previewModal.hidden = true;
  document.body.style.overflow = "";
}

async function exportPdf() {
  if (!state.questions.length) {
    toast("请先框选至少一道题。", "error");
    return;
  }
  if (!window.jspdf?.jsPDF) {
    toast("PDF 导出组件未加载，请刷新页面后重试。", "error");
    return;
  }

  const previousText = elements.exportButton.innerHTML;
  elements.exportButton.disabled = true;
  elements.modalExportButton.disabled = true;
  elements.exportButton.textContent = "正在排版…";

  try {
    const config = getLayoutConfig();
    const canvases = await buildPaperCanvases(2);
    const orientation = config.widthMm > config.heightMm ? "landscape" : "portrait";
    const pdf = new window.jspdf.jsPDF({
      orientation,
      unit: "mm",
      format: "a4",
      compress: true,
    });

    canvases.forEach((canvas, index) => {
      if (index > 0) pdf.addPage("a4", orientation);
      pdf.addImage(
        canvas.toDataURL("image/jpeg", 0.94),
        "JPEG",
        0,
        0,
        config.widthMm,
        config.heightMm,
        undefined,
        "FAST",
      );
    });

    const safeTitle = config.title.replace(/[\\/:*?"<>|]/g, "_");
    pdf.save(`${safeTitle}.pdf`);
    toast(`已导出 ${canvases.length} 页 PDF。`);
  } catch (error) {
    console.error(error);
    toast("导出失败，请减少单次题目数量后重试。", "error");
  } finally {
    elements.exportButton.innerHTML = previousText;
    elements.exportButton.disabled = false;
    elements.modalExportButton.disabled = false;
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function removeDocument(id) {
  const document = state.documents.find((item) => item.id === id);
  state.documents = state.documents.filter((item) => item.id !== id);
  if (state.activeDocumentId === id) {
    state.activeDocumentId = state.documents[0]?.id || null;
    state.activePage = 1;
  }
  renderDocumentList();
  renderActivePage();
  if (document) toast(`已移除「${document.name}」。`);
}

function clearAll() {
  if (!state.documents.length && !state.questions.length) return;
  const confirmed = window.confirm("清空全部试卷和已选题目？这个操作无法撤销。");
  if (!confirmed) return;
  state.documents = [];
  state.questions = [];
  state.activeDocumentId = null;
  state.activePage = 1;
  clearSelection();
  renderDocumentList();
  renderQuestions();
  renderActivePage();
  toast("工作台已清空。");
}

elements.addFilesButton.addEventListener("click", () => elements.fileInput.click());
elements.uploadZone.addEventListener("click", () => elements.fileInput.click());
elements.emptyUploadButton.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", (event) => {
  handleFiles(event.target.files);
  event.target.value = "";
});

["dragenter", "dragover"].forEach((type) => {
  elements.uploadZone.addEventListener(type, (event) => {
    event.preventDefault();
    elements.uploadZone.classList.add("drag-over");
  });
});
["dragleave", "drop"].forEach((type) => {
  elements.uploadZone.addEventListener(type, (event) => {
    event.preventDefault();
    elements.uploadZone.classList.remove("drag-over");
  });
});
elements.uploadZone.addEventListener("drop", (event) => handleFiles(event.dataTransfer.files));

elements.documentList.addEventListener("click", async (event) => {
  const remove = event.target.closest("[data-remove-document]");
  if (remove) {
    event.preventDefault();
    event.stopPropagation();
    removeDocument(remove.dataset.removeDocument);
    return;
  }

  const page = event.target.closest("[data-page]");
  if (page) {
    state.activePage = Number(page.dataset.page);
    renderDocumentList();
    await renderActivePage();
    return;
  }

  const documentButton = event.target.closest("[data-open-document]");
  if (documentButton) {
    state.activeDocumentId = documentButton.dataset.openDocument;
    state.activePage = 1;
    renderDocumentList();
    await renderActivePage();
  }
});

elements.prevPageButton.addEventListener("click", async () => {
  if (state.activePage <= 1) return;
  state.activePage -= 1;
  renderDocumentList();
  await renderActivePage();
});
elements.nextPageButton.addEventListener("click", async () => {
  const document = getActiveDocument();
  if (!document || state.activePage >= document.pages) return;
  state.activePage += 1;
  renderDocumentList();
  await renderActivePage();
});

elements.zoomOutButton.addEventListener("click", async () => {
  state.zoom = Math.max(0.7, Number((state.zoom - 0.1).toFixed(1)));
  await renderActivePage();
});
elements.zoomInButton.addEventListener("click", async () => {
  state.zoom = Math.min(1.5, Number((state.zoom + 0.1).toFixed(1)));
  await renderActivePage();
});

elements.selectionLayer.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  elements.selectionLayer.setPointerCapture(event.pointerId);
  const start = pointFromEvent(event);
  state.pointer = { start, current: start };
  state.selection = null;
  elements.selectionAction.hidden = true;
  updateSelectionBox({ x: start.x, y: start.y, width: 0, height: 0 });
});

elements.selectionLayer.addEventListener("pointermove", (event) => {
  if (!state.pointer) return;
  state.pointer.current = pointFromEvent(event);
  updateSelectionBox(normalizeRect(state.pointer.start, state.pointer.current));
});

elements.selectionLayer.addEventListener("pointerup", (event) => {
  if (!state.pointer) return;
  const end = pointFromEvent(event);
  const rect = normalizeRect(state.pointer.start, end);
  state.pointer = null;
  finalizeSelection(rect);
});

elements.cancelSelectionButton.addEventListener("click", clearSelection);
elements.addQuestionButton.addEventListener("click", addSelectedQuestion);

elements.questionList.addEventListener("click", (event) => {
  const up = event.target.closest("[data-move-up]");
  const down = event.target.closest("[data-move-down]");
  const duplicate = event.target.closest("[data-duplicate]");
  const remove = event.target.closest("[data-remove-question]");
  if (up) moveQuestion(up.dataset.moveUp, -1);
  if (down) moveQuestion(down.dataset.moveDown, 1);
  if (duplicate) {
    const index = state.questions.findIndex((question) => question.id === duplicate.dataset.duplicate);
    if (index >= 0) {
      state.questions.splice(index + 1, 0, { ...state.questions[index], id: uid() });
      renderQuestions();
    }
  }
  if (remove) {
    state.questions = state.questions.filter((question) => question.id !== remove.dataset.removeQuestion);
    renderQuestions();
  }
});

elements.questionList.addEventListener("change", (event) => {
  const select = event.target.closest("[data-question-size]");
  if (!select) return;
  const question = state.questions.find((item) => item.id === select.dataset.questionSize);
  if (question) question.size = select.value;
});

elements.settingsToggle.addEventListener("click", () => {
  const expanded = elements.settingsToggle.getAttribute("aria-expanded") === "true";
  elements.settingsToggle.setAttribute("aria-expanded", String(!expanded));
  elements.settingsBody.hidden = expanded;
});

elements.pageMargin.addEventListener("input", () => {
  elements.marginOutput.textContent = `${elements.pageMargin.value} mm`;
});
elements.questionGap.addEventListener("input", () => {
  elements.gapOutput.textContent = `${elements.questionGap.value} mm`;
});

elements.previewButton.addEventListener("click", openPreview);
elements.closeModalButton.addEventListener("click", closePreview);
$("[data-close-modal]").addEventListener("click", closePreview);
elements.modalExportButton.addEventListener("click", exportPdf);
elements.exportButton.addEventListener("click", exportPdf);
elements.clearAllButton.addEventListener("click", clearAll);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.previewModal.hidden) closePreview();
});

renderQuestions();
updatePageControls();

// Exposed by convention to make browser smoke tests and classroom IT support easier.
window.__paperStudioDebug = state;
