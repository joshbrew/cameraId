
//@ts-ignore
import camHTML from './camera.html'
import { CameraPreview, CameraPreviewOptions } from '@capacitor-community/camera-preview'
import { downloadMP4URL, isMobile } from './util/utils';
import { initVideoProcessingThreads } from './camThreads';

export async function setupCamUI(parentElement=document.body) {

  const onMobile = isMobile();
  const Cam = CameraPreview;
  parentElement.insertAdjacentHTML('afterbegin',camHTML);
  
  //appended by CameraPreview

  //checkboxes
  const saveFile = parentElement.querySelector('#save') as HTMLInputElement;
  const cloudSave = parentElement.querySelector('#cloudsave') as HTMLInputElement;
  const saveFrames = parentElement.querySelector('#saveframes') as HTMLInputElement;

  const fname = (document.querySelector('#fname') as HTMLInputElement);

  const takePic = parentElement.querySelector('#tp') as HTMLButtonElement;
  const recVid = parentElement.querySelector('#rv') as HTMLButtonElement;

  const flashModes = parentElement.querySelector('#flashModes') as HTMLSelectElement;
  const flip = parentElement.querySelector('#flip') as HTMLButtonElement;
  //ui
  const folderSelect = parentElement.querySelector('#folderSelect') as HTMLSelectElement;
  const folderContents = parentElement.querySelector('#folderContents') as HTMLDivElement;

  const frameTime = parentElement.querySelector('#classTime') as HTMLSpanElement

  const TempCaptures = {};
  const TempCanvases = {};
  const TempResults = {};
  const TempCaptureOrder = [] as any[];
  const TempCaptureLimit = 5;
  

  const {
    poolingThread, 
    videoDecoderThread, 
    canvasThread, 
    classifierThread
  } = await initVideoProcessingThreads();
  
  classifierThread.addCallback((res)=>{
    console.timeEnd(`capture and inference ${res.name}`);
    console.log('classifier thread result: ', res);
    TempResults[res.name] = res;
    setCapture(res.name,'image',res);
  });

  videoDecoderThread.addCallback((res)=>{console.log('videoDecoderThread thread result: ', res);});
  poolingThread.addCallback((res)=>{console.log('poolingThread result:',res)});

  
  function setCapture(name,type,classifierResult) {
    TempCaptureOrder.push(name);
    if(classifierResult) {
      if(TempCaptureOrder.length > TempCaptureLimit) {
        delete TempCaptures[TempCaptureOrder[0]];
        delete TempResults[TempCaptureOrder[0]];
        (TempCanvases[TempCaptureOrder[0]] as HTMLElement).remove()
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
      avgTimeMs:number,
      height:number,
      width:number,
      name:string,
      label:string,
      maxProb:number,
      probs:number[]
    }
  ) {
    if(classifierResult?.avgTimeMs) frameTime.innerText = `${classifierResult.avgTimeMs}`;

    if(type === 'image') {
      let canvas = document.createElement('canvas');
      canvas.width = 400; canvas.height = 300;
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
                <td><span style='font-weight:bold; background-color:blue;'>Label: </span>${classifierResult?.label}</td>
                <td><span style='font-weight:bold;'>Likelihood: </span>${classifierResult?.maxProb}</td>
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


    //https://github.com/capacitor-community/camera-preview
    const cameraPreviewOptions: CameraPreviewOptions = {
        parent:'webcam', //web only
        position: 'rear', //mobile only

        //previewDims
        width: 3840, //should restrict to max available size 
        height: 2160,

        enableZoom: true
        //enableOpacity: true //AR-friendly mode
    };
    
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
    let savedFrames = [] as any[];
    let prom:Promise<any>|undefined;

    let threadRunning = false;

    let processFrames = async () => { //dont do this while running capture or we'll explode, also workerize it
      
      for(let i = 0; i < savedFrames.length; i++) {
        if(prom) await prom; //make sure classifierThread finishes last round.
        
        prom = new Promise((res) => {
          let id = classifierThread.addCallback(() => {
            classifierThread.removeCallback(id);
            threadRunning = false;
            prom = undefined; //dereference for next frame
            res(true);
          });
        })
        
        const frame = savedFrames[i].image;
        const fileName = savedFrames[i].name;

        let poolingWait = new Promise((res)=>{
          let id = poolingThread.addCallback((out) => {
            poolingThread.removeCallback(id);
            res(out);
          });
        });

        await videoDecoderThread.run(
          savedFrames[i], 
          [frame]
        );

        await poolingWait;

        poolingThread.run(
          {command:'get',name:fileName},
          undefined, 
          classifierThread.id
        );
        
        if(saveFile.checked) { //ur gonna get a lot of images if you did this on a video < __ <
            offscreen.width = vid.videoWidth; offscreen.height = vid.videoHeight;
            ctx?.drawImage(vid,0,0);
            let blob = await offscreen.convertToBlob();
            var hiddenElement = document.createElement('a') as HTMLAnchorElement;
            hiddenElement.href =  URL.createObjectURL(blob);
            hiddenElement.target = "_blank";
            hiddenElement.download = fileName;
            
            hiddenElement.click();
        }
      } 
      savedFrames.length = 0;
    }
    
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

        let offscreen = new OffscreenCanvas(vid.videoWidth, vid.videoHeight);
        let ctx = offscreen.getContext('2d');
        const setupFrameCallbacks = () => {
          let onframe = async (timestamp) => {
            let frameName = fname.value+'_'+new Date().toISOString();

            if(saveFrames.checked) {
              frameName 

              const image = new VideoFrame(vid, {timestamp});
              const frame = {
                image,
                name:fileName,
                width:vid.videoWidth,
                height:vid.videoHeight,
                type:'image',
                command:'set',
                overridePort:true
              }
              savedFrames.push(frame); //process at end of recording to prevent CPU exploding
            } else if(!threadRunning) {
              frameName = fname.value+'_'+new Date().toISOString();

              threadRunning = true;
              
              let id = classifierThread.addCallback(() => {
                threadRunning = false;
                classifierThread.removeCallback(id);
              });

              //this will slow main thread down
              ctx?.drawImage(vid,0,0);
              let imgData = ctx?.getImageData(0,0,vid.videoWidth,vid.videoHeight) as ImageData;

              classifierThread.run(
                {
                  image:imgData.data,
                  name:frameName,
                  width:vid.videoWidth,
                  height:vid.videoHeight,
                  type:'image'
                },
                [imgData.data.buffer]
              ); //callback will run
            }
          }
          vid.requestVideoFrameCallback(onframe);
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
                let blob = new Blob(chunks, {'type':'video/mp4'});

                TempCaptures[fileName] = {
                  image:URL.createObjectURL(blob),
                  name:fileName,
                  width:vid.videoWidth,
                  height:vid.videoHeight,
                  type:'video'
                };
                TempCaptureOrder.push(fileName);

                if(saveFile.checked) {
                    chunks.length = 0;
                    reader.onload = (ev)=>{
                        ev.target && downloadMP4URL(ev.target.result, fileName);
                    };
                    
                    reader.readAsDataURL(blob); 
                }

                processFrames();
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
            type:'image',
            command:'set',
            overridePort:true
          };
          savedFrames.push(frame);

          processFrames();

        //});
      }

    }
  
  });
  
}
