const $ = id => document.getElementById(id);
const status = $('status');
function setStatus(s){ if(status) status.textContent = s; }

async function sendToActive(msg){
  try{
    const [tab] = await chrome.tabs.query({active:true,lastFocusedWindow:true});
    if(!tab) return setStatus('No active tab');
    chrome.tabs.sendMessage(tab.id, msg, (resp)=>{
      if(chrome.runtime.lastError){
        setStatus('Injecting content script...');
        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-script.js'] }).then(()=>{
          setTimeout(()=> chrome.tabs.sendMessage(tab.id, msg, (r)=>{ if(chrome.runtime.lastError) setStatus('Error: '+(chrome.runtime.lastError.message||'')); else setStatus('Sent'); }), 300);
        }).catch(e => setStatus('Injection failed'));
      } else setStatus('Sent');
    });
  }catch(e){ setStatus('send error'); }
}

$('start').addEventListener('click', async ()=>{ setStatus('Starting...'); await sendToActive({type:'start_profile_scrape', cfg:{}}); });
$('stop').addEventListener('click', async ()=>{ setStatus('Stopping...'); await sendToActive({type:'stop_profile_scrape'}); });
$('exportAll').addEventListener('click', async ()=>{
  setStatus('Exporting...');
  chrome.runtime.sendMessage({type:'export_profile_images', mode:'all'}, (resp)=>{ if(resp && resp.started) setStatus('Export started'); else setStatus('Export request sent'); });
});
