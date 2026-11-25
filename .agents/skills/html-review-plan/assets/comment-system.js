(() => {
  'use strict';

  const root = document.getElementById('founder-review');
  if (!root) return;

  const schemaVersion = 'founder-review-comments/v1';
  const reportId = root.dataset.reportId;
  const storageKey = `founder-review-comments:${reportId}`;
  const dataNode = document.getElementById('founder-comments-data');
  const anchorInput = document.getElementById('founder-comment-anchor');
  const typeInput = document.getElementById('founder-comment-type');
  const bodyInput = document.getElementById('founder-comment-body');
  const quoteNode = document.getElementById('founder-comment-quote');
  const saveButton = document.getElementById('founder-comment-save');
  const cancelButton = document.getElementById('founder-comment-cancel');
  const countNode = document.getElementById('founder-comment-count');
  const indexNode = document.getElementById('founder-comment-index');
  const stateNode = document.getElementById('founder-comments-state');

  let pendingQuote = '';
  let pendingAnchorId = 'executive-summary';
  let pendingInlineTargetId = '';
  let editingId = null;
  let localStorageAvailable = true;

  const selectionTrigger = document.createElement('button');
  selectionTrigger.type = 'button';
  selectionTrigger.className = 'primary selection-comment-trigger';
  selectionTrigger.textContent = 'Comment here';
  selectionTrigger.hidden = true;
  selectionTrigger.dataset.exportTransient = 'true';
  root.appendChild(selectionTrigger);

  function safeJson(value) {
    return JSON.stringify(value, null, 2).replace(/</g, '\\u003c');
  }

  function parsePayload(text) {
    try {
      const parsed = JSON.parse(text || '{}');
      return {
        schemaVersion: parsed.schemaVersion || schemaVersion,
        reportId: parsed.reportId || reportId,
        comments: Array.isArray(parsed.comments) ? parsed.comments : [],
        deletedIds: Array.isArray(parsed.deletedIds) ? parsed.deletedIds : []
      };
    } catch (_) {
      return { schemaVersion, reportId, comments: [], deletedIds: [] };
    }
  }

  function readLocalPayload() {
    try {
      return parsePayload(localStorage.getItem(storageKey) || '{}');
    } catch (_) {
      localStorageAvailable = false;
      return { schemaVersion, reportId, comments: [], deletedIds: [] };
    }
  }

  function mergePayloads(embedded, local) {
    const deleted = new Set([...(embedded.deletedIds || []), ...(local.deletedIds || [])]);
    const byId = new Map();
    [...(embedded.comments || []), ...(local.comments || [])].forEach(comment => {
      if (!comment?.id || deleted.has(comment.id)) return;
      const prior = byId.get(comment.id);
      const priorTime = Date.parse(prior?.updatedAt || prior?.createdAt || 0) || 0;
      const nextTime = Date.parse(comment.updatedAt || comment.createdAt || 0) || 0;
      if (!prior || nextTime >= priorTime) byId.set(comment.id, comment);
    });
    return {
      schemaVersion,
      reportId,
      comments: [...byId.values()].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))),
      deletedIds: [...deleted]
    };
  }

  let payload = mergePayloads(parsePayload(dataNode.textContent), readLocalPayload());

  function anchors() {
    return [...root.querySelectorAll('[data-review-anchor][id]')];
  }

  function anchorLabel(anchor) {
    return anchor?.dataset.anchorLabel || anchor?.querySelector('h1,h2,h3,h4')?.textContent.trim() || anchor?.id || 'Review';
  }

  function ensureReviewUi() {
    anchors().forEach(anchor => {
      let tools = [...anchor.children].find(child => child.classList?.contains('annotation-tools'));
      if (!tools) {
        tools = document.createElement('div');
        tools.className = 'annotation-tools';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'section-comment';
        button.dataset.anchor = anchor.id;
        button.textContent = 'Comment on this section';
        const hint = document.createElement('span');
        hint.textContent = 'Founder feedback is embedded in the returned HTML.';
        tools.append(button, hint);
        const heading = [...anchor.children].find(child => /^H[1-4]$/.test(child.tagName));
        if (heading) heading.insertAdjacentElement('afterend', tools);
        else anchor.prepend(tools);
      }
      let well = [...anchor.children].find(child => child.classList?.contains('section-comments'));
      if (!well) {
        well = document.createElement('div');
        well.className = 'inline-comments section-comments';
        well.dataset.commentsFor = anchor.id;
        well.setAttribute('aria-live', 'polite');
        anchor.appendChild(well);
      }
    });
  }

  function populateAnchors() {
    const prior = anchorInput.value || pendingAnchorId;
    anchorInput.replaceChildren();
    anchors().forEach(anchor => {
      const option = document.createElement('option');
      option.value = anchor.id;
      option.textContent = anchorLabel(anchor);
      anchorInput.appendChild(option);
    });
    anchorInput.value = document.getElementById(prior) ? prior : anchorInput.options[0]?.value || '';
    pendingAnchorId = anchorInput.value;
  }

  function persist() {
    dataNode.textContent = safeJson(payload);
    try {
      localStorage.setItem(storageKey, JSON.stringify(payload));
      localStorageAvailable = true;
    } catch (_) {
      localStorageAvailable = false;
    }
  }

  function badge(text) {
    const node = document.createElement('span');
    node.className = 'badge';
    node.textContent = text;
    return node;
  }

  function commentCard(comment, indexCopy = false) {
    const card = document.createElement('article');
    card.className = 'card founder-comment';
    card.setAttribute('data-founder-comment', 'true');
    card.dataset.commentId = comment.id;
    card.dataset.authorRole = 'FOUNDER_REVIEW_COMMENT';
    card.dataset.requiresAgentResponse = 'true';
    card.dataset.status = comment.status || 'open';
    card.dataset.anchorId = comment.anchorId || '';
    if (indexCopy) card.dataset.indexCopy = 'true';

    const label = document.createElement('div');
    label.className = 'comment-label';
    label.append(badge('FOUNDER REVIEW COMMENT'), badge(comment.type || 'Question'), badge((comment.status || 'open').toUpperCase()));
    const required = document.createElement('span');
    required.textContent = 'Requires agent response';
    label.appendChild(required);
    card.appendChild(label);

    const link = document.createElement('a');
    link.href = `#${comment.inlineTargetId || comment.anchorId}`;
    link.textContent = comment.anchorLabel || comment.anchorId || 'Review';
    card.appendChild(link);

    if (comment.quote) {
      const quote = document.createElement('blockquote');
      quote.textContent = comment.quote;
      card.appendChild(quote);
    }
    const body = document.createElement('p');
    body.className = 'founder-comment-body';
    body.textContent = comment.body;
    card.appendChild(body);
    const meta = document.createElement('p');
    meta.className = 'muted';
    meta.textContent = `${comment.createdAt || ''}${comment.updatedAt && comment.updatedAt !== comment.createdAt ? ` · updated ${comment.updatedAt}` : ''} · ID ${comment.id}`;
    card.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'comment-actions';
    [['edit', 'Edit'], ['resolve', comment.status === 'resolved' ? 'Reopen' : 'Resolve'], ['delete', 'Delete']].forEach(([action, text]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.commentAction = action;
      button.dataset.commentId = comment.id;
      button.textContent = text;
      if (action === 'delete') button.style.color = 'var(--danger)';
      actions.appendChild(button);
    });
    card.appendChild(actions);
    return card;
  }

  function insertNear(target, node) {
    if (/^(LI|TD|TH)$/.test(target.tagName)) target.appendChild(node);
    else target.insertAdjacentElement('afterend', node);
  }

  function inlineWell(target, targetId) {
    let well = root.querySelector(`[data-inline-comments-for="${targetId}"]`);
    if (!well) {
      well = document.createElement('div');
      well.className = 'inline-comments inline-target-comments';
      well.dataset.inlineCommentsFor = targetId;
      well.setAttribute('aria-live', 'polite');
      insertNear(target, well);
    }
    return well;
  }

  function renderComments() {
    root.querySelectorAll('.inline-target-comments').forEach(node => node.remove());
    root.querySelectorAll('.section-comments').forEach(node => node.replaceChildren());
    indexNode.replaceChildren();
    payload.comments.forEach(comment => {
      const anchor = document.getElementById(comment.anchorId);
      const target = comment.inlineTargetId ? document.getElementById(comment.inlineTargetId) : null;
      const well = target ? inlineWell(target, comment.inlineTargetId) : [...(anchor?.children || [])].find(child => child.classList?.contains('section-comments'));
      if (well) well.appendChild(commentCard(comment));
      indexNode.appendChild(commentCard(comment, true));
    });
    countNode.textContent = String(payload.comments.length);
    if (!payload.comments.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No founder comments yet.';
      indexNode.appendChild(empty);
    }
    stateNode.textContent = `${payload.comments.length} founder comment${payload.comments.length === 1 ? '' : 's'}${localStorageAvailable ? ' · saved locally · export HTML to return.' : ' · export HTML before closing.'}`;
    dataNode.textContent = safeJson(payload);
  }

  function setQuote(text, anchorId, inlineTargetId = '') {
    pendingQuote = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
    if (anchorId && document.getElementById(anchorId)) {
      pendingAnchorId = anchorId;
      anchorInput.value = anchorId;
    }
    pendingInlineTargetId = inlineTargetId;
    quoteNode.textContent = pendingQuote || 'No text selected. Highlight wording to use Comment here.';
  }

  function selectionBlock(element, anchor) {
    return element?.closest?.('p,li,blockquote,td,th,pre,figure,.callout,.plain-group') || anchor;
  }

  function ensureTarget(element) {
    if (!element.id) element.id = `founder-comment-target-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    element.dataset.founderCommentTarget = 'true';
    return element.id;
  }

  function positionSelectionTrigger(rect) {
    const rootRect = root.getBoundingClientRect();
    selectionTrigger.hidden = false;
    requestAnimationFrame(() => {
      const left = Math.max(0, Math.min(rect.right - rootRect.left, root.clientWidth - selectionTrigger.offsetWidth));
      selectionTrigger.style.left = `${left}px`;
      selectionTrigger.style.top = `${Math.max(0, rect.bottom - rootRect.top + 6)}px`;
    });
  }

  function captureSelection(moveToWorkbench = false) {
    const selection = getSelection();
    if (!selection || !selection.rangeCount || selection.isCollapsed) {
      selectionTrigger.hidden = true;
      return false;
    }
    const text = selection.toString().replace(/\s+/g, ' ').trim();
    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    const anchor = element?.closest?.('[data-review-anchor][id]');
    if (!text || !anchor || !root.contains(anchor)) return false;
    const targetId = ensureTarget(selectionBlock(element, anchor));
    const rects = [...range.getClientRects()];
    setQuote(text, anchor.id, targetId);
    if (moveToWorkbench) {
      document.getElementById('comment-workbench').scrollIntoView({ behavior: 'smooth', block: 'start' });
      bodyInput.focus();
      selectionTrigger.hidden = true;
    } else {
      positionSelectionTrigger(rects.at(-1) || range.getBoundingClientRect());
    }
    return true;
  }

  function addComment(body, type, anchorId, quote, inlineTargetId) {
    body = String(body || '').trim();
    if (!body) return false;
    const now = new Date().toISOString();
    payload.comments.push({
      id: `founder-comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      authorRole: 'FOUNDER_REVIEW_COMMENT',
      requiresAgentResponse: true,
      reportId,
      anchorId,
      anchorLabel: anchorLabel(document.getElementById(anchorId)),
      inlineTargetId: inlineTargetId || '',
      quote: quote || '',
      body,
      type: type || 'Question',
      status: 'open',
      createdAt: now,
      updatedAt: now
    });
    persist();
    renderComments();
    return true;
  }

  function closeInlineComposer() {
    root.querySelector('.inline-composer')?.remove();
  }

  function openInlineComposer() {
    closeInlineComposer();
    const target = document.getElementById(pendingInlineTargetId) || document.getElementById(pendingAnchorId);
    if (!target || !pendingQuote) return;
    const composer = document.createElement('div');
    composer.className = 'card inline-composer';
    composer.dataset.exportTransient = 'true';
    composer.innerHTML = '<strong>Comment on highlighted text</strong>';
    const quote = document.createElement('blockquote');
    quote.textContent = pendingQuote;
    composer.appendChild(quote);
    const fieldId = `founder-inline-comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const typeLabel = document.createElement('label');
    typeLabel.htmlFor = `${fieldId}-type`;
    typeLabel.textContent = 'Comment type';
    const type = document.createElement('select');
    type.id = `${fieldId}-type`;
    ['Question', 'Change request', 'Concern', 'Approval'].forEach(value => type.add(new Option(value, value)));
    const bodyLabel = document.createElement('label');
    bodyLabel.htmlFor = `${fieldId}-body`;
    bodyLabel.textContent = 'Your comment';
    const body = document.createElement('textarea');
    body.id = `${fieldId}-body`;
    body.placeholder = 'Write the question or change you want addressed.';
    const actions = document.createElement('div');
    actions.className = 'actions';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'primary';
    add.textContent = 'Add founder comment';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    actions.append(add, cancel);
    composer.append(typeLabel, type, bodyLabel, body, actions);
    insertNear(target, composer);
    selectionTrigger.hidden = true;
    body.focus();
    add.addEventListener('click', () => {
      if (!addComment(body.value, type.value, pendingAnchorId, pendingQuote, pendingInlineTargetId)) return body.focus();
      closeInlineComposer();
      getSelection()?.removeAllRanges();
    });
    cancel.addEventListener('click', closeInlineComposer);
    body.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        add.click();
      }
    });
  }

  function resetWorkbench() {
    editingId = null;
    bodyInput.value = '';
    typeInput.value = 'Question';
    setQuote('', anchorInput.value || 'executive-summary');
    saveButton.textContent = 'Add founder comment';
    cancelButton.hidden = true;
  }

  function saveWorkbenchComment() {
    const body = bodyInput.value.trim();
    if (!body) return bodyInput.focus();
    if (editingId) {
      const comment = payload.comments.find(item => item.id === editingId);
      if (!comment) return;
      comment.anchorId = anchorInput.value;
      comment.anchorLabel = anchorLabel(document.getElementById(anchorInput.value));
      comment.inlineTargetId = pendingInlineTargetId || '';
      comment.quote = pendingQuote;
      comment.body = body;
      comment.type = typeInput.value;
      comment.updatedAt = new Date().toISOString();
      persist();
      renderComments();
    } else if (!addComment(body, typeInput.value, anchorInput.value, pendingQuote, pendingInlineTargetId)) {
      return;
    }
    resetWorkbench();
  }

  function editComment(id) {
    const comment = payload.comments.find(item => item.id === id);
    if (!comment) return;
    editingId = id;
    anchorInput.value = comment.anchorId;
    typeInput.value = comment.type;
    bodyInput.value = comment.body;
    setQuote(comment.quote, comment.anchorId, comment.inlineTargetId || '');
    saveButton.textContent = 'Save founder comment';
    cancelButton.hidden = false;
    document.getElementById('comment-workbench').scrollIntoView({ behavior: 'smooth', block: 'start' });
    bodyInput.focus();
  }

  function toggleResolved(id) {
    const comment = payload.comments.find(item => item.id === id);
    if (!comment) return;
    comment.status = comment.status === 'resolved' ? 'open' : 'resolved';
    comment.updatedAt = new Date().toISOString();
    persist();
    renderComments();
  }

  function deleteComment(id) {
    if (!payload.comments.some(item => item.id === id) || !confirm('Delete this founder review comment?')) return;
    payload.comments = payload.comments.filter(item => item.id !== id);
    if (!payload.deletedIds.includes(id)) payload.deletedIds.push(id);
    if (editingId === id) resetWorkbench();
    persist();
    renderComments();
  }

  function beginSectionComment(anchorId) {
    closeInlineComposer();
    selectionTrigger.hidden = true;
    anchorInput.value = anchorId;
    setQuote('', anchorId);
    document.getElementById('comment-workbench').scrollIntoView({ behavior: 'smooth', block: 'start' });
    bodyInput.focus();
  }

  function download(content, type, filename) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportJson() {
    download(safeJson({ ...payload, exportedAt: new Date().toISOString() }), 'application/json;charset=utf-8', `${reportId}-founder-comments.json`);
  }

  function exportHtml() {
    persist();
    const clone = document.documentElement.cloneNode(true);
    clone.querySelector('#founder-comments-data').textContent = safeJson(payload);
    clone.querySelector('#founder-review').dataset.exportedWithFounderComments = new Date().toISOString();
    clone.querySelectorAll('[data-export-transient="true"]').forEach(node => node.remove());
    const clonedBody = clone.querySelector('#founder-comment-body');
    if (clonedBody) clonedBody.textContent = '';
    let marker = clone.querySelector('meta[name="founder-review-comments-schema"]');
    if (!marker) {
      marker = document.createElement('meta');
      marker.name = 'founder-review-comments-schema';
      clone.querySelector('head').appendChild(marker);
    }
    marker.content = schemaVersion;
    const date = new Date().toISOString().slice(0, 10);
    download(`<!doctype html>\n${clone.outerHTML}`, 'text/html;charset=utf-8', `${reportId}-commented-${date}.html`);
    stateNode.textContent = `Commented HTML saved with ${payload.comments.length} embedded comment${payload.comments.length === 1 ? '' : 's'}.`;
  }

  ensureReviewUi();
  populateAnchors();
  renderComments();

  root.addEventListener('click', event => {
    const selectionButton = event.target.closest('.selection-comment-trigger');
    if (selectionButton) return openInlineComposer();
    const sectionButton = event.target.closest('.section-comment');
    if (sectionButton) return beginSectionComment(sectionButton.dataset.anchor);
    const actionButton = event.target.closest('[data-comment-action]');
    if (!actionButton) return;
    const { commentId, commentAction } = actionButton.dataset;
    if (commentAction === 'edit') editComment(commentId);
    if (commentAction === 'resolve') toggleResolved(commentId);
    if (commentAction === 'delete') deleteComment(commentId);
  });

  root.addEventListener('mouseup', event => {
    if (event.target.closest('#comment-workbench,.inline-composer,.selection-comment-trigger')) return;
    setTimeout(() => captureSelection(false), 0);
  });
  anchorInput.addEventListener('change', () => {
    pendingAnchorId = anchorInput.value;
    pendingInlineTargetId = '';
  });
  saveButton.addEventListener('click', saveWorkbenchComment);
  cancelButton.addEventListener('click', resetWorkbench);
  document.getElementById('founder-comment-use-selection').addEventListener('click', () => captureSelection(true));
  document.getElementById('founder-comment-clear-quote').addEventListener('click', () => setQuote('', anchorInput.value));
  document.getElementById('founder-comments-save-html').addEventListener('click', exportHtml);
  document.getElementById('founder-comments-export-json').addEventListener('click', exportJson);
  bodyInput.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      saveWorkbenchComment();
    }
  });
})();
