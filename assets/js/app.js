(() => {
  'use strict';

  /* ============================================================
   * IndexedDB
   * ==========================================================*/
  const DB_NAME = 'vibecode-player';
  const DB_VERSION = 1;
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function dbAll(store) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  async function dbPut(store, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
    });
  }
  async function dbDelete(store, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /* ============================================================
   * State & helpers
   * ==========================================================*/
  const state = {
    tracks: [],
    playlists: [],
    view: { type: 'library', id: null },
    queue: [],          // array of track ids
    queueIndex: -1,
    shuffle: false,
    repeat: 'off',      // 'off' | 'all' | 'one'
    search: '',
  };

  const settings = loadSettings();

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem('vibecode-player-settings')) || {}; }
    catch { return {}; }
  }
  function saveSettings() {
    localStorage.setItem('vibecode-player-settings', JSON.stringify({
      volume: audio.volume, muted: audio.muted, shuffle: state.shuffle, repeat: state.repeat,
    }));
  }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  function parseName(filename) {
    const base = filename.replace(/\.[^.]+$/, '').trim();
    const m = base.split(/\s+[-–—]\s+/);
    if (m.length >= 2) return { artist: m[0].trim(), title: m.slice(1).join(' - ').trim() };
    return { artist: 'Неизвестный исполнитель', title: base || 'Без названия' };
  }

  function hashStr(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i) | 0;
    return Math.abs(h);
  }
  function coverGradient(seed) {
    const h = hashStr(seed || 'x');
    const a = h % 360;
    const b = (a + 40 + (h % 80)) % 360;
    return `linear-gradient(135deg, hsl(${a} 65% 45%), hsl(${b} 70% 30%))`;
  }
  const NOTE_SVG = '<svg viewBox="0 0 24 24" width="45%" height="45%" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>';

  function applyCover(el, track, withIcon = true) {
    el.style.background = coverGradient((track.artist || '') + (track.title || ''));
    el.innerHTML = withIcon ? NOTE_SVG : '';
  }

  /* ============================================================
   * Object URL cache (for file blobs)
   * ==========================================================*/
  const urlCache = new Map();
  function trackSrc(track) {
    if (track.source === 'url') return track.url;
    if (urlCache.has(track.id)) return urlCache.get(track.id);
    const url = URL.createObjectURL(track.blob);
    urlCache.set(track.id, url);
    return url;
  }

  /* ============================================================
   * Elements
   * ==========================================================*/
  const audio = $('#audio');
  const els = {
    playlistList: $('#playlistList'),
    trackList: $('#trackList'),
    tracksSection: $('#tracksSection'),
    emptyState: $('#emptyState'),
    heroArt: $('#heroArt'), heroKicker: $('#heroKicker'), heroTitle: $('#heroTitle'),
    heroSub: $('#heroSub'), heroActions: $('#heroActions'),
    searchInput: $('#searchInput'),
    npArt: $('#npArt'), npTitle: $('#npTitle'), npArtist: $('#npArtist'),
    playBtn: $('#playBtn'), prevBtn: $('#prevBtn'), nextBtn: $('#nextBtn'),
    shuffleBtn: $('#shuffleBtn'), repeatBtn: $('#repeatBtn'),
    likeBtn: $('#likeBtn'),
    curTime: $('#curTime'), durTime: $('#durTime'),
    seekBar: $('#seekBar'), seekFill: $('#seekFill'), seekKnob: $('#seekKnob'),
    muteBtn: $('#muteBtn'), volBar: $('#volBar'), volFill: $('#volFill'), volKnob: $('#volKnob'),
    player: $('#player'),
    addModal: $('#addModal'), promptModal: $('#promptModal'),
    dropzone: $('#dropzone'), fileInput: $('#fileInput'),
    urlForm: $('#urlForm'), urlInput: $('#urlInput'),
    promptForm: $('#promptForm'), promptInput: $('#promptInput'), promptTitle: $('#promptTitle'),
    ctxMenu: $('#ctxMenu'), toast: $('#toast'),
    sidebar: $('#sidebar'), menuBtn: $('#menuBtn'), scrim: $('#scrim'),
    newPlaylistBtn: $('#newPlaylistBtn'),
  };

  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2600);
  }

  /* ============================================================
   * Data access
   * ==========================================================*/
  const getTrack = (id) => state.tracks.find((t) => t.id === id);

  function currentViewTracks() {
    let list;
    if (state.view.type === 'playlist') {
      const pl = state.playlists.find((p) => p.id === state.view.id);
      list = pl ? pl.trackIds.map(getTrack).filter(Boolean) : [];
    } else {
      list = state.tracks.slice();
    }
    const q = state.search.trim().toLowerCase();
    if (q) list = list.filter((t) => (t.title + ' ' + t.artist + ' ' + (t.album || '')).toLowerCase().includes(q));
    return list;
  }

  /* ============================================================
   * Rendering
   * ==========================================================*/
  function renderPlaylists() {
    els.playlistList.innerHTML = '';
    if (!state.playlists.length) {
      els.playlistList.innerHTML = '<li class="playlists__empty">Пока нет плейлистов. Создай первый!</li>';
      return;
    }
    state.playlists.forEach((pl) => {
      const li = document.createElement('li');
      li.className = 'pl-item' + (state.view.type === 'playlist' && state.view.id === pl.id ? ' is-active' : '');
      const art = document.createElement('div');
      art.className = 'pl-item__art';
      art.style.background = coverGradient(pl.name);
      art.innerHTML = NOTE_SVG;
      const meta = document.createElement('div');
      meta.className = 'pl-item__meta';
      meta.innerHTML = `<div class="pl-item__name"></div><div class="pl-item__count">${pl.trackIds.length} трек(ов)</div>`;
      meta.querySelector('.pl-item__name').textContent = pl.name;
      const del = document.createElement('button');
      del.className = 'pl-item__del';
      del.type = 'button';
      del.title = 'Удалить плейлист';
      del.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>';
      del.addEventListener('click', (e) => { e.stopPropagation(); deletePlaylist(pl.id); });
      li.append(art, meta, del);
      li.addEventListener('click', () => openView({ type: 'playlist', id: pl.id }));
      els.playlistList.appendChild(li);
    });
  }

  function renderView() {
    const list = currentViewTracks();
    const isPlaylist = state.view.type === 'playlist';
    const pl = isPlaylist ? state.playlists.find((p) => p.id === state.view.id) : null;

    if (isPlaylist && !pl) { state.view = { type: 'library', id: null }; return renderView(); }

    els.heroKicker.textContent = isPlaylist ? 'Плейлист' : 'Медиатека';
    els.heroTitle.textContent = isPlaylist ? pl.name : 'Моя музыка';
    els.heroArt.style.background = coverGradient(isPlaylist ? pl.name : 'Моя музыка');
    els.heroArt.innerHTML = NOTE_SVG;

    const total = (isPlaylist ? pl.trackIds.length : state.tracks.length);
    els.heroSub.textContent = total ? `${total} трек(ов)` : 'Здесь пока пусто';

    // Hero actions
    els.heroActions.innerHTML = '';
    if (list.length) {
      const play = document.createElement('button');
      play.className = 'play-fab';
      play.type = 'button';
      play.setAttribute('aria-label', 'Слушать');
      play.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      play.addEventListener('click', () => playFromView(0));
      els.heroActions.appendChild(play);
    }

    // Empty vs list
    const libraryEmpty = state.tracks.length === 0;
    els.emptyState.hidden = !libraryEmpty;
    els.tracksSection.hidden = libraryEmpty;

    els.trackList.innerHTML = '';
    if (libraryEmpty) return;

    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'playlists__empty';
      li.style.padding = '24px 16px';
      li.textContent = state.search ? 'Ничего не найдено.' : 'В этом плейлисте пока нет треков.';
      els.trackList.appendChild(li);
      return;
    }

    const playingId = state.queue[state.queueIndex];
    list.forEach((t, i) => els.trackList.appendChild(renderTrackRow(t, i, t.id === playingId)));
  }

  function renderTrackRow(track, index, isPlaying) {
    const li = document.createElement('li');
    li.className = 'track' + (isPlaying ? ' is-playing' : '') + (track.liked ? ' is-liked' : '');
    li.dataset.id = track.id;

    // index / play
    const idxWrap = document.createElement('div');
    idxWrap.className = 'track__index-wrap';
    idxWrap.innerHTML = `<span class="track__index">${index + 1}</span>
      <button class="track__play" type="button" aria-label="Играть"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>`;

    // main
    const main = document.createElement('div');
    main.className = 'track__main';
    const art = document.createElement('div');
    art.className = 'track__art';
    applyCover(art, track);
    const text = document.createElement('div');
    text.className = 'track__text';
    text.innerHTML = '<div class="track__name"></div><div class="track__artist"></div>';
    text.querySelector('.track__name').textContent = track.title;
    text.querySelector('.track__artist').textContent = track.artist;
    main.append(art, text);

    // album
    const album = document.createElement('div');
    album.className = 'track__album';
    album.textContent = track.album || '—';

    // right
    const right = document.createElement('div');
    right.className = 'track__right';
    const like = document.createElement('button');
    like.className = 'track__like' + (track.liked ? ' is-liked' : '');
    like.type = 'button';
    like.setAttribute('aria-label', 'В избранное');
    like.innerHTML = likeSVG(track.liked);
    like.addEventListener('click', (e) => { e.stopPropagation(); toggleLike(track.id); });
    const dur = document.createElement('span');
    dur.textContent = fmtTime(track.duration || 0);
    const more = document.createElement('button');
    more.className = 'track__more';
    more.type = 'button';
    more.setAttribute('aria-label', 'Ещё');
    more.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
    more.addEventListener('click', (e) => { e.stopPropagation(); openCtx(e, track.id); });
    right.append(like, dur, more);

    li.append(idxWrap, main, album, right);
    li.addEventListener('dblclick', () => playFromView(index));
    idxWrap.querySelector('.track__play').addEventListener('click', () => playFromView(index));
    li.addEventListener('contextmenu', (e) => { e.preventDefault(); openCtx(e, track.id); });
    return li;
  }

  function likeSVG(filled, size = 16) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z"/></svg>`;
  }

  /* ============================================================
   * Playback
   * ==========================================================*/
  function buildQueue(startId) {
    const list = currentViewTracks();
    let ids = list.map((t) => t.id);
    if (state.shuffle) {
      const startIdx = ids.indexOf(startId);
      const rest = ids.filter((id) => id !== startId);
      for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
      ids = startIdx >= 0 ? [startId, ...rest] : rest;
    }
    state.queue = ids;
    state.queueIndex = ids.indexOf(startId);
  }

  function playFromView(viewIndex) {
    const list = currentViewTracks();
    const track = list[viewIndex];
    if (!track) return;
    buildQueue(track.id);
    loadAndPlay(track.id);
  }

  function loadAndPlay(id) {
    const track = getTrack(id);
    if (!track) return;
    audio.src = trackSrc(track);
    audio.play().catch(() => {});
    updateNowPlaying(track);
    highlightPlaying();
  }

  function updateNowPlaying(track) {
    els.npTitle.textContent = track.title;
    els.npArtist.textContent = track.artist;
    applyCover(els.npArt, track);
    els.likeBtn.classList.toggle('is-liked', !!track.liked);
    els.likeBtn.innerHTML = likeSVG(track.liked, 20);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: track.album || '' });
    }
    document.title = `${track.title} · ${track.artist} — Vibecode`;
  }

  function highlightPlaying() {
    const playingId = state.queue[state.queueIndex];
    $$('.track', els.trackList).forEach((row) => {
      row.classList.toggle('is-playing', row.dataset.id === playingId);
    });
  }

  function togglePlay() {
    if (!audio.src) {
      const list = currentViewTracks();
      if (list.length) playFromView(0);
      return;
    }
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  }

  function next(auto = false) {
    if (!state.queue.length) return;
    if (state.repeat === 'one' && auto) { audio.currentTime = 0; audio.play().catch(() => {}); return; }
    let idx = state.queueIndex + 1;
    if (idx >= state.queue.length) {
      if (state.repeat === 'all' || !auto) idx = 0;
      else { audio.pause(); return; }
    }
    state.queueIndex = idx;
    loadAndPlay(state.queue[idx]);
  }

  function prev() {
    if (!state.queue.length) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    let idx = state.queueIndex - 1;
    if (idx < 0) idx = state.repeat === 'all' ? state.queue.length - 1 : 0;
    state.queueIndex = idx;
    loadAndPlay(state.queue[idx]);
  }

  /* ============================================================
   * Likes / playlists mutations
   * ==========================================================*/
  async function toggleLike(id) {
    const t = getTrack(id);
    if (!t) return;
    t.liked = !t.liked;
    await dbPut('tracks', stripForDB(t));
    renderView();
    if (state.queue[state.queueIndex] === id) {
      els.likeBtn.classList.toggle('is-liked', t.liked);
    }
    toast(t.liked ? 'Добавлено в избранное' : 'Убрано из избранного');
  }

  async function createPlaylist(name) {
    const pl = { id: uid(), name: name.trim() || 'Новый плейлист', trackIds: [], createdAt: Date.now() };
    state.playlists.unshift(pl);
    await dbPut('playlists', pl);
    renderPlaylists();
    return pl;
  }

  async function deletePlaylist(id) {
    state.playlists = state.playlists.filter((p) => p.id !== id);
    await dbDelete('playlists', id);
    if (state.view.type === 'playlist' && state.view.id === id) state.view = { type: 'library', id: null };
    renderPlaylists();
    renderView();
    toast('Плейлист удалён');
  }

  async function addToPlaylist(playlistId, trackId) {
    const pl = state.playlists.find((p) => p.id === playlistId);
    if (!pl) return;
    if (!pl.trackIds.includes(trackId)) pl.trackIds.push(trackId);
    await dbPut('playlists', pl);
    renderPlaylists();
    if (state.view.type === 'playlist' && state.view.id === playlistId) renderView();
    toast('Добавлено в «' + pl.name + '»');
  }

  async function removeFromPlaylist(playlistId, trackId) {
    const pl = state.playlists.find((p) => p.id === playlistId);
    if (!pl) return;
    pl.trackIds = pl.trackIds.filter((x) => x !== trackId);
    await dbPut('playlists', pl);
    renderPlaylists();
    renderView();
    toast('Убрано из плейлиста');
  }

  async function deleteTrack(id) {
    state.tracks = state.tracks.filter((t) => t.id !== id);
    await dbDelete('tracks', id);
    // remove from playlists
    for (const pl of state.playlists) {
      if (pl.trackIds.includes(id)) { pl.trackIds = pl.trackIds.filter((x) => x !== id); await dbPut('playlists', pl); }
    }
    if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
    renderPlaylists();
    renderView();
    toast('Трек удалён из медиатеки');
  }

  function stripForDB(t) { return t; } // tracks are stored as-is (blob is structured-cloneable)

  /* ============================================================
   * Adding music
   * ==========================================================*/
  function getAudioDuration(src) {
    return new Promise((resolve) => {
      const a = document.createElement('audio');
      a.preload = 'metadata';
      a.src = src;
      const done = (d) => { a.src = ''; resolve(d); };
      a.addEventListener('loadedmetadata', () => done(isFinite(a.duration) ? a.duration : 0));
      a.addEventListener('error', () => done(0));
      setTimeout(() => done(isFinite(a.duration) ? a.duration : 0), 8000);
    });
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList).filter((f) => f.type.startsWith('audio/') || /\.(mp3|flac|wav|ogg|m4a|aac|opus|weba|wma)$/i.test(f.name));
    if (!files.length) { toast('Не найдено аудиофайлов'); return; }
    let added = 0;
    for (const file of files) {
      const { artist, title } = parseName(file.name);
      const tmpUrl = URL.createObjectURL(file);
      const duration = await getAudioDuration(tmpUrl);
      URL.revokeObjectURL(tmpUrl);
      const track = { id: uid(), title, artist, album: '', source: 'file', blob: file, duration, addedAt: Date.now(), liked: false };
      state.tracks.push(track);
      await dbPut('tracks', track);
      added++;
    }
    renderView();
    toast(added === 1 ? 'Трек добавлен' : `Добавлено треков: ${added}`);
  }

  async function addUrl(url) {
    url = url.trim();
    if (!url) return;
    let name = 'Аудио по ссылке';
    try { name = decodeURIComponent(url.split('/').pop().split('?')[0]) || name; } catch {}
    const { artist, title } = parseName(name);
    const duration = await getAudioDuration(url);
    const track = { id: uid(), title, artist, album: '', source: 'url', url, duration, addedAt: Date.now(), liked: false };
    state.tracks.push(track);
    await dbPut('tracks', track);
    renderView();
    toast('Трек добавлен по ссылке');
  }

  /* ============================================================
   * Context menu
   * ==========================================================*/
  function openCtx(e, trackId) {
    const menu = els.ctxMenu;
    menu.innerHTML = '';
    const track = getTrack(trackId);
    if (!track) return;

    addCtxItem(menu, 'Воспроизвести', () => {
      const list = currentViewTracks();
      const idx = list.findIndex((t) => t.id === trackId);
      if (idx >= 0) playFromView(idx);
    });
    addCtxItem(menu, track.liked ? 'Убрать из избранного' : 'В избранное', () => toggleLike(trackId));

    menu.appendChild(sep());
    const label = document.createElement('div');
    label.className = 'ctx__label';
    label.textContent = 'Добавить в плейлист';
    menu.appendChild(label);
    addCtxItem(menu, '+ Новый плейлист…', async () => {
      const pl = await promptPlaylist();
      if (pl) addToPlaylist(pl.id, trackId);
    });
    state.playlists.forEach((pl) => addCtxItem(menu, pl.name, () => addToPlaylist(pl.id, trackId)));

    if (state.view.type === 'playlist') {
      menu.appendChild(sep());
      addCtxItem(menu, 'Убрать из этого плейлиста', () => removeFromPlaylist(state.view.id, trackId), true);
    }
    menu.appendChild(sep());
    addCtxItem(menu, 'Удалить из медиатеки', () => deleteTrack(trackId), true);

    menu.hidden = false;
    const { innerWidth: w, innerHeight: h } = window;
    const rect = menu.getBoundingClientRect();
    let x = e.clientX, y = e.clientY;
    if (x + rect.width > w - 8) x = w - rect.width - 8;
    if (y + rect.height > h - 8) y = h - rect.height - 8;
    menu.style.left = Math.max(8, x) + 'px';
    menu.style.top = Math.max(8, y) + 'px';
  }
  function addCtxItem(menu, text, onClick, danger) {
    const item = document.createElement('div');
    item.className = 'ctx__item' + (danger ? ' ctx__item--danger' : '');
    item.setAttribute('role', 'menuitem');
    item.tabIndex = 0;
    item.textContent = text;
    item.addEventListener('click', () => { closeCtx(); onClick(); });
    menu.appendChild(item);
  }
  function sep() { const s = document.createElement('div'); s.className = 'ctx__sep'; return s; }
  function closeCtx() { els.ctxMenu.hidden = true; }

  /* ============================================================
   * Modals
   * ==========================================================*/
  function openModal(m) { m.hidden = false; }
  function closeModal(m) { m.hidden = true; }

  let promptResolve = null;
  function promptPlaylist() {
    els.promptTitle.textContent = 'Новый плейлист';
    els.promptInput.value = '';
    openModal(els.promptModal);
    setTimeout(() => els.promptInput.focus(), 50);
    return new Promise((resolve) => { promptResolve = resolve; });
  }

  /* ============================================================
   * Progress / volume bars
   * ==========================================================*/
  function barValueFromEvent(bar, clientX) {
    const rect = bar.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }
  function makeDraggable(bar, onChange) {
    let dragging = false;
    const move = (clientX) => onChange(barValueFromEvent(bar, clientX));
    bar.addEventListener('pointerdown', (e) => { dragging = true; bar.setPointerCapture(e.pointerId); move(e.clientX); });
    bar.addEventListener('pointermove', (e) => { if (dragging) move(e.clientX); });
    bar.addEventListener('pointerup', (e) => { dragging = false; try { bar.releasePointerCapture(e.pointerId); } catch {} });
    bar.addEventListener('keydown', (e) => {
      const cur = parseFloat(bar.getAttribute('aria-valuenow')) || 0;
      if (e.key === 'ArrowRight') { onChange(Math.min(1, cur / 100 + 0.05)); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { onChange(Math.max(0, cur / 100 - 0.05)); e.preventDefault(); }
    });
  }
  function setSeek(v) { if (isFinite(audio.duration)) audio.currentTime = v * audio.duration; }
  function setVol(v) { audio.muted = false; audio.volume = v; updateVolUI(); saveSettings(); }
  function updateVolUI() {
    const v = audio.muted ? 0 : audio.volume;
    els.volFill.style.width = (v * 100) + '%';
    els.volKnob.style.left = (v * 100) + '%';
    els.volBar.setAttribute('aria-valuenow', Math.round(v * 100));
    els.player.classList.toggle('is-muted', audio.muted || audio.volume === 0);
  }

  /* ============================================================
   * Events wiring
   * ==========================================================*/
  function wire() {
    // Nav
    $$('.nav__item[data-view]').forEach((b) => b.addEventListener('click', () => {
      $$('.nav__item').forEach((n) => n.classList.remove('is-active'));
      b.classList.add('is-active');
      openView({ type: b.dataset.view, id: null });
    }));
    $$('[data-action="add-music"]').forEach((b) => b.addEventListener('click', () => openModal(els.addModal)));

    els.newPlaylistBtn.addEventListener('click', async () => { await promptPlaylist(); });

    // Player controls
    els.playBtn.addEventListener('click', togglePlay);
    els.nextBtn.addEventListener('click', () => next(false));
    els.prevBtn.addEventListener('click', prev);
    els.shuffleBtn.addEventListener('click', () => {
      state.shuffle = !state.shuffle;
      els.shuffleBtn.classList.toggle('is-on', state.shuffle);
      const playingId = state.queue[state.queueIndex];
      if (playingId) buildQueue(playingId);
      saveSettings();
      toast(state.shuffle ? 'Перемешивание включено' : 'Перемешивание выключено');
    });
    els.repeatBtn.addEventListener('click', () => {
      state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
      els.repeatBtn.classList.toggle('is-on', state.repeat !== 'off');
      els.repeatBtn.classList.toggle('repeat-one', state.repeat === 'one');
      els.repeatBtn.title = state.repeat === 'one' ? 'Повтор трека' : state.repeat === 'all' ? 'Повтор всех' : 'Повтор';
      saveSettings();
      toast(state.repeat === 'off' ? 'Повтор выключен' : state.repeat === 'all' ? 'Повтор всех' : 'Повтор одного трека');
    });
    els.likeBtn.addEventListener('click', () => { const id = state.queue[state.queueIndex]; if (id) toggleLike(id); });
    els.muteBtn.addEventListener('click', () => { audio.muted = !audio.muted; updateVolUI(); saveSettings(); });

    makeDraggable(els.seekBar, setSeek);
    makeDraggable(els.volBar, setVol);

    // Audio events
    audio.addEventListener('timeupdate', () => {
      const d = audio.duration || 0;
      const p = d ? audio.currentTime / d : 0;
      els.seekFill.style.width = (p * 100) + '%';
      els.seekKnob.style.left = (p * 100) + '%';
      els.seekBar.setAttribute('aria-valuenow', Math.round(p * 100));
      els.curTime.textContent = fmtTime(audio.currentTime);
    });
    audio.addEventListener('loadedmetadata', () => {
      els.durTime.textContent = fmtTime(audio.duration);
      const id = state.queue[state.queueIndex];
      const t = getTrack(id);
      if (t && (!t.duration || Math.abs(t.duration - audio.duration) > 1) && isFinite(audio.duration)) {
        t.duration = audio.duration; dbPut('tracks', t); 
      }
    });
    audio.addEventListener('play', () => { els.player.classList.add('is-playing'); els.playBtn.setAttribute('aria-label', 'Пауза'); });
    audio.addEventListener('pause', () => { els.player.classList.remove('is-playing'); els.playBtn.setAttribute('aria-label', 'Play'); });
    audio.addEventListener('ended', () => next(true));

    // Search
    els.searchInput.addEventListener('input', () => { state.search = els.searchInput.value; renderView(); });

    // Add modal: dropzone
    els.dropzone.addEventListener('click', () => els.fileInput.click());
    els.dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fileInput.click(); } });
    els.fileInput.addEventListener('change', () => { if (els.fileInput.files.length) { addFiles(els.fileInput.files); closeModal(els.addModal); els.fileInput.value = ''; } });
    ['dragenter', 'dragover'].forEach((ev) => els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.add('is-drag'); }));
    ['dragleave', 'drop'].forEach((ev) => els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.remove('is-drag'); }));
    els.dropzone.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) { addFiles(e.dataTransfer.files); closeModal(els.addModal); } });

    // Also allow dropping anywhere on the page
    ['dragover', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); }));
    document.addEventListener('drop', (e) => {
      if (els.addModal.hidden && e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });

    els.urlForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const url = els.urlInput.value;
      if (url.trim()) { addUrl(url); els.urlInput.value = ''; closeModal(els.addModal); }
    });

    // Prompt form
    els.promptForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = els.promptInput.value;
      closeModal(els.promptModal);
      const pl = await createPlaylist(name);
      if (promptResolve) { promptResolve(pl); promptResolve = null; }
    });

    // Modal close
    $$('[data-close]').forEach((el) => el.addEventListener('click', () => {
      closeModal(els.addModal); closeModal(els.promptModal);
      if (promptResolve) { promptResolve(null); promptResolve = null; }
    }));

    // Global: close ctx / modals
    document.addEventListener('click', (e) => { if (!els.ctxMenu.hidden && !els.ctxMenu.contains(e.target)) closeCtx(); });
    document.addEventListener('scroll', closeCtx, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeCtx(); closeModal(els.addModal); closeModal(els.promptModal);
        if (promptResolve) { promptResolve(null); promptResolve = null; }
        closeSidebar();
      }
      if (e.key === ' ' && !isTyping(e.target)) { e.preventDefault(); togglePlay(); }
      if (e.key === 'ArrowRight' && e.altKey) next(false);
      if (e.key === 'ArrowLeft' && e.altKey) prev();
    });

    // Sidebar (mobile)
    els.menuBtn.addEventListener('click', openSidebar);
    els.scrim.addEventListener('click', closeSidebar);

    // Media session
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => audio.play());
      navigator.mediaSession.setActionHandler('pause', () => audio.pause());
      navigator.mediaSession.setActionHandler('nexttrack', () => next(false));
      navigator.mediaSession.setActionHandler('previoustrack', prev);
    }

    // Persist queue position on unload
    window.addEventListener('beforeunload', saveSettings);
  }

  function isTyping(el) { return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable); }

  function openView(view) {
    state.view = view;
    if (window.innerWidth <= 700) closeSidebar();
    renderPlaylists();
    renderView();
    const content = $('#content');
    if (content) content.scrollTop = 0;
  }
  function openSidebar() { els.sidebar.classList.add('is-open'); els.scrim.hidden = false; }
  function closeSidebar() { els.sidebar.classList.remove('is-open'); els.scrim.hidden = true; }

  /* ============================================================
   * Init
   * ==========================================================*/
  async function init() {
    // restore settings
    audio.volume = typeof settings.volume === 'number' ? settings.volume : 1;
    audio.muted = !!settings.muted;
    state.shuffle = !!settings.shuffle;
    state.repeat = settings.repeat || 'off';
    els.shuffleBtn.classList.toggle('is-on', state.shuffle);
    els.repeatBtn.classList.toggle('is-on', state.repeat !== 'off');
    els.repeatBtn.classList.toggle('repeat-one', state.repeat === 'one');
    updateVolUI();

    wire();

    try {
      const [tracks, playlists] = await Promise.all([dbAll('tracks'), dbAll('playlists')]);
      state.tracks = tracks.sort((a, b) => a.addedAt - b.addedAt);
      state.playlists = playlists.sort((a, b) => b.createdAt - a.createdAt);
    } catch (err) {
      console.error('DB load failed', err);
      toast('Не удалось загрузить сохранённую музыку');
    }

    renderPlaylists();
    renderView();
  }

  init();
})();
