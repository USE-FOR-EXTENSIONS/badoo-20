// Minimal content script for "nearby-only" extension
// Purpose: When Badoo Nearby tab/page is active, auto-scroll the nearby grid
// and extract name/age (and an image URL) from each profile. Send batches to
// background to persist under `nearby_only_profiles`.

(function(){
  const LOG = (...args) => console.debug('[nearby-only]', ...args);
  const NEARBY_TAB_SELECTOR = '#tabbar > nav > button:nth-child(2)';
  let __nearby_only_should_stop = false;

  function emulateSwipe(container, direction = 'down'){
    try{
      // container may be element or document
      const target = (container && container !== window) ? container : document.scrollingElement || document.documentElement;
      const rect = (target.getBoundingClientRect && target.getBoundingClientRect()) || {left:0, top:0, width: window.innerWidth, height: window.innerHeight};
      const startX = rect.left + (rect.width/2);
      const startY = rect.top + (rect.height * 0.8);
      const endY = rect.top + (rect.height * 0.2);
      const steps = 8;
      // dispatch pointer events if supported
      const supportsPointer = typeof window.PointerEvent === 'function';
      if(supportsPointer){
        const id = Date.now() % 65536;
        const down = new PointerEvent('pointerdown', {bubbles:true,cancelable:true,pointerId:id,clientX:startX,clientY:startY,isPrimary:true});
        target.dispatchEvent(down);
        for(let i=1;i<=steps;i++){
          const t = i/steps;
          const y = startY + (endY - startY) * t;
          const move = new PointerEvent('pointermove', {bubbles:true,cancelable:true,pointerId:id,clientX:startX,clientY:Math.floor(y),isPrimary:true});
          target.dispatchEvent(move);
        }
        const up = new PointerEvent('pointerup', {bubbles:true,cancelable:true,pointerId:id,clientX:startX,clientY:endY,isPrimary:true});
        target.dispatchEvent(up);
      } else {
        // fallback to mouse events
        const mdown = new MouseEvent('mousedown', {bubbles:true,cancelable:true,clientX:startX,clientY:startY});
        target.dispatchEvent(mdown);
        for(let i=1;i<=steps;i++){
          const t = i/steps;
          const y = startY + (endY - startY) * t;
          const move = new MouseEvent('mousemove', {bubbles:true,cancelable:true,clientX:startX,clientY:Math.floor(y)});
          target.dispatchEvent(move);
        }
        const mup = new MouseEvent('mouseup', {bubbles:true,cancelable:true,clientX:startX,clientY:endY});
        target.dispatchEvent(mup);
      }
      // ensure scroll has some effect as fallback
      try{ target.scrollBy && target.scrollBy(0, endY - startY); }catch(e){}
      return true;
    }catch(e){ LOG('emulateSwipe failed', e); return false; }
  }

  function findNearbyUL(){
    // Prefer the full page-container path the user provided, it's the most specific
    return document.querySelector('#page-container > div > div > div:nth-child(3) > div.people-nearby__content > div:nth-child(1) > ul')
      || document.querySelector('ul.csms-user-list')
      || document.querySelector('ul[class*="csms-user-list"]')
      || document.querySelector('div.people-nearby__content ul')
      || null;
  }

  function getText(el){ try{ return (el && (el.innerText||el.textContent)||'').trim(); }catch(e){return ''; } }

  function extractFromItem(it){
    try{
      const btn = it.querySelector('button[data-qa-user-id]') || it.querySelector('button');
      const id = btn ? (btn.getAttribute('data-qa-user-id')||'') : '';
      const nameEl = it.querySelector('.csms-profile-info__name-inner') || it.querySelector('[data-qa="profile-info__name"]') || null;
      const ageEl = it.querySelector('[data-qa="profile-info__age"]') || it.querySelector('.csms-profile-info__age') || null;
      const imgEl = it.querySelector('.csms-avatar__image') || it.querySelector('img') || null;
      const name = nameEl ? getText(nameEl) : '';
      const age = ageEl ? getText(ageEl).replace(/^,\s*/,'') : '';
      let image = imgEl ? (imgEl.src || imgEl.getAttribute('src') || '') : '';
      if(image && image.startsWith('//')) image = window.location.protocol + image;
      if(!name && !age && !image) return null;
      return { id: id||'', name: name||'', age: age||'', image: image||'' };
    }catch(e){ return null; }
  }

  function extractVisibleProfiles(){
    const list = findNearbyUL();
    const out = [];
    const seen = new Set();
    if(!list) return out;
    const items = Array.from(list.querySelectorAll('li.csms-user-list__item, li'));
    for(const it of items){
      const p = extractFromItem(it);
      if(!p) continue;
      const key = p.id ? ('id:'+p.id) : ((p.name||'')+'||'+(p.age||''));
      if(seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
    return out;
  }

  function getScrollableAncestor(el){
    if(!el) return document.scrollingElement || document.documentElement || window;
    let cur = el;
    while(cur && cur !== document.body && cur !== document.documentElement){
      try{
        const style = window.getComputedStyle(cur);
        if((cur.scrollHeight && cur.clientHeight && cur.scrollHeight > cur.clientHeight) || (style && (style.overflowY==='auto' || style.overflowY==='scroll'))){
          return cur;
        }
      }catch(e){}
      cur = cur.parentElement;
    }
    return document.scrollingElement || document.documentElement || window;
  }

  function sendBatch(profiles){
    if(!profiles || !profiles.length) return;
    try{ chrome.runtime.sendMessage({type:'nearby_only_profiles', profiles}); }catch(e){ LOG('sendBatch error', e); }
  }

  async function autoScrollAndCollect(opts = {}){
    const cfg = Object.assign({maxSteps:120, stepDelay:650, stopIfNoNew:6, emulatePointer: false}, opts||{});
    const list = findNearbyUL();
    if(!list){ LOG('nearby list not found, aborting'); return []; }
    const container = getScrollableAncestor(list);
    const collected = [];
    const seen = new Set();
    let lastCount = 0, noNew = 0;

    for(let step=0; step<cfg.maxSteps; step++){
      if(__nearby_only_should_stop){ LOG('stop requested, aborting'); break; }
      const found = extractVisibleProfiles();
      LOG('step', step, 'found', found.length, 'collected', collected.length);
      for(const p of found){
        const key = p.id ? ('id:'+p.id) : ((p.name||'')+'||'+(p.age||''));
        if(seen.has(key)) continue;
        seen.add(key);
        collected.push(p);
      }
      if(found.length) sendBatch(found);
      if(collected.length > lastCount){ lastCount = collected.length; noNew = 0; }
      else noNew++;

      // if we see no new items for a few steps, try pointer emulation swipe and continue
      if(cfg.emulatePointer && noNew >= Math.max(2, Math.floor(cfg.stopIfNoNew/2))){
        LOG('no new items, trying pointer emulation swipe');
        emulateSwipe(container, 'down');
        // allow some time to load
        await new Promise(r => setTimeout(r, Math.max(300, cfg.stepDelay/2)));
        noNew = 0; // reset and continue
        continue;
      }

      if(noNew >= cfg.stopIfNoNew) break;

      // try to scroll
      try{
        if(container && typeof container.scrollTop === 'number' && container.scrollHeight && container.clientHeight){
          container.scrollTop = Math.min(container.scrollTop + (container.clientHeight || window.innerHeight), Math.max(0, container.scrollHeight - (container.clientHeight || window.innerHeight)));
        } else {
          window.scrollBy(0, Math.max(window.innerHeight * 0.8, 300));
        }
      }catch(e){ try{ window.scrollBy(0, Math.max(window.innerHeight * 0.8, 300)); }catch(_){} }

      await new Promise(r => setTimeout(r, cfg.stepDelay));
    }

    if(collected.length) { LOG('final send', collected.length); sendBatch(collected); }
    LOG('autoScrollAndCollect finished', collected.length);
    return collected;
  }

  // Auto-start when on nearby page or when nearby tab is clicked
  try{
    if(/people[-_]nearby|people-nearby|people\/nearby|nearby/.test(location.pathname+location.href)){
      setTimeout(()=>autoScrollAndCollect(), 800);
    }
  }catch(e){}

  document.addEventListener('click', (ev)=>{
    try{ const btn = ev.target.closest && ev.target.closest(NEARBY_TAB_SELECTOR); if(btn) setTimeout(()=>autoScrollAndCollect(), 700); }catch(e){}
  }, true);

  // respond to messages to start explicitly
  try{
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      try{
      if(!msg) return;
      if(msg.type === 'start_nearby_only'){
        __nearby_only_should_stop = false;
        autoScrollAndCollect(msg.cfg || {});
        sendResponse({started:true});
        return true;
      }
      if(msg.type === 'stop_nearby_only'){
        __nearby_only_should_stop = true;
        sendResponse({stopped:true});
        return true;
      }
      if(msg.type === 'start_nearby_click_and_scrape'){
        __nearby_only_should_stop = false;
        startClickAndScrape(msg.cfg || {});
        sendResponse({started:true});
        return true;
      }
      }catch(e){ LOG('onMessage error', e); }
    });
  }catch(e){}

  // --- Click-through scraping (open each profile, scrape, close) ---
  let __nearby_click_running = false;

  function createMouseIndicator(){
    let el = document.getElementById('__nearby_only_mouse');
    if(el) return el;
    el = document.createElement('div');
    el.id = '__nearby_only_mouse';
    el.style.position = 'fixed';
    el.style.zIndex = 9999999;
    el.style.width = '16px';
    el.style.height = '16px';
    el.style.border = '3px solid rgba(0,150,136,0.95)';
    el.style.borderRadius = '50%';
    el.style.background = 'rgba(0,150,136,0.12)';
    el.style.pointerEvents = 'none';
    el.style.transition = 'left 0.18s linear, top 0.18s linear';
    document.documentElement.appendChild(el);
    return el;
  }

  function moveMouseIndicatorTo(x,y){
    const el = createMouseIndicator();
    el.style.left = (x - 8) + 'px';
    el.style.top = (y - 8) + 'px';
  }

  function synthesizeMouseEvent(target, type, clientX, clientY){
    try{
      const ev = new MouseEvent(type, {view: window, bubbles: true, cancelable: true, clientX, clientY, button: 0});
      target.dispatchEvent(ev);
    }catch(e){ /* ignore */ }
  }

  async function moveAndClickElement(el){
    if(!el) return false;
    const rect = el.getBoundingClientRect();
    const cx = Math.floor(rect.left + rect.width/2);
    const cy = Math.floor(rect.top + rect.height/2);
    try{ el.scrollIntoView({behavior:'auto', block:'center', inline:'center'}); }catch(e){}
    moveMouseIndicatorTo(cx, cy);
    await new Promise(r => setTimeout(r, 180));
    try{
      el.focus && el.focus();
      synthesizeMouseEvent(el, 'mousemove', cx, cy);
      synthesizeMouseEvent(el, 'mouseover', cx, cy);
      synthesizeMouseEvent(el, 'mousedown', cx, cy);
      synthesizeMouseEvent(el, 'click', cx, cy);
      synthesizeMouseEvent(el, 'mouseup', cx, cy);
    }catch(e){ LOG('click synth error', e); }
    await new Promise(r => setTimeout(r, 280));
    return true;
  }

  async function waitForProfileOpen(timeout = 2200){
    const start = Date.now();
    const selectors = ['[data-qa="profile-page"]', '.csms-profile-page', '.profile-page', '.user-profile', '.profile-modal', '[data-qa="user-profile"]'];
    while(Date.now() - start < timeout){
      for(const s of selectors){
        const el = document.querySelector(s);
        if(el) return el;
      }
      await new Promise(r => setTimeout(r, 150));
    }
    return null;
  }

  async function loadAllProfileGallery(root, {maxSteps=12, stepDelay=300} = {}){
    try{
      // Prefer the exact scroller selector provided by user; fallback to common gallery/container selectors
      const preferred = '#app-root > div > div.modal-container > div > div > div > div > div > div > div > div > div > div.profile-card-full__content > div > div.profile-card__content-scroller > div > div';
      const selectors = [preferred, '.csms-profile-media', '.profile-photos', '.csms-gallery', '.gallery', '.multimedia', '.multimedia-list', '.photo-gallery', '[data-qa="media"]'];
      let container = null;
      for(const s of selectors){ try{ const el = root.querySelector(s); if(el){ container = el; break; } }catch(e){}
      }
      if(!container) container = root;
      const seen = new Set();
      let noNew = 0;
      for(let step=0; step<maxSteps; step++){
        // collect images (from <img> and from background-image styles)
        const imgs = Array.from(container.querySelectorAll('img')).map(i=>i.src||i.getAttribute('src')||'').filter(Boolean);
        // also find elements with background-image style
        try{
          const elems = Array.from(container.querySelectorAll('*'));
          for(const el of elems){
            try{
              const style = el.style && el.style.backgroundImage ? el.style.backgroundImage : '';
              let bg = style || '';
              if(!bg){ const cs = window.getComputedStyle && window.getComputedStyle(el); if(cs) bg = cs.backgroundImage || ''; }
              if(bg && bg !== 'none'){
                const m = /url\(["']?(.*?)["']?\)/.exec(bg);
                if(m && m[1]) imgs.push(m[1]);
              }
            }catch(e){}
          }
        }catch(e){}
        let added = 0;
        for(const u of imgs){ if(u && !seen.has(u)){ seen.add(u); added++; } }
        if(added === 0) noNew++; else noNew = 0;
        if(noNew >= 3) break;
        // try to advance gallery: prefer pointer emulation on the actual scroller, otherwise click next or scroll
        let advanced = false;
        try{
          // pointer emulation: dispatch pointer events across the container to trigger virtual scrollers
          if(typeof PointerEvent === 'function'){
            const rect = container.getBoundingClientRect();
            const startX = Math.floor(rect.left + rect.width * 0.8);
            const startY = Math.floor(rect.top + rect.height / 2);
            const endX = Math.floor(rect.left + rect.width * 0.2);
            const id = Date.now() % 65536;
            container.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true,cancelable:true,pointerId:id,clientX:startX,clientY:startY}));
            const steps = 6;
            for(let s=1;s<=steps;s++){ const t = s/steps; const x = Math.floor(startX + (endX-startX)*t); container.dispatchEvent(new PointerEvent('pointermove', {bubbles:true,cancelable:true,pointerId:id,clientX:x,clientY:startY})); }
            container.dispatchEvent(new PointerEvent('pointerup', {bubbles:true,cancelable:true,pointerId:id,clientX:endX,clientY:startY}));
            advanced = true;
          }
        }catch(e){ advanced = false; }
        if(!advanced){
          // try container-local next buttons first
          const nextBtnLocal = container.querySelector('button[aria-label*="next" i], button[title*="Next" i], .next, .gallery-next, .slick-next, button[data-action*="next"]');
          if(nextBtnLocal){ try{ nextBtnLocal.click(); advanced = true; }catch(e){} }
          // if not found, try document-level next buttons (some galleries render arrows outside the immediate container)
          if(!advanced){
            const nextBtnGlobal = document.querySelector('button[aria-label*="next" i], button[title*="Next" i], .swiper-button-next, .gallery-next, .slick-next, .csms-gallery__next');
            if(nextBtnGlobal){ try{ nextBtnGlobal.click(); advanced = true; }catch(e){} }
          }
          // fallback: try to send keyboard ArrowRight to advance gallery
          if(!advanced){
            try{
              const ev = new KeyboardEvent('keydown', {key:'ArrowRight', code:'ArrowRight', keyCode:39, which:39, bubbles:true, cancelable:true});
              const target = document.activeElement || document.body || document;
              target.dispatchEvent(ev);
              advanced = true;
            }catch(e){}
          }
        }
        if(!advanced){
          try{
            if(typeof container.scrollLeft === 'number' && container.scrollWidth > container.clientWidth){ container.scrollLeft += Math.max(container.clientWidth*0.7, 200); }
            else if(typeof container.scrollTop === 'number' && container.scrollHeight > container.clientHeight){ container.scrollTop += Math.max(container.clientHeight*0.7, 200); }
            else { window.scrollBy(0, 200); }
          }catch(e){ try{ window.scrollBy(0, 200); }catch(e){} }
        }
        await new Promise(r => setTimeout(r, stepDelay));
      }
      return Array.from(seen);
    }catch(e){ return []; }
  }

  async function scrapeOpenProfile(){
    try{
      const root = document.querySelector('[data-qa="profile-page"]') || document.querySelector('.csms-profile-page') || document.querySelector('.profile-page') || document.querySelector('.user-profile') || document.body;
      const nameEl = root.querySelector('.csms-profile-info__name-inner') || root.querySelector('[data-qa="profile-info__name"]') || root.querySelector('h1') || null;
      const ageEl = root.querySelector('[data-qa="profile-info__age"]') || root.querySelector('.profile-age') || null;
      // Location: look for the user-section/location block the user provided
      const locSection = root.querySelector('[data-qa="location"]') || root.querySelector('.user-section[data-qa="location"]') || root.querySelector('[data-qa-user-section-last]');
      let locationText = '';
      try{ if(locSection){ const textEl = locSection.querySelector('.csms-view-profile-block__header-text') || locSection.querySelector('.csms-header-2') || locSection; locationText = textEl ? ((textEl.innerText || textEl.textContent || '').trim()) : ''; } }catch(e){ locationText = ''; }
      // attempt to open fullscreen gallery (double-click) and load/scroll it to reveal more images
      let imgs = [];
      try{
        // attempt to open fullscreen/gallery modal by double-clicking the main image or first thumbnail
        try{
          const mainImg = root.querySelector('img') || document.querySelector('img.csms-avatar__image');
          if(mainImg){
            try{ const ev = new MouseEvent('dblclick', {view: window, bubbles: true, cancelable: true, clientX: mainImg.getBoundingClientRect().left + 2, clientY: mainImg.getBoundingClientRect().top + 2}); mainImg.dispatchEvent(ev); }catch(e){}
            // some galleries need an extra click
            try{ mainImg.click(); }catch(e){}
          }
        }catch(e){}
        // wait briefly for potential modal/gallery to appear
        const modal = await (async function waitForModal(timeout=1600){
          const start = Date.now();
          const selectors = ['.csms-modal', '.modal', '.profile-gallery-modal', '.gallery-modal', '.profile-photos-modal', '.csms-profile-media__modal', '.profile-card-full__gallery'];
          while(Date.now() - start < timeout){
            for(const s of selectors){ const el = document.querySelector(s); if(el) return el; }
            await new Promise(r=>setTimeout(r, 150));
          }
          return null;
        })();
        const galleryRoot = modal || root;
        imgs = await loadAllProfileGallery(galleryRoot, {maxSteps:18, stepDelay:300});
      }catch(e){ imgs = []; }
      // fallback: gather any images in the profile view
      if(!imgs || !imgs.length){ imgs = Array.from(root.querySelectorAll('img')).map(i=> i.src || i.getAttribute('src') || '').filter(Boolean); }
      const idBtn = root.querySelector('button[data-qa-user-id]') || document.querySelector('button[data-qa-user-id]');
      const id = idBtn ? (idBtn.getAttribute('data-qa-user-id')||'') : '';
      const name = nameEl ? (nameEl.innerText || nameEl.textContent || '').trim() : '';
      const age = ageEl ? (ageEl.innerText || ageEl.textContent || '').trim().replace(/^,\s*/,'') : '';
      // dedupe and normalize images
      const uniq = Array.from(new Set(imgs)).map(u => (u && u.startsWith('//')) ? window.location.protocol + u : u).filter(Boolean);
      return { id, name, age, images: uniq.slice(0,200), location: locationText };
    }catch(e){ LOG('scrapeOpenProfile error', e); return null; }
  }

  function closeProfileView(){
    try{
      const closeButtons = Array.from(document.querySelectorAll('button[aria-label*="close" i], button[title*="Close" i], button.csms-close, .csms-modal__close'));
      for(const b of closeButtons){ try{ b.click(); return true; }catch(e){} }
      document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', keyCode:27, which:27, bubbles:true}));
      try{ history.back(); }catch(e){}
    }catch(e){}
    return false;
  }

  async function clickAndScrapeNearby(cfg = {}){
    if(__nearby_click_running) return;
    __nearby_click_running = true;
    try{
      const list = findNearbyUL();
      if(!list){ LOG('clickAndScrapeNearby: nearby list not found'); __nearby_click_running = false; return; }
      const items = Array.from(list.querySelectorAll('li.csms-user-list__item, li'));
      LOG('clickAndScrapeNearby items', items.length);
      const results = [];
      let count = 0;
      for(const it of items){
        if(__nearby_only_should_stop) break;
        if(count >= (cfg.maxProfiles || 500)) break;
        const img = it.querySelector('.csms-avatar__image') || it.querySelector('img');
        const clickTarget = img || it.querySelector('button[data-qa-user-id]') || it.querySelector('button');
        if(!clickTarget) continue;
        await moveAndClickElement(clickTarget);
        const opened = await waitForProfileOpen(cfg.openTimeout || 2000);
        if(opened){
          await new Promise(r => setTimeout(r, 200));
          // try to open fullscreen gallery and scrape all images
          const data = await scrapeOpenProfile();
          if(data){
            LOG('scraped', data.name || data.id, data.images && data.images.length);
            results.push(data);
            try{ chrome.runtime.sendMessage({type:'nearby_only_profiles', profiles: [ { id: data.id||'', name: data.name||'', age: data.age||'', image: (data.images && data.images[0])||'', images: data.images||[], location: data.location||'' } ]}); }catch(e){}
          }
          closeProfileView();
        } else {
          LOG('profile not opened');
        }
        count++;
        await new Promise(r => setTimeout(r, cfg.perProfileDelay || 600));
      }
      LOG('clickAndScrapeNearby finished', results.length);
    }catch(e){ LOG('clickAndScrapeNearby error', e); }
    __nearby_click_running = false;
  }

  function startClickAndScrape(cfg){ try{ clickAndScrapeNearby(cfg || {}); }catch(e){ LOG('startClickAndScrape', e); } }

})();
