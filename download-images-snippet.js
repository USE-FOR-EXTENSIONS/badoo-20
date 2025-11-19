// Console snippet: copy & paste into the page DevTools Console and run `runAll()`.
// It uses three selectors provided by the user to open profiles, open the gallery,
// extract image URLs, and download them.

(function(){
  const FIRST = "#page-container > div > div > div:nth-child(3) > div.people-nearby__content > div:nth-child(1) > ul > li:nth-child(1) > div > button > span.csms-user-list-cell__content > span.csms-user-list-cell__media > span > span > span > span > span";
  const SECOND = "#app-root > div > div.modal-container > div > div > div > div > div > div > div > div > div.profile-card-full__content > div > div.profile-card__content-scroller > div > div > div:nth-child(1) > button";
  const THIRD = "#fullscreen-gallery > div.slider-gallery > div.slider-gallery-pages.is-horizontal.is-animated > div:nth-child(2)";
  // New scrollbar selector (profile content scroller) provided by user — used to scroll
  const SCROLLBAR = "#app-root > div > div.modal-container > div > div > div > div > div > div > div > div > div > div.profile-card-full__content > div > div.profile-card__scroll-bar.profile-card__scroll-bar--centered";

  function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

  function waitForSelector(selector, timeout = 5000){
    return new Promise(resolve => {
      const start = Date.now();
      const iv = setInterval(() => {
        const el = document.querySelector(selector);
        if(el){ clearInterval(iv); resolve(el); }
        if(Date.now() - start > timeout){ clearInterval(iv); resolve(null); }
      }, 200);
    });
  }

  async function downloadUrl(url, filename){
    try{
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || '';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }catch(e){ console.warn('download failed', e, url); }
  }

  function extractUrlsFromGallery(gallery){
    if(!gallery) return [];
    const imgs = Array.from(gallery.querySelectorAll('img'));
    const srcs = imgs.map(i => i.src || i.getAttribute('data-src') || i.getAttribute('data-lazy'))
                   .filter(Boolean);
    if(srcs.length) return srcs;
    // fallback: search for background-image
    const slides = Array.from(gallery.querySelectorAll('div'));
    const bg = [];
    slides.forEach(s => {
      const style = s && s.style && s.style.backgroundImage;
      if(style){
        const m = style.match(/url\(["']?(.*?)["']?\)/);
        if(m && m[1]) bg.push(m[1]);
      }
    });
    return bg;
  }

  async function openProfileAndDownload(el, idx){
    el.scrollIntoView({block:'center'});
    await sleep(300);
    el.click();
    await sleep(600);
    // Try to find the profile scrollbar and scroll it to load all images
    const scroller = await waitForSelector(SCROLLBAR, 3000);
    let urls = [];
    if(scroller){
      // Scroll the scroller element progressively and collect images
      const collected = new Set();
      const maxSteps = 40;
      let lastCount = 0;
      for(let step=0; step<maxSteps; step++){
        // collect current images inside scroller
        Array.from(scroller.querySelectorAll('img')).forEach(img => {
          const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy');
          if(src) collected.add(src);
        });
        // also check background-images in children
        Array.from(scroller.querySelectorAll('div')).forEach(d => {
          const style = d && d.style && d.style.backgroundImage;
          if(style){
            const m = style.match(/url\(["']?(.*?)["']?\)/);
            if(m && m[1]) collected.add(m[1]);
          }
        });

        // attempt scroll further
        try{
          scroller.scrollTop = scroller.scrollTop + Math.max(scroller.clientHeight, 300);
        }catch(e){ /* ignore */ }
        await sleep(400);
        if(collected.size === lastCount){
          // no new images — try a couple more iterations then break
          if(step >= maxSteps - 3) break;
        }
        lastCount = collected.size;
      }
      urls = Array.from(collected);
    } else {
      // Fallback: if scroller not found, try opening gallery as before
      const btn = await waitForSelector(SECOND, 3000);
      if(btn){ btn.click(); }
      await sleep(700);
      const gallery = await waitForSelector('#fullscreen-gallery', 4000);
      if(gallery){
        await sleep(400);
        urls = extractUrlsFromGallery(gallery);
        if(!urls.length){
          const special = document.querySelector(THIRD);
          const specialImgs = special ? Array.from(special.querySelectorAll('img')).map(i=>i.src).filter(Boolean) : [];
          if(specialImgs.length) urls.push(...specialImgs);
        }
      } else {
        console.warn('No gallery or scroller for item', idx+1);
        document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', keyCode:27, which:27}));
        await sleep(300);
        return;
      }
    }
    if(!urls.length){ console.warn('No images found in gallery for item', idx+1); }
    for(let i=0;i<urls.length;i++){
      const url = urls[i];
      let ext = '';
      try{ ext = (new URL(url)).pathname.split('.').pop().split('?')[0]; }catch(e){ ext = 'jpg'; }
      const filename = `badoo_profile_${idx+1}_img_${i+1}.${ext}`;
      await downloadUrl(url, filename);
      await sleep(250);
    }
    // close gallery/modal
    document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', keyCode:27, which:27}));
    await sleep(400);
  }

  async function runAll(){
    const els = Array.from(document.querySelectorAll(FIRST));
    console.log('Found', els.length, 'elements matching FIRST selector');
    for(let i=0;i<els.length;i++){
      try{
        await openProfileAndDownload(els[i], i);
      }catch(e){ console.error('Error processing item', i+1, e); }
      await sleep(350);
    }
    console.log('Finished processing', els.length, 'items');
  }

  // Expose to window for interactive use
  window.runAll = runAll;
  window.downloadImagesSnippet = { runAll };
  console.log('download-images-snippet ready — call `runAll()` to start.');
})();
