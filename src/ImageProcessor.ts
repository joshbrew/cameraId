// ImageProcessor.ts
import { BoundingBoxTool } from "./BoundingBoxTool";
import { MediaElementCreator } from "./MediaElementCreator";
import { CamThreads, initVideoProcessingThreads } from "./camThreads";

import './imageprocessor.css'

export class ImageProcessor {

    id;
    Media:MediaElementCreator;
    BBTool:BoundingBoxTool;
    threads:CamThreads;
    parentElement:HTMLElement;
    container:HTMLElement;

    outputWidth;
    outputHeight;

    poolCt=0;
    poolCtMaxIdx = 3;
    threadRunning = false;

    classifierWait;
    classifierResults;
    canvasPool = [] as any[]; // Array to store available canvases


    constructor(
        parentElement=document.body,
        modelInpWidth:number=224, 
        modelInpHeight:number=224
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
            element.style.width = '100%';
            this.BBTool?.clearBoundingBoxes(true);
            this.BBTool = new BoundingBoxTool(element, { //replace
                color: 'orange',
                labelColor: 'orange',
                oncreate: (box, boxes) => { console.log("Created", box, boxes); },
                onedited: (box, boxes) => { console.log("Edited", box, boxes); },
                ondelete: (box, boxes) => { console.log("Deleted", box, boxes); }
            });
            this.clearCanvases();
            console.log('Stream target changed with ID or URL:', id);
        };

        this.parentElement.insertAdjacentHTML('beforeend',`
            <div id="container${this.id}" class="image-processor-container">
                <div id="mediaElm${this.id}" class="image-processor-media"></div>
                <div id="controls${this.id}" class="image-processor-controls">
                    <button id="capture${this.id}" class="image-processor-capture-btn">Capture</button>
                </div>
                <div id="results${this.id}" class="image-processor-results"></div>
            </div>
        `);

        this.container = document.getElementById(`container${this.id}`) as HTMLElement;

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

        this.initThreads(modelInpWidth, modelInpHeight);        
        const captureButton = (document.getElementById('capture'+this.id) as HTMLElement);
        captureButton.onclick = () => {

            // Add the active class to trigger the animation
            captureButton.classList.add('capture-btn-active');

            this.processBoundingBoxes();

            // Reattach the click event listener after the animation ends
            captureButton.addEventListener('animationend', () => {
                // Remove the active class after the animation
                captureButton.classList.remove('capture-btn-active');
            });
        }
    }

    async initThreads(outputWidth, outputHeight) {
        
        //values set for the squeezeNet result
        let decoderPool = 4;
        let modelName = 'opt-squeeze.onnx';//'sononet_simplified.onnx'; //'opt-squeeze.onnx'
        let labelsName = 'squeeze-labels.txt';//'mnist-labels.txt'; /'squeeze-labels.txt';
        let inputName = 'data'//'data'; //'input'
        let outputName = 'squeezenet0_flatten0_reshape0'//'output';//'squeezenet0_flatten0_reshape0' //'output'
        
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
            console.timeEnd(`capture and inference ${res.name}`);
            console.log('classifier thread result: ', res);
            this.visualizeCapture(res);
            this.poolCt--;
        });

        this.threads.videoDecoderThread.addCallback((res)=>{console.log('videoDecoderThread thread result: ', res);});
        this.threads.poolingThread.addCallback((res)=>{console.log('poolingThread result:',res)});
      
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
            let canvas = document.createElement('canvas');
            canvas.id = 'canvas'+crop.cropIndex;
            canvas.width = crop.outputWidth; canvas.height = crop.outputHeight;
            this.canvasPool.push(canvas);
            canvas.style.maxWidth = '100px'; canvas.style.maxHeight = '100px';

            let offscreen = canvas.transferControlToOffscreen();
      
            this.threads.canvasThread.run(
              {canvas:offscreen, cropIndex:crop.cropIndex},[offscreen]
            );

            let canvasDiv = document.createElement('div');
            canvasDiv.id = 'div'+crop.cropIndex;
            canvasDiv.innerHTML = `
                <table>
                <tr>
                    <td id="canvas${crop.cropIndex}">
                        <span class="image-processor-dimensions-label">${crop.outputWidth}x${crop.outputHeight}</span>
                    </td>
                    <td id="output${crop.cropIndex}"></td>
                </tr>
                </table>
            `;

            let dimensionsLabel = document.createElement('div');
    
            (document.getElementById(`results${this.id}`) as HTMLElement).appendChild(canvasDiv);
            (document.getElementById(`canvas${crop.cropIndex}`) as HTMLElement).appendChild(canvas);
            (document.getElementById(`canvas${crop.cropIndex}`) as HTMLElement).appendChild(dimensionsLabel);



            return offscreen;
        }
    }
    
    // Method to return a canvas to the pool
    returnCanvasToPool(canvas) {
        this.canvasPool.push(canvas);
    }

    getBoundingBoxData = () => {
        if(this.canvasPool.length > this.BBTool.boxes.length) {
            for(let i = this.BBTool.boxes.length; i < this.canvasPool.length; i++) {
                this.threads.canvasThread.run({cropIndex:i, delete:true});
                document.getElementById('div'+i)?.remove(); //clear the control div
            }
            this.canvasPool.length = this.BBTool.boxes.length;
        }
        return this.BBTool.boxes.map((box,i) => {
            return {
                name:box.id,
                cropX:box.rect.x,
                cropY:box.rect.y,
                cropW:box.rect.width,
                cropH:box.rect.height,
                outputWidth:this.outputWidth,
                outputHeight:this.outputHeight,
                cropIndex:i
            }
        });
    }

    processBoundingBoxes = async (data=this.getBoundingBoxData()) => {
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
                name:`${Date.now()}`,
                cropX:0,
                cropY:0,
                cropW:sourceWidth,
                cropH:sourceHeight,
                outputWidth:this.outputWidth,
                outputHeight:this.outputHeight,
                cropIndex:0
            })
        }

        //get all the bounding boxes
        if(data.length > 0) {

            let toDecode = {
                image:frame,
                id:`${Date.now()}`,
                width:(this.Media.currentMediaElement as HTMLVideoElement).videoWidth || (this.Media.currentMediaElement as HTMLImageElement).naturalWidth || this.Media.currentMediaElement.width,
                height:(this.Media.currentMediaElement as HTMLVideoElement).videoHeight || (this.Media.currentMediaElement as HTMLImageElement).naturalHeight || this.Media.currentMediaElement.height,
                command:'set',
                timestamp,
                data,
                overridePort:true
            }

            if(this.poolCt === this.poolCtMaxIdx) { //we need to await this last promise;
                this.classifierWait = new Promise((res) => {
                  let id = this.threads.classifierThread.addCallback(() => {
                    this.threads.classifierThread.removeCallback(id);
                    this.threadRunning = false;
                    this.classifierWait = undefined; //dereference for next frame
                    res(true);
                  });
                });
                this.threadRunning = true;
            } else if(this.classifierWait) await this.classifierWait; //make sure classifierThread finishes last round.
      
            this.poolCt++;

            let id = this.threads.poolingThread.addCallback((out) => {
                if(out === toDecode.id) {
                    this.threads.poolingThread.removeCallback(id);
        
                    for(const crop of data) { //classify each crop
                        console.time(`capture and inference ${crop.name}`);
                        this.threads.poolingThread.run(
                            {
                                command:'get',
                                name:crop.name
                            },
                            undefined, 
                            this.threads.classifierThread.id
                        );

                        this.getOrCreateCanvas(crop);
            
                        this.threads.poolingThread.run(
                            {
                                command:'getbmp', 
                                name:crop.name
                            }, 
                            undefined, 
                            this.threads.canvasThread.id
                        );
                    }
                }
            });
              
            // Send the frame data to the videoDecoderThread for processing
            this.threads.videoDecoderThread.run(toDecode,[frame]);
        
            //implement callbacks 
        }
    }

    visualizeCapture(
        classifierResult?:{
            inferenceTime:number,
            avgFrameTime:number,
            avgFrameRate:number,
            height:number,
            width:number,
            name:string,
            cropIndex:number,
            label:string,
            maxProb:number,
            probs:number[]
        }
    ) {
      
        if(classifierResult) {
      
            (document.getElementById('output'+classifierResult.cropIndex) as HTMLElement).innerHTML = `
                <table class="image-processor-table">
                    <tr class="image-processor-table-header">
                        <td colSpan="3" class="image-processor-table-cell"><strong>Image:</strong> ${classifierResult?.name}</td>
                    </tr>
                    <tr class="image-processor-table-row">
                        <td class="image-processor-table-cell"><strong>Best Guess:</strong> ${classifierResult?.label}</td>
                        <td class="image-processor-table-cell"><strong>Probability:</strong> ${classifierResult?.maxProb?.toFixed(3)}</td>
                        <td class="image-processor-table-cell"><strong>Time:</strong> ${classifierResult?.inferenceTime?.toFixed(3)}</td>
                    </tr>
                </table>
            `

            this.BBTool.updateLabelProgrammatically(classifierResult.name, classifierResult.label);
      
            //TempCanvases[name] = div;
      
            //folderContents.insertAdjacentElement('afterbegin',div);
        }
    }

    //create a grid of image crops through the canvas thread after receiving all the crops

    //Create a table on the side of the classifier results

    // Other methods to handle threading callbacks and aggregation...
}

export default ImageProcessor;

