import * as pdfjsLib from "./vendor/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  fileInput: $("#fileInput"),
  addFilesButton: $("#addFilesButton"),
  uploadZone: $("#uploadZone"),
  uploadSectionToggle: $("#uploadSectionToggle"),
  uploadSectionBody: $("#uploadSectionBody"),
  uploadSectionHint: $("#uploadSectionHint"),
  emptyUploadButton: $("#emptyUploadButton"),
  documentList: $("#documentList"),
  workspace: $(".workspace"),
  paneSplitters: $$("[data-pane-splitter]"),
  pageTitle: $("#pageTitle"),
  pageCounter: $("#pageCounter"),
  prevPageButton: $("#prevPageButton"),
  nextPageButton: $("#nextPageButton"),
  viewerEmpty: $("#viewerEmpty"),
  viewerStage: $("#viewerStage"),
  viewerScrollRail: $("#viewerScrollRail"),
  viewerScrollThumb: $("#viewerScrollThumb"),
  canvasWrap: $("#canvasWrap"),
  continuousPages: $("#continuousPages"),
  selectionBox: $("#selectionBox"),
  selectionSize: $("#selectionSize"),
  selectionAction: $("#selectionAction"),
  selectionMeta: $("#selectionMeta"),
  addQuestionButton: $("#addQuestionButton"),
  cancelSelectionButton: $("#cancelSelectionButton"),
  toolHint: $("#toolHint"),
  scrollUpButton: $("#scrollUpButton"),
  scrollDownButton: $("#scrollDownButton"),
  zoomOutButton: $("#zoomOutButton"),
  zoomInButton: $("#zoomInButton"),
  zoomLabel: $("#zoomLabel"),
  questionList: $("#questionList"),
  questionCount: $("#questionCount"),
  bulkQuestionSizeButtons: $$('[data-bulk-question-size]'),
  bulkQuestionSizeStatus: $("#bulkQuestionSizeStatus"),
  dayManagerToggle: $("#dayManagerToggle"),
  dayManagerBody: $("#dayManagerBody"),
  activeDayLabel: $("#activeDayLabel"),
  activeDayInput: $("#activeDayInput"),
  dayTabList: $("#dayTabList"),
  addDayButton: $("#addDayButton"),
  composeEditorView: $("#composeEditorView"),
  composePreviewView: $("#composePreviewView"),
  composeViewTabs: $$("[data-compose-view]"),
  inlinePreviewPages: $("#inlinePreviewPages"),
  inlinePreviewSummary: $("#inlinePreviewSummary"),
  refreshInlinePreviewButton: $("#refreshInlinePreviewButton"),
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
  previewRulerToggle: $("#previewRulerToggle"),
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
  scrollDrag: null,
  previewCanvases: [],
  renderToken: 0,
  activeDay: 1,
  defaultQuestionSize: "standard",
  collapsedDays: new Set(),
  showPreviewRuler: false,
  composeView: "editor",
  inlinePreviewDirty: true,
  inlinePreviewToken: 0,
  paneDrag: null,
};

const thumbnailState = {
  observer: null,
  queue: [],
  active: 0,
  generation: 0,
};

const MAX_THUMBNAIL_WORKERS = 2;

const continuousState = {
  observer: null,
  queue: [],
  active: 0,
  generation: 0,
  renderedPages: new Set(),
  baseAspectRatio: 210 / 297,
};

const MAX_CONTINUOUS_WORKERS = 2;

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

function setUploadSectionCollapsed(collapsed) {
  const expanded = !collapsed;
  elements.uploadSectionToggle.setAttribute("aria-expanded", String(expanded));
  elements.uploadSectionBody.hidden = collapsed;
  elements.uploadSectionHint.textContent = collapsed ? "点击展开" : "上传后自动收起";
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

function getQuestionDay(question) {
  return Math.min(365, Math.max(1, Math.round(Number(question.day) || 1)));
}

function getQuestionAnswerSpaceMm(question) {
  const directValue = Number(question.answerSpaceMm);
  if (Number.isFinite(directValue) && directValue >= 0) {
    return Math.min(2000, Math.round(directValue));
  }

  if (question.answerSpace === "custom") {
    return Math.min(2000, Math.max(0, Math.round(Number(question.customAnswerSpaceMm) || 0)));
  }

  return {
    none: 0,
    small: 30,
    medium: 50,
    large: 80,
  }[question.answerSpace || "none"];
}

function sortQuestionsByDay() {
  state.questions.sort((a, b) => getQuestionDay(a) - getQuestionDay(b));
}

function getKnownDays() {
  return [...new Set([1, state.activeDay, ...state.questions.map(getQuestionDay)])].sort(
    (a, b) => a - b,
  );
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
    const objectUrl = URL.createObjectURL(file);
    try {
      const loadingTask = pdfjsLib.getDocument({
        url: objectUrl,
        disableAutoFetch: true,
        rangeChunkSize: 1024 * 1024,
      });
      loadingTask.onProgress = ({ loaded, total }) => {
        const percent = total ? ` ${Math.min(100, Math.round((loaded / total) * 100))}%` : "";
        setSaveStatus(`正在读取 ${file.name}${percent}`, true);
      };
      const pdf = await loadingTask.promise;
      state.documents.push({
        id: uid(),
        name: file.name,
        size: file.size,
        objectUrl,
        pdf,
        pages: pdf.numPages,
        thumbnailCache: new Map(),
      });
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
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
  if (state.documents.length) setUploadSectionCollapsed(true);
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
                  const cachedThumbnail = document.thumbnailCache.get(page);
                  return `<button class="page-thumb ${page === state.activePage ? "active" : ""}" type="button" data-page="${page}" title="第 ${page} 页">
                    <span class="thumb-surface" data-thumb-page="${page}">${
                      cachedThumbnail
                        ? `<img src="${cachedThumbnail}" alt="" />`
                        : `<i class="thumb-placeholder" aria-hidden="true"></i>`
                    }</span><span>${page}</span>
                  </button>`;
                }).join("")}</div>`
              : ""
          }
        </div>`,
    )
    .join("");

  observeVisibleThumbnails();
}

function observeVisibleThumbnails() {
  const document = getActiveDocument();
  if (!document) return;
  thumbnailState.observer?.disconnect();
  thumbnailState.generation += 1;
  thumbnailState.queue = [];
  const generation = thumbnailState.generation;
  thumbnailState.observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        thumbnailState.observer?.unobserve(entry.target);
        queueThumbnail(document.id, entry.target, generation);
      });
    },
    {
      root: elements.documentList,
      rootMargin: "360px 0px",
    },
  );
  $$("[data-thumb-page]").forEach((surface) => {
    if (!surface.querySelector("img")) thumbnailState.observer.observe(surface);
  });
}

function queueThumbnail(documentId, surface, generation) {
  thumbnailState.queue.push({ documentId, surface, generation });
  drainThumbnailQueue();
}

function drainThumbnailQueue() {
  while (thumbnailState.active < MAX_THUMBNAIL_WORKERS && thumbnailState.queue.length) {
    const task = thumbnailState.queue.shift();
    thumbnailState.active += 1;
    renderThumbnail(task).finally(() => {
      thumbnailState.active -= 1;
      drainThumbnailQueue();
    });
  }
}

async function renderThumbnail({ documentId, surface, generation }) {
  if (generation !== thumbnailState.generation || !surface.isConnected) return;
  const document = state.documents.find((item) => item.id === documentId);
  if (!document) return;
  const pageNumber = Number(surface.dataset.thumbPage);
  const cachedThumbnail = document.thumbnailCache.get(pageNumber);
  if (cachedThumbnail) {
    surface.innerHTML = `<img src="${cachedThumbnail}" alt="" />`;
    return;
  }

  try {
    const page = await document.pdf.getPage(pageNumber);
    if (generation !== thumbnailState.generation || !surface.isConnected) return;
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 76 / base.width });
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width * ratio);
    canvas.height = Math.ceil(viewport.height * ratio);
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvasContext: context,
      viewport,
      transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0],
    }).promise;
    if (generation !== thumbnailState.generation || !surface.isConnected) return;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.76);
    document.thumbnailCache.set(pageNumber, dataUrl);
    surface.innerHTML = `<img src="${dataUrl}" alt="" />`;
    page.cleanup();
  } catch (error) {
    console.warn("Thumbnail render failed", error);
    surface.classList.add("thumb-failed");
  }
}

function continuousPlaceholder(pageNumber) {
  return `<div class="continuous-page-placeholder">第 ${pageNumber} 页<br />滚动到这里时加载</div>`;
}

function resetContinuousViewer() {
  continuousState.observer?.disconnect();
  continuousState.generation += 1;
  continuousState.queue = [];
  continuousState.renderedPages.clear();
  elements.continuousPages.innerHTML = "";
}

async function renderActivePage() {
  const document = getActiveDocument();
  const token = ++state.renderToken;
  clearSelection();
  resetContinuousViewer();

  if (!document) {
    elements.viewerEmpty.hidden = false;
    elements.canvasWrap.hidden = true;
    elements.pageTitle.textContent = "从页面中框选题目";
    elements.pageCounter.textContent = "— / —";
    elements.toolHint.textContent = "上传 PDF 后，拖动鼠标框出一道题";
    updatePageControls();
    updateViewerScrollRail();
    return;
  }

  elements.viewerEmpty.hidden = true;
  elements.canvasWrap.hidden = false;
  elements.pageTitle.textContent = document.name;
  elements.pageCounter.textContent = `${state.activePage} / ${document.pages}`;
  elements.toolHint.textContent = "向下连续滚动浏览；在任意页面拖动框选题目";
  updatePageControls();

  try {
    const firstPage = await document.pdf.getPage(1);
    if (token !== state.renderToken) return;
    const baseViewport = firstPage.getViewport({ scale: 1 });
    continuousState.baseAspectRatio = baseViewport.width / baseViewport.height;
    const availableWidth = Math.max(420, elements.viewerStage.clientWidth - 62);
    const displayWidth = Math.ceil(availableWidth * state.zoom);
    const generation = continuousState.generation;

    const fragment = window.document.createDocumentFragment();
    for (let pageNumber = 1; pageNumber <= document.pages; pageNumber += 1) {
      const shell = window.document.createElement("section");
      shell.className = "continuous-page";
      shell.dataset.continuousPage = String(pageNumber);
      shell.style.width = `${displayWidth}px`;
      shell.style.aspectRatio = `${baseViewport.width} / ${baseViewport.height}`;
      shell.innerHTML = continuousPlaceholder(pageNumber);
      fragment.append(shell);
    }
    elements.continuousPages.append(fragment);

    continuousState.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const shell = entry.target;
          shell.dataset.inViewport = String(entry.isIntersecting);
          if (entry.isIntersecting) {
            queueContinuousPage(document.id, shell, generation);
          }
        });
      },
      {
        root: elements.viewerStage,
        rootMargin: "1300px 0px",
      },
    );

    elements.continuousPages.querySelectorAll("[data-continuous-page]").forEach((shell) => {
      continuousState.observer.observe(shell);
    });

    const activeShell = elements.continuousPages.querySelector(
      `[data-continuous-page="${state.activePage}"]`,
    );
    if (activeShell) {
      elements.viewerStage.scrollTop = Math.max(0, activeShell.offsetTop - 20);
      queueContinuousPage(document.id, activeShell, generation);
    }
    firstPage.cleanup();
    requestAnimationFrame(() => {
      updateActivePageFromScroll();
      updateViewerScrollRail();
    });
  } catch (error) {
    console.error(error);
    toast("试卷连续预览生成失败，请重新打开文件。", "error");
  }
}

function queueContinuousPage(documentId, shell, generation) {
  if (
    generation !== continuousState.generation ||
    shell.dataset.rendered === "true" ||
    shell.dataset.queued === "true"
  ) {
    return;
  }
  shell.dataset.queued = "true";
  continuousState.queue.push({ documentId, shell, generation });
  drainContinuousQueue();
}

function drainContinuousQueue() {
  while (
    continuousState.active < MAX_CONTINUOUS_WORKERS &&
    continuousState.queue.length
  ) {
    const task = continuousState.queue.shift();
    continuousState.active += 1;
    renderContinuousPage(task).finally(() => {
      continuousState.active -= 1;
      drainContinuousQueue();
    });
  }
}

async function renderContinuousPage({ documentId, shell, generation }) {
  if (generation !== continuousState.generation || !shell.isConnected) return;
  const document = state.documents.find((item) => item.id === documentId);
  if (!document) return;
  const pageNumber = Number(shell.dataset.continuousPage);

  try {
    const page = await document.pdf.getPage(pageNumber);
    if (generation !== continuousState.generation || !shell.isConnected) return;
    const baseViewport = page.getViewport({ scale: 1 });
    const cssWidth = Number.parseFloat(shell.style.width);
    const viewport = page.getViewport({ scale: cssWidth / baseViewport.width });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = window.document.createElement("canvas");
    canvas.className = "pdf-page-canvas";
    canvas.width = Math.ceil(viewport.width * ratio);
    canvas.height = Math.ceil(viewport.height * ratio);
    canvas.style.width = `${Math.ceil(viewport.width)}px`;
    canvas.style.height = `${Math.ceil(viewport.height)}px`;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: context,
      viewport,
      transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0],
    }).promise;
    if (generation !== continuousState.generation || !shell.isConnected) return;

    const layer = window.document.createElement("div");
    layer.className = "selection-layer";
    layer.dataset.selectionPage = String(pageNumber);
    layer.setAttribute("aria-label", `第 ${pageNumber} 页题目框选区域`);
    shell.style.aspectRatio = `${baseViewport.width} / ${baseViewport.height}`;
    shell.replaceChildren(canvas, layer);
    shell.dataset.rendered = "true";
    shell.dataset.queued = "false";
    continuousState.renderedPages.add(pageNumber);
    page.cleanup();
    requestAnimationFrame(updateViewerScrollRail);
  } catch (error) {
    console.warn(`Page ${pageNumber} render failed`, error);
    shell.dataset.queued = "false";
    shell.innerHTML = `<div class="continuous-page-placeholder">第 ${pageNumber} 页暂时无法显示</div>`;
  }
}

function cleanupContinuousPages() {
  const protectedPage = state.pointer?.page || state.selection?.page;
  elements.continuousPages.querySelectorAll('[data-rendered="true"]').forEach((shell) => {
    const pageNumber = Number(shell.dataset.continuousPage);
    if (
      pageNumber === protectedPage ||
      shell.dataset.inViewport === "true" ||
      Math.abs(pageNumber - state.activePage) <= 4
    ) {
      return;
    }
    shell.dataset.rendered = "false";
    shell.dataset.queued = "false";
    shell.innerHTML = continuousPlaceholder(pageNumber);
    continuousState.renderedPages.delete(pageNumber);
  });
}

function updateActivePageFromScroll() {
  const document = getActiveDocument();
  if (!document) return;
  const stageRect = elements.viewerStage.getBoundingClientRect();
  const targetY = stageRect.top + Math.min(110, stageRect.height * 0.24);
  let closestShell = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  elements.continuousPages.querySelectorAll("[data-continuous-page]").forEach((shell) => {
    const rect = shell.getBoundingClientRect();
    const distance =
      rect.top <= targetY && rect.bottom >= targetY
        ? 0
        : Math.min(Math.abs(rect.top - targetY), Math.abs(rect.bottom - targetY));
    if (distance < closestDistance) {
      closestDistance = distance;
      closestShell = shell;
    }
  });

  if (!closestShell) return;
  const pageNumber = Number(closestShell.dataset.continuousPage);
  if (pageNumber !== state.activePage) {
    state.activePage = pageNumber;
    elements.pageCounter.textContent = `${pageNumber} / ${document.pages}`;
    updatePageControls();
    updateActiveThumbnail(false);
  }
  cleanupContinuousPages();
}

function scrollToPage(pageNumber, behavior = "smooth") {
  const document = getActiveDocument();
  if (!document) return;
  const targetPage = Math.min(document.pages, Math.max(1, pageNumber));
  const shell = elements.continuousPages.querySelector(
    `[data-continuous-page="${targetPage}"]`,
  );
  if (!shell) return;
  state.activePage = targetPage;
  elements.pageCounter.textContent = `${targetPage} / ${document.pages}`;
  updatePageControls();
  updateActiveThumbnail(true);
  elements.viewerStage.scrollTo({
    top: Math.max(0, shell.offsetTop - 20),
    behavior,
  });
  queueContinuousPage(document.id, shell, continuousState.generation);
}

function setupPaneResizing() {
  elements.paneSplitters.forEach((splitter) => {
    const finish = (event) => {
      if (!state.paneDrag || state.paneDrag.pointerId !== event.pointerId) return;
      splitter.classList.remove("dragging");
      document.body.classList.remove("resizing-panes");
      state.paneDrag = null;
      if (getActiveDocument()) renderActivePage();
    };

    splitter.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      splitter.setPointerCapture(event.pointerId);
      const styles = getComputedStyle(elements.workspace);
      state.paneDrag = {
        type: splitter.dataset.paneSplitter,
        pointerId: event.pointerId,
        startX: event.clientX,
        sourceWidth: Number.parseFloat(styles.getPropertyValue("--source-pane-width")) || 258,
        composeWidth: Number.parseFloat(styles.getPropertyValue("--compose-pane-width")) || 332,
      };
      splitter.classList.add("dragging");
      document.body.classList.add("resizing-panes");
    });

    splitter.addEventListener("pointermove", (event) => {
      const drag = state.paneDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const workspaceWidth = elements.workspace.clientWidth;
      const delta = event.clientX - drag.startX;
      if (drag.type === "source") {
        const maximum = Math.max(240, workspaceWidth - drag.composeWidth - 470);
        const width = Math.min(maximum, Math.max(180, drag.sourceWidth + delta));
        elements.workspace.style.setProperty("--source-pane-width", `${Math.round(width)}px`);
      } else {
        const maximum = Math.max(360, workspaceWidth - drag.sourceWidth - 470);
        const width = Math.min(maximum, Math.max(280, drag.composeWidth - delta));
        elements.workspace.style.setProperty("--compose-pane-width", `${Math.round(width)}px`);
      }
      updateViewerScrollRail();
    });

    splitter.addEventListener("pointerup", finish);
    splitter.addEventListener("pointercancel", finish);
    splitter.addEventListener("dblclick", () => {
      const property =
        splitter.dataset.paneSplitter === "source"
          ? "--source-pane-width"
          : "--compose-pane-width";
      elements.workspace.style.removeProperty(property);
      if (getActiveDocument()) renderActivePage();
    });
  });
}

function updatePageControls() {
  const document = getActiveDocument();
  const disabled = !document;
  elements.prevPageButton.disabled = disabled || state.activePage <= 1;
  elements.nextPageButton.disabled = disabled || state.activePage >= document.pages;
  elements.scrollUpButton.disabled = disabled;
  elements.scrollDownButton.disabled = disabled;
  elements.zoomOutButton.disabled = disabled || state.zoom <= 0.7;
  elements.zoomInButton.disabled = disabled || state.zoom >= 1.5;
  elements.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
}

function scrollViewer(top = 0, left = 0) {
  const stage = elements.viewerStage;
  if (top) {
    const maxTop = Math.max(0, stage.scrollHeight - stage.clientHeight);
    stage.scrollTop = Math.max(0, Math.min(maxTop, stage.scrollTop + top));
  }
  if (left) {
    const maxLeft = Math.max(0, stage.scrollWidth - stage.clientWidth);
    stage.scrollLeft = Math.max(0, Math.min(maxLeft, stage.scrollLeft + left));
  }
  updateViewerScrollRail();
}

function updateViewerScrollRail() {
  const stage = elements.viewerStage;
  const rail = elements.viewerScrollRail;
  const thumb = elements.viewerScrollThumb;
  const maxScrollTop = Math.max(0, stage.scrollHeight - stage.clientHeight);
  const scrollable = Boolean(getActiveDocument()) && maxScrollTop > 2;

  rail.hidden = !scrollable;
  elements.scrollUpButton.disabled = !scrollable || stage.scrollTop <= 0;
  elements.scrollDownButton.disabled = !scrollable || stage.scrollTop >= maxScrollTop - 1;
  if (!scrollable) {
    rail.setAttribute("aria-valuenow", "0");
    return;
  }

  const railHeight = rail.clientHeight;
  const thumbHeight = Math.max(48, Math.round(railHeight * (stage.clientHeight / stage.scrollHeight)));
  const maxThumbTop = Math.max(0, railHeight - thumbHeight);
  const thumbTop = maxScrollTop ? Math.round(maxThumbTop * (stage.scrollTop / maxScrollTop)) : 0;

  thumb.style.height = `${thumbHeight}px`;
  thumb.style.transform = `translateY(${thumbTop}px)`;
  rail.setAttribute("aria-valuenow", String(Math.round((stage.scrollTop / maxScrollTop) * 100)));
}

function autoScrollViewer(event) {
  const rect = elements.viewerStage.getBoundingClientRect();
  const threshold = 54;
  const maxStep = 24;
  let left = 0;
  let top = 0;
  if (event.clientX < rect.left + threshold) left = -maxStep;
  else if (event.clientX > rect.right - threshold) left = maxStep;
  if (event.clientY < rect.top + threshold) top = -maxStep;
  else if (event.clientY > rect.bottom - threshold) top = maxStep;
  if (left || top) scrollViewer(top, left, "auto");
}

function updateActiveThumbnail(scrollIntoView = false) {
  $$(".page-thumb.active").forEach((item) => item.classList.remove("active"));
  const activeThumbnail = $(`.page-thumb[data-page="${state.activePage}"]`);
  if (!activeThumbnail) return;
  activeThumbnail.classList.add("active");
  if (scrollIntoView) {
    activeThumbnail.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }
}

function clearSelection() {
  state.selection = null;
  state.pointer = null;
  elements.selectionBox.hidden = true;
  elements.selectionAction.hidden = true;
}

function pointFromEvent(event, layer = state.pointer?.layer) {
  if (!layer) return { x: 0, y: 0 };
  const rect = layer.getBoundingClientRect();
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

async function finalizeSelection(rect, pointerContext) {
  if (rect.width < 35 || rect.height < 25) {
    clearSelection();
    return;
  }
  state.selection = {
    ...rect,
    page: pointerContext.page,
    canvas: pointerContext.canvas,
    layer: pointerContext.layer,
  };
  state.activePage = pointerContext.page;
  const document = getActiveDocument();
  if (document) elements.pageCounter.textContent = `${state.activePage} / ${document.pages}`;
  updatePageControls();
  updateActiveThumbnail(false);
  const ratio = rect.width / rect.height;
  elements.selectionMeta.textContent =
    ratio > 2.8 ? "横向题目 · 建议使用整栏宽度" : "拖动空白处可重新框选";
  await addSelectedQuestion();
}

async function addSelectedQuestion() {
  const document = getActiveDocument();
  const selection = state.selection;
  if (!document || !selection?.canvas) return;
  const rect = selection;
  const canvas = selection.canvas;
  const displayWidth = canvas.clientWidth;
  const displayHeight = canvas.clientHeight;
  const sourceScaleX = canvas.width / displayWidth;
  const sourceScaleY = canvas.height / displayHeight;
  const sx = Math.max(0, Math.round(rect.x * sourceScaleX));
  const sy = Math.max(0, Math.round(rect.y * sourceScaleY));
  const sw = Math.min(canvas.width - sx, Math.round(rect.width * sourceScaleX));
  const sh = Math.min(canvas.height - sy, Math.round(rect.height * sourceScaleY));

  const cropCanvas = window.document.createElement("canvas");
  const maxDimension = 2200;
  const shrink = Math.min(1, maxDimension / Math.max(sw, sh));
  cropCanvas.width = Math.max(1, Math.round(sw * shrink));
  cropCanvas.height = Math.max(1, Math.round(sh * shrink));
  const cropContext = cropCanvas.getContext("2d", { alpha: false });
  cropContext.fillStyle = "#ffffff";
  cropContext.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
  cropContext.drawImage(
    canvas,
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
    sourcePage: selection.page,
    size: state.defaultQuestionSize,
    answerSpaceMm: 0,
    day: state.activeDay,
  });

  clearSelection();
  renderQuestions();
  setSaveStatus("仅在本机处理");
  toast(`第 ${state.questions.length} 题已加入练习。`);
}

function renderDayManager() {
  elements.activeDayLabel.textContent = `第 ${state.activeDay} 天`;
  elements.activeDayInput.value = state.activeDay;
  elements.dayTabList.innerHTML = getKnownDays()
    .map(
      (day) => `
        <button
          type="button"
          class="${day === state.activeDay ? "active" : ""}"
          data-select-active-day="${day}"
          aria-pressed="${day === state.activeDay}"
        >第 ${day} 天</button>`,
    )
    .join("");
}

function renderQuestionCard(question, index) {
  const answerSpaceMm = getQuestionAnswerSpaceMm(question);
  const presetListId = `answer-space-presets-${question.id}`;
  return `
    <article class="question-card" data-question-id="${question.id}">
      <span
        class="drag-handle"
        draggable="true"
        data-drag-question="${question.id}"
        title="拖动排序或拖到其他天"
      ></span>
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
        <div class="question-options">
          <label class="question-option">
            <span>题目宽度</span>
            <select data-question-size="${question.id}">
              <option value="compact" ${question.size === "compact" ? "selected" : ""}>紧凑</option>
              <option value="standard" ${question.size === "standard" ? "selected" : ""}>标准</option>
              <option value="full" ${question.size === "full" ? "selected" : ""}>通栏</option>
            </select>
          </label>
          <label class="question-option">
            <span>答题区（0 表示不留）</span>
            <span class="answer-space-editor">
              <input
                type="number"
                min="0"
                max="2000"
                step="1"
                inputmode="numeric"
                list="${presetListId}"
                value="${answerSpaceMm}"
                data-answer-space-mm="${question.id}"
                aria-label="答题区高度，单位毫米"
              />
              <span>mm</span>
              <datalist id="${presetListId}">
                <option value="0" label="不留"></option>
                <option value="30" label="小"></option>
                <option value="50" label="中"></option>
                <option value="80" label="大"></option>
              </datalist>
            </span>
          </label>
        </div>
      </div>
    </article>`;
}

const QUESTION_SIZE_LABELS = {
  compact: "紧凑",
  standard: "标准",
  full: "通栏",
};

function renderBulkQuestionSizeControls() {
  const defaultSize = state.defaultQuestionSize;
  const overrideCount = state.questions.filter((question) => question.size !== defaultSize).length;
  elements.bulkQuestionSizeButtons.forEach((button) => {
    const active = button.dataset.bulkQuestionSize === defaultSize;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  if (!state.questions.length) {
    elements.bulkQuestionSizeStatus.textContent = `新题默认：${QUESTION_SIZE_LABELS[defaultSize]}`;
  } else if (overrideCount) {
    elements.bulkQuestionSizeStatus.textContent = `新题默认：${QUESTION_SIZE_LABELS[defaultSize]} · ${overrideCount} 道单独调整`;
  } else {
    elements.bulkQuestionSizeStatus.textContent = `全部 ${state.questions.length} 道 · 新题也使用`;
  }
}

function applyQuestionSizeToAll(size) {
  if (!QUESTION_SIZE_LABELS[size]) return;
  state.defaultQuestionSize = size;
  state.questions.forEach((question) => {
    question.size = size;
  });
  renderQuestions();
  toast(
    state.questions.length
      ? `全部题目已改为“${QUESTION_SIZE_LABELS[size]}”，之后的新题也会使用。`
      : `之后的新题默认使用“${QUESTION_SIZE_LABELS[size]}”。`,
  );
}

function renderQuestions() {
  sortQuestionsByDay();
  renderDayManager();
  renderBulkQuestionSizeControls();
  elements.questionCount.textContent = state.questions.length;
  elements.previewButton.disabled = !state.questions.length;
  elements.exportButton.disabled = !state.questions.length;

  if (!state.questions.length) {
    elements.questionList.innerHTML = `
      <div class="question-empty">
        <span>+</span>
        <strong>框选的题目会出现在这里</strong>
        <p>先在上方选择第几天，再从试卷中框选题目。</p>
      </div>`;
    markInlinePreviewDirty();
    return;
  }

  const indexById = new Map(state.questions.map((question, index) => [question.id, index]));
  const days = getKnownDays();
  elements.questionList.innerHTML = days
    .map((day) => {
      const questions = state.questions.filter((question) => getQuestionDay(question) === day);
      const collapsed = state.collapsedDays.has(day);
      return `
        <section class="day-group" data-day-group="${day}">
          <button
            class="day-group-heading"
            type="button"
            data-toggle-day-group="${day}"
            aria-expanded="${!collapsed}"
            title="点击折叠；也可以把题拖到这里"
          >
            <span><strong>第 ${day} 天</strong><small>${questions.length} 道题</small></span>
            <span class="day-drop-hint">拖题到这里</span>
            <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          <div class="day-group-body" ${collapsed ? "hidden" : ""}>
            ${
              questions.length
                ? questions
                    .map((question) => renderQuestionCard(question, indexById.get(question.id)))
                    .join("")
                : '<div class="day-group-empty">暂无题目，可拖动题目到这里</div>'
            }
          </div>
        </section>`;
    })
    .join("");

  bindQuestionDragging();
  markInlinePreviewDirty();
}

function moveQuestion(id, direction) {
  const question = state.questions.find((item) => item.id === id);
  if (!question) return;
  const day = getQuestionDay(question);
  const dayIndexes = state.questions
    .map((item, index) => (getQuestionDay(item) === day ? index : -1))
    .filter((index) => index >= 0);
  const localIndex = dayIndexes.indexOf(state.questions.indexOf(question));
  const targetLocalIndex = localIndex + direction;
  if (targetLocalIndex < 0 || targetLocalIndex >= dayIndexes.length) return;
  const from = dayIndexes[localIndex];
  const target = dayIndexes[targetLocalIndex];
  [state.questions[from], state.questions[target]] = [state.questions[target], state.questions[from]];
  renderQuestions();
}

function moveQuestionToDay(id, day) {
  const from = state.questions.findIndex((question) => question.id === id);
  if (from < 0) return;
  const [question] = state.questions.splice(from, 1);
  question.day = day;
  let insertAt = state.questions.length;
  for (let index = 0; index < state.questions.length; index += 1) {
    if (getQuestionDay(state.questions[index]) > day) {
      insertAt = index;
      break;
    }
  }
  while (insertAt < state.questions.length && getQuestionDay(state.questions[insertAt]) === day) {
    insertAt += 1;
  }
  state.questions.splice(insertAt, 0, question);
  state.collapsedDays.delete(day);
  renderQuestions();
}

function bindQuestionDragging() {
  let draggedId = null;
  $$(".drag-handle[data-drag-question]").forEach((handle) => {
    handle.addEventListener("dragstart", (event) => {
      draggedId = handle.dataset.dragQuestion;
      const card = handle.closest(".question-card");
      card.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedId);
    });
    handle.addEventListener("dragend", () => {
      const card = handle.closest(".question-card");
      card.classList.remove("dragging");
      $$(".drag-over").forEach((element) => element.classList.remove("drag-over"));
      draggedId = null;
    });
  });

  $$(".question-card").forEach((card) => {
    card.addEventListener("dragover", (event) => {
      event.preventDefault();
      card.classList.add("drag-over");
    });
    card.addEventListener("dragleave", () => card.classList.remove("drag-over"));
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      card.classList.remove("drag-over");
      const targetId = card.dataset.questionId;
      if (!draggedId || draggedId === targetId) return;
      const from = state.questions.findIndex((question) => question.id === draggedId);
      if (from < 0) return;
      const [item] = state.questions.splice(from, 1);
      const targetQuestion = state.questions.find((question) => question.id === targetId);
      item.day = getQuestionDay(targetQuestion);
      const to = state.questions.findIndex((question) => question.id === targetId);
      state.questions.splice(to, 0, item);
      renderQuestions();
    });
  });

  $$(".day-group-heading").forEach((heading) => {
    heading.addEventListener("dragover", (event) => {
      event.preventDefault();
      heading.classList.add("drag-over");
    });
    heading.addEventListener("dragleave", () => heading.classList.remove("drag-over"));
    heading.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      heading.classList.remove("drag-over");
      if (!draggedId) return;
      moveQuestionToDay(draggedId, Number(heading.dataset.toggleDayGroup));
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
    const day = getQuestionDay(question);
    const previousDay = index > 0 ? getQuestionDay(state.questions[index - 1]) : null;
    const startsNewDay = index === 0 || day !== previousDay;
    const dayHeaderHeight = startsNewDay ? 10 * pxPerMm : 0;
    const numberWidth = config.showNumbers ? 10 * pxPerMm : 0;
    const sizeFactor = question.size === "compact" ? 0.78 : question.size === "full" ? 1 : 0.9;
    const requiredColumns = question.size === "full" && config.columns === 2 ? 2 : 1;
    const availableWidth =
      requiredColumns === 2 ? innerWidth : Math.min(columnWidth, columnWidth * sizeFactor);
    let imageWidth = availableWidth - numberWidth;
    let imageHeight = imageWidth * (image.height / image.width);
    const sourceHeight = config.showSources ? 5 * pxPerMm : 0;
    const answerSpaceMm = getQuestionAnswerSpaceMm(question);
    const answerHeight = answerSpaceMm * pxPerMm;
    const answerGap = answerHeight > 0 ? 4 * pxPerMm : 0;
    // The selected question width must not be sacrificed to make answer space fit.
    // Only scale an unusually tall crop enough for the question itself to fit on a
    // fresh page; any answer space that does not fit continues on following pages.
    const maxImageHeight = Math.max(
      12 * pxPerMm,
      bottomLimit - contentTop - dayHeaderHeight - sourceHeight - gap,
    );
    if (imageHeight > maxImageHeight) {
      const fit = maxImageHeight / imageHeight;
      imageWidth *= fit;
      imageHeight *= fit;
    }
    const questionOnlyHeight = imageHeight + sourceHeight + gap;
    let remainingAnswerHeight = answerHeight;

    if (startsNewDay) {
      let headerY =
        config.columns === 2 ? Math.max(positions[0].y, positions[1].y) : positions[0].y;
      if (headerY + dayHeaderHeight + questionOnlyHeight > bottomLimit) {
        newPage();
        headerY = contentTop;
      }
      drawDayHeader(context, day, margin, headerY, innerWidth, pxPerMm);
      const questionStartY = headerY + dayHeaderHeight;
      positions.forEach((position) => {
        position.y = questionStartY;
      });
    }

    let columnIndex = positions[0].y <= positions[positions.length - 1].y ? 0 : positions.length - 1;
    if (config.columns === 2 && requiredColumns === 1) {
      columnIndex = positions[0].y <= positions[1].y ? 0 : 1;
    }

    if (requiredColumns === 2) {
      const startY = Math.max(positions[0].y, positions[1].y);
      if (startY + questionOnlyHeight > bottomLimit) newPage();
      const y = Math.max(positions[0].y, positions[1].y);
      const maximumFirstAnswerHeight = Math.max(
        0,
        bottomLimit - y - imageHeight - sourceHeight - answerGap - gap,
      );
      const firstAnswerHeight = Math.min(answerHeight, maximumFirstAnswerHeight);
      const firstAnswerGap = firstAnswerHeight > 0 ? answerGap : 0;
      const blockHeight =
        imageHeight + sourceHeight + firstAnswerGap + firstAnswerHeight + gap;
      drawQuestion(
        context,
        question,
        image,
        index,
        margin,
        y,
        imageWidth,
        imageHeight,
        numberWidth,
        firstAnswerHeight,
        firstAnswerGap,
        config,
        pxPerMm,
      );
      positions[0].y = y + blockHeight;
      positions[1].y = y + blockHeight;
      remainingAnswerHeight = answerHeight - firstAnswerHeight;
    } else {
      if (positions[columnIndex].y + questionOnlyHeight > bottomLimit) {
        const other = config.columns === 2 ? 1 - columnIndex : -1;
        if (other >= 0 && positions[other].y + questionOnlyHeight <= bottomLimit) {
          columnIndex = other;
        } else {
          newPage();
          columnIndex = 0;
        }
      }
      const x = positions[columnIndex].x;
      const y = positions[columnIndex].y;
      const maximumFirstAnswerHeight = Math.max(
        0,
        bottomLimit - y - imageHeight - sourceHeight - answerGap - gap,
      );
      const firstAnswerHeight = Math.min(answerHeight, maximumFirstAnswerHeight);
      const firstAnswerGap = firstAnswerHeight > 0 ? answerGap : 0;
      const blockHeight =
        imageHeight + sourceHeight + firstAnswerGap + firstAnswerHeight + gap;
      drawQuestion(
        context,
        question,
        image,
        index,
        x,
        y,
        imageWidth,
        imageHeight,
        numberWidth,
        firstAnswerHeight,
        firstAnswerGap,
        config,
        pxPerMm,
      );
      positions[columnIndex].y += blockHeight;
      remainingAnswerHeight = answerHeight - firstAnswerHeight;
    }

    while (remainingAnswerHeight > 0) {
      newPage();
      const maximumContinuationHeight = bottomLimit - contentTop - gap;
      const continuationHeight = Math.min(remainingAnswerHeight, maximumContinuationHeight);
      const continuationX = margin + numberWidth;
      drawAnswerArea(
        context,
        continuationX,
        contentTop,
        imageWidth,
        continuationHeight,
        pxPerMm,
        `第 ${day} 天 · 第 ${index + 1} 题答题区（续）`,
      );
      const continuationBottom = contentTop + continuationHeight + gap;
      if (requiredColumns === 2) {
        positions[0].y = continuationBottom;
        positions[1].y = continuationBottom;
      } else {
        positions[0].y = continuationBottom;
      }
      remainingAnswerHeight -= continuationHeight;
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
  answerHeight,
  answerGap,
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

  if (answerHeight > 0) {
    const answerX = x + numberWidth;
    const answerY = y + imageHeight + (config.showSources ? 5 * pxPerMm : 0) + answerGap;
    drawAnswerArea(context, answerX, answerY, imageWidth, answerHeight, pxPerMm, "答题区");
  }
}

function drawDayHeader(context, day, x, y, width, pxPerMm) {
  context.save();
  context.fillStyle = "#2878f0";
  context.font = `700 ${Math.round(4.4 * pxPerMm)}px "Noto Sans SC", "Microsoft YaHei", sans-serif`;
  context.textAlign = "left";
  context.textBaseline = "top";
  context.fillText(`第 ${day} 天作业`, x, y);
  context.restore();
}

function drawAnswerArea(context, x, y, width, height, pxPerMm, label) {
  context.save();
  context.fillStyle = "#8b96a6";
  context.font = `${Math.round(3 * pxPerMm)}px "Noto Sans SC", "Microsoft YaHei", sans-serif`;
  context.textAlign = "left";
  context.textBaseline = "top";
  context.fillText(label, x, y);
  context.restore();
}

let inlinePreviewTimer = null;

function markInlinePreviewDirty() {
  state.inlinePreviewDirty = true;
  if (state.composeView !== "preview") return;
  window.clearTimeout(inlinePreviewTimer);
  inlinePreviewTimer = window.setTimeout(renderInlinePreview, 180);
}

async function renderInlinePreview() {
  const token = ++state.inlinePreviewToken;
  window.clearTimeout(inlinePreviewTimer);

  if (!state.questions.length) {
    elements.inlinePreviewSummary.textContent = "加入题目后可在这里预览";
    elements.inlinePreviewPages.innerHTML = `
      <div class="question-empty">
        <span>○</span>
        <strong>页面预览会显示在这里</strong>
        <p>框选题目后即可在主界面直接查看排版。</p>
      </div>`;
    state.inlinePreviewDirty = false;
    return;
  }

  elements.inlinePreviewSummary.textContent = "正在更新页面预览…";
  elements.inlinePreviewPages.innerHTML = `<div class="empty-note">正在排版…</div>`;

  try {
    const canvases = await buildPaperCanvases(0.72);
    if (token !== state.inlinePreviewToken) return;
    const config = getLayoutConfig();
    elements.inlinePreviewPages.innerHTML = "";
    canvases.forEach((canvas) => {
      const page = window.document.createElement("div");
      page.className = "inline-preview-page";
      page.style.aspectRatio = `${config.widthMm} / ${config.heightMm}`;
      page.append(canvas);
      elements.inlinePreviewPages.append(page);
    });
    elements.inlinePreviewSummary.textContent =
      `${state.questions.length} 道题 · ${canvases.length} 页`;
    state.inlinePreviewDirty = false;
  } catch (error) {
    console.error(error);
    elements.inlinePreviewSummary.textContent = "页面预览生成失败";
    elements.inlinePreviewPages.innerHTML =
      `<div class="empty-note">请点击“刷新”重新生成。</div>`;
  }
}

function setComposeView(view) {
  state.composeView = view === "preview" ? "preview" : "editor";
  const showingPreview = state.composeView === "preview";
  elements.composeEditorView.hidden = showingPreview;
  elements.composePreviewView.hidden = !showingPreview;
  elements.composeViewTabs.forEach((button) => {
    const active = button.dataset.composeView === state.composeView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  if (showingPreview && state.inlinePreviewDirty) renderInlinePreview();
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
    updatePreviewRulerState();
    state.previewCanvases.forEach((canvas) => {
      const page = document.createElement("div");
      page.className = "preview-page";
      const displayWidth = config.widthMm / config.heightMm > 1 ? 760 : 560;
      page.style.width = `${displayWidth}px`;
      page.style.aspectRatio = `${config.widthMm} / ${config.heightMm}`;
      page.append(canvas);
      page.append(createPreviewRuler(config.heightMm));
      elements.previewPages.append(page);
    });
    elements.previewSummary.textContent = `${state.questions.length} 道题 · ${state.previewCanvases.length} 页 · ${config.columns === 1 ? "单栏" : "双栏"} A4`;
  } catch (error) {
    console.error(error);
    elements.previewPages.innerHTML = `<div class="empty-note">预览生成失败，请重试。</div>`;
  }
}

function createPreviewRuler(heightMm) {
  const ruler = document.createElement("div");
  ruler.className = "preview-ruler";
  ruler.setAttribute("aria-hidden", "true");

  for (let mm = 0; mm <= heightMm; mm += 5) {
    const tick = document.createElement("span");
    const isMajor = mm % 10 === 0;
    tick.className = `preview-ruler-tick${isMajor ? " major" : ""}`;
    tick.style.top = `${(mm / heightMm) * 100}%`;
    if (isMajor) tick.dataset.mm = String(mm);
    ruler.append(tick);
  }

  return ruler;
}

function updatePreviewRulerState() {
  elements.previewPages.classList.toggle("ruler-visible", state.showPreviewRuler);
  elements.previewRulerToggle.classList.toggle("active", state.showPreviewRuler);
  elements.previewRulerToggle.setAttribute("aria-pressed", String(state.showPreviewRuler));
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
  if (document) disposeDocument(document);
  state.documents = state.documents.filter((item) => item.id !== id);
  if (state.activeDocumentId === id) {
    state.activeDocumentId = state.documents[0]?.id || null;
    state.activePage = 1;
  }
  renderDocumentList();
  renderActivePage();
  if (!state.documents.length) setUploadSectionCollapsed(false);
  if (document) toast(`已移除「${document.name}」。`);
}

function disposeDocument(document) {
  document.thumbnailCache?.clear();
  document.pdf?.destroy().catch((error) => console.warn("PDF cleanup failed", error));
  if (document.objectUrl) URL.revokeObjectURL(document.objectUrl);
}

function clearAll() {
  if (!state.documents.length && !state.questions.length) return;
  const confirmed = window.confirm("清空全部试卷和已选题目？这个操作无法撤销。");
  if (!confirmed) return;
  state.documents.forEach(disposeDocument);
  state.documents = [];
  state.questions = [];
  state.activeDocumentId = null;
  state.activePage = 1;
  state.activeDay = 1;
  state.defaultQuestionSize = "standard";
  state.collapsedDays.clear();
  clearSelection();
  renderDocumentList();
  renderQuestions();
  renderActivePage();
  setUploadSectionCollapsed(false);
  toast("工作台已清空。");
}

[elements.addFilesButton, elements.uploadZone, elements.emptyUploadButton].forEach((trigger) => {
  trigger.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    elements.fileInput.click();
  });
});
elements.uploadSectionToggle.addEventListener("click", () => {
  const expanded = elements.uploadSectionToggle.getAttribute("aria-expanded") === "true";
  setUploadSectionCollapsed(expanded);
});
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
    scrollToPage(Number(page.dataset.page));
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
  scrollToPage(state.activePage - 1);
});
elements.nextPageButton.addEventListener("click", async () => {
  const document = getActiveDocument();
  if (!document || state.activePage >= document.pages) return;
  scrollToPage(state.activePage + 1);
});

elements.scrollUpButton.addEventListener("click", () => {
  scrollViewer(-Math.max(240, elements.viewerStage.clientHeight * 0.72));
});
elements.scrollDownButton.addEventListener("click", () => {
  scrollViewer(Math.max(240, elements.viewerStage.clientHeight * 0.72));
});
elements.zoomOutButton.addEventListener("click", async () => {
  state.zoom = Math.max(0.7, Number((state.zoom - 0.1).toFixed(1)));
  await renderActivePage();
});
elements.zoomInButton.addEventListener("click", async () => {
  state.zoom = Math.min(1.5, Number((state.zoom + 0.1).toFixed(1)));
  await renderActivePage();
});

elements.continuousPages.addEventListener("pointerdown", (event) => {
  const layer = event.target.closest(".selection-layer");
  if (!layer) return;
  if (event.button !== 0) return;
  event.preventDefault();
  layer.setPointerCapture(event.pointerId);
  const shell = layer.closest("[data-continuous-page]");
  const canvas = shell?.querySelector("canvas");
  if (!shell || !canvas) return;
  const start = pointFromEvent(event, layer);
  state.pointer = {
    start,
    current: start,
    layer,
    canvas,
    page: Number(shell.dataset.continuousPage),
  };
  state.selection = null;
  elements.selectionAction.hidden = true;
  layer.append(elements.selectionBox);
  updateSelectionBox({ x: start.x, y: start.y, width: 0, height: 0 });
});

elements.continuousPages.addEventListener("pointermove", (event) => {
  if (!state.pointer) return;
  autoScrollViewer(event);
  state.pointer.current = pointFromEvent(event);
  updateSelectionBox(normalizeRect(state.pointer.start, state.pointer.current));
});

elements.continuousPages.addEventListener("pointerup", async (event) => {
  if (!state.pointer) return;
  const pointerContext = state.pointer;
  const end = pointFromEvent(event);
  const rect = normalizeRect(state.pointer.start, end);
  state.pointer = null;
  await finalizeSelection(rect, pointerContext);
});

elements.continuousPages.addEventListener("pointercancel", clearSelection);
elements.viewerStage.addEventListener(
  "scroll",
  () => {
    updateViewerScrollRail();
    updateActivePageFromScroll();
  },
  { passive: true },
);
elements.viewerStage.addEventListener(
  "wheel",
  (event) => {
    if (event.ctrlKey) return;
    event.preventDefault();
    const unit =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 18
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? elements.viewerStage.clientHeight
          : 1;
    if (event.shiftKey) {
      scrollViewer(0, (event.deltaY || event.deltaX) * unit);
      return;
    }
    scrollViewer(event.deltaY * unit, event.deltaX * unit);
  },
  { passive: false, capture: true },
);

elements.viewerScrollRail.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  const railRect = elements.viewerScrollRail.getBoundingClientRect();
  const thumbRect = elements.viewerScrollThumb.getBoundingClientRect();
  if (event.target === elements.viewerScrollThumb) {
    elements.viewerScrollRail.setPointerCapture(event.pointerId);
    state.scrollDrag = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScrollTop: elements.viewerStage.scrollTop,
    };
    elements.viewerScrollThumb.classList.add("dragging");
    return;
  }

  const direction = event.clientY < thumbRect.top ? -1 : 1;
  const distance = Math.max(240, elements.viewerStage.clientHeight * 0.82);
  scrollViewer(direction * distance);
  if (event.clientY < railRect.top || event.clientY > railRect.bottom) updateViewerScrollRail();
});

elements.viewerScrollRail.addEventListener("pointermove", (event) => {
  if (!state.scrollDrag || state.scrollDrag.pointerId !== event.pointerId) return;
  const railHeight = elements.viewerScrollRail.clientHeight;
  const thumbHeight = elements.viewerScrollThumb.offsetHeight;
  const maxThumbTop = Math.max(1, railHeight - thumbHeight);
  const maxScrollTop = Math.max(
    0,
    elements.viewerStage.scrollHeight - elements.viewerStage.clientHeight,
  );
  const scrollDelta = ((event.clientY - state.scrollDrag.startY) / maxThumbTop) * maxScrollTop;
  elements.viewerStage.scrollTop = Math.max(
    0,
    Math.min(maxScrollTop, state.scrollDrag.startScrollTop + scrollDelta),
  );
});

function finishScrollDrag(event) {
  if (!state.scrollDrag || state.scrollDrag.pointerId !== event.pointerId) return;
  state.scrollDrag = null;
  elements.viewerScrollThumb.classList.remove("dragging");
}

elements.viewerScrollRail.addEventListener("pointerup", finishScrollDrag);
elements.viewerScrollRail.addEventListener("pointercancel", finishScrollDrag);
elements.viewerScrollRail.addEventListener("keydown", (event) => {
  const pageDistance = Math.max(240, elements.viewerStage.clientHeight * 0.82);
  const keyActions = {
    ArrowUp: () => scrollViewer(-80),
    ArrowDown: () => scrollViewer(80),
    PageUp: () => scrollViewer(-pageDistance),
    PageDown: () => scrollViewer(pageDistance),
    Home: () => {
      elements.viewerStage.scrollTop = 0;
    },
    End: () => {
      elements.viewerStage.scrollTop = elements.viewerStage.scrollHeight;
    },
  };
  const action = keyActions[event.key];
  if (!action) return;
  event.preventDefault();
  action();
  updateViewerScrollRail();
});

elements.cancelSelectionButton.addEventListener("click", clearSelection);
elements.addQuestionButton.addEventListener("click", addSelectedQuestion);
elements.bulkQuestionSizeButtons.forEach((button) => {
  button.addEventListener("click", () => applyQuestionSizeToAll(button.dataset.bulkQuestionSize));
});

elements.questionList.addEventListener("click", (event) => {
  const dayToggle = event.target.closest("[data-toggle-day-group]");
  if (dayToggle) {
    const day = Number(dayToggle.dataset.toggleDayGroup);
    if (state.collapsedDays.has(day)) {
      state.collapsedDays.delete(day);
    } else {
      state.collapsedDays.add(day);
    }
    renderQuestions();
    return;
  }

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
  const sizeSelect = event.target.closest("[data-question-size]");
  if (!sizeSelect) return;
  const question = state.questions.find((item) => item.id === sizeSelect.dataset.questionSize);
  if (question) {
    question.size = sizeSelect.value;
    renderBulkQuestionSizeControls();
    markInlinePreviewDirty();
  }
});

elements.questionList.addEventListener("input", (event) => {
  const answerInput = event.target.closest("[data-answer-space-mm]");
  if (!answerInput) return;
  const question = state.questions.find((item) => item.id === answerInput.dataset.answerSpaceMm);
  const value = Number(answerInput.value);
  if (question && Number.isFinite(value) && value >= 0) {
    question.answerSpaceMm = Math.min(2000, Math.round(value));
    markInlinePreviewDirty();
  }
});

elements.questionList.addEventListener("change", (event) => {
  const answerInput = event.target.closest("[data-answer-space-mm]");
  if (!answerInput) return;
  const question = state.questions.find((item) => item.id === answerInput.dataset.answerSpaceMm);
  if (!question) return;
  answerInput.value = getQuestionAnswerSpaceMm(question);
});

elements.dayManagerToggle.addEventListener("click", () => {
  const expanded = elements.dayManagerToggle.getAttribute("aria-expanded") === "true";
  elements.dayManagerToggle.setAttribute("aria-expanded", String(!expanded));
  elements.dayManagerBody.hidden = expanded;
});

elements.dayTabList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-select-active-day]");
  if (!button) return;
  state.activeDay = Number(button.dataset.selectActiveDay);
  renderDayManager();
});

elements.activeDayInput.addEventListener("change", () => {
  const value = Number(elements.activeDayInput.value);
  state.activeDay = Math.min(365, Math.max(1, Math.round(value) || 1));
  renderDayManager();
});

elements.addDayButton.addEventListener("click", () => {
  state.activeDay = Math.min(365, Math.max(...getKnownDays()) + 1);
  renderDayManager();
});

elements.settingsToggle.addEventListener("click", () => {
  const expanded = elements.settingsToggle.getAttribute("aria-expanded") === "true";
  elements.settingsToggle.setAttribute("aria-expanded", String(!expanded));
  elements.settingsBody.hidden = expanded;
});

elements.pageMargin.addEventListener("input", () => {
  elements.marginOutput.textContent = `${elements.pageMargin.value} mm`;
  markInlinePreviewDirty();
});
elements.questionGap.addEventListener("input", () => {
  elements.gapOutput.textContent = `${elements.questionGap.value} mm`;
  markInlinePreviewDirty();
});

[
  elements.paperTitle,
  elements.paperSize,
  elements.columns,
  elements.showNumbers,
  elements.showSources,
].forEach((control) => {
  control.addEventListener("input", markInlinePreviewDirty);
  control.addEventListener("change", markInlinePreviewDirty);
});

elements.composeViewTabs.forEach((button) => {
  button.addEventListener("click", () => setComposeView(button.dataset.composeView));
});
elements.refreshInlinePreviewButton.addEventListener("click", renderInlinePreview);

elements.previewButton.addEventListener("click", openPreview);
elements.previewRulerToggle.addEventListener("click", () => {
  state.showPreviewRuler = !state.showPreviewRuler;
  updatePreviewRulerState();
});
elements.closeModalButton.addEventListener("click", closePreview);
$("[data-close-modal]").addEventListener("click", closePreview);
elements.modalExportButton.addEventListener("click", exportPdf);
elements.exportButton.addEventListener("click", exportPdf);
elements.clearAllButton.addEventListener("click", clearAll);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.previewModal.hidden) closePreview();
});
let viewerResizeTimer = null;
window.addEventListener("resize", () => {
  updateViewerScrollRail();
  window.clearTimeout(viewerResizeTimer);
  viewerResizeTimer = window.setTimeout(() => {
    if (getActiveDocument() && !state.paneDrag) renderActivePage();
  }, 180);
});

setupPaneResizing();
renderQuestions();
updatePageControls();

// Exposed by convention to make browser smoke tests and classroom IT support easier.
window.__paperStudioDebug = state;
