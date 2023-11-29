// ImageProcessor.ts
import { BoundingBoxTool } from "./BoundingBoxTool";
import { MediaElementCreator } from "./MediaElementCreator";
import { CamThreads, initVideoProcessingThreads } from "./CamThreads";
import { CSV } from './util/csv'

import './imageprocessor.css'

export class ImageProcessor {

    id;
    Media:MediaElementCreator;
    BBTool:BoundingBoxTool;
    threads:CamThreads;
    parentElement:HTMLElement;
    container:HTMLElement;
    streamVideo:HTMLInputElement;
    useSpectralAnalysis:HTMLInputElement;
    useAutocor:HTMLInputElement;
    usePano:HTMLInputElement;
    useAveraging:HTMLInputElement;

    outputWidth;
    outputHeight;

    poolCt=0;
    poolCtMaxIdx = 3;
    threadRunning = false;

    classifierWait;
    classifierResults;
    canvasPool = [] as any[]; // Array to store available canvases

    animation;

    constructor(
        parentElement=document.body,
        modelInpWidth:number=224, 
        modelInpHeight:number=224,
        threadSettings?:{
            decoderPool?: number;
            modelName?: string;
            labelsName?: string;
            inputName?: string;
            outputName?: string;
        }
    ) {
                
        this.parentElement = parentElement;
        this.id = Math.random();

        // Callback functions
        const oncreate = (id, element) => {
            console.log('Image, stream or video created with ID or URL:', id);
        };

        const onstarted = (id, element) => {
            console.log('Stream or video started with ID or URL:', id);
        };

        const ondelete = (id, element) => {
            console.log('Media element removed with ID or URL:', id);
            // Perform additional cleanup if necessary
        };

        const ontargetchanged = (id, element) => {
            this.BBTool?.clearBoundingBoxes(true);
            this.BBTool = new BoundingBoxTool(element, { //replace
                color: 'orange',
                labelColor: 'orange',
                oncreate: (box, boxes) => { 
                    console.log("Created", box, boxes); 
                    if(boxes.length === 1) 
                        this.threads.poolingThread.run({command:'delete', name:`0`},undefined,true);
                },
                onedited: (box, boxes, boxIndex) => { 
                    //console.log("Edited", box, boxes); 
                },
                ondelete: (box, boxes, boxIndex) => { 
                    console.log("Deleted", box, boxes);  
                    this.threads.poolingThread.run({command:'delete', name:boxIndex},undefined,true);
                }
            });
            this.clearCanvases();

            setTimeout(()=>{
                const textElm = (document.getElementById('mediaDims'+this.id) as HTMLElement);
                textElm.innerText = `${element.videoWidth || element.naturalWidth || element.width}x${element.videoHeight || element.naturalHeight || element.height}`;
            },300);
            console.log('Stream target changed with ID or URL:', id);
        };

        this.parentElement.insertAdjacentHTML('beforeend',`
            <div id="container${this.id}" class="image-processor-container">
                <div id="mediaElm${this.id}" class="image-processor-camera">
                    <span id="mediaDims${this.id}" class="image-processor-dimensions-label"></span>
                </div>
                <div id="controls${this.id}" class="image-processor-controls">
                    <button id="capture${this.id}" class="image-processor-capture-btn">📷</button>
                    <div class="image-processor-checkboxes">
                        <label for="streamvideo${this.id}">
                            <input type="checkbox" id="streamvideo${this.id}" name="streamvideo">
                            Stream Video
                        </label>
                        <label for="spectral${this.id}">
                            <input type="checkbox" id="spectral${this.id}" name="spectral">
                            Spectral
                        </label>
                        <label for="average${this.id}">
                            <input type="checkbox" id="average${this.id}" name="autocorrelate">
                            Averaging (last 10 per BB)
                        </label>
               
                        <label for="autocorrelate${this.id}">
                            <input type="checkbox" id="autocorrelate${this.id}" name="autocorrelate">
                            Autocorrelated (slow!)
                        </label>
                    </div>
                </div>
                <div id="results${this.id}" class="image-processor-results"></div>
                <div id="workspace${this.id}" class="image-processor-workspace"></div>
            </div>
        `);

        /**
         *          <label for="pano${this.id}">
                            <input type="checkbox" id="pano${this.id}" name="pano">
                            Panoramic
                        </label>
         * 
         */

        this.container = document.getElementById(`container${this.id}`) as HTMLElement;
        this.streamVideo = document.getElementById(`streamvideo${this.id}`) as HTMLInputElement;
        this.useSpectralAnalysis = document.getElementById(`spectral${this.id}`) as HTMLInputElement;
        this.useAutocor = document.getElementById(`autocorrelate${this.id}`) as HTMLInputElement;
        //this.usePano = document.getElementById(`pano${this.id}`) as HTMLInputElement;
        this.useAveraging = document.getElementById(`average${this.id}`) as HTMLInputElement;
        let animating = false;

        // this.usePano.onchange = () => {
        //     if(this.useAveraging.checked) this.useAveraging.click();
        //     if(this.useAutocor.checked) this.useAutocor.click();
        // }

        this.streamVideo.onchange = () => {
            if(this.streamVideo.checked) {
                animating = true;
                const anim = async () => {
                    if(!animating) return;
                    await this.processBoundingBoxes(); //will prevent thread backup
                    this.animation = requestAnimationFrame(anim);
                }
                this.animation = requestAnimationFrame(anim);
            } else if(this.animation) {
                animating = false;
                cancelAnimationFrame(this.animation);
            }
        }

        this.useSpectralAnalysis.onchange = () => {
            if(!(document.getElementById('savespectrum'+0) as HTMLElement)) return;
            if(this.useSpectralAnalysis.checked) {
                (document.getElementById('savespectrum'+0) as HTMLElement).style.display = '';
                (document.getElementById('savespectrumcsv'+0) as HTMLElement).style.display = '';
                (document.getElementById('canvas2'+0) as HTMLElement).style.display = '';
                this.BBTool.boxes.forEach((b,i) => {
                    if(i===0) return;
                    (document.getElementById('savespectrum'+i) as HTMLElement).style.display = '';
                    (document.getElementById('savespectrumcsv'+i) as HTMLElement).style.display = '';
                    (document.getElementById('canvas2'+i) as HTMLElement).style.display = '';
                })
            } else {
                (document.getElementById('savespectrum'+0) as HTMLElement).style.display = 'none';
                (document.getElementById('savespectrumcsv'+0) as HTMLElement).style.display = 'none';
                (document.getElementById('canvas2'+0) as HTMLElement).style.display = 'none';
                this.BBTool.boxes.forEach((b,i) => {
                    (document.getElementById('savespectrum'+i) as HTMLElement).style.display = 'none';
                    (document.getElementById('savespectrumcsv'+i) as HTMLElement).style.display = 'none';
                    (document.getElementById('canvas2'+i) as HTMLElement).style.display = 'none';
                })
            }
        };

        // Initialize MediaElementCreator
        this.Media = new MediaElementCreator(
            document.getElementById(`mediaElm${this.id}`) as HTMLElement,
            {
                oncreate: oncreate,
                onstarted: onstarted,
                ondelete: ondelete,
                ontargetchanged: ontargetchanged
            }
        );

        this.outputWidth = modelInpWidth;
        this.outputHeight = modelInpHeight;

        this.initThreads(modelInpWidth, modelInpHeight, threadSettings); 
               
        const captureButton = (document.getElementById('capture'+this.id) as HTMLElement);
        captureButton.title = "Take Snapshot";
        captureButton.onclick = () => {

            // Add the active class to trigger the animation
            captureButton.classList.add('capture-btn-active');

            this.processBoundingBoxes();

            // Reattach the click event listener after the animation ends
            captureButton.addEventListener('animationend', () => {
                // Remove the active class after the animation
                captureButton.classList.remove('capture-btn-active');
            });
        };

    }

    async initThreads(outputWidth, outputHeight, {
        decoderPool=4,
        modelName='opt-squeeze.onnx',
        labelsName='squeeze-labels.txt',
        //just single i/o for now
        inputName='data',
        outputName='squeezenet0_flatten0_reshape0'
    }={}) {
        
        // Initialization of threads based on your provided code snippet
        this.threads = await initVideoProcessingThreads(
            decoderPool,
            modelName,
            labelsName,
            inputName,
            outputName,
            outputWidth,
            outputHeight
        );

        this.threads.classifierThread.addCallback((res) => {
            if(!res) return;
            console.timeEnd(`capture and inference ${res.id}`);
            //console.log('classifier thread result: ', res);
            this.visualizeCapture(res);
            this.poolCt--;
        });

        this.threads.videoDecoderThread.addCallback((res)=>{
            //console.log('videoDecoderThread thread result: ', res);
        });
        this.threads.poolingThread.addCallback((res)=>{
            //console.log('poolingThread result:',res)
        });
      
    }

    clearCanvases = () => {
        for(let i = 0; i < this.canvasPool.length; i++) {
            this.threads.canvasThread.run({cropIndex:i, delete:true});
            document.getElementById('div'+i)?.remove(); //clear the control div
        }
        this.canvasPool = [];
    }

    deinit() {
        for(const key in this.threads) {
            this.threads[key].terminate();
        }
        this.container.remove();
    }

    // Method to get a canvas from the pool or create a new one
    getOrCreateCanvas(crop) {
        if (this.canvasPool[crop.cropIndex]) {
            let canvas = this.canvasPool[crop.cropIndex];
            return canvas; // Reuse a canvas from the pool
        } else {
            let canvas = document.createElement('canvas') as HTMLCanvasElement;
            canvas.id = 'canvas'+crop.cropIndex;
            canvas.width = crop.outputWidth; canvas.height = crop.outputHeight;
            this.canvasPool.push(canvas);
            canvas.style.maxWidth = '150px'; canvas.style.maxHeight = '150px';

            let offscreen = canvas.transferControlToOffscreen();
      
            this.threads.canvasThread.run(
              {canvas:offscreen, cropIndex:crop.cropIndex},[offscreen]
            );

            //for visualizing spectrograms
            let canvas2 = document.createElement('canvas') as HTMLCanvasElement;
            canvas2.id = 'canvas2'+crop.cropIndex;
            canvas2.width = crop.outputWidth; canvas2.height = crop.outputHeight;
            canvas2.style.maxWidth = '150px'; canvas2.style.maxHeight = '150px';
            canvas2.style.position='absolute';

            let offscreen2 = canvas2.transferControlToOffscreen();
      
            this.threads.canvasThread.run(
              {
                canvas:offscreen2, 
                cropIndex:crop.cropIndex+'s'
                },[
                    offscreen2
                ]
            );

            let canvasDiv = document.createElement('div');
            canvasDiv.id = 'div'+crop.cropIndex;

            canvasDiv.innerHTML = `
                <table class="image-processor-table">
                    <tr>
                        <td class="image-processor-media" id="canvasContainer${crop.cropIndex}">
                            <span class="image-processor-dimensions-label">${crop.outputWidth}x${crop.outputHeight}</span>
                        </td>
                        <td id="output${crop.cropIndex}">
                            <table class="image-processor-table">
                                <tr id="imgheaderrow${crop.cropIndex}"  class="image-processor-table-header">
                                    <td colSpan="2" class="image-processor-table-cell">
                                        <input type="text" id="name${crop.cropIndex}" placeholder="Image Name"> .png
                                    </td>
                                    <td id="imgheadercell${crop.cropIndex}" class="image-processor-table-cell"></td>
                                </tr>
                                <tr>
                                    <th>Best Guess:</th>
                                    <th>Probability:</th>
                                    <th>ONNX Time (ms):</th>
                                </tr>
                                <tr class="image-processor-table-row">
                                    <td id="label${crop.cropIndex}" class="image-processor-table-cell"></td>
                                    <td id="maxProb${crop.cropIndex}" class="image-processor-table-cell"></td>
                                    <td id="inferenceTime${crop.cropIndex}" class="image-processor-table-cell"></td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            `;

            let dimensionsLabel = document.createElement('div');
            (document.getElementById(`results${this.id}`) as HTMLElement).appendChild(canvasDiv);
            (document.getElementById(`canvasContainer${crop.cropIndex}`) as HTMLElement).appendChild(canvas);
            (document.getElementById(`canvasContainer${crop.cropIndex}`) as HTMLElement).appendChild(canvas2);
            (document.getElementById(`canvasContainer${crop.cropIndex}`) as HTMLElement).appendChild(dimensionsLabel);

            canvas2.style.left = 0+'px';
            canvas2.style.display = this.useSpectralAnalysis.checked ? '' : 'none';
            let appendTo = (document.getElementById('imgheadercell'+crop.cropIndex) as HTMLElement);

            // Button for downloading the base canvas
            let downloadDiv = document.createElement('div');
            let downloadBtn = document.createElement('button');
            downloadBtn.id = "save"+crop.cropIndex;
            downloadBtn.innerHTML = '💾'; // Replace with actual save icon
            downloadBtn.addEventListener('click', () => this.downloadCanvas('canvas' + crop.cropIndex, crop.cropIndex));
            downloadBtn.title = "Download Image";

            // Button for downloading the spectrum canvas
            let downloadSpectrumBtn = document.createElement('button');
            downloadSpectrumBtn.id = "savespectrum"+crop.cropIndex;
            downloadSpectrumBtn.innerHTML = '💾🌈'; // Replace with actual icons
            downloadSpectrumBtn.addEventListener('click', () => {
                this.downloadCanvas('canvas2' + crop.cropIndex, crop.cropIndex);
            });
            downloadSpectrumBtn.style.display = this.useSpectralAnalysis.checked ? '' : 'none';
            downloadSpectrumBtn.title = "Download Spectrum Image";

            // Download spectral data as csv
            let downloadSpectrumCSVBtn = document.createElement('button');
            downloadSpectrumCSVBtn.id = "savespectrumcsv"+crop.cropIndex;
            downloadSpectrumCSVBtn.innerHTML = '💾📉'; // Replace with actual icons
            downloadSpectrumCSVBtn.addEventListener('click', () => {
                downloadSpectrumCSV();
            });
            downloadSpectrumCSVBtn.style.display = this.useSpectralAnalysis.checked ? '' : 'none';
            downloadSpectrumCSVBtn.title = "Download Spectrum CSV";

            let setBaselineButton = document.createElement('button');
            setBaselineButton.id = "setbaseline"+crop.cropIndex;
            setBaselineButton.innerHTML = '⛳'; // Replace with actual icons
            setBaselineButton.addEventListener('click', () => {
                this.threads.poolingThread.run({command:'baseline', name:crop.name},undefined,true);
            });
            setBaselineButton.title = "Set as Baseline";


            //TODO: Spectrum CSV (pull from poolingThread with getspectral:true and overridePort:true)
            let downloadSpectrumCSV = async () => {
                let result = await this.threads.poolingThread.run({command:'getspectral', name:crop.name}, undefined, true);
                if(!result?.spectral) return;
                const spectralData = result.spectral;
                let csvName = (document.getElementById(`name${crop.cropIndex}`) as HTMLInputElement).value || 'image_'+new Date().toISOString();
                let processed = "Intensity,R,G,B\n";
                for(const value of spectralData.intensities) {
                    processed += `${value.i},${value.r},${value.g},${value.b}\n`;
                }
                CSV.saveCSV(processed, csvName);
            }

            downloadDiv.appendChild(setBaselineButton);
            downloadDiv.appendChild(downloadBtn);
            downloadDiv.appendChild(downloadSpectrumBtn);
            downloadDiv.appendChild(downloadSpectrumCSVBtn);
        
            appendTo.appendChild(downloadDiv);
        }
    }
    
    downloadCanvas(canvasId, cropIndex) {
        let canvas = document.getElementById(canvasId) as HTMLCanvasElement;
        if (canvas) {
            let imageName = (document.getElementById(`name${cropIndex}`) as HTMLInputElement).value || 'image_'+new Date().toISOString();
            canvas.toBlob((blob) => {
                let link = document.createElement('a');
                link.download = imageName + '.png';
                link.href = URL.createObjectURL(blob as Blob);
                link.click();
                URL.revokeObjectURL(link.href); // Clean up the URL object
            }, 'image/png');
        }
    }

    clearExcessCanvases = () => {
        if(this.canvasPool.length > (this.BBTool.boxes.length || 1)) { //preserve the first canvas
            for(let i = (this.BBTool.boxes.length || 1); i < this.canvasPool.length; i++) {
                this.threads.canvasThread.run({cropIndex:i, delete:true});
                this.threads.canvasThread.run({cropIndex:i+'s', delete:true});
                document.getElementById('div'+i)?.remove(); //clear the control div
            }
            this.canvasPool.length = (this.BBTool.boxes.length || 1);
        }
    }

    getBoundingBoxData = () => {
        this.clearExcessCanvases();
        
        return this.BBTool.boxes.map((box,i) => {
            return {
                name:`${i}`,
                id:`${Math.floor(Math.random()*1000000000000000)}`,
                cropX:box.rect.x,
                cropY:box.rect.y,
                cropW:box.rect.width,
                cropH:box.rect.height,
                outputWidth:this.outputWidth,
                outputHeight:this.outputHeight,
                cropIndex:i
            };
        });
    }

    processBoundingBoxes = async (
        data=this.getBoundingBoxData()
    ) => {
        // Here we would capture the frame data related to the bounding box
        // However, the specifics of how to capture and process the frame depend on your application's logic
        if(!this.Media.currentMediaElement) return;
        // For demonstration, we'll assume we have a function to capture the frame
        const timestamp = (this.Media.currentMediaElement as HTMLVideoElement).currentTime || Date.now();
        const frame = new VideoFrame(this.Media.currentMediaElement, {timestamp:Date.now()});
        
        if(data.length === 0) {
            const sourceWidth = (this.Media.currentMediaElement as HTMLImageElement).naturalWidth || (this.Media.currentMediaElement as HTMLVideoElement).videoWidth || this.Media.currentMediaElement.width;
            const sourceHeight = (this.Media.currentMediaElement as HTMLImageElement).naturalHeight || (this.Media.currentMediaElement as HTMLVideoElement).videoHeight || this.Media.currentMediaElement.height;
        
            data.push({
                name:`0`,
                id:`${Math.floor(Math.random()*1000000000000000)}`,
                cropX:0,
                cropY:0,
                cropW:sourceWidth,
                cropH:sourceHeight,
                outputWidth:this.outputWidth,
                outputHeight:this.outputHeight,
                cropIndex:0
            });
        }

        if(this.classifierWait) 
            await this.classifierWait; //make sure classifierThread finishes last round.    
        else if(this.poolCt >= this.poolCtMaxIdx) { //we need to await this last promise;
            this.classifierWait = new Promise((res) => {
                let id = this.threads.classifierThread.addCallback(() => {
                    if(this.poolCt === 0) { //wait for flush
                        this.threads.classifierThread.removeCallback(id);
                        this.threadRunning = false;
                        this.classifierWait = undefined; //dereference for next frame
                        res(true);
                    }
                });
            });
            this.threadRunning = true;
        }

        let toDecode = {
            image:frame,
            id:`${Math.floor(Math.random()*1000000000000000)}`,
            width:(this.Media.currentMediaElement as HTMLVideoElement).videoWidth || (this.Media.currentMediaElement as HTMLImageElement).naturalWidth || this.Media.currentMediaElement.width,
            height:(this.Media.currentMediaElement as HTMLVideoElement).videoHeight || (this.Media.currentMediaElement as HTMLImageElement).naturalHeight || this.Media.currentMediaElement.height,
            command:this.useAveraging.checked ? 'setaveraged' : 'set',
            timestamp,
            data,
            overridePort:true,
            autocor:this.useAutocor.checked,
            spectral:this.useSpectralAnalysis.checked
        };

        for(const crop of data) {
            console.time(`capture and inference ${crop.id}`);
            this.poolCt++;
                        }
        let id = this.threads.poolingThread.addCallback((out) => {
            if(out === toDecode.id) {
                this.threads.poolingThread.removeCallback(id);
    
                for(const crop of data) { //classify each crop

                    this.getOrCreateCanvas(crop);

                    this.threads.poolingThread.run(
                        {
                            command:'get',
                            name:crop.name
                        },
                        undefined, 
                        this.threads.classifierThread.id
                    );
        
                    this.threads.poolingThread.run(
                        {
                            command:this.useAutocor.checked ? 'getautocorbmp' : 'getbmp', 
                            name:crop.name
                        }, 
                        undefined, 
                        this.threads.canvasThread.id
                    );

                    if(this.useSpectralAnalysis.checked) {
                        this.threads.poolingThread.run(
                            {
                                command:'getspectral', 
                                name:crop.name
                            }, 
                            undefined, 
                            this.threads.canvasThread.id
                        );
                    }
                }
            }
        });
            
        // Send the frame data to the videoDecoderThread for processing
        this.threads.videoDecoderThread.run(toDecode,[frame]);
    
        return true;
    }

    visualizeCapture(
        classifierResult?:{
            inferenceTime:number,
            avgFrameTime:number,
            avgFrameRate:number,
            height:number,
            width:number,
            name:string,
            id:string,
            cropIndex:number,
            label:string,
            maxProb:number,
            probs:number[]
        }
    ) {
      
        if(classifierResult) {
            (document.getElementById('name'+classifierResult.cropIndex) as HTMLInputElement).value = classifierResult?.name;
            (document.getElementById('label'+classifierResult.cropIndex) as HTMLElement).innerText = classifierResult?.label;
            (document.getElementById('maxProb'+classifierResult.cropIndex) as HTMLElement).innerText = classifierResult?.maxProb.toFixed(3) as any;
            (document.getElementById('inferenceTime'+classifierResult.cropIndex) as HTMLElement).innerText = classifierResult?.inferenceTime.toFixed(3) as any;
           
            
            if(this.BBTool.boxes[parseInt(classifierResult.name)]?.id) 
                this.BBTool.updateLabelProgrammatically(
                    this.BBTool.boxes[parseInt(classifierResult.name)].id, classifierResult.label
                );
      
            //TempCanvases[name] = div;
      
            //folderContents.insertAdjacentElement('afterbegin',div);
        }
    }

    // Other methods to handle threading callbacks and aggregation...
}

export default ImageProcessor;

