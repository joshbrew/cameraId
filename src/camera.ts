
//@ts-ignore
import camHTML from './camera.html'
import { CameraPreview, CameraPreviewOptions } from '@capacitor-community/camera-preview'
import { downloadMP4URL, isMobile } from './util/utils';
import { initVideoProcessingThreads } from './camThreads';

export async function setupCamUI(parentElement=document.body) {
  
  //https://github.com/capacitor-community/camera-preview
  const cameraPreviewOptions: CameraPreviewOptions = {
    parent:'webcam', //web only
    position: 'rear', //mobile only

    //previewDims
    width: 3840, //480,//352,//3840, //should restrict to max available size 
    height: 2160,  // 360,//240,//

    enableZoom: true
    //enableOpacity: true //AR-friendly mode
  };
  
  //values set for the squeezeNet result
  let outputWidth = 244;
  let outputHeight = 244;
  let decoderPool = 4;
  

  const onMobile = isMobile();
  const Cam = CameraPreview;
  parentElement.insertAdjacentHTML('afterbegin',camHTML);
  
  //appended by CameraPreview
  const {
    poolingThread, 
    videoDecoderThread, 
    canvasThread, 
    classifierThread
  } = await initVideoProcessingThreads(decoderPool);

  
  let savedFrames = [] as any[];
  let classifierWait:Promise<any>|undefined;

  let threadRunning = false;
  let poolCt = 0;
  let poolCtMax = decoderPool-2; //4 codec threads

  const TempCaptures = {};
  const TempCanvases = {};
  const TempResults = {};
  const TempCaptureOrder = [] as any[];
  const TempCaptureLimit = 25;
  

  classifierThread.addCallback((res)=>{
    if(!res) return;
    console.timeEnd(`capture and inference ${res.name}`);
    console.log('classifier thread result: ', res);
    TempResults[res.name] = res;
    setCapture(res.name,'image',res);
    poolCt--;
  });

  videoDecoderThread.addCallback((res)=>{console.log('videoDecoderThread thread result: ', res);});
  poolingThread.addCallback((res)=>{console.log('poolingThread result:',res)});


  let offscreen = new OffscreenCanvas(outputWidth, outputHeight);
  let ctx = offscreen.getContext('2d');

  let processFrames = async (isVideo:boolean) => { //dont do this while running capture or we'll explode, also workerize it
    let savedFramesCpy = [...savedFrames];
    savedFrames.length = 0;
    for(let i = 0; i < savedFramesCpy.length; i++) {
      
      if(poolCt === poolCtMax) { //we need to await this last promise;
        classifierWait = new Promise((res) => {
          let id = classifierThread.addCallback(() => {
            classifierThread.removeCallback(id);
            threadRunning = false;
            classifierWait = undefined; //dereference for next frame
            res(true);
          });
        });
        threadRunning = true;
      } else if(classifierWait) await classifierWait; //make sure classifierThread finishes last round.
      
      
      const frame = savedFramesCpy[i].image;
      const fileName = savedFramesCpy[i].name;

      let frameCpy;
      if((isVideo && saveFrames.checked) || (!isVideo && saveFile.checked)) frameCpy = (frame as VideoFrame).clone();

      let id = poolingThread.addCallback((out) => {
        if(out === savedFramesCpy[i].name) {
          poolingThread.removeCallback(id);

          poolingThread.run(
            {command:'get',name:fileName},
            undefined, 
            classifierThread.id
          );
          
        }
      });

      poolCt++;

      videoDecoderThread.run(
        savedFramesCpy[i], 
        [frame]
      );
      
      //ur gonna get a lot of images if you did this on a video < __ <
      if((isVideo && saveFrames.checked) || (!isVideo && saveFile.checked)) { 
          offscreen.width = savedFramesCpy[i].width; offscreen.height = savedFramesCpy[i].height;
          createImageBitmap(
            frameCpy as VideoFrame, 
            0, 0, 
            savedFramesCpy[i].width, 
            savedFramesCpy[i].height
          ).then(async (bmp) => {
            ctx?.drawImage(bmp,0,0);
            let blob = await offscreen.convertToBlob();
            var hiddenElement = document.createElement('a') as HTMLAnchorElement;
            hiddenElement.href =  URL.createObjectURL(blob);
            hiddenElement.target = "_blank";
            hiddenElement.download = fileName;
            
            hiddenElement.click();
          });
      }
    } 
  }


  
  //checkboxes
  const saveFile = parentElement.querySelector('#save') as HTMLInputElement;
  const cloudSave = parentElement.querySelector('#cloudsave') as HTMLInputElement;
  const saveFrames = parentElement.querySelector('#saveframes') as HTMLInputElement;

  const fname = parentElement.querySelector('#fname') as HTMLInputElement;

  const takePic = parentElement.querySelector('#tp') as HTMLButtonElement;
  const recVid = parentElement.querySelector('#rv') as HTMLButtonElement;

  const flashModes = parentElement.querySelector('#flashModes') as HTMLSelectElement;
  const flip = parentElement.querySelector('#flip') as HTMLButtonElement;
  //ui
  const folderSelect = parentElement.querySelector('#folderSelect') as HTMLSelectElement;
  const folderContents = parentElement.querySelector('#folderContents') as HTMLDivElement;

  const frameTime = parentElement.querySelector('#classTime') as HTMLSpanElement
  const avgFrameTime = parentElement.querySelector('#classAvgTime') as HTMLSpanElement


  function setCapture(name,type,classifierResult) {
    TempCaptureOrder.push(name);
    if(classifierResult) {
      if(TempCaptureOrder.length > TempCaptureLimit) {
        delete TempCaptures[TempCaptureOrder[0]];
        delete TempResults[TempCaptureOrder[0]];
        if(TempCanvases[TempCaptureOrder[0]]) (TempCanvases[TempCaptureOrder[0]] as HTMLElement).remove()
        delete TempCanvases[TempCaptureOrder[0]];
        TempCaptureOrder.shift()
      }
    }
    if(folderSelect.selectedIndex === 0) { //temp folder so we should visualize these
        visualizeCapture(name,type,classifierResult);
    }
  }

  function visualizeCapture(
    name:string, 
    type='image',
    classifierResult?:{
      inferenceTime:number,
      avgFrameTime:number,
      avgFrameRate:number,
      height:number,
      width:number,
      name:string,
      label:string,
      maxProb:number,
      probs:number[]
    }
  ) {
    if(classifierResult?.inferenceTime) {
      frameTime.innerText = `${classifierResult.inferenceTime.toFixed(2)}`;
      avgFrameTime.innerText = `${classifierResult.avgFrameRate.toFixed(2)}`;
    }

    if(type === 'image' && classifierResult) {
      let canvas = document.createElement('canvas');
      canvas.width = classifierResult.width; canvas.height = classifierResult.height;
      let offscreen = canvas.transferControlToOffscreen();

      canvasThread.run(
        {canvas:offscreen, name},[offscreen]
      );
      poolingThread.run(
        {command:'getbmp', name}, undefined, canvasThread.id
      );

      const div = document.createElement('div');
      div.appendChild(canvas);

      //spaghetti
      div.insertAdjacentHTML('afterbegin',`
          <div style="position:absolute;">
            <table>
              <tr style='background-color:blue;'>
                <td><span style='font-weight:bold; background-color:blue;'>Image: </span>${classifierResult?.name}</td>
              </tr>
              <tr style='background-color:blue;'>
                <td><span style='font-weight:bold; background-color:blue;'>Most Likely: </span>${classifierResult?.label}</td>
                <td><span style='font-weight:bold;'>Probability: </span>${classifierResult?.maxProb.toFixed(3)}%</td>
              </tr>
            </table>
          </div>
      `);
      TempCanvases[name] = div;

      folderContents.insertAdjacentElement('afterbegin',div);
    } else if (type === 'video') {
      let data = TempCaptures[name].image;
      let video = document.createElement('video');
      video.src = data; //Object Url
      folderContents.insertAdjacentElement('afterbegin',video);
    }
  } 

  folderSelect.onchange = () => {
      if(folderSelect.selectedIndex === 0) {
        folderSelect.innerHTML = '';
        for(const key in TempCaptures) {
            let c = TempCaptures[key];
            visualizeCapture(c.name,c.type,TempResults[c.name]);
        }
      } else {
        folderSelect.innerHTML = '';
        //todo: add local file reader
      }
  }


  Cam.start(cameraPreviewOptions).then(() => {

    const vid = (parentElement.querySelector('#video') as HTMLVideoElement);
    //todo:  vid.videoWidth, vid.videoHeight are unsatisfying, we'd rather have direct camera info from the API but this should max out the resolution OK
    setTimeout(()=>{console.log(vid.videoWidth,vid.videoHeight);},300);

    if(onMobile) {
        Cam.getSupportedFlashModes().then((modes) => {
        for(const flashMode of modes.result) {
          flashModes.insertAdjacentHTML('beforeend',`
          <option>${flashMode}</option>
          `);
          flashModes.onchange = () => {
            Cam.setFlashMode({flashMode});
          }
        }
      });
    } else flashModes.style.display = 'none';
  
    if(onMobile) 
        flip.onclick = () => {
        Cam.flip();
        }
    else flip.style.display = 'none';

    //todo: button to press or hold to capture or record ? or maybe better to have two buttons for ease of use

    
    //android / ios only (todo: reimplement our other settings for this from the fishscanner demo)
    const recordOnClick = () => {
        let reader = new FileReader() as FileReader;
        let mediaRecorder:MediaRecorder; 
        let chunks = [] as any[];

        
        let fileName;
        if (fname.value !== "") {
          fileName = fname.value+'_'+new Date().toISOString();
        } else{
          fileName = new Date().toISOString();
        }

        let frameCb;

        const setupFrameCallbacks = () => {
          let onframe = async (timestamp) => {
            if(!threadRunning) { //throttles
              let frameName = fname.value+'_'+new Date().toISOString();
              console.time(`capture and inference ${frameName}`);

              const image = new VideoFrame(vid, {timestamp});
              const frame = {
                image,
                name:frameName,
                timestamp,
                width:vid.videoWidth,
                height:vid.videoHeight,
                type:'image',
                command:'set',
                overridePort:true,
                outputWidth,
                outputHeight
              }
              savedFrames.push(frame); //process at end of recording to prevent CPU exploding
              if(savedFrames.length > decoderPool) 
                processFrames(true); 
            }
            frameCb = vid.requestVideoFrameCallback(onframe);
          }
          frameCb = vid.requestVideoFrameCallback(onframe);
        }

        //if(onMobile) {
        //  Cam.startRecordVideo({}).then(() => {
        //    setupFrameCallbacks();
        //  });
        //} else {
            let stream = (vid as any).captureStream(30) as MediaStream;
            mediaRecorder = new MediaRecorder(stream);
            
            mediaRecorder.ondataavailable = (e) => {
                chunks.push(e.data);
            };
            mediaRecorder.onstop = () => {
              vid.cancelVideoFrameCallback(frameCb);
              let blob = new Blob(chunks, {'type':'video/mp4'});

              TempCaptures[fileName] = {
                image:URL.createObjectURL(blob),
                name:fileName,
                timestamp:Date.now(),
                width:vid.videoWidth,
                height:vid.videoHeight,
                type:'video',
                outputWidth,
                outputHeight
              };
              TempCaptureOrder.push(fileName);

              if(saveFile.checked) {
                  chunks.length = 0;
                  reader.onload = (ev)=>{
                      ev.target && downloadMP4URL(ev.target.result, fileName);
                  };
                  
                  reader.readAsDataURL(blob); 
              }

              processFrames(true);
            }

            mediaRecorder.start();

            setupFrameCallbacks();
        //}
  
        recVid.innerHTML = 'Stop Recording';
        recVid.onclick = () => {
            // if(onMobile) {
            //     CameraPreview.stopRecordVideo().then((filePath) => {
            //         //read the file from path and do stuff with it
            //         onstop();
            //     });
            // } else {
              if(mediaRecorder) mediaRecorder.stop();
            //}
            recVid.innerHTML = 'Record Video';
            recVid.onclick = recordOnClick;
        } 
      }
    recVid.onclick = recordOnClick;
  
    let offscreen = new OffscreenCanvas(vid.videoWidth, vid.videoHeight);
    let ctx = offscreen.getContext('2d');
    takePic.onclick = async () => {
      if(!threadRunning) { //throttle
      //Cam.capture({
      //  quality:100
      //}).then(async (result) => {
          const image = new VideoFrame(vid);
          let fileName;
          if (fname.value !== "") {
            fileName = fname.value+'_'+new Date().toISOString()+".png";
          } else{
            fileName = new Date().toISOString()+".png";
          }
          console.time(`capture and inference ${fileName}`);
  
          const frame = {
            image,
            name:fileName,
            width:vid.videoWidth,
            height:vid.videoHeight,
            timestamp:Date.now(),
            type:'image',
            command:'set',
            overridePort:true,
            outputWidth,
            outputHeight
          };
          savedFrames.push(frame);

          processFrames(false);

        //});
      }

    }
  
  });
  
}
