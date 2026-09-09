// Record the browser-selected tab or screen locally, including its HTML overlays.
export function setupKitchenRecording(){
  const button=document.getElementById('record-kitchen'),label=document.getElementById('record-label'),elapsed=document.getElementById('record-time'),note=document.getElementById('recording-note'),status=document.getElementById('recording-status'),download=document.getElementById('recording-download');
  let phase='idle',stream=null,recorder=null,timer=null,chunks=[],recordingUrl='',startedAt=0,clockStart=0,failure='',leaving=false;
  const supported=()=>!!navigator.mediaDevices?.getDisplayMedia&&typeof MediaRecorder!=='undefined';
  function controls(next){
    phase=next;button.dataset.state=next;button.disabled=next==='picking'||next==='stopping';
    const name=next==='recording'?'Stop recording':next==='picking'?'Choose a tab…':next==='stopping'?'Preparing recording…':'Record kitchen';
    label.textContent=name;button.setAttribute('aria-label',name);button.setAttribute('aria-pressed',String(next==='recording'));
    elapsed.hidden=next!=='recording';
  }
  function message(text){status.textContent=text;note.hidden=!text&&!recordingUrl;download.hidden=!recordingUrl;}
  function releaseCapture(){
    clearInterval(timer);timer=null;
    for(const track of stream?.getTracks()||[])track.stop();
    stream=null;
  }
  function updateTime(){
    const seconds=Math.floor((performance.now()-clockStart)/1000);
    elapsed.textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  }
  function finish(){
    releaseCapture();
    if(leaving){chunks=[];return;}
    const mime=recorder?.mimeType||'video/webm',blob=new Blob(chunks,{type:mime});
    chunks=[];recorder=null;controls('idle');
    if(blob.size){
      if(recordingUrl)URL.revokeObjectURL(recordingUrl);
      recordingUrl=URL.createObjectURL(blob);download.href=recordingUrl;
      download.download=`agenttrail-kitchen-${new Date(startedAt).toISOString().replace(/[:.]/g,'-')}.webm`;
      download.textContent=failure?'Download partial recording':'Download recording';
      message(failure?'Recording stopped unexpectedly. The captured portion is ready.':'Recording ready. Download it before closing this tab.');
    }else message(failure||'No video was captured. Choose the kitchen tab and try again.');
  }
  function stop(){
    if(phase!=='recording')return;
    controls('stopping');
    if(recorder?.state!=='inactive')recorder.stop();
    releaseCapture();
  }
  async function start(){
    if(!supported()){message('This browser cannot record a screen. Open the kitchen in Chrome or another browser with screen recording support.');return;}
    const mimeType=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
    if(!mimeType){message('This browser cannot save WebM recordings. Open the kitchen in Chrome to record.');return;}
    controls('picking');message('Choose this kitchen tab in the browser’s share picker. Audio stays off.');
    try{
      stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:30,max:30}},audio:false,preferCurrentTab:true});
      if(leaving){releaseCapture();return;}
      const tracks=stream.getVideoTracks();
      if(!tracks.some(track=>track.readyState==='live'))throw new Error('No live video');
      chunks=[];failure='';recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:6_000_000});
      recorder.ondataavailable=event=>{if(event.data.size&&!leaving)chunks.push(event.data);};
      recorder.onstop=finish;
      recorder.onerror=()=>{failure='The browser could not finish this recording.';stop();};
      for(const track of tracks)track.addEventListener('ended',stop,{once:true});
      recorder.start(1000);startedAt=Date.now();clockStart=performance.now();
      controls('recording');updateTime();timer=setInterval(updateTime,1000);note.hidden=true;
    }catch(error){
      releaseCapture();recorder=null;chunks=[];controls('idle');
      message(error.name==='NotAllowedError'||error.name==='AbortError'?'Recording was not started. You can choose a tab and try again.':error.name==='NotReadableError'?'The browser could not access the selected screen. Check screen recording access and try again.':'Recording could not start. Keep this tab focused and try again.');
    }
  }
  button.title='Record this kitchen tab to a local video. Choose the tab in the browser’s share picker.';
  button.addEventListener('click',()=>{if(phase==='recording')stop();else if(phase==='idle')void start();});
  window.addEventListener('beforeunload',event=>{if(phase==='recording'||phase==='stopping'){event.preventDefault();event.returnValue='';}});
  window.addEventListener('pagehide',()=>{leaving=true;if(recorder?.state==='recording')recorder.stop();releaseCapture();if(recordingUrl)URL.revokeObjectURL(recordingUrl);});
  controls('idle');
}
