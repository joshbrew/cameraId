
//@ts-ignore
import camHTML from './camera.html'
import { CameraPreview, CameraPreviewOptions } from '@capacitor-community/camera-preview'
import { downloadMP4URL, isMobile } from './util/utils';
import { initVideoProcessingThreads } from './camThreads';

//TODO: WEB WORKERS!!!!
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
      div.insertAdjacentHTML('afterbegin',`
          <div style="position:absolute;">
            <table>
              <tr>
                <td><span style='font-weight:bold;'>Image: </span>${classifierResult?.name}</td>
              </tr>
              <tr>
                <td><span style='font-weight:bold;'>Label: </span>${classifierResult?.label}</td>
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

    //android / ios only (todo: reimplement our other settings for this from the fishscanner demo)
    const recordOnClick = () => {
        let reader = new FileReader() as FileReader;
        let mediaRecorder:MediaRecorder; 
        let chunks = [] as any[];

        let savedFrames = [] as any[];
        let onstop = () => { //dont do this while running capture or we'll explode, also workerize it
            savedFrames.forEach((f) => {
                (setCapture as any)(f);
                poolingThread.run({command:'get',name:f},undefined,classifierThread.id);
                //todo: save images
            })
        }
        
        let fileName;
        if (fname.value !== "") {
          fileName = fname.value+'_'+new Date().toISOString()+".png";
        } else{
          fileName = new Date().toISOString()+".png";
        }


        const setupFrameCallbacks = () => {
          let onframe = async (timestamp) => {
              
            let frameName;
            if (fname.value !== "") {
                frameName = fname.value+'_'+new Date().toISOString();
            } else{
                frameName = new Date().toISOString();
            }

            const frame = new VideoFrame(vid, {timestamp});
            if(saveFrames.checked) {

              let poolingWait = new Promise((res)=>{
                let id = poolingThread.addCallback((out) => {
                  poolingThread.removeCallback(id);
                  res(out);
                });
              });
      
              await videoDecoderThread.run(
                {
                  image:frame,
                  name:fileName,
                  width:vid.videoWidth,
                  height:vid.videoHeight,
                  type:'image',
                  command:'set',
                  overridePort:true
                }, 
                [frame]
              );
      
        
              await poolingWait;

              poolingThread.run(
                {command:'get',name:fileName},
                undefined, 
                classifierThread.id
              );

              savedFrames.push(frameName);
            } else {

              //instead of storing in the poolingThread just send straight to classifier
              // classifierThread.run({
              //   image:frame,
              //   name:frameName,
              //   width:vid.videoWidth,
              //   height:vid.videoHeight,
              //   type:'image'
              // },[frame]); //callback will run
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

                onstop();
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
      //Cam.capture({
      //  quality:100
      //}).then(async (result) => {
        const frame = new VideoFrame(vid);
        
        let fileName;
        if (fname.value !== "") {
          fileName = fname.value+'_'+new Date().toISOString()+".png";
        } else{
          fileName = new Date().toISOString()+".png";
        }
        console.time(`capture and inference ${fileName}`);

        let poolingWait = new Promise((res)=>{
          let id = poolingThread.addCallback((out) => {
            poolingThread.removeCallback(id);
            res(out);
          });
        });

        await videoDecoderThread.run(
          {
            image:frame,
            name:fileName,
            width:vid.videoWidth,
            height:vid.videoHeight,
            type:'image',
            command:'set',
            overridePort:true
          }, 
          [frame]
        );

        await poolingWait;

        poolingThread.run(
          {command:'get',name:fileName},
          undefined, 
          classifierThread.id
        );
        
        if(saveFile.checked) {
            offscreen.width = vid.videoWidth; offscreen.height = vid.videoHeight;
            ctx?.drawImage(vid,0,0);
            let blob = await offscreen.convertToBlob();
            var hiddenElement = document.createElement('a') as HTMLAnchorElement;
            hiddenElement.href =  URL.createObjectURL(blob);
            hiddenElement.target = "_blank";
            hiddenElement.download = fileName;
            
            hiddenElement.click();
        }

      //});
    }
  
  });
  
}
